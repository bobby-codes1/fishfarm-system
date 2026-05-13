'use strict';

const { getFeedInventory, insertFeedInventory, setFeedStock } = require('../db/supabase');

async function handleAddFeed(args) {
  const feeds = await getFeedInventory();
  const existing = feeds.find(f => f.feed_type.toLowerCase() === args.feedType.toLowerCase());

  if (existing) {
    const newQty = parseFloat(existing.quantity_kg) + args.quantityKg;
    await setFeedStock(existing.id, newQty);
    return `✓ Stock updated: ${existing.feed_type} now at ${newQty.toFixed(1)}kg (+${args.quantityKg}kg added).`;
  }

  await insertFeedInventory({
    feed_type:             args.feedType,
    quantity_kg:           args.quantityKg,
    reorder_threshold_kg:  50,
    unit_cost_ghs:         args.costPerKg,
    last_updated:          new Date().toISOString(),
  });

  return `✓ Feed created: ${args.feedType} — ${args.quantityKg}kg @ GHS${args.costPerKg}/kg. Reorder alert set at 50kg.`;
}

module.exports = { handleAddFeed };
