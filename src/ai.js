'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');
const {
  getLast7DaysFeedUsage,
  getFeedInventory,
  getActiveBatches,
  getLogsForPond,
} = require('./db/supabase');

async function generateWeeklyReport() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return '📊 Weekly report unavailable — add ANTHROPIC_API_KEY to Railway Variables to enable it.';
  }
  const client = new Anthropic();
  const [usageLogs, feeds, batches] = await Promise.all([
    getLast7DaysFeedUsage(),
    getFeedInventory(),
    getActiveBatches(),
  ]);

  // Build per-pond 7-day log summaries
  const pondSummaries = await Promise.all(
    batches.map(async b => {
      const logs = await getLogsForPond(b.pond_id, 7);
      const totalFeed      = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const totalMortality = logs.reduce((s, l) => s + (l.mortality_count || 0), 0);
      const daysLogged     = new Set(logs.map(l => l.log_date)).size;
      const pondName       = b.ponds?.name || b.pond_id;
      const species        = b.ponds?.species || b.species;
      const daysToHarvest  = b.target_harvest_date
        ? Math.ceil((new Date(b.target_harvest_date) - new Date()) / 86400000)
        : null;

      return {
        pond:            pondName,
        species,
        currentCount:    b.current_count,
        avgWeightKg:     b.avg_weight_kg,
        totalFeedKg:     totalFeed.toFixed(1),
        totalMortality,
        daysLogged,
        daysToHarvest,
      };
    })
  );

  const feedSnapshot = feeds.map(f => ({
    type:        f.feed_type,
    quantityKg:  parseFloat(f.quantity_kg).toFixed(1),
    costPerKg:   f.unit_cost_ghs,
  }));

  const prompt = `You are an expert aquaculture advisor for a catfish and tilapia farm in Ghana.

Here is the farm's data for the past 7 days:

## Pond Summaries
${pondSummaries.map(p => `- ${p.pond} (${p.species}): ${p.currentCount} fish, avg weight ~${p.avgWeightKg || '?'}kg, fed ${p.totalFeedKg}kg over ${p.daysLogged}/7 days, ${p.totalMortality} mortalities${p.daysToHarvest !== null ? `, ${p.daysToHarvest} days to target harvest` : ''}`).join('\n')}

## Feed Inventory
${feedSnapshot.map(f => `- ${f.type}: ${f.quantityKg}kg remaining${f.costPerKg ? ` @ GHS${f.costPerKg}/kg` : ''}`).join('\n')}

Please provide a concise weekly analysis with:
1. Feed conversion ratio (FCR) observations per pond (feed fed / biomass gained estimate)
2. Mortality trend observations — any ponds of concern?
3. Cost efficiency notes
4. 2-3 specific, actionable recommendations to reduce cost or improve yield
5. Flag any ponds approaching their target harvest date (within 14 days)

Keep the response clear and practical — the farm owner will read this on a phone.`;

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  });

  return `📊 Weekly farm report:\n\n${response.content[0].text}`;
}

module.exports = { generateWeeklyReport };
