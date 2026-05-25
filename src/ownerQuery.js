'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');
const {
  getActivePonds,
  getActiveBatches,
  getFeedInventory,
  getAllLogsLastNDays,
  getHarvestsInRange,
  getLast7DaysFeedUsage,
} = require('./db/supabase');

const client = new Anthropic();

const QUERY_STARTERS = /^(how|what|when|which|who|show|tell|is|are|was|were|did|do|does|can|will|give)/i;

function isOwnerQuery(messageText) {
  const text = messageText.trim();
  return text.endsWith('?') || QUERY_STARTERS.test(text);
}

async function handleOwnerQuery(messageText) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const from30 = new Date(today);
  from30.setDate(today.getDate() - 30);
  const from30Str = from30.toISOString().split('T')[0];

  const [batches, feeds, logs7d, usageLogs, harvests] = await Promise.all([
    getActiveBatches(),
    getFeedInventory(),
    getAllLogsLastNDays(7),
    getLast7DaysFeedUsage(),
    getHarvestsInRange(from30Str, todayStr),
  ]);

  const pondSummaries = batches.map(b => {
    const pondLogs      = logs7d.filter(l => l.pond_id === b.pond_id);
    const feedKg        = pondLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const deaths        = pondLogs.reduce((s, l) => s + (l.mortality_count || 0), 0);
    const daysLogged    = new Set(pondLogs.map(l => l.log_date)).size;
    const lastLog       = pondLogs.length ? pondLogs[0].log_date : null;
    const daysToHarvest = b.target_harvest_date
      ? Math.ceil((new Date(b.target_harvest_date) - today) / 86400000)
      : null;
    const mortalityRate = b.current_count > 0
      ? ((deaths / b.current_count) * 100).toFixed(2)
      : '0.00';

    return {
      pond:              b.ponds?.name || b.pond_id,
      species:           b.ponds?.species || b.species,
      currentCount:      b.current_count,
      avgWeightKg:       b.avg_weight_kg,
      feedKg7d:          feedKg.toFixed(1),
      avgFeedPerDay:     (feedKg / 7).toFixed(1),
      deaths7d:          deaths,
      mortalityRate7d:   mortalityRate,
      daysLogged7d:      daysLogged,
      lastLogDate:       lastLog,
      targetHarvestDate: b.target_harvest_date,
      daysToHarvest,
    };
  });

  const feedSnapshot = feeds.map(f => {
    const kgUsed7d  = usageLogs.filter(l => l.feed_type_id === f.id)
      .reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const avgPerDay = kgUsed7d / 7;
    const daysLeft  = avgPerDay > 0 ? Math.floor(parseFloat(f.quantity_kg) / avgPerDay) : null;
    return {
      type:       f.feed_type,
      quantityKg: parseFloat(f.quantity_kg).toFixed(1),
      daysLeft,
      costPerKg:  f.unit_cost_ghs,
      threshold:  f.reorder_threshold_kg,
    };
  });

  const totalRevenue30d = harvests.reduce((s, h) => s + parseFloat(h.total_revenue_ghs || 0), 0);
  const totalFeedCost7d = logs7d.reduce((s, l) => {
    const feed = feeds.find(f => f.id === l.feed_type_id);
    return s + parseFloat(l.feed_amount_kg || 0) * parseFloat(feed?.unit_cost_ghs || 0);
  }, 0);

  const context = `Today: ${todayStr}

## Active Ponds — Last 7 Days
${pondSummaries.map(p =>
  `- ${p.pond} (${p.species}): ${p.currentCount?.toLocaleString()} fish @ avg ${p.avgWeightKg}kg each, fed ${p.feedKg7d}kg over ${p.daysLogged7d}/7 days (~${p.avgFeedPerDay}kg/day avg), ${p.deaths7d} deaths (${p.mortalityRate7d}%)${p.daysToHarvest !== null ? `, harvest target in ${p.daysToHarvest} days (${p.targetHarvestDate})` : ''}${p.lastLogDate ? `, last log: ${p.lastLogDate}` : ', no logs yet'}`
).join('\n')}

## Feed Inventory
${feedSnapshot.map(f =>
  `- ${f.type}: ${f.quantityKg}kg remaining${f.costPerKg ? ` @ GHS${f.costPerKg}/kg` : ''}${f.daysLeft !== null ? ` (~${f.daysLeft} days left)` : ''}`
).join('\n')}

## Harvests — Last 30 Days
${harvests.length
  ? harvests.map(h =>
    `- ${h.ponds?.name || h.pond_id}: ${h.weight_kg}kg, ${h.fish_count} fish, GHS${h.total_revenue_ghs} revenue (buyer: ${h.buyer_name || 'unknown'}, ${h.harvest_date})`
  ).join('\n')
  : '- No harvests in last 30 days'}

Total revenue (30 days): GHS${totalRevenue30d.toFixed(2)}
Total feed cost (7 days): GHS${totalFeedCost7d.toFixed(2)}`;

  console.log('[OwnerQuery] Fetched context, calling Claude for:', messageText);

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 400,
    system:     `You are a helpful fish farm assistant for a catfish and tilapia farm in Ghana. Answer the owner's question using only the farm data provided. Be concise and conversational — use actual numbers from the data. Format for WhatsApp (bold key figures with *asterisks*). Keep it under 10 lines. All monetary values in GHS.`,
    messages:   [{ role: 'user', content: `Farm data:\n${context}\n\nOwner question: ${messageText}` }],
  });

  return response.content[0].text.trim();
}

module.exports = { isOwnerQuery, handleOwnerQuery };
