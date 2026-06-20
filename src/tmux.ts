import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runTmux(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', args, { env: process.env });
  return stdout;
}

export async function tmuxSessionExists(session: string): Promise<boolean> {
  try {
    await runTmux(['has-session', '-t', session]);
    return true;
  } catch {
    return false;
  }
}

export async function capturePane(session: string, rows: number): Promise<string> {
  return runTmux(['capture-pane', '-p', '-t', session, '-S', `-${rows}`]);
}

export function shellCommand(parts: string[]): string {
  return parts.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
