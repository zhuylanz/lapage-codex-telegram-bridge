import type { BridgeConfig } from './config.js';
import { capturePane, runTmux, shellCommand, tmuxSessionExists } from './tmux.js';

export class CodexSession {
  private running = false;
  private startPromise: Promise<void> | null = null;

  constructor(private readonly config: BridgeConfig) {}

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startSession().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (await this.exists()) {
      await runTmux(['kill-session', '-t', this.config.tmuxSession]).catch(() => undefined);
    }
    this.running = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async sendText(text: string): Promise<void> {
    await runTmux(['set-buffer', '-b', 'codex-telegram-input', text]);
    await runTmux(['paste-buffer', '-b', 'codex-telegram-input', '-t', this.config.tmuxSession]);
    await sleep(this.config.codexSubmitDelayMs);
    await runTmux(['send-keys', '-t', this.config.tmuxSession, this.config.codexSubmitKey]);
  }

  async interrupt(): Promise<void> {
    if (await this.exists()) {
      await runTmux(['send-keys', '-t', this.config.tmuxSession, 'C-c']);
    }
  }

  async waitUntilReady(hasOutput: boolean): Promise<void> {
    if (this.config.startupDelayMs > 0 && !hasOutput) {
      await sleep(this.config.startupDelayMs);
    }
  }

  async exists(): Promise<boolean> {
    return tmuxSessionExists(this.config.tmuxSession);
  }

  async capturePane(): Promise<string> {
    return capturePane(this.config.tmuxSession, this.config.rows);
  }

  private async startSession(): Promise<void> {
    if (this.running && await this.exists()) {
      return;
    }

    await runTmux(['kill-session', '-t', this.config.tmuxSession]).catch(() => undefined);
    await runTmux([
      'new-session',
      '-d',
      '-s',
      this.config.tmuxSession,
      '-c',
      this.config.codexCwd,
      '-x',
      String(this.config.cols),
      '-y',
      String(this.config.rows),
      shellCommand([this.config.codexCommand, ...this.config.codexArgs]),
    ]);

    this.running = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
