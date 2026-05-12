'use strict';

const {
  getFeedInventory,
  getLast7DaysFeedUsage,
  getActivePonds,
  getActiveBatchForPond,
  getLogsForPond,
  getLogsForDate,
  insertAlert,
} = require('../db/supabase');
const { sendWhatsAppMessage } = require('../whatsapp');

async function runStockAlerts() {
  const ownerPhone = process.env.OWNER_PHONE;
  const today      = new Date().toISOString().split('T')[0];

  await checkFeedRunway(ownerPhone);
  await checkMissedFeedings(ownerPhone);
  await checkMortalitySpike(ownerPhone, today);
}

async function checkFeedRunway(ownerPhone) {
  const feeds     = await getFeedInventory();
  const usageLogs = await getLast7DaysFeedUsage();

  for (const feed of feeds) {
    const logsForFeed  = usageLogs.filter(l => l.feed_type_id === feed.id);
    const totalKg      = logsForFeed.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const avgDailyKg   = totalKg / 7;

    if (avgDailyKg === 0) continue;

    const projectedDays = parseFloat(feed.quantity_kg) / avgDailyKg;
    if (projectedDays < 10) {
      const reorderDate = new Date();
      reorderDate.setDate(reorderDate.getDate() + Math.floor(projectedDays));
      const reorderStr = reorderDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

      const msg = `⚠️ Feed alert: ${feed.feed_type} stock is at ${parseFloat(feed.quantity_kg).toFixed(1)}kg. At current usage (${avgDailyKg.toFixed(1)}kg/day), you have approximately ${Math.floor(projectedDays)} days remaining. Reorder before ${reorderStr}.`;
      await sendWhatsAppMessage(ownerPhone, msg);
      await insertAlert('low_feed', msg, ownerPhone);
    }
  }
}

async function checkMissedFeedings(ownerPhone) {
  const ponds = await getActivePonds();

  for (const pond of ponds) {
    const logs = await getLogsForPond(pond.id, 3);

    // Check if there are 2+ consecutive days with no feeding log
    const logDates = new Set(logs.filter(l => l.feed_amount_kg > 0).map(l => l.log_date));
    let consecutiveMissed = 0;
    let maxConsecutive    = 0;

    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      if (!logDates.has(dateStr)) {
        consecutiveMissed++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveMissed);
      } else {
        consecutiveMissed = 0;
      }
    }

    if (maxConsecutive >= 2) {
      const msg = `⚠️ Feeding alert: ${pond.name} has not been fed for ${maxConsecutive} consecutive days. Please check and log feeding.`;
      await sendWhatsAppMessage(ownerPhone, msg);
      await insertAlert('missed_feeding', msg, ownerPhone);
    }
  }
}

async function checkMortalitySpike(ownerPhone, today) {
  const logs = await getLogsForDate(today);

  for (const log of logs) {
    if (!log.mortality_count || log.mortality_count === 0) continue;

    const batch = await require('../db/supabase').getActiveBatchForPond(log.pond_id);
    if (!batch || batch.current_count === 0) continue;

    const pct = (log.mortality_count / (batch.current_count + log.mortality_count)) * 100;
    if (pct > 2) {
      const pondName = log.ponds?.name || log.pond_id;
      const msg = `🚨 High mortality alert: ${log.mortality_count} deaths in ${pondName} today (${pct.toFixed(1)}% of stock). Immediate attention required.`;
      await sendWhatsAppMessage(ownerPhone, msg);
      await insertAlert('high_mortality', msg, ownerPhone);
    }
  }
}

module.exports = { runStockAlerts };
