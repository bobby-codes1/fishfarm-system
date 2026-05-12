'use strict';

function parseCommand(messageBody) {
  const raw = messageBody.trim();
  const normalised = raw.toLowerCase().replace(/\s+/g, ' ');
  const tokens = normalised.split(' ');
  const cmd = tokens[0];

  if (cmd === 'feed') {
    if (tokens.length < 3) return { error: 'invalid_args', raw };
    const kg = parseFloat(tokens[2]);
    if (!tokens[1] || isNaN(kg) || kg <= 0) return { error: 'invalid_args', raw };
    return { command: 'feed', args: { pondName: tokens[1].toUpperCase(), kg }, raw };
  }

  if (cmd === 'dead' || cmd === 'mort' || cmd === 'mortality') {
    if (tokens.length < 3) return { error: 'invalid_args', raw };
    const count = parseInt(tokens[2], 10);
    if (!tokens[1] || isNaN(count) || count < 0) return { error: 'invalid_args', raw };
    return { command: 'mortality', args: { pondName: tokens[1].toUpperCase(), count }, raw };
  }

  if (cmd === 'count' || cmd === 'fish') {
    if (tokens.length < 3) return { error: 'invalid_args', raw };
    const count = parseInt(tokens[2], 10);
    if (!tokens[1] || isNaN(count) || count < 0) return { error: 'invalid_args', raw };
    return { command: 'count', args: { pondName: tokens[1].toUpperCase(), count }, raw };
  }

  if (cmd === 'harvest') {
    // harvest [pond] [weight_kg] [fish_count] [buyer] [price_per_kg]
    if (tokens.length < 6) return { error: 'invalid_args', raw };
    const weightKg   = parseFloat(tokens[2]);
    const fishCount  = parseInt(tokens[3], 10);
    const buyer      = tokens[4];
    const pricePerKg = parseFloat(tokens[5]);
    if (isNaN(weightKg) || isNaN(fishCount) || isNaN(pricePerKg) || weightKg <= 0 || fishCount <= 0 || pricePerKg <= 0) {
      return { error: 'invalid_args', raw };
    }
    return {
      command: 'harvest',
      args: { pondName: tokens[1].toUpperCase(), weightKg, fishCount, buyer, pricePerKg },
      raw,
    };
  }

  if (cmd === 'stock' || cmd === 'inventory' || normalised === 'feed stock') {
    return { command: 'stock', args: {}, raw };
  }

  if (cmd === 'ponds' || cmd === 'status') {
    return { command: 'ponds', args: {}, raw };
  }

  if (cmd === 'help') {
    return { command: 'help', args: {}, raw };
  }

  return { error: 'unknown_command', raw };
}

module.exports = { parseCommand };
