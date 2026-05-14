'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');
const {
  getLast7DaysFeedUsage,
  getFeedInventory,
  getActiveBatches,
  getLogsForPond,
  getAllLogsLastNDays,
  getActivePonds,
} = require('./db/supabase');

async function generateWeeklyReport() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return '📊 Weekly report unavailable — add ANTHROPIC_API_KEY to Railway Variables to enable it.';
  }
  const client = new Anthropic();

  const [usageLogs, feeds, batches, recentLogs, activePonds] = await Promise.all([
    getLast7DaysFeedUsage(),
    getFeedInventory(),
    getActiveBatches(),
    getAllLogsLastNDays(7),
    getActivePonds(),
  ]);

  // Per-pond 7-day summaries
  const pondSummaries = await Promise.all(
    batches.map(async b => {
      const logs           = await getLogsForPond(b.pond_id, 7);
      const totalFeed      = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const totalMortality = logs.reduce((s, l) => s + (l.mortality_count || 0), 0);
      const daysLogged     = new Set(logs.map(l => l.log_date)).size;
      const pondName       = b.ponds?.name || b.pond_id;
      const species        = b.ponds?.species || b.species;
      const daysToHarvest  = b.target_harvest_date
        ? Math.ceil((new Date(b.target_harvest_date) - new Date()) / 86400000)
        : null;

      // Feed cost estimate using feed_inventory unit_cost_ghs
      const feedIds = [...new Set(logs.filter(l => l.feed_type_id).map(l => l.feed_type_id))];
      let feedCostGhs = 0;
      for (const fid of feedIds) {
        const feedRow  = feeds.find(f => f.id === fid);
        const kgUsed   = logs.filter(l => l.feed_type_id === fid).reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
        if (feedRow?.unit_cost_ghs) feedCostGhs += kgUsed * parseFloat(feedRow.unit_cost_ghs);
      }

      return {
        pond:           pondName,
        species,
        currentCount:   b.current_count,
        avgWeightKg:    b.avg_weight_kg,
        totalFeedKg:    totalFeed.toFixed(1),
        totalMortality,
        mortalityRate:  b.current_count > 0 ? ((totalMortality / b.current_count) * 100).toFixed(2) : '0.00',
        daysLogged,
        daysToHarvest,
        feedCostGhs:    feedCostGhs.toFixed(2),
      };
    })
  );

  // Feed inventory with days remaining
  const feedSnapshot = feeds.map(f => {
    const logs      = usageLogs.filter(l => l.feed_type_id === f.id);
    const totalKg   = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
    const avgPerDay = totalKg / 7;
    const daysLeft  = avgPerDay > 0 ? Math.floor(parseFloat(f.quantity_kg) / avgPerDay) : null;
    return {
      type:       f.feed_type,
      quantityKg: parseFloat(f.quantity_kg).toFixed(1),
      costPerKg:  f.unit_cost_ghs,
      daysLeft,
      threshold:  parseFloat(f.reorder_threshold_kg),
    };
  });

  // Ponds with no logs in last 2 days
  const twoDaysAgo   = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];
  const recentPondIds = new Set(recentLogs.filter(l => l.log_date >= twoDaysAgoStr).map(l => l.pond_id));
  const neglectedPonds = activePonds.filter(p => !recentPondIds.has(p.id)).map(p => p.name);

  const prompt = `You are an expert aquaculture advisor for a catfish and tilapia fish farm in Ghana. Provide a clear, practical weekly report that the farm owner can read on their phone.

## Pond Performance — Last 7 Days
${pondSummaries.map(p =>
  `- **${p.pond}** (${p.species}): ${p.currentCount?.toLocaleString()} fish, fed ${p.totalFeedKg}kg over ${p.daysLogged}/7 days, ${p.totalMortality} deaths (${p.mortalityRate}% rate), feed cost ~GHS${p.feedCostGhs}${p.daysToHarvest !== null ? `, ${p.daysToHarvest} days to target harvest` : ''}`
).join('\n')}

## Feed Inventory
${feedSnapshot.map(f =>
  `- ${f.type}: ${f.quantityKg}kg remaining${f.costPerKg ? ` @ GHS${f.costPerKg}/kg` : ''}${f.daysLeft !== null ? ` — ~${f.daysLeft} days left` : ' — usage unknown'}${f.daysLeft !== null && f.daysLeft < 14 ? ' ⚠️ LOW' : ''}`
).join('\n')}

## Flags
${neglectedPonds.length ? `- ⚠️ No logs in last 2 days: ${neglectedPonds.join(', ')}` : '- All ponds logged in last 2 days ✓'}
${feedSnapshot.filter(f => f.daysLeft !== null && f.daysLeft < f.threshold / 7).map(f => `- ⚠️ ${f.type} below reorder threshold`).join('\n') || ''}

Please write the weekly report with these exact sections:

1. 📊 Performance Summary
2. 🐟 Pond-by-Pond Analysis
3. 🌾 Feed Efficiency (FCR observations, cost per fish)
4. ⚠️ Alerts and Concerns
5. 💡 Top 3 Recommendations
6. 📅 Upcoming (harvests due within 30 days, reorder dates)

Keep it concise and actionable. Use simple language. All monetary values in GHS.`;

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    messages:   [{ role: 'user', content: prompt }],
  });

  return `📊 Weekly Farm Report\n\n${response.content[0].text}`;
}

module.exports = { generateWeeklyReport };
