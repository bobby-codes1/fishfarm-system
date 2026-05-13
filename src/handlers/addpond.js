'use strict';

const { getPondByName, insertPond, insertBatch } = require('../db/supabase');

async function handleAddPond(args) {
  const existing = await getPondByName(args.name);
  if (existing) {
    return `Pond ${args.name} already exists. Send *ponds* to see all ponds.`;
  }

  const today = new Date().toISOString().split('T')[0];

  const pond = await insertPond({
    name:          args.name,
    species:       args.species,
    capacity:      args.count,
    stocking_date: today,
    status:        'active',
  });

  await insertBatch({
    pond_id:       pond.id,
    species:       args.species,
    initial_count: args.count,
    current_count: args.count,
    stocking_date: today,
    status:        'active',
  });

  return `✓ Pond ${args.name} created: ${args.count} ${args.species} stocked on ${today}. Workers can now log to this pond.`;
}

module.exports = { handleAddPond };
