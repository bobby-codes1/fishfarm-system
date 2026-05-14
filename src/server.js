'use strict';

require('dotenv').config();

const express  = require('express');
const path     = require('path');
const { parseCommand }          = require('./parser');
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
*help* — Show this message`;

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
    const parsed = parseCommand(body);

    if (parsed.error === 'unknown_command') {
      reply = "I didn't understand that. Send *help* to see available commands.";
    } else if (parsed.error === 'invalid_args') {
      reply = "Invalid command format. Send *help* to see usage examples.";
    } else {
      switch (parsed.command) {
        case 'feed':      reply = await handleFeed(parsed.args, from);      break;
        case 'mortality': reply = await handleMortality(parsed.args, from); break;
        case 'count':     reply = await handleCount(parsed.args, from);     break;
        case 'harvest':   reply = await handleHarvest(parsed.args, from);   break;
        case 'stock':     reply = await handleStock();                       break;
        case 'ponds':     reply = await handlePonds();                       break;
        case 'addpond':
        case 'addfeed':
          if (from !== process.env.OWNER_PHONE) {
            reply = 'This command is only available to the farm owner.';
            break;
          }
          reply = parsed.command === 'addpond'
            ? await handleAddPond(parsed.args)
            : await handleAddFeed(parsed.args);
          break;
        case 'help':      reply = HELP_TEXT;                                 break;
        default:          reply = "I didn't understand that. Send *help* to see available commands.";
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
