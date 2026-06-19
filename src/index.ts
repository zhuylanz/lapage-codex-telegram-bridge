import 'dotenv/config';

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Bot, Context } from 'grammy';
import stripAnsi from 'strip-ansi';

type BridgeConfig = {
  token: string;
  allowedUserIds: Set<number>;
  codexCommand: string;
  codexArgs: string[];
  codexCwd: string;
  cols: number;
  rows: number;
  flushIntervalMs: number;
  maxTelegramChars: number;
};

const config = readConfig();
const bot = new Bot(config.token);

let codex: ChildProcessWithoutNullStreams | null = null;
let activeChatId: number | null = null;
let outputBuffer = '';
let lastOutputAt: Date | null = null;
let flushTimer: NodeJS.Timeout | null = null;

startCodex();

bot.on('message', async (context) => {
  const chatId = context.chat.id;
  const userId = context.from?.id;

  if (!userId || !config.allowedUserIds.has(userId)) {
    await context.reply('Not authorized.');
    return;
  }

  activeChatId = chatId;

  const text = context.message.text ?? '';
  if (!text.trim()) {
    await context.reply('Send text to forward it to Codex.');
    return;
  }

  if (await handleCommand(context, text.trim())) {
    return;
  }

  if (!codex) {
    startCodex();
  }

  codex?.stdin.write(`${text}\n`);
});

bot.catch((error) => {
  console.error('Telegram bot error:', error.message);
});

bot.start();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function handleCommand(context: Context, text: string): Promise<boolean> {
  switch (text) {
    case '/start':
    case '/help':
      await context.reply(helpText());
      return true;
    case '/status':
      await context.reply(statusText());
      return true;
    case '/flush':
      await flushOutput(true);
      return true;
    case '/interrupt':
      codex?.stdin.write('\x03');
      await context.reply('Sent Ctrl-C to Codex.');
      return true;
    case '/restart':
      restartCodex();
      await context.reply('Restarted Codex.');
      return true;
    case '/stop':
      stopCodex();
      await context.reply('Stopped Codex. Send any message to start it again.');
      return true;
    default:
      return false;
  }
}

function startCodex(): void {
  if (codex) {
    return;
  }

  codex = spawn('script', ['-q', '/dev/null', config.codexCommand, ...config.codexArgs], {
    cwd: config.codexCwd,
    env: {
      ...process.env,
      COLUMNS: String(config.cols),
      LINES: String(config.rows),
      TERM: process.env.TERM || 'xterm-256color',
    },
  });

  codex.stdout.on('data', (data: Buffer) => {
    outputBuffer += normalizeTerminalOutput(data.toString('utf8'));
    lastOutputAt = new Date();
    scheduleFlush();
  });

  codex.stderr.on('data', (data: Buffer) => {
    outputBuffer += normalizeTerminalOutput(data.toString('utf8'));
    lastOutputAt = new Date();
    scheduleFlush();
  });

  codex.on('exit', (exitCode, signal) => {
    codex = null;
    outputBuffer += `\n[Codex exited: code=${exitCode}, signal=${signal ?? 'none'}]\n`;
    scheduleFlush();
  });
}

function stopCodex(): void {
  if (!codex) {
    return;
  }

  const processToStop = codex;
  codex = null;
  processToStop.kill('SIGTERM');
}

function restartCodex(): void {
  stopCodex();
  startCodex();
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushOutput(false);
  }, config.flushIntervalMs);
}

async function flushOutput(force: boolean): Promise<void> {
  if (!activeChatId) {
    return;
  }

  const trimmed = outputBuffer.trimEnd();
  if (!trimmed) {
    if (force) {
      await bot.api.sendMessage(activeChatId, 'No buffered output.');
    }
    outputBuffer = '';
    return;
  }

  outputBuffer = '';
  for (const chunk of chunkText(trimmed, config.maxTelegramChars)) {
    await bot.api.sendMessage(activeChatId, wrapCodeBlock(chunk), { parse_mode: 'MarkdownV2' });
  }
}

function normalizeTerminalOutput(data: string): string {
  return stripAnsi(data)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const newlineIndex = remaining.lastIndexOf('\n', maxLength);
    const splitIndex = newlineIndex > maxLength * 0.5 ? newlineIndex : maxLength;
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function wrapCodeBlock(text: string): string {
  return `\`\`\`text\n${escapeMarkdownV2(text)}\n\`\`\``;
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*.\[\]()~`>#+\-=|{}!\\])/g, '\\$1');
}

function statusText(): string {
  return [
    `Codex: ${codex ? 'running' : 'stopped'}`,
    `CWD: ${config.codexCwd}`,
    `Command: ${[config.codexCommand, ...config.codexArgs].join(' ')}`,
    `Buffered chars: ${outputBuffer.length}`,
    `Last output: ${lastOutputAt?.toISOString() ?? 'none'}`,
  ].join('\n');
}

function helpText(): string {
  return [
    'Telegram ↔ Codex bridge commands:',
    '/status - show bridge status',
    '/flush - send buffered Codex output now',
    '/interrupt - send Ctrl-C to Codex',
    '/restart - restart Codex session',
    '/stop - stop Codex session',
    '',
    'Any other text is sent directly to the Codex CLI.',
  ].join('\n');
}

function readConfig(): BridgeConfig {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const allowedUserIds = new Set(
    requireEnv('TELEGRAM_ALLOWED_USER_IDS')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value)),
  );

  if (allowedUserIds.size === 0) {
    throw new Error('TELEGRAM_ALLOWED_USER_IDS must contain at least one numeric user ID.');
  }

  return {
    token,
    allowedUserIds,
    codexCommand: process.env.CODEX_COMMAND || 'codex',
    codexArgs: parseArgs(process.env.CODEX_ARGS || ''),
    codexCwd: process.env.CODEX_CWD || process.cwd(),
    cols: readNumber('CODEX_COLS', 120),
    rows: readNumber('CODEX_ROWS', 40),
    flushIntervalMs: readNumber('FLUSH_INTERVAL_MS', 1200),
    maxTelegramChars: Math.min(readNumber('MAX_TELEGRAM_CHARS', 3500), 3900),
  };
}

function parseArgs(value: string): string[] {
  return value.split(' ').map((part) => part.trim()).filter(Boolean);
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function shutdown(): Promise<void> {
  stopCodex();
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  await bot.stop();
  process.exit(0);
}
