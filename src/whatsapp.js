'use strict';

const GRAPH_API_VERSION = 'v21.0';

async function sendWhatsAppMessage(to, message) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    });
  } catch (err) {
    console.error(`[WhatsApp] Network error sending to ${to}:`, err.message);
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`[WhatsApp] API error ${res.status} sending to ${to}:`, body);
  }
}

function extractInboundMessage(payload) {
  try {
    const entry   = payload?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') return null;

    return {
      from:      message.from,
      body:      message.text.body,
      messageId: message.id,
    };
  } catch {
    return null;
  }
}

module.exports = { sendWhatsAppMessage, extractInboundMessage };
