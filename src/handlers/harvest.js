'use strict';

const {
  getPondByName,
  getActiveBatchForPond,
  insertHarvest,
  updateBatchStatus,
  updatePondStatus,
} = require('../db/supabase');

async function handleHarvest(args, senderPhone) {
  const pond = await getPondByName(args.pondName);
  if (!pond) return `Pond ${args.pondName} not found. Send *ponds* to see available ponds.`;

  const batch = await getActiveBatchForPond(pond.id);
  if (!batch) return `No active batch found for ${pond.name}.`;

  const avgWeight      = parseFloat((args.weightKg / args.fishCount).toFixed(3));
  const totalRevenue   = parseFloat((args.weightKg * args.pricePerKg).toFixed(2));
  const today          = new Date().toISOString().split('T')[0];

  await insertHarvest({
    pond_id:           pond.id,
    batch_id:          batch.id,
    harvest_date:      today,
    total_weight_kg:   args.weightKg,
    fish_count:        args.fishCount,
    avg_weight_kg:     avgWeight,
    buyer:             args.buyer,
    price_per_kg_ghs:  args.pricePerKg,
    total_revenue_ghs: totalRevenue,
  });

  await updateBatchStatus(batch.id, 'harvested');
  await updatePondStatus(pond.id, 'harvested');

  const ts = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  return `✓ Logged: Harvest from ${pond.name} — ${args.weightKg}kg, ${args.fishCount} fish sold to ${args.buyer} at GHS${args.pricePerKg}/kg. Revenue: GHS${totalRevenue.toLocaleString()}. ${ts} UTC`;
}

module.exports = { handleHarvest };
