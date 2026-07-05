import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

const configDirName = '.lapage-codex-telegram-bridge';
const envFileName = '.env';

export function defaultConfigDir(): string {
  return join(homedir(), configDirName);
}

export function defaultEnvPath(): string {
  return join(defaultConfigDir(), envFileName);
}

export function loadEnvironment(): string[] {
  const loaded: string[] = [];
  const explicitEnvPath = process.env.CODEX_TELEGRAM_BRIDGE_ENV;
  const candidates = explicitEnvPath
    ? [resolve(explicitEnvPath)]
    : [resolve(process.cwd(), envFileName), defaultEnvPath()];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    loadDotenv({ path, override: false });
    loaded.push(path);
  }

  return loaded;
}

export function createDefaultEnvFile(): string {
  const targetPath = defaultEnvPath();

  if (existsSync(targetPath)) {
    return targetPath;
  }

  mkdirSync(defaultConfigDir(), { recursive: true, mode: 0o700 });
  writeFileSync(targetPath, readEnvTemplate(), { mode: 0o600 });
  return targetPath;
}

function readEnvTemplate(): string {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const templatePath = join(packageRoot, '.env.example');

  if (existsSync(templatePath)) {
    return readFileSync(templatePath, 'utf8');
  }

  return [
    'TELEGRAM_BOT_TOKEN=123456:replace_me',
    'TELEGRAM_ALLOWED_USER_IDS=123456789',
    'CODEX_CWD=~',
    'CODEX_COMMAND=codex',
    'CODEX_ARGS=app-server --stdio',
    'CODEX_APPROVAL_POLICY=never',
    'CODEX_SANDBOX=danger-full-access',
    'CODEX_EPHEMERAL=false',
    'STREAM_EDIT_INTERVAL_MS=650',
    'STREAM_MIN_CHANGE_CHARS=24',
    'TYPING_INTERVAL_MS=4000',
    'MAX_TELEGRAM_CHARS=3500',
    '',
  ].join('\n');
}
