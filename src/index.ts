import 'dotenv/config';

import { readConfig } from './config.js';
import { TelegramCodexBridge } from './telegram-bridge.js';

const bridge = new TelegramCodexBridge(readConfig());

void bridge.start();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown(): Promise<void> {
  await bridge.stop();
  process.exit(0);
}
