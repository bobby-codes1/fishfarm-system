'use strict';

const { getFeedInventory } = require('../db/supabase');

async function handleStock() {
  const feeds = await getFeedInventory();
  if (!feeds.length) return 'No feed types in inventory.';

  const lines = feeds.map(f => {
    const qty       = parseFloat(f.quantity_kg).toFixed(1);
    const threshold = parseFloat(f.reorder_threshold_kg).toFixed(1);
    const flag      = parseFloat(f.quantity_kg) <= parseFloat(f.reorder_threshold_kg) ? ' ⚠️ LOW' : '';
    return `• ${f.feed_type}: ${qty}kg (reorder at ${threshold}kg)${flag}`;
  });

  return `📦 Feed Inventory:\n${lines.join('\n')}`;
}

module.exports = { handleStock };
