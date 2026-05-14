'use strict';

const PDFDocument = require('pdfkit');
const ExcelJS    = require('exceljs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateDMY(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).split('-');
  return `${d}/${m}/${y}`;
}

function workerLabel(phone) {
  if (!phone || phone === '—') return '—';
  const clean = String(phone).replace(/\D/g, '');
  return clean.length >= 4 ? `Worker ...${clean.slice(-4)}` : phone;
}

// ── PDF table helper ──────────────────────────────────────────────────────────

function drawTableRow(doc, cells, colWidths, y, startX = 50) {
  let x = startX;
  cells.forEach((cell, i) => {
    doc.text(String(cell ?? '—'), x, y, { width: colWidths[i] - 4, ellipsis: true });
    x += colWidths[i];
  });
}

function drawTable(doc, headers, rows, colWidths) {
  const startX = 50;
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  // Header row background
  const headerY = doc.y;
  doc.rect(startX, headerY - 2, totalW, 16).fill('#1a4a6b');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  drawTableRow(doc, headers, colWidths, headerY, startX);
  doc.fillColor('#000000').font('Helvetica').fontSize(8);
  doc.y = headerY + 18;

  rows.forEach((row, idx) => {
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
      // Repeat header on new page
      const hy = doc.y;
      doc.rect(startX, hy - 2, totalW, 16).fill('#1a4a6b');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      drawTableRow(doc, headers, colWidths, hy, startX);
      doc.fillColor('#000000').font('Helvetica').fontSize(8);
      doc.y = hy + 18;
    }
    if (idx % 2 === 1) {
      doc.rect(startX, doc.y - 2, totalW, 14).fill('#f7fafc').fillColor('#000000');
    }
    drawTableRow(doc, row, colWidths, doc.y, startX);
    doc.y += 14;
  });
  doc.moveDown(0.5);
}

// ── PDF Report ────────────────────────────────────────────────────────────────

function generatePdfReport(res, { farmName, from, to, summary, feeds, pondPerf, mortality30d, alerts }) {
  const doc   = new PDFDocument({ margin: 50, size: 'A4' });
  const today = new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="farm-report-${today}.pdf"`);
  doc.pipe(res);

  // ── Title block ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 72).fill('#1a4a6b');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
     .text(farmName, 50, 16, { align: 'center', width: doc.page.width - 100 });
  doc.font('Helvetica').fontSize(11)
     .text(`Farm Report — ${fmtDateDMY(from)} to ${fmtDateDMY(to)}`, 50, 42,
           { align: 'center', width: doc.page.width - 100 });
  doc.fillColor('#a0aec0').fontSize(9)
     .text(`Generated: ${fmtDateDMY(today)}`, 50, 60, { align: 'right', width: doc.page.width - 100 });

  doc.fillColor('#000000');
  doc.y = 88;

  // ── Summary ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a4a6b').text('Summary');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke('#1a4a6b');
  doc.moveDown(0.4).font('Helvetica').fontSize(10).fillColor('#000000');

  const summaryRows = [
    ['Total Fish (current)',       (summary.totalFish || 0).toLocaleString()],
    ['Active Ponds',               String(summary.activePonds || 0)],
    ['Total Feed Used (period)',   `${parseFloat(summary.periodFeedKg || 0).toFixed(1)} kg`],
    ['Revenue (period)',           `GHS ${parseFloat(summary.periodRevenue || 0).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`],
    ['Total Feed In Stock',        `${parseFloat(summary.totalFeedKg || 0).toFixed(1)} kg`],
  ];
  summaryRows.forEach(([label, val]) => {
    doc.text(`${label}:`, { continued: true, width: 260 }).text(val);
  });
  doc.moveDown();

  // ── Feed Inventory ───────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a4a6b').text('Feed Inventory');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke('#1a4a6b');
  doc.moveDown(0.4);

  drawTable(doc,
    ['Feed Type', 'Stock (kg)', 'Threshold (kg)', 'Days Left', 'Cost/kg (GHS)', 'Supplier'],
    feeds.map(f => [
      f.feed_type,
      parseFloat(f.quantity_kg).toFixed(1),
      parseFloat(f.reorder_threshold_kg).toFixed(0),
      f.projectedDaysLeft !== null ? f.projectedDaysLeft : 'N/A',
      f.unit_cost_ghs ? `GHS ${parseFloat(f.unit_cost_ghs).toFixed(2)}` : '—',
      f.supplier || '—',
    ]),
    [130, 75, 90, 65, 95, 90]
  );

  // ── Pond Performance ─────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a4a6b').text('Pond Performance — Last 7 Days');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke('#1a4a6b');
  doc.moveDown(0.4);

  drawTable(doc,
    ['Pond', 'Species', 'Fish', 'Fed (kg)', 'Deaths', 'Mortality %', 'Last Log'],
    pondPerf.map(p => [
      p.pond,
      p.species,
      (p.currentCount || 0).toLocaleString(),
      parseFloat(p.totalFed7d || 0).toFixed(1),
      p.mortalityCount7d || 0,
      `${parseFloat(p.mortalityRate7d || 0).toFixed(2)}%`,
      p.daysSinceLastLog === 0 ? 'Today' : `${p.daysSinceLastLog}d ago`,
    ]),
    [60, 70, 55, 65, 50, 75, 70]
  );

  // ── Mortality Summary ────────────────────────────────────────────────────────
  const mortalityLogs = (mortality30d || []).filter(l => l.mortality_count > 0);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a4a6b').text('Mortality Summary — Last 30 Days');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke('#1a4a6b');
  doc.moveDown(0.4);

  if (!mortalityLogs.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#718096').text('No mortality records in the last 30 days.');
    doc.moveDown();
  } else {
    const total = mortalityLogs.reduce((s, l) => s + (l.mortality_count || 0), 0);
    doc.font('Helvetica').fontSize(10).fillColor('#000000')
       .text(`Total deaths recorded: ${total}`).moveDown(0.3);
    drawTable(doc,
      ['Date', 'Pond', 'Deaths'],
      mortalityLogs.slice(0, 30).map(m => [
        fmtDateDMY(m.log_date),
        m.ponds?.name || '—',
        m.mortality_count,
      ]),
      [120, 200, 100]
    );
  }

  // ── Active Alerts ────────────────────────────────────────────────────────────
  if (alerts && alerts.length) {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a4a6b').text('Recent Alerts');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke('#1a4a6b');
    doc.moveDown(0.4);
    drawTable(doc,
      ['Type', 'Date', 'Message'],
      alerts.slice(0, 10).map(a => [
        a.alert_type,
        fmtDateDMY(new Date(a.sent_at).toISOString().split('T')[0]),
        a.message.slice(0, 120),
      ]),
      [90, 80, 325]
    );
  }

  doc.end();
}

// ── XLSX Report ───────────────────────────────────────────────────────────────

async function generateXlsxReport(res, { farmName, from, to, summary, feeds, pondPerf, logs, harvests }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = farmName;
  wb.created = new Date();

  const today = new Date().toISOString().split('T')[0];

  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4A6B' } };
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  const ALT_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
  const RED_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEAEA' } };

  function styleSheet(ws) {
    ws.getRow(1).eachCell(cell => {
      cell.font      = HEADER_FONT;
      cell.fill      = HEADER_FILL;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });
    ws.getRow(1).height = 20;
  }

  // ── Sheet 1: Summary ─────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Summary');
  ws1.columns = [
    { header: 'Metric', key: 'metric', width: 35 },
    { header: 'Value',  key: 'value',  width: 30 },
  ];
  styleSheet(ws1);
  ws1.addRows([
    { metric: 'Farm Name',                  value: farmName },
    { metric: 'Report Period',              value: `${fmtDateDMY(from)} — ${fmtDateDMY(to)}` },
    { metric: 'Generated',                  value: fmtDateDMY(today) },
    { metric: '',                            value: '' },
    { metric: 'Total Fish (current)',       value: summary.totalFish || 0 },
    { metric: 'Active Ponds',               value: summary.activePonds || 0 },
    { metric: 'Total Feed In Stock (kg)',   value: parseFloat(summary.totalFeedKg || 0).toFixed(1) },
    { metric: 'Feed Used — Period (kg)',    value: parseFloat(summary.periodFeedKg || 0).toFixed(1) },
    { metric: 'Revenue — Period (GHS)',     value: parseFloat(summary.periodRevenue || 0).toFixed(2) },
  ]);

  // ── Sheet 2: Activity Logs ───────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Activity Logs');
  ws2.columns = [
    { header: 'Date',        key: 'date',    width: 14 },
    { header: 'Time (UTC)',  key: 'time',    width: 12 },
    { header: 'Worker',      key: 'worker',  width: 20 },
    { header: 'Pond',        key: 'pond',    width: 12 },
    { header: 'Action',      key: 'action',  width: 14 },
    { header: 'Details',     key: 'details', width: 45 },
  ];
  styleSheet(ws2);

  const actRows = [];
  for (const log of (logs || [])) {
    const time = log.created_at
      ? new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      : '—';
    if (parseFloat(log.feed_amount_kg) > 0) {
      actRows.push({ date: fmtDateDMY(log.log_date), time, worker: workerLabel(log.logged_by), pond: log.ponds?.name || '—', action: 'Feed', details: `${log.feed_amount_kg}kg ${log.feed_inventory?.feed_type || ''}`.trim() });
    }
    if ((log.mortality_count || 0) > 0) {
      actRows.push({ date: fmtDateDMY(log.log_date), time, worker: workerLabel(log.logged_by), pond: log.ponds?.name || '—', action: 'Mortality', details: `${log.mortality_count} deaths` });
    }
  }
  for (const h of (harvests || [])) {
    const time = h.created_at
      ? new Date(h.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      : '—';
    actRows.push({ date: fmtDateDMY(h.harvest_date), time, worker: '—', pond: h.ponds?.name || '—', action: 'Harvest', details: `${h.total_weight_kg}kg, ${h.fish_count} fish sold to ${h.buyer || '?'} → GHS${parseFloat(h.total_revenue_ghs || 0).toLocaleString()}` });
  }
  ws2.addRows(actRows);
  ws2.eachRow((row, rn) => { if (rn > 1 && rn % 2 === 0) row.eachCell(c => { c.fill = ALT_FILL; }); });

  // ── Sheet 3: Feed Inventory ──────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('Feed Inventory');
  ws3.columns = [
    { header: 'Feed Type',             key: 'type',      width: 25 },
    { header: 'Current Stock (kg)',    key: 'stock',     width: 20 },
    { header: 'Reorder Threshold (kg)',key: 'threshold', width: 22 },
    { header: 'Days Remaining',        key: 'days',      width: 18 },
    { header: 'Unit Cost (GHS)',       key: 'cost',      width: 18 },
    { header: 'Supplier',              key: 'supplier',  width: 22 },
  ];
  styleSheet(ws3);
  ws3.addRows(feeds.map(f => ({
    type:      f.feed_type,
    stock:     parseFloat(f.quantity_kg),
    threshold: parseFloat(f.reorder_threshold_kg),
    days:      f.projectedDaysLeft !== null ? f.projectedDaysLeft : 'N/A',
    cost:      f.unit_cost_ghs ? parseFloat(f.unit_cost_ghs) : '—',
    supplier:  f.supplier || '—',
  })));

  // ── Sheet 4: Pond Performance ────────────────────────────────────────────────
  const ws4 = wb.addWorksheet('Pond Performance');
  ws4.columns = [
    { header: 'Pond',                 key: 'pond',     width: 12 },
    { header: 'Species',              key: 'species',  width: 15 },
    { header: 'Current Count',        key: 'count',    width: 16 },
    { header: 'Total Fed 7d (kg)',    key: 'fed',      width: 20 },
    { header: 'Deaths (7d)',          key: 'deaths',   width: 14 },
    { header: 'Mortality Rate (7d %)',key: 'rate',     width: 22 },
    { header: 'Days Since Last Log',  key: 'lastlog',  width: 22 },
  ];
  styleSheet(ws4);
  pondPerf.forEach((p, i) => {
    const row = ws4.addRow({
      pond:    p.pond,
      species: p.species,
      count:   p.currentCount || 0,
      fed:     parseFloat(p.totalFed7d || 0).toFixed(1),
      deaths:  p.mortalityCount7d || 0,
      rate:    parseFloat(p.mortalityRate7d || 0).toFixed(2),
      lastlog: p.daysSinceLastLog,
    });
    if (p.noRecentLog) {
      row.eachCell(c => { c.fill = RED_FILL; });
    } else if (i % 2 === 1) {
      row.eachCell(c => { c.fill = ALT_FILL; });
    }
  });

  // ── Sheet 5: Harvest Records ─────────────────────────────────────────────────
  const ws5 = wb.addWorksheet('Harvest Records');
  ws5.columns = [
    { header: 'Date',                key: 'date',    width: 14 },
    { header: 'Pond',                key: 'pond',    width: 12 },
    { header: 'Weight (kg)',         key: 'weight',  width: 14 },
    { header: 'Fish Count',          key: 'count',   width: 14 },
    { header: 'Avg Weight (kg)',     key: 'avg',     width: 18 },
    { header: 'Buyer',               key: 'buyer',   width: 20 },
    { header: 'Price/kg (GHS)',      key: 'price',   width: 18 },
    { header: 'Total Revenue (GHS)', key: 'revenue', width: 22 },
  ];
  styleSheet(ws5);
  (harvests || []).forEach((h, i) => {
    const row = ws5.addRow({
      date:    fmtDateDMY(h.harvest_date),
      pond:    h.ponds?.name || '—',
      weight:  parseFloat(h.total_weight_kg),
      count:   h.fish_count,
      avg:     h.avg_weight_kg ? parseFloat(h.avg_weight_kg) : '—',
      buyer:   h.buyer || '—',
      price:   h.price_per_kg_ghs ? parseFloat(h.price_per_kg_ghs) : '—',
      revenue: parseFloat(h.total_revenue_ghs || 0),
    });
    if (i % 2 === 1) row.eachCell(c => { c.fill = ALT_FILL; });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="farm-report-${today}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { generatePdfReport, generateXlsxReport };
