'use strict';

const {
  getPondByName,
  getActiveBatchForPond,
  insertDailyLog,
  updateBatchCount,
} = require('../db/supabase');

async function handleMortality(args, senderPhone) {
  const pond = await getPondByName(args.pondName);
  if (!pond) return `Pond ${args.pondName} not found. Send *ponds* to see available ponds.`;

  const batch = await getActiveBatchForPond(pond.id);
  if (!batch) return `No active batch found for ${pond.name}.`;

  const newCount = batch.current_count - args.count;
  const pct = ((args.count / batch.current_count) * 100).toFixed(1);
  const warning = args.count > batch.current_count * 0.5
    ? `⚠️ Warning: This mortality count (${args.count}) is over 50% of current stock. Please verify. ` : '';

  const today = new Date().toISOString().split('T')[0];
  await insertDailyLog({
    pond_id:         pond.id,
    log_date:        today,
    feed_amount_kg:  0,
    mortality_count: args.count,
    logged_by:       senderPhone,
  });

  await updateBatchCount(batch.id, Math.max(0, newCount));

  const ts = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  return `${warning}✓ Logged: ${args.count} mortalities in ${pond.name} (${pct}% of stock). Current count: ${Math.max(0, newCount)}. ${ts} UTC`;
}

module.exports = { handleMortality };
