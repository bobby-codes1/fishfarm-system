'use strict';

const express = require('express');
const router  = express.Router();
const {
  getActivePonds,
  getPondById,
  getLogsForPond,
  getFeedInventory,
  getRecentAlerts,
  getDashboardSummary,
  getLogsFiltered,
  getLast7DaysFeedUsage,
  getActiveBatches,
  getFeedTrendData,
  getMortalityTrendData,
  getAllLogsLastNDays,
  getHarvestsInRange,
  getMonthlyHistory,
  getWeeklyReports,
} = require('../db/supabase');
const { generatePdfReport, generateXlsxReport } = require('./export');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDateRange(days) {
  const dates = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

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

function csvRow(cells) {
  return cells.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

// ─── EXISTING ENDPOINTS ───────────────────────────────────────────────────────

// GET /api/ponds
router.get('/ponds', async (req, res) => {
  try {
    const data = await getActivePonds();
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /ponds:', err.message);
    res.status(500).json({ error: 'Failed to fetch ponds' });
  }
});

// GET /api/ponds/:id
router.get('/ponds/:id', async (req, res) => {
  try {
    const [pond, logs] = await Promise.all([
      getPondById(req.params.id),
      getLogsForPond(req.params.id, 30),
    ]);
    res.json({ data: { pond, logs } });
  } catch (err) {
    console.error('[API] GET /ponds/:id:', err.message);
    res.status(500).json({ error: 'Failed to fetch pond detail' });
  }
});

// GET /api/feed
router.get('/feed', async (req, res) => {
  try {
    const feeds     = await getFeedInventory();
    const usageLogs = await getLast7DaysFeedUsage();

    const enriched = feeds.map(f => {
      const logs      = usageLogs.filter(l => l.feed_type_id === f.id);
      const totalKg   = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const avgPerDay = totalKg / 7;
      const daysLeft  = avgPerDay > 0 ? Math.floor(parseFloat(f.quantity_kg) / avgPerDay) : null;
      return { ...f, avgDailyKg: parseFloat(avgPerDay.toFixed(2)), projectedDaysLeft: daysLeft };
    });

    res.json({ data: enriched });
  } catch (err) {
    console.error('[API] GET /feed:', err.message);
    res.status(500).json({ error: 'Failed to fetch feed inventory' });
  }
});

// GET /api/alerts
router.get('/alerts', async (req, res) => {
  try {
    const data = await getRecentAlerts(30);
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /alerts:', err.message);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// GET /api/summary
router.get('/summary', async (req, res) => {
  try {
    const data = await getDashboardSummary();
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /summary:', err.message);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// GET /api/logs?pond=&from=&to=
router.get('/logs', async (req, res) => {
  try {
    const { pond, from, to } = req.query;
    const data = await getLogsFiltered({ pondId: pond, from, to });
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /logs:', err.message);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ─── CHART ENDPOINTS ─────────────────────────────────────────────────────────

// GET /api/charts/feed-trend
// { dates: [], ponds: { "A1": [50, 45, ...] } }
router.get('/charts/feed-trend', async (req, res) => {
  try {
    const raw   = await getFeedTrendData(14);
    const dates = buildDateRange(14);

    const pondMap = {};
    for (const log of raw) {
      const name = log.ponds?.name || 'Unknown';
      if (!pondMap[name]) pondMap[name] = {};
      pondMap[name][log.log_date] = (pondMap[name][log.log_date] || 0) + parseFloat(log.feed_amount_kg || 0);
    }

    const ponds = {};
    for (const [name, dayMap] of Object.entries(pondMap)) {
      ponds[name] = dates.map(d => parseFloat((dayMap[d] || 0).toFixed(2)));
    }

    res.json({ dates, ponds });
  } catch (err) {
    console.error('[API] GET /charts/feed-trend:', err.message);
    res.status(500).json({ error: 'Failed to fetch feed trend' });
  }
});

// GET /api/charts/mortality-trend
// { dates: [], totals: [], exceeded_threshold: [] }
router.get('/charts/mortality-trend', async (req, res) => {
  try {
    const [raw, batches] = await Promise.all([
      getMortalityTrendData(14),
      getActiveBatches(),
    ]);

    const totalFish = batches.reduce((s, b) => s + (b.current_count || 0), 0);
    const dates = buildDateRange(14);

    const dayMap = {};
    for (const log of raw) {
      dayMap[log.log_date] = (dayMap[log.log_date] || 0) + (log.mortality_count || 0);
    }

    const totals            = dates.map(d => dayMap[d] || 0);
    const exceeded_threshold = totals.map(t => totalFish > 0 && t / totalFish > 0.02);

    res.json({ dates, totals, exceeded_threshold });
  } catch (err) {
    console.error('[API] GET /charts/mortality-trend:', err.message);
    res.status(500).json({ error: 'Failed to fetch mortality trend' });
  }
});

// GET /api/charts/pond-performance
router.get('/charts/pond-performance', async (req, res) => {
  try {
    const [ponds, logs] = await Promise.all([
      getActivePonds(),
      getAllLogsLastNDays(30),
    ]);

    const todayStr = new Date().toISOString().split('T')[0];
    const sevenAgo = new Date();
    sevenAgo.setDate(sevenAgo.getDate() - 7);
    const sevenAgoStr = sevenAgo.toISOString().split('T')[0];

    const data = ponds.map(pond => {
      const batch        = (pond.fish_batches || []).find(b => b.status === 'active');
      const currentCount = batch ? (batch.current_count || 0) : 0;

      const pondLogs   = logs.filter(l => l.pond_id === pond.id);
      const recentLogs = pondLogs.filter(l => l.log_date >= sevenAgoStr);

      const totalFed7d       = recentLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const mortalityCount7d = recentLogs.reduce((s, l) => s + (l.mortality_count || 0), 0);
      const mortalityRate7d  = currentCount > 0 ? (mortalityCount7d / currentCount) * 100 : 0;

      const sorted        = [...pondLogs].sort((a, b) => b.log_date.localeCompare(a.log_date));
      const lastLogDate   = sorted[0]?.log_date || null;
      const daysSince     = lastLogDate
        ? Math.floor((new Date(todayStr) - new Date(lastLogDate)) / 86400000)
        : 999;

      return {
        pond:            pond.name,
        species:         pond.species,
        currentCount,
        totalFed7d:      parseFloat(totalFed7d.toFixed(2)),
        mortalityCount7d,
        mortalityRate7d: parseFloat(mortalityRate7d.toFixed(2)),
        daysSinceLastLog: daysSince,
        noRecentLog:     daysSince > 2,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('[API] GET /charts/pond-performance:', err.message);
    res.status(500).json({ error: 'Failed to fetch pond performance' });
  }
});

// ─── EXPORT ENDPOINTS ─────────────────────────────────────────────────────────

// GET /api/export/logs.csv?from=&to=&pond=
router.get('/export/logs.csv', async (req, res) => {
  try {
    const { from, to, pond } = req.query;
    const [logs, harvests] = await Promise.all([
      getLogsFiltered({ pondId: pond, from, to }),
      getHarvestsInRange(from, to),
    ]);

    const header = csvRow(['Date', 'Time (UTC)', 'Worker', 'Pond', 'Action', 'Details']);
    const rows   = [header];

    for (const log of logs) {
      const date = fmtDateDMY(log.log_date);
      const time = log.created_at
        ? new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
        : '—';
      const worker = workerLabel(log.logged_by);
      const pondName = log.ponds?.name || '—';
      if (parseFloat(log.feed_amount_kg) > 0) {
        rows.push(csvRow([date, time, worker, pondName, 'Feed', `${log.feed_amount_kg}kg ${log.feed_inventory?.feed_type || ''}`.trim()]));
      }
      if ((log.mortality_count || 0) > 0) {
        rows.push(csvRow([date, time, worker, pondName, 'Mortality', `${log.mortality_count} deaths`]));
      }
    }

    for (const h of harvests) {
      const date = fmtDateDMY(h.harvest_date);
      const time = h.created_at
        ? new Date(h.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
        : '—';
      rows.push(csvRow([date, time, '—', h.ponds?.name || '—', 'Harvest',
        `${h.total_weight_kg}kg, ${h.fish_count} fish sold to ${h.buyer || '?'} → GHS${parseFloat(h.total_revenue_ghs || 0).toLocaleString()}`]));
    }

    const today = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="farm-logs-${today}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    console.error('[API] GET /export/logs.csv:', err.message);
    res.status(500).json({ error: 'Failed to generate logs CSV' });
  }
});

// GET /api/export/inventory.csv
router.get('/export/inventory.csv', async (req, res) => {
  try {
    const [feeds, usageLogs] = await Promise.all([getFeedInventory(), getLast7DaysFeedUsage()]);

    const rows = [csvRow(['Feed Type', 'Current Stock (kg)', 'Reorder Threshold (kg)', 'Days Remaining', 'Unit Cost (GHS)', 'Supplier'])];
    for (const f of feeds) {
      const relevant = usageLogs.filter(l => l.feed_type_id === f.id);
      const total    = relevant.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const avgDay   = total / 7;
      const daysLeft = avgDay > 0 ? Math.floor(parseFloat(f.quantity_kg) / avgDay) : 'N/A';
      rows.push(csvRow([
        f.feed_type,
        parseFloat(f.quantity_kg).toFixed(2),
        parseFloat(f.reorder_threshold_kg).toFixed(2),
        daysLeft,
        f.unit_cost_ghs ? parseFloat(f.unit_cost_ghs).toFixed(2) : '—',
        f.supplier || '—',
      ]));
    }

    const today = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="farm-inventory-${today}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    console.error('[API] GET /export/inventory.csv:', err.message);
    res.status(500).json({ error: 'Failed to generate inventory CSV' });
  }
});

// GET /api/export/report.pdf?from=&to=
router.get('/export/report.pdf', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const from = req.query.from || thirtyAgo;
    const to   = req.query.to   || today;

    const farmName = process.env.FARM_NAME || 'Fish Farm';

    const [summaryRaw, feeds, pondPerfRes, mortality30d, alerts, periodLogs, periodHarvests, usageLogs] = await Promise.all([
      getDashboardSummary(),
      getFeedInventory(),
      getActivePonds(),
      getAllLogsLastNDays(30),
      getRecentAlerts(10),
      getLogsFiltered({ from, to }),
      getHarvestsInRange(from, to),
      getLast7DaysFeedUsage(),
    ]);

    // Enrich feeds with projected days
    const enrichedFeeds = feeds.map(f => {
      const logs    = usageLogs.filter(l => l.feed_type_id === f.id);
      const total   = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const avg     = total / 7;
      return { ...f, projectedDaysLeft: avg > 0 ? Math.floor(parseFloat(f.quantity_kg) / avg) : null };
    });

    // Build pond performance
    const todayStr = today;
    const sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate() - 7);
    const sevenAgoStr = sevenAgo.toISOString().split('T')[0];
    const pondPerf = pondPerfRes.map(pond => {
      const batch        = (pond.fish_batches || []).find(b => b.status === 'active');
      const currentCount = batch?.current_count || 0;
      const pondLogs     = mortality30d.filter(l => l.pond_id === pond.id);
      const recentLogs   = pondLogs.filter(l => l.log_date >= sevenAgoStr);
      const totalFed7d   = recentLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const deaths7d     = recentLogs.reduce((s, l) => s + (l.mortality_count || 0), 0);
      const rate7d       = currentCount > 0 ? (deaths7d / currentCount) * 100 : 0;
      const lastLog      = [...pondLogs].sort((a, b) => b.log_date.localeCompare(a.log_date))[0];
      const daysSince    = lastLog ? Math.floor((new Date(todayStr) - new Date(lastLog.log_date)) / 86400000) : 999;
      return { pond: pond.name, species: pond.species, currentCount, totalFed7d, mortalityCount7d: deaths7d, mortalityRate7d: rate7d, daysSinceLastLog: daysSince, noRecentLog: daysSince > 2 };
    });

    const periodFeedKg   = periodLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const periodRevenue  = periodHarvests.reduce((s, h) => s + parseFloat(h.total_revenue_ghs || 0), 0);

    generatePdfReport(res, {
      farmName, from, to,
      summary:   { ...summaryRaw, periodFeedKg, periodRevenue },
      feeds:     enrichedFeeds,
      pondPerf,
      mortality30d,
      alerts,
    });
  } catch (err) {
    console.error('[API] GET /export/report.pdf:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// GET /api/export/report.xlsx?from=&to=
router.get('/export/report.xlsx', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const from = req.query.from || thirtyAgo;
    const to   = req.query.to   || today;

    const farmName = process.env.FARM_NAME || 'Fish Farm';

    const [summaryRaw, feeds, ponds, allLogs30, periodLogs, periodHarvests, usageLogs] = await Promise.all([
      getDashboardSummary(),
      getFeedInventory(),
      getActivePonds(),
      getAllLogsLastNDays(30),
      getLogsFiltered({ from, to }),
      getHarvestsInRange(from, to),
      getLast7DaysFeedUsage(),
    ]);

    const enrichedFeeds = feeds.map(f => {
      const logs  = usageLogs.filter(l => l.feed_type_id === f.id);
      const total = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const avg   = total / 7;
      return { ...f, projectedDaysLeft: avg > 0 ? Math.floor(parseFloat(f.quantity_kg) / avg) : null };
    });

    const sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate() - 7);
    const sevenAgoStr = sevenAgo.toISOString().split('T')[0];
    const pondPerf = ponds.map(pond => {
      const batch      = (pond.fish_batches || []).find(b => b.status === 'active');
      const count      = batch?.current_count || 0;
      const pondLogs   = allLogs30.filter(l => l.pond_id === pond.id);
      const recent     = pondLogs.filter(l => l.log_date >= sevenAgoStr);
      const fed        = recent.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const deaths     = recent.reduce((s, l) => s + (l.mortality_count || 0), 0);
      const rate       = count > 0 ? (deaths / count) * 100 : 0;
      const last       = [...pondLogs].sort((a, b) => b.log_date.localeCompare(a.log_date))[0];
      const daysSince  = last ? Math.floor((new Date(today) - new Date(last.log_date)) / 86400000) : 999;
      return { pond: pond.name, species: pond.species, currentCount: count, totalFed7d: fed, mortalityCount7d: deaths, mortalityRate7d: rate, daysSinceLastLog: daysSince, noRecentLog: daysSince > 2 };
    });

    const periodFeedKg  = periodLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const periodRevenue = periodHarvests.reduce((s, h) => s + parseFloat(h.total_revenue_ghs || 0), 0);

    await generateXlsxReport(res, {
      farmName, from, to,
      summary:  { ...summaryRaw, periodFeedKg, periodRevenue },
      feeds:    enrichedFeeds,
      pondPerf,
      logs:     periodLogs,
      harvests: periodHarvests,
    });
  } catch (err) {
    console.error('[API] GET /export/report.xlsx:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate Excel report' });
  }
});

// ─── HISTORY ENDPOINTS ────────────────────────────────────────────────────────

// GET /api/history/monthly?month=YYYY-MM
router.get('/history/monthly', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const { logs, harvests, from, to } = await getMonthlyHistory(month);

    const totalFeedKg  = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const totalMortality = logs.reduce((s, l) => s + (l.mortality_count || 0), 0);
    const harvestRevenue = harvests.reduce((s, h) => s + parseFloat(h.total_revenue_ghs || 0), 0);

    // Daily feed per pond (for charts)
    const feedByPond = {};
    for (const log of logs) {
      const pondName = log.ponds?.name || 'Unknown';
      if (!feedByPond[pondName]) feedByPond[pondName] = {};
      feedByPond[pondName][log.log_date] = (feedByPond[pondName][log.log_date] || 0) + parseFloat(log.feed_amount_kg || 0);
    }

    // Daily mortality (for charts)
    const mortalityByDay = {};
    for (const log of logs) {
      mortalityByDay[log.log_date] = (mortalityByDay[log.log_date] || 0) + (log.mortality_count || 0);
    }

    res.json({
      data: {
        from, to, month,
        totalFeedKg:   parseFloat(totalFeedKg.toFixed(2)),
        totalMortality,
        harvestCount:  harvests.length,
        harvestWeightKg: harvests.reduce((s, h) => s + parseFloat(h.total_weight_kg || 0), 0),
        harvestRevenue: parseFloat(harvestRevenue.toFixed(2)),
        feedByPond,
        mortalityByDay,
        harvests,
      },
    });
  } catch (err) {
    console.error('[API] GET /history/monthly:', err.message);
    res.status(500).json({ error: 'Failed to fetch monthly history' });
  }
});

// GET /api/history/harvests?from=&to=
router.get('/history/harvests', async (req, res) => {
  try {
    const { from, to } = req.query;
    const data = await getHarvestsInRange(from, to);
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /history/harvests:', err.message);
    res.status(500).json({ error: 'Failed to fetch harvests' });
  }
});

// GET /api/reports/weekly
router.get('/reports/weekly', async (req, res) => {
  try {
    const data = await getWeeklyReports(12);
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /reports/weekly:', err.message);
    res.status(500).json({ error: 'Failed to fetch weekly reports' });
  }
});

module.exports = router;
