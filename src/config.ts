export type BridgeConfig = {
  token: string;
  allowedUserIds: Set<number>;
  codexCommand: string;
  codexArgs: string[];
  codexSubmitKey: string;
  codexSubmitDelayMs: number;
  codexCwd: string;
  tmuxSession: string;
  cols: number;
  rows: number;
  flushIntervalMs: number;
  pollIntervalMs: number;
  startupDelayMs: number;
  streamEditIntervalMs: number;
  streamMinChangeChars: number;
  typingIntervalMs: number;
  maxTelegramChars: number;
};

export function readConfig(): BridgeConfig {
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
    codexArgs: parseArgs(process.env.CODEX_ARGS || '--search --yolo'),
    codexSubmitKey: process.env.CODEX_SUBMIT_KEY || 'Enter',
    codexSubmitDelayMs: readNumber('CODEX_SUBMIT_DELAY_MS', 800),
    codexCwd: expandHome(process.env.CODEX_CWD || process.cwd()),
    tmuxSession: process.env.TMUX_SESSION || 'codex-telegram-bridge',
    cols: readNumber('CODEX_COLS', 120),
    rows: readNumber('CODEX_ROWS', 40),
    flushIntervalMs: readNumber('FLUSH_INTERVAL_MS', 1200),
    pollIntervalMs: readNumber('POLL_INTERVAL_MS', 500),
    startupDelayMs: readNumber('CODEX_STARTUP_DELAY_MS', 1500),
    streamEditIntervalMs: readNumber('STREAM_EDIT_INTERVAL_MS', 650),
    streamMinChangeChars: readNumber('STREAM_MIN_CHANGE_CHARS', 24),
    typingIntervalMs: readNumber('TYPING_INTERVAL_MS', 4000),
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

function expandHome(value: string): string {
  if (value === '~') {
    return process.env.HOME || value;
  }

  if (value.startsWith('~/')) {
    return `${process.env.HOME || '~'}${value.slice(1)}`;
  }

  return value;
}
