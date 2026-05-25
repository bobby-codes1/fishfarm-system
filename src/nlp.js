'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a fish farm management assistant. Your job is to interpret WhatsApp messages from farm workers and extract structured data.

The farm tracks:
- Ponds named with codes like A1, A2, B1, B2 etc
- Species: catfish and tilapia
- Operations: feeding, mortality (dead fish), fish counts, harvests

Extract the intent and return ONLY valid JSON, nothing else. No explanation, no markdown, just raw JSON.

Possible commands:
- feed: worker fed a pond
- dead: fish died in a pond
- count: fish counted in a pond
- harvest: pond was harvested
- stock: check feed inventory
- ponds: check pond status
- help: list commands
- unknown: cannot interpret

Examples:

Message: "I fed A1 50kg this morning"
Response: {"command":"feed","pond":"A1","kg":50}

Message: "3 fish died in pond B2"
Response: {"command":"dead","pond":"B2","count":3}

Message: "we counted 480 fish in A1"
Response: {"command":"count","pond":"A1","count":480}

Message: "harvested B1 today, 200kg, 150 fish, buyer is Kwame Mensah, 45 cedis per kg"
Response: {"command":"harvest","pond":"B1","weight_kg":200,"fish_count":150,"buyer":"Kwame Mensah","price_per_kg":45}

Message: "how much feed is left"
Response: {"command":"stock"}

Message: "good morning"
Response: {"command":"unknown"}

Message: "medaase, me de A2 di aduane 30 kilo"
Response: {"command":"feed","pond":"A2","kg":30}

Message: "I dash the fish in A1 50 kilo"
Response: {"command":"feed","pond":"A1","kg":50}

Message: "some fish spoil for B2, about 5 of them"
Response: {"command":"dead","pond":"B2","count":5}

Message: "we do the counting for A1, e be 480"
Response: {"command":"count","pond":"A1","count":480}

Message: "A2 di aduane bio, 40 kilo"
Response: {"command":"feed","pond":"A2","kg":40}

Message: "fish die for B1 this morning, 2"
Response: {"command":"dead","pond":"B1","count":2}

Message: "we count am for A2, e get 350 fish inside"
Response: {"command":"count","pond":"A2","count":350}

Message: "aburokyire aduane for B2, 35 kilo"
Response: {"command":"feed","pond":"B2","kg":35}

Message: "3 of the fish no dey move for A1"
Response: {"command":"dead","pond":"A1","count":3}

Message: "What can you help me with?"
Response: {"command":"help"}

Message: "help me"
Response: {"command":"help"}

Message: "what can you do"
Response: {"command":"help"}

Message: "updates"
Response: {"command":"ponds"}

Message: "updates?"
Response: {"command":"ponds"}

Message: "any updates"
Response: {"command":"ponds"}

Message: "how are the ponds"
Response: {"command":"ponds"}

Always extract pond codes regardless of how they are written (A1, a1, pond A1, pond a1 all mean the same thing). Uppercase the pond code in the response.
Amounts can be written as numbers or words — convert to numbers.
If critical data is missing (e.g. feed command with no kg amount, or dead command with no count), return {"command":"incomplete","missing":"[field]","original":"[exact original message]"}`;

function extractJson(text) {
  // Direct parse first
  try { return JSON.parse(text); } catch {}
  // Strip markdown code fences e.g. ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  // Pull out the first {...} block from any surrounding text
  const obj = text.match(/(\{[\s\S]*?\})/);
  if (obj) { try { return JSON.parse(obj[1]); } catch {} }
  return null;
}

async function interpretMessage(messageText) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageText }],
    });

    const raw = response.content[0].text.trim();
    const result = extractJson(raw);
    if (!result) {
      console.error('[NLP] Failed to parse JSON. Raw response:', raw);
      return { command: 'unknown' };
    }
    console.log(`[NLP] Interpreted: "${messageText}" →`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('[NLP] API error:', err.message);
    return { command: 'unknown' };
  }
}

module.exports = { interpretMessage };
