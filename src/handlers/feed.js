'use strict';

const {
  getPondByName,
  getFeedInventory,
  deductFeedStock,
  insertDailyLog,
} = require('../db/supabase');

async function handleFeed(args, senderPhone) {
  const pond = await getPondByName(args.pondName);
  if (!pond) return `Pond ${args.pondName} not found. Send *ponds* to see available ponds.`;

  const feeds = await getFeedInventory();
  if (!feeds.length) return `No feed types in inventory. Please add feed stock before logging.`;

  const activeFeed = feeds[0]; // highest stock first (sorted by quantity_kg DESC)

  if (parseFloat(activeFeed.quantity_kg) < args.kg) {
    return `⚠️ Warning: Only ${activeFeed.quantity_kg}kg of ${activeFeed.feed_type} in stock but you logged ${args.kg}kg. Logging anyway — please restock soon.`;
  }

  await deductFeedStock(activeFeed.id, args.kg);

  const today = new Date().toISOString().split('T')[0];
  await insertDailyLog({
    pond_id:        pond.id,
    log_date:       today,
    feed_type_id:   activeFeed.id,
    feed_amount_kg: args.kg,
    mortality_count: 0,
    logged_by:      senderPhone,
  });

  const ts = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  return `✓ Logged: Fed ${args.kg}kg of ${activeFeed.feed_type} to ${pond.name}. Remaining stock: ${(parseFloat(activeFeed.quantity_kg) - args.kg).toFixed(1)}kg. ${ts} UTC`;
}

module.exports = { handleFeed };
