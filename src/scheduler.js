'use strict';

const cron = require('node-cron');
const { runStockAlerts }     = require('./alerts/stockAlert');
const { generateWeeklyReport } = require('./ai');
const { sendWhatsAppMessage }  = require('./whatsapp');
const { insertAlert }          = require('./db/supabase');
const {
  getLogsForDate,
  getActivePonds,
  getFeedInventory,
} = require('./db/supabase');

function startScheduler() {
  // 6am UTC (= 6am Ghana time, GMT+0) — feed runway + mortality + missed feeding alerts
  cron.schedule('0 6 * * *', async () => {
    console.log('[Scheduler] Running morning stock alerts...');
    try {
      await runStockAlerts();
    } catch (err) {
      console.error('[Scheduler] Stock alert error:', err.message);
    }
  });

  // 7pm UTC — daily summary to owner
  cron.schedule('0 19 * * *', async () => {
    console.log('[Scheduler] Sending daily report...');
    try {
      await sendDailyReport();
    } catch (err) {
      console.error('[Scheduler] Daily report error:', err.message);
    }
  });

  // 8pm UTC every Sunday — weekly AI report
  cron.schedule('0 20 * * 0', async () => {
    console.log('[Scheduler] Generating weekly AI report...');
    try {
      const report = await generateWeeklyReport();
      await sendWhatsAppMessage(process.env.OWNER_PHONE, report);
      await insertAlert('weekly_report', report, process.env.OWNER_PHONE);
    } catch (err) {
      console.error('[Scheduler] Weekly report error:', err.message);
    }
  });

  console.log('[Scheduler] All cron jobs registered.');
}

async function sendDailyReport() {
  const ownerPhone = process.env.OWNER_PHONE;
  const today      = new Date().toISOString().split('T')[0];

  const [todayLogs, activePonds, feeds] = await Promise.all([
    getLogsForDate(today),
    getActivePonds(),
    getFeedInventory(),
  ]);

  const totalFeedToday     = todayLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
  const totalMortalityToday = todayLogs.reduce((s, l) => s + (l.mortality_count || 0), 0);

  const loggedPondIds = new Set(todayLogs.map(l => l.pond_id));
  const missedPonds   = activePonds.filter(p => !loggedPondIds.has(p.id)).map(p => p.name);

  const feedSnapshot = feeds
    .map(f => `  • ${f.feed_type}: ${parseFloat(f.quantity_kg).toFixed(1)}kg`)
    .join('\n');

  let msg = `🌅 Daily Farm Report — ${today}\n\n`;
  msg += `Feed used today: ${totalFeedToday.toFixed(1)}kg\n`;
  msg += `Mortalities today: ${totalMortalityToday}\n`;

  if (missedPonds.length) {
    msg += `\n⚠️ No logs today for: ${missedPonds.join(', ')}\n`;
  }

  msg += `\nFeed Inventory:\n${feedSnapshot}`;

  await sendWhatsAppMessage(ownerPhone, msg);
  await insertAlert('daily_report', msg, ownerPhone);
}

module.exports = { startScheduler };
