import { Bot, Context } from 'grammy';
import type { BridgeConfig } from './config.js';
import { CodexSession } from './codex-session.js';
import { chunkText, isCodexWorking, latestCodexResponse, latestCompletedCodexResponse, wrapCodeBlock } from './text.js';

export class TelegramCodexBridge {
  private readonly bot: Bot;
  private readonly codex: CodexSession;
  private activeChatId: number | null = null;
  private outputBuffer = '';
  private lastOutputAt: Date | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastPaneResponse = '';
  private lastSentResponse = '';
  private lastSnapshotSentAt = 0;
  private streamMessageId: number | null = null;
  private lastStreamText = '';
  private lastStreamEditAt = 0;

  constructor(private readonly config: BridgeConfig) {
    this.bot = new Bot(config.token);
    this.codex = new CodexSession(config);
  }

  async start(): Promise<void> {
    await this.codex.start();
    this.startPollingOutput();

    this.bot.on('message', async (context) => this.handleMessage(context));
    this.bot.catch((error) => {
      console.error('Telegram bot error:', error.message);
    });

    this.bot.start();
  }

  async stop(): Promise<void> {
    this.stopPollingOutput();
    await this.codex.stop();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.bot.stop();
  }

  private async handleMessage(context: Context): Promise<void> {
    const chatId = context.chat?.id;
    const userId = context.from?.id;

    if (!chatId) {
      return;
    }

    if (!userId || !this.config.allowedUserIds.has(userId)) {
      await context.reply('Not authorized.');
      return;
    }

    this.activeChatId = chatId;

    const text = context.message?.text ?? '';
    if (!text.trim()) {
      await context.reply('Send text to forward it to Codex.');
      return;
    }

    if (await this.handleCommand(context, text.trim())) {
      return;
    }

    if (!this.codex.isRunning) {
      await this.codex.start();
    }

    await this.codex.waitUntilReady(Boolean(this.lastOutputAt));
    await this.codex.sendText(text);
    const streamMessage = await context.reply('Codex is working…');
    this.streamMessageId = streamMessage.message_id;
    this.lastStreamText = 'Codex is working…';
    this.lastStreamEditAt = Date.now();
  }

  private async handleCommand(context: Context, text: string): Promise<boolean> {
    switch (text) {
      case '/start':
      case '/help':
        await context.reply(this.helpText());
        return true;
      case '/status':
        await context.reply(this.statusText());
        return true;
      case '/flush':
        await this.readNewOutput(true);
        await this.flushOutput(true);
        return true;
      case '/interrupt':
        await this.codex.interrupt();
        await context.reply('Sent Ctrl-C to Codex.');
        return true;
      case '/restart':
        await this.codex.restart();
        this.resetSnapshots();
        await context.reply('Restarted Codex.');
        return true;
      case '/stop':
        await this.codex.stop();
        await context.reply('Stopped Codex. Send any message to start it again.');
        return true;
      default:
        return false;
    }
  }

  private startPollingOutput(): void {
    this.stopPollingOutput();
    this.pollTimer = setInterval(() => {
      void this.readNewOutput();
      void this.refreshCodexRunningState();
    }, this.config.pollIntervalMs);
  }

  private stopPollingOutput(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async readNewOutput(force = false): Promise<void> {
    if (!this.activeChatId || !await this.codex.exists()) {
      return;
    }

    const pane = await this.codex.capturePane();
    const response = force ? latestCompletedCodexResponse(pane) : latestCodexResponse(pane);
    const working = isCodexWorking(pane);

    if (this.streamMessageId && response) {
      await this.editStreamMessage(response, !working || force);
    }

    if (working && !force) {
      return;
    }

    if (!response || (!force && response === this.lastPaneResponse)) {
      return;
    }

    this.lastPaneResponse = response;
    if (!force && !this.shouldSendResponse(response)) {
      return;
    }

    this.lastSentResponse = response;
    this.lastSnapshotSentAt = Date.now();
    this.outputBuffer = response;
    this.lastOutputAt = new Date();
    if (!this.streamMessageId) {
      this.scheduleFlush();
    }
  }

  private async refreshCodexRunningState(): Promise<void> {
    const exists = await this.codex.exists();
    if (!exists && this.codex.isRunning) {
      this.outputBuffer = '[Codex tmux session exited]';
      this.scheduleFlush();
    }
  }

  private shouldSendResponse(response: string): boolean {
    if (response === this.lastSentResponse) {
      return false;
    }
    return true;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      await this.flushOutput(false);
    }, this.config.flushIntervalMs);
  }

  private async flushOutput(force: boolean): Promise<void> {
    if (!this.activeChatId) {
      return;
    }

    const trimmed = this.outputBuffer.trimEnd();
    if (!trimmed) {
      if (force) {
        await this.bot.api.sendMessage(this.activeChatId, 'No buffered output.');
      }
      this.outputBuffer = '';
      return;
    }

    this.outputBuffer = '';
    for (const chunk of chunkText(trimmed, this.config.maxTelegramChars)) {
      await this.bot.api.sendMessage(this.activeChatId, wrapCodeBlock(chunk), { parse_mode: 'MarkdownV2' });
    }
  }

  private async editStreamMessage(text: string, force: boolean): Promise<void> {
    if (!this.activeChatId || !this.streamMessageId) {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || trimmed === this.lastStreamText) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastStreamEditAt < 1500) {
      return;
    }

    const [chunk] = chunkText(trimmed, this.config.maxTelegramChars);
    await this.bot.api.editMessageText(this.activeChatId, this.streamMessageId, wrapCodeBlock(chunk), {
      parse_mode: 'MarkdownV2',
    }).catch(() => undefined);

    this.lastStreamText = trimmed;
    this.lastStreamEditAt = now;
  }

  private statusText(): string {
    return [
      `Codex: ${this.codex.isRunning ? 'running' : 'stopped'}`,
      `tmux: ${this.config.tmuxSession}`,
      `CWD: ${this.config.codexCwd}`,
      `Command: ${[this.config.codexCommand, ...this.config.codexArgs].join(' ')}`,
      `Submit key: ${this.config.codexSubmitKey}`,
      `Submit delay: ${this.config.codexSubmitDelayMs}ms`,
      `Buffered chars: ${this.outputBuffer.length}`,
      `Last output: ${this.lastOutputAt?.toISOString() ?? 'none'}`,
    ].join('\n');
  }

  private helpText(): string {
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

  private resetSnapshots(): void {
    this.lastPaneResponse = '';
    this.lastSentResponse = '';
    this.lastSnapshotSentAt = 0;
    this.lastOutputAt = null;
    this.streamMessageId = null;
    this.lastStreamText = '';
    this.lastStreamEditAt = 0;
  }
}
