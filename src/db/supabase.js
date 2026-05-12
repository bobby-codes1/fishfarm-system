'use strict';

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

// ─── PONDS ────────────────────────────────────────────────────────────────────

async function getActivePonds() {
  const { data, error } = await supabase
    .from('ponds')
    .select(`
      *,
      fish_batches (
        id, current_count, avg_weight_kg, target_harvest_date, status
      )
    `)
    .eq('status', 'active')
    .order('name');
  if (error) throw error;
  return data;
}

async function getPondById(id) {
  const { data, error } = await supabase
    .from('ponds')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function getPondByName(name) {
  const normalised = name.trim().toUpperCase();
  const { data, error } = await supabase
    .from('ponds')
    .select('*')
    .ilike('name', `%${normalised}%`)
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function updatePondStatus(pondId, status) {
  const { error } = await supabase
    .from('ponds')
    .update({ status })
    .eq('id', pondId);
  if (error) throw error;
}

// ─── FISH BATCHES ─────────────────────────────────────────────────────────────

async function getActiveBatchForPond(pondId) {
  const { data, error } = await supabase
    .from('fish_batches')
    .select('*')
    .eq('pond_id', pondId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function updateBatchCount(batchId, newCount) {
  const { error } = await supabase
    .from('fish_batches')
    .update({ current_count: newCount })
    .eq('id', batchId);
  if (error) throw error;
}

async function updateBatchStatus(batchId, status) {
  const { error } = await supabase
    .from('fish_batches')
    .update({ status })
    .eq('id', batchId);
  if (error) throw error;
}

async function getActiveBatches() {
  const { data, error } = await supabase
    .from('fish_batches')
    .select(`*, ponds(name, species)`)
    .eq('status', 'active')
    .order('target_harvest_date');
  if (error) throw error;
  return data;
}

// ─── FEED INVENTORY ───────────────────────────────────────────────────────────

async function getFeedInventory() {
  const { data, error } = await supabase
    .from('feed_inventory')
    .select('*')
    .order('quantity_kg', { ascending: false });
  if (error) throw error;
  return data;
}

async function getFeedInventoryById(id) {
  const { data, error } = await supabase
    .from('feed_inventory')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function deductFeedStock(feedTypeId, kg) {
  const { data: current, error: fetchErr } = await supabase
    .from('feed_inventory')
    .select('quantity_kg')
    .eq('id', feedTypeId)
    .single();
  if (fetchErr) throw fetchErr;

  const newQty = Math.max(0, parseFloat(current.quantity_kg) - parseFloat(kg));
  const { error } = await supabase
    .from('feed_inventory')
    .update({ quantity_kg: newQty, last_updated: new Date().toISOString() })
    .eq('id', feedTypeId);
  if (error) throw error;
}

// ─── DAILY LOGS ───────────────────────────────────────────────────────────────

async function insertDailyLog(data) {
  const { data: row, error } = await supabase
    .from('daily_logs')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return row;
}

async function getLogsForPond(pondId, days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('pond_id', pondId)
    .gte('log_date', since.toISOString().split('T')[0])
    .order('log_date', { ascending: false });
  if (error) throw error;
  return data;
}

async function getLogsForDate(date) {
  const { data, error } = await supabase
    .from('daily_logs')
    .select(`*, ponds(name, species)`)
    .eq('log_date', date);
  if (error) throw error;
  return data;
}

async function getLast7DaysFeedUsage() {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const { data, error } = await supabase
    .from('daily_logs')
    .select('feed_type_id, feed_amount_kg, log_date')
    .gte('log_date', since.toISOString().split('T')[0])
    .not('feed_type_id', 'is', null);
  if (error) throw error;
  return data;
}

async function getLogsFiltered({ pondId, from, to }) {
  let query = supabase
    .from('daily_logs')
    .select(`*, ponds(name, species), feed_inventory(feed_type)`)
    .order('log_date', { ascending: false });
  if (pondId) query = query.eq('pond_id', pondId);
  if (from)   query = query.gte('log_date', from);
  if (to)     query = query.lte('log_date', to);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ─── HARVESTS ─────────────────────────────────────────────────────────────────

async function insertHarvest(data) {
  const { data: row, error } = await supabase
    .from('harvests')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return row;
}

async function getRevenueThisMonth() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('harvests')
    .select('total_revenue_ghs')
    .gte('harvest_date', firstOfMonth);
  if (error) throw error;
  return data.reduce((sum, r) => sum + parseFloat(r.total_revenue_ghs || 0), 0);
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────

async function insertAlert(alertType, message, sentTo) {
  const { error } = await supabase
    .from('alerts_log')
    .insert({ alert_type: alertType, message, sent_to: sentTo });
  if (error) throw error;
}

async function getRecentAlerts(limit = 30) {
  const { data, error } = await supabase
    .from('alerts_log')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────

async function getDashboardSummary() {
  const [batches, feedRows, alertRows, usageLogs, monthRevenue] = await Promise.all([
    getActiveBatches(),
    getFeedInventory(),
    getRecentAlerts(1),
    getLast7DaysFeedUsage(),
    getRevenueThisMonth(),
  ]);

  const totalFish = batches.reduce((s, b) => s + (b.current_count || 0), 0);
  const totalFeedKg = feedRows.reduce((s, f) => s + parseFloat(f.quantity_kg || 0), 0);
  const activePonds = batches.length;
  const last7DaysFeedKg = usageLogs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);

  return { totalFish, totalFeedKg, activePonds, last7DaysFeedKg, revenueThisMonth: monthRevenue };
}

module.exports = {
  getActivePonds,
  getPondById,
  getPondByName,
  updatePondStatus,
  getActiveBatchForPond,
  updateBatchCount,
  updateBatchStatus,
  getActiveBatches,
  getFeedInventory,
  getFeedInventoryById,
  deductFeedStock,
  insertDailyLog,
  getLogsForPond,
  getLogsForDate,
  getLast7DaysFeedUsage,
  getLogsFiltered,
  insertHarvest,
  getRevenueThisMonth,
  insertAlert,
  getRecentAlerts,
  getDashboardSummary,
};
