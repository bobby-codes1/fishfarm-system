'use strict';

const {
  getPondByName,
  getActiveBatchForPond,
  updateBatchCount,
} = require('../db/supabase');

async function handleCount(args, senderPhone) {
  const pond = await getPondByName(args.pondName);
  if (!pond) return `Pond ${args.pondName} not found. Send *ponds* to see available ponds.`;

  const batch = await getActiveBatchForPond(pond.id);
  if (!batch) return `No active batch found for ${pond.name}.`;

  const previous = batch.current_count;
  await updateBatchCount(batch.id, args.count);

  const diff = args.count - previous;
  const sign = diff >= 0 ? '+' : '';
  const ts   = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  return `✓ Logged: Fish count for ${pond.name} updated to ${args.count} (${sign}${diff} from previous ${previous}). ${ts} UTC`;
}

module.exports = { handleCount };
