#!/usr/bin/env node

import { readConfig } from './config.js';
import { createDefaultEnvFile, defaultEnvPath, loadEnvironment } from './env.js';
import { TelegramCodexBridge } from './telegram-bridge.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (process.argv.includes('init')) {
  const envPath = createDefaultEnvFile();
  console.log(`Config file ready: ${envPath}`);
  console.log('Edit it, then run: codex-telegram-bridge');
  process.exit(0);
}

loadEnvironment();

const bridge = new TelegramCodexBridge(readConfig());

void bridge.start();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown(): Promise<void> {
  await bridge.stop();
  process.exit(0);
}

function printHelp(): void {
  console.log(`LaPage Codex Telegram Bridge

Usage:
  codex-telegram-bridge init       Create ${defaultEnvPath()}
  codex-telegram-bridge            Start the bridge

Environment:
  CODEX_TELEGRAM_BRIDGE_ENV=/path/to/.env  Use a custom config file
`);
}
