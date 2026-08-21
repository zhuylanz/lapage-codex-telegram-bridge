import assert from 'node:assert/strict';

import { telegramBotCommands } from '../dist/telegram-bridge.js';

assert.deepEqual(
  telegramBotCommands.map(({ command }) => command),
  ['start', 'help', 'status', 'new', 'resume', 'flush', 'interrupt', 'restart', 'stop'],
);
assert.equal(new Set(telegramBotCommands.map(({ command }) => command)).size, telegramBotCommands.length);

for (const { command, description } of telegramBotCommands) {
  assert.match(command, /^[a-z0-9_]{1,32}$/);
  assert.ok(description.length >= 1 && description.length <= 256);
}

console.log('Telegram command menu assertions passed.');
