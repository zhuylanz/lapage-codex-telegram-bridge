export type BridgeConfig = {
  token: string;
  allowedUserIds: Set<number>;
  codexCommand: string;
  codexArgs: string[];
  codexCwd: string;
  codexApprovalPolicy: string;
  codexSandbox: string;
  codexEphemeral: boolean;
  streamEditIntervalMs: number;
  streamMinChangeChars: number;
  typingIntervalMs: number;
  maxTelegramChars: number;
};

export function readConfig(): BridgeConfig {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const codexArgs = parseArgs(process.env.CODEX_ARGS || 'app-server --stdio');
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
    codexArgs: validateCodexArgs(codexArgs),
    codexCwd: expandHome(process.env.CODEX_CWD || process.cwd()),
    codexApprovalPolicy: process.env.CODEX_APPROVAL_POLICY || 'never',
    codexSandbox: process.env.CODEX_SANDBOX || 'danger-full-access',
    codexEphemeral: readBoolean('CODEX_EPHEMERAL', false),
    streamEditIntervalMs: readNumber('STREAM_EDIT_INTERVAL_MS', 650),
    streamMinChangeChars: readNumber('STREAM_MIN_CHANGE_CHARS', 24),
    typingIntervalMs: readNumber('TYPING_INTERVAL_MS', 4000),
    maxTelegramChars: Math.min(readNumber('MAX_TELEGRAM_CHARS', 3500), 3900),
  };
}

function validateCodexArgs(args: string[]): string[] {
  if (!args.includes('app-server')) {
    throw new Error('CODEX_ARGS must start Codex app-server, for example: CODEX_ARGS=app-server --stdio');
  }

  return args;
}

function parseArgs(value: string): string[] {
  return value.split(' ').map((part) => part.trim()).filter(Boolean);
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value);
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
