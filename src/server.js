'use strict';

require('dotenv').config();

const express  = require('express');
const path     = require('path');
const { parseCommand }          = require('./parser');
const { interpretMessage }      = require('./nlp');
const { isOwnerQuery, handleOwnerQuery } = require('./ownerQuery');
const { sendWhatsAppMessage, extractInboundMessage } = require('./whatsapp');
const { handleFeed }     = require('./handlers/feed');
const { handleMortality } = require('./handlers/mortality');
const { handleHarvest }   = require('./handlers/harvest');
const { handleStock }     = require('./handlers/stock');
const { handlePonds }     = require('./handlers/ponds');
const { handleCount }     = require('./handlers/count');
const { handleAddPond }   = require('./handlers/addpond');
const { handleAddFeed }   = require('./handlers/addfeed');
const { startScheduler }  = require('./scheduler');

const HELP_TEXT = `🐟 *Fish Farm Bot — Commands*

*feed [pond] [kg]* — Log feeding
  Example: feed A1 50

*dead [pond] [count]* — Log mortalities
  Example: dead A1 3

*count [pond] [number]* — Update fish count
  Example: count A1 480

*harvest [pond] [weight_kg] [fish_count] [buyer] [price/kg]* — Log harvest
  Example: harvest A1 200 150 AcraFish 30

*stock* — Check feed inventory
*ponds* — Check all pond status
*help* — Show this message

Or just describe what happened in plain language and I'll figure it out!`;

const UNKNOWN_REPLY = `I couldn't understand that message. Here's what I can help with:

🐟 *Log feeding:* 'I fed A1 50kg'
💀 *Log deaths:* '3 fish died in B2'
🔢 *Update count:* 'counted 480 in A1'
🎣 *Log harvest:* 'harvested A1, 200kg, 45 cedis'
📦 *Check feed stock:* 'how much feed is left'
🏊 *Check ponds:* 'show all ponds'

Or just describe what happened and I'll figure it out!`;

// In-memory store for incomplete commands awaiting follow-up
// { phone -> { original: string, missing: string } }
const pendingCommands = new Map();

// Convert NLP JSON output → { command, args } shape that handlers expect
function normalizeNlpResult(nlp) {
  switch (nlp.command) {
    case 'feed':
    case 'feeding':
      return { command: 'feed', args: { pondName: nlp.pond, kg: nlp.kg } };
    case 'dead':
    case 'death':
    case 'deaths':
    case 'mortality':
      return { command: 'mortality', args: { pondName: nlp.pond, count: nlp.count } };
    case 'count':
    case 'counting':
    case 'fish':
      return { command: 'count', args: { pondName: nlp.pond, count: nlp.count } };
    case 'harvest':
    case 'harvested':
      return {
        command: 'harvest',
        args: {
          pondName:   nlp.pond,
          weightKg:   nlp.weight_kg,
          fishCount:  nlp.fish_count,
          buyer:      nlp.buyer,
          pricePerKg: nlp.price_per_kg,
        },
      };
    case 'stock':
    case 'inventory':
      return { command: 'stock', args: {} };
    case 'ponds':
    case 'status':
      return { command: 'ponds', args: {} };
    case 'addpond':
      return { command: 'addpond', args: { name: nlp.name, species: nlp.species, count: nlp.count } };
    case 'addfeed':
      return { command: 'addfeed', args: { feedType: nlp.feed_type, quantityKg: nlp.quantity_kg, costPerKg: nlp.cost_per_kg } };
    case 'help':  return { command: 'help',  args: {} };
    default:
      console.log('[NLP] Unrecognised command from model:', nlp.command);
      return null;
  }
}

async function routeCommand(parsed, from) {
  switch (parsed.command) {
    case 'feed':      return handleFeed(parsed.args, from);
    case 'mortality': return handleMortality(parsed.args, from);
    case 'count':     return handleCount(parsed.args, from);
    case 'harvest':   return handleHarvest(parsed.args, from);
    case 'stock':     return handleStock();
    case 'ponds':     return handlePonds();
    case 'help':      return HELP_TEXT;
    case 'addpond':
      if (from !== process.env.OWNER_PHONE) return 'This command is only available to the farm owner.';
      if (!parsed.args.name || !parsed.args.species || !parsed.args.count) {
        const n = parsed.args.name || 'X';
        return `To create pond ${n} I need the species and fish count.\n\nReply with:\n*addpond ${n} catfish 500*\n\nSpecies options: *catfish* or *tilapia*`;
      }
      return handleAddPond(parsed.args);
    case 'addfeed':
      if (from !== process.env.OWNER_PHONE) return 'This command is only available to the farm owner.';
      if (!parsed.args.feedType || !parsed.args.quantityKg || !parsed.args.costPerKg) {
        return `To add feed stock I need the feed type, quantity, and cost.\n\nReply with:\n*addfeed Coppens 200 45*\n(type, kg, GHS per kg)`;
      }
      return handleAddFeed(parsed.args);
    default:
      return UNKNOWN_REPLY;
  }
}

const app = express();
app.use(express.json());

// ─── STATIC / DASHBOARD ───────────────────────────────────────────────────────

app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'privacy-policy.html'));
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'history.html'));
});

// ─── REST API ─────────────────────────────────────────────────────────────────

app.use('/api', require('./api/routes'));

// ─── WHATSAPP WEBHOOK VERIFICATION ────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully.');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verification failed — token mismatch.');
  res.sendStatus(403);
});

// ─── WHATSAPP WEBHOOK MESSAGES ────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  // Acknowledge immediately — Meta requires a 200 within 20s
  res.sendStatus(200);

  const inbound = extractInboundMessage(req.body);
  if (!inbound) return;

  const { from, body } = inbound;
  let reply;

  try {
    // ── 1. Complete a pending incomplete command ──────────────────────────────
    if (pendingCommands.has(from)) {
      const { original, missing } = pendingCommands.get(from);
      pendingCommands.delete(from);

      const combined = `${original}. The ${missing} is: ${body.trim()}`;
      console.log('[Webhook] Completing pending command:', combined);
      const nlp = await interpretMessage(combined);

      if (nlp.command === 'incomplete' || nlp.command === 'unknown') {
        reply = UNKNOWN_REPLY;
      } else {
        const parsed = normalizeNlpResult(nlp);
        reply = parsed ? await routeCommand(parsed, from) : UNKNOWN_REPLY;
      }

      await sendWhatsAppMessage(from, reply);
      return;
    }

    // ── 2. Try strict parser ──────────────────────────────────────────────────
    const strict = parseCommand(body);

    if (!strict.error) {
      // Exact match — use it directly, no API call needed
      reply = await routeCommand(strict, from);

    } else if (from === process.env.OWNER_PHONE && isOwnerQuery(body)) {
      // ── 3. Owner asking a question — data-driven Claude answer ───────────
      console.log('[Webhook] Owner query detected:', body);
      reply = await handleOwnerQuery(body);

    } else {
      // ── 4. Fall back to NLP interpretation ───────────────────────────────
      const nlp = await interpretMessage(body);

      if (nlp.batch && Array.isArray(nlp.batch)) {
        // Multiple pond operations in one message
        const results = [];
        for (const cmd of nlp.batch) {
          const parsed = normalizeNlpResult(cmd);
          if (parsed) {
            try {
              results.push(await routeCommand(parsed, from));
            } catch (e) {
              results.push(`⚠️ Could not process ${cmd.command} for ${cmd.pond}: ${e.message}`);
            }
          }
        }
        reply = results.length ? results.join('\n\n') : UNKNOWN_REPLY;

      } else if (nlp.command === 'incomplete') {
        // Store state and prompt for the missing field
        pendingCommands.set(from, { original: nlp.original || body, missing: nlp.missing });
        const fieldLabel = nlp.missing === 'kg' ? 'kg of feed' : nlp.missing;
        reply = `Almost there! How many ${fieldLabel} did you use? Reply with just the number, e.g. *50*`;

      } else if (nlp.command === 'unknown') {
        reply = UNKNOWN_REPLY;

      } else {
        const parsed = normalizeNlpResult(nlp);
        reply = parsed ? await routeCommand(parsed, from) : UNKNOWN_REPLY;
      }
    }

  } catch (err) {
    console.error(`[Webhook] Error handling message from ${from}:`, err.message);
    reply = 'Something went wrong on our end. Please try again in a moment.';
  }

  await sendWhatsAppMessage(from, reply);
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── START ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Fish Farm System running on port ${PORT}`);
  startScheduler();
});
