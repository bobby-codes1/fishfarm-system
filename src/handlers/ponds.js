'use strict';

const { getActivePonds, getLogsForPond } = require('../db/supabase');

async function handlePonds() {
  const ponds = await getActivePonds();
  if (!ponds.length) return 'No active ponds found.';

  const lines = await Promise.all(ponds.map(async p => {
    const batch    = p.fish_batches?.find(b => b.status === 'active');
    const count    = batch ? batch.current_count : '—';
    const logs     = await getLogsForPond(p.id, 1);
    const lastFed  = logs.length ? logs[0].log_date : 'Never';
    return `• ${p.name} (${p.species}): ${count} fish | Last log: ${lastFed}`;
  }));

  return `🏊 Active Ponds:\n${lines.join('\n')}`;
}

module.exports = { handlePonds };
