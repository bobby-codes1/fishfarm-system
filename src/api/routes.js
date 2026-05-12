'use strict';

const express = require('express');
const router  = express.Router();
const {
  getActivePonds,
  getPondById,
  getLogsForPond,
  getFeedInventory,
  getRecentAlerts,
  getDashboardSummary,
  getLogsFiltered,
  getLast7DaysFeedUsage,
} = require('../db/supabase');

// GET /api/ponds
router.get('/ponds', async (req, res) => {
  try {
    const data = await getActivePonds();
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /ponds:', err.message);
    res.status(500).json({ error: 'Failed to fetch ponds' });
  }
});

// GET /api/ponds/:id
router.get('/ponds/:id', async (req, res) => {
  try {
    const [pond, logs] = await Promise.all([
      getPondById(req.params.id),
      getLogsForPond(req.params.id, 30),
    ]);
    res.json({ data: { pond, logs } });
  } catch (err) {
    console.error('[API] GET /ponds/:id:', err.message);
    res.status(500).json({ error: 'Failed to fetch pond detail' });
  }
});

// GET /api/feed
router.get('/feed', async (req, res) => {
  try {
    const feeds     = await getFeedInventory();
    const usageLogs = await getLast7DaysFeedUsage();

    // Compute daily avg and projected runway per feed type
    const enriched = feeds.map(f => {
      const logs      = usageLogs.filter(l => l.feed_type_id === f.id);
      const totalKg   = logs.reduce((s, l) => s + parseFloat(l.feed_amount_kg || 0), 0);
      const avgPerDay = totalKg / 7;
      const daysLeft  = avgPerDay > 0 ? Math.floor(parseFloat(f.quantity_kg) / avgPerDay) : null;
      return { ...f, avgDailyKg: parseFloat(avgPerDay.toFixed(2)), projectedDaysLeft: daysLeft };
    });

    res.json({ data: enriched });
  } catch (err) {
    console.error('[API] GET /feed:', err.message);
    res.status(500).json({ error: 'Failed to fetch feed inventory' });
  }
});

// GET /api/alerts
router.get('/alerts', async (req, res) => {
  try {
    const data = await getRecentAlerts(30);
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /alerts:', err.message);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// GET /api/summary
router.get('/summary', async (req, res) => {
  try {
    const data = await getDashboardSummary();
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /summary:', err.message);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// GET /api/logs?pond=&from=&to=
router.get('/logs', async (req, res) => {
  try {
    const { pond, from, to } = req.query;
    const data = await getLogsFiltered({ pondId: pond, from, to });
    res.json({ data });
  } catch (err) {
    console.error('[API] GET /logs:', err.message);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;
