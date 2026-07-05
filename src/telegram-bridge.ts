import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { Bot, Context } from 'grammy';
import type { Message } from 'grammy/types';
import type { BridgeConfig } from './config.js';
import { CodexSession, type CodexAttachment, type CodexCompletedItem } from './codex-session.js';
import { formatTelegramMarkdownChunks, safePlainTelegramChunks, safePlainTelegramText } from './text.js';

type RenderItem = {
  id: string;
  order: number;
  text: string;
};

type TelegramAttachmentSource = {
  fileId: string;
  originalName: string;
  mimeType?: string;
  kind: 'image' | 'file';
};

const attachmentTmpDir = join(tmpdir(), 'codex-telegram-bridge');

export class TelegramCodexBridge {
  private readonly bot: Bot;
  private readonly codex: CodexSession;
  private activeChatId: number | null = null;
  private outputBuffer = '';
  private lastOutputAt: Date | null = null;
  private turnActive = false;
  private renderItems = new Map<string, RenderItem>();
  private renderOrder = 0;
  private renderMessageIds: number[] = [];
  private typingTimer: NodeJS.Timeout | null = null;
  private sendQueue: Promise<void> = Promise.resolve();

  constructor(private readonly config: BridgeConfig) {
    this.bot = new Bot(config.token);
    this.codex = new CodexSession(config);
    this.codex.on('itemCompleted', (item) => void this.handleCodexItemCompleted(item));
    this.codex.on('turnCompleted', () => void this.handleCodexTurnCompleted());
    this.codex.on('error', (message) => console.error('Codex app-server:', message));
    this.codex.on('exit', (code, signal) => console.error('Codex app-server exited:', code ?? signal ?? 'unknown'));
  }

  async start(): Promise<void> {
    await this.codex.start();

    this.bot.on('message', async (context) => this.handleMessage(context));
    this.bot.catch((error) => {
      console.error('Telegram bot error:', error.message);
    });

    this.bot.start();
  }

  async stop(): Promise<void> {
    this.stopTypingIndicator();
    await this.codex.stop();
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

    const text = context.message?.text ?? context.message?.caption ?? '';
    const attachmentSources = this.extractAttachmentSources(context);
    if (!text.trim() && attachmentSources.length === 0) {
      await context.reply('Send text or an attachment to forward it to Codex.');
      return;
    }

    if (context.message?.text && await this.handleCommand(context, text.trim())) {
      return;
    }

    if (!this.codex.isRunning) {
      await this.codex.start();
    }

    this.resetTurnRenderState();
    this.turnActive = true;
    const streamMessage = await context.reply('Codex is working…');
    this.renderMessageIds = [streamMessage.message_id];
    this.startTypingIndicator();

    const attachments = await this.downloadAttachments(attachmentSources);
    await this.codex.sendText(text, attachments);
  }

  private extractAttachmentSources(context: Context): TelegramAttachmentSource[] {
    const message = context.message;
    if (!message) {
      return [];
    }

    const sources: TelegramAttachmentSource[] = [];

    const photo = message.photo?.at(-1);
    if (photo) {
      sources.push({
        fileId: photo.file_id,
        originalName: `telegram-photo-${photo.file_unique_id}.jpg`,
        mimeType: 'image/jpeg',
        kind: 'image',
      });
    }

    if (message.document) {
      const mimeType = message.document.mime_type;
      sources.push({
        fileId: message.document.file_id,
        originalName: message.document.file_name ?? `telegram-document-${message.document.file_unique_id}${extensionForMime(mimeType)}`,
        mimeType,
        kind: mimeType?.startsWith('image/') ? 'image' : 'file',
      });
    }

    if (message.video) {
      sources.push({
        fileId: message.video.file_id,
        originalName: message.video.file_name ?? `telegram-video-${message.video.file_unique_id}.mp4`,
        mimeType: message.video.mime_type,
        kind: 'file',
      });
    }

    if (message.animation) {
      sources.push({
        fileId: message.animation.file_id,
        originalName: message.animation.file_name ?? `telegram-animation-${message.animation.file_unique_id}.mp4`,
        mimeType: message.animation.mime_type,
        kind: 'file',
      });
    }

    if (message.audio) {
      sources.push({
        fileId: message.audio.file_id,
        originalName: message.audio.file_name ?? `telegram-audio-${message.audio.file_unique_id}${extensionForMime(message.audio.mime_type)}`,
        mimeType: message.audio.mime_type,
        kind: 'file',
      });
    }

    if (message.voice) {
      sources.push({
        fileId: message.voice.file_id,
        originalName: `telegram-voice-${message.voice.file_unique_id}.ogg`,
        mimeType: message.voice.mime_type,
        kind: 'file',
      });
    }

    return sources;
  }

  private async downloadAttachments(sources: TelegramAttachmentSource[]): Promise<CodexAttachment[]> {
    if (sources.length === 0) {
      return [];
    }

    await mkdir(attachmentTmpDir, { recursive: true });
    const attachments: CodexAttachment[] = [];

    for (const source of sources) {
      try {
        attachments.push(await this.downloadAttachment(source));
      } catch (error) {
        console.error('Telegram attachment download failed:', telegramErrorSummary(error));
      }
    }

    return attachments;
  }

  private async downloadAttachment(source: TelegramAttachmentSource): Promise<CodexAttachment> {
    const file = await this.bot.api.getFile(source.fileId);
    if (!file.file_path) {
      throw new Error(`Telegram did not return file_path for ${source.originalName}`);
    }

    const token = this.config.token;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed with ${response.status} ${response.statusText}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    const safeName = safeFileName(source.originalName);
    const extension = extname(safeName) || extensionForMime(source.mimeType);
    const fileName = `${randomUUID()}${extension}`;
    const path = join(attachmentTmpDir, fileName);
    await writeFile(path, data);

    return {
      path,
      name: basename(safeName),
      mimeType: source.mimeType,
      kind: source.kind,
    };
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
        await this.renderTurnCache(true);
        return true;
      case '/interrupt':
        await this.codex.interrupt();
        await context.reply('Sent interrupt to Codex.');
        return true;
      case '/restart':
        await this.codex.restart();
        this.resetSnapshots();
        await context.reply('Restarted Codex app-server.');
        return true;
      case '/stop':
        await this.codex.stop();
        this.stopTypingIndicator();
        await context.reply('Stopped Codex app-server. Send any message to start it again.');
        return true;
      default:
        return false;
    }
  }

  private startTypingIndicator(): void {
    if (!this.activeChatId) {
      return;
    }

    this.stopTypingIndicator();
    void this.sendTypingAction();
    this.typingTimer = setInterval(() => {
      void this.sendTypingAction();
    }, this.config.typingIntervalMs);
  }

  private stopTypingIndicator(): void {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private async sendTypingAction(): Promise<void> {
    if (!this.activeChatId) {
      return;
    }

    await this.bot.api.sendChatAction(this.activeChatId, 'typing').catch(() => undefined);
  }

  private async handleCodexItemCompleted(item: CodexCompletedItem): Promise<void> {
    if (!this.turnActive) {
      return;
    }

    const rendered = renderCompletedItem(item);
    if (!rendered) {
      return;
    }

    this.lastOutputAt = new Date();
    this.renderItems.set(rendered.id, rendered);
    this.outputBuffer = this.renderCachedText();
    await this.renderTurnCache(false);
  }

  private async handleCodexTurnCompleted(): Promise<void> {
    if (!this.turnActive) {
      return;
    }

    await this.renderTurnCache(true);
    this.turnActive = false;
    this.outputBuffer = '';
    this.resetTurnRenderState();
    this.stopTypingIndicator();
  }

  private async renderTurnCache(force: boolean): Promise<void> {
    if (!this.activeChatId) {
      return;
    }

    const text = this.renderCachedText();
    if (!text) {
      if (force) {
        await this.queueTelegramSend(() => this.bot.api.sendMessage(this.activeChatId!, 'No completed output yet.'));
      }
      return;
    }

    const markdownChunks = formatTelegramMarkdownChunks(text, this.config.maxTelegramChars);
    const fallbackChunks = safePlainTelegramChunks(text, this.config.maxTelegramChars);

    for (let index = 0; index < markdownChunks.length; index += 1) {
      const markdown = markdownChunks[index];
      const fallback = fallbackChunks[index] ?? safePlainTelegramText(markdown);
      const messageId = this.renderMessageIds[index];
      if (messageId) {
        const edited = await this.editFormattedMarkdown(messageId, markdown, fallback);
        if (!edited) {
          const sent = await this.sendFormattedMarkdownAndReturn(markdown, fallback);
          if (sent) {
            this.renderMessageIds[index] = sent.message_id;
          }
        }
      } else {
        const sent = await this.sendFormattedMarkdownAndReturn(markdown, fallback);
        if (sent) {
          this.renderMessageIds[index] = sent.message_id;
        }
      }
    }

    this.renderMessageIds = this.renderMessageIds.slice(0, markdownChunks.length);
  }

  private renderCachedText(): string {
    return [...this.renderItems.values()]
      .sort((first, second) => first.order - second.order)
      .map((item) => item.text)
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  private async sendFormattedMarkdownAndReturn(markdown: string, fallback: string): Promise<Message.TextMessage | null> {
    if (!this.activeChatId) {
      return null;
    }

    const chatId = this.activeChatId;
    const sent = await this.queueTelegramSend(() => this.bot.api.sendMessage(chatId, markdown, { parse_mode: 'MarkdownV2' }))
      .catch((error) => {
        console.error('Telegram Markdown send failed:', telegramErrorSummary(error));
        return null;
      });
    if (sent) {
      return sent;
    }

    return this.queueTelegramSend(() => this.bot.api.sendMessage(chatId, fallback)).catch(() => null);
  }

  private async editFormattedMarkdown(messageId: number, markdown: string, fallback: string): Promise<boolean> {
    if (!this.activeChatId) {
      return false;
    }

    const edited = await this.bot.api.editMessageText(this.activeChatId, messageId, markdown, {
      parse_mode: 'MarkdownV2',
    }).then(() => true).catch((error) => {
      if (isTelegramMessageNotModified(error)) {
        return true;
      }

      console.error('Telegram Markdown edit failed:', telegramErrorSummary(error));
      return false;
    });
    if (edited) {
      return true;
    }

    return this.bot.api.editMessageText(this.activeChatId, messageId, fallback)
      .then(() => true)
      .catch(() => false);
  }

  private queueTelegramSend<T>(operation: () => Promise<T>): Promise<T> {
    const run = async () => {
      await sleep(350);
      return retryTelegramOperation(operation);
    };

    const next = this.sendQueue.then(run, run);
    this.sendQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private statusText(): string {
    return [
      `Codex: ${this.codex.isRunning ? 'running' : 'stopped'}`,
      'Transport: stdio app-server',
      `CWD: ${this.config.codexCwd}`,
      `Command: ${this.config.codexCommand} app-server --stdio`,
      `Approval policy: ${this.config.codexApprovalPolicy}`,
      `Sandbox: ${this.config.codexSandbox}`,
      `Completed items: ${this.renderItems.size}`,
      `Buffered chars: ${this.outputBuffer.length}`,
      `Last output: ${this.lastOutputAt?.toISOString() ?? 'none'}`,
    ].join('\n');
  }

  private helpText(): string {
    return [
      'Telegram ↔ Codex bridge commands:',
      '/status - show bridge status',
      '/flush - send completed Codex output now',
      '/interrupt - interrupt the active Codex turn',
      '/restart - restart Codex app-server',
      '/stop - stop Codex app-server',
      '',
      'Any other text is sent directly to Codex app-server.',
    ].join('\n');
  }

  private resetSnapshots(): void {
    this.outputBuffer = '';
    this.lastOutputAt = null;
    this.resetTurnRenderState();
    this.stopTypingIndicator();
  }

  private resetTurnRenderState(): void {
    this.turnActive = false;
    this.renderItems.clear();
    this.renderOrder = 0;
    this.renderMessageIds = [];
  }
}

function renderCompletedItem(item: CodexCompletedItem): RenderItem | null {
  const id = typeof item.id === 'string' ? item.id : `${item.type ?? 'item'}-${Date.now()}`;
  const order = completedAtMs(item) ?? Date.now();

  switch (item.type) {
    case 'agentMessage': {
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      return text ? { id, order, text } : null;
    }
    case 'commandExecution': {
      const command = typeof item.command === 'string' ? compactCommand(item.command) : 'command';
      const status = typeof item.status === 'string' ? item.status : 'completed';
      const exitCode = typeof item.exitCode === 'number' ? `, exit ${item.exitCode}` : '';
      const duration = typeof item.durationMs === 'number' ? `, ${Math.round(item.durationMs / 100) / 10}s` : '';
      return {
        id,
        order,
        text: [`🔧 Ran \`${command}\``, `Status: ${status}${exitCode}${duration}`].join('\n'),
      };
    }
    case 'mcpToolCall': {
      const server = typeof item.server === 'string' ? item.server : 'mcp';
      const tool = typeof item.tool === 'string' ? item.tool : 'tool';
      const status = typeof item.status === 'string' ? item.status : 'completed';
      return { id, order, text: `🔌 Tool \`${server}/${tool}\`\nStatus: ${status}` };
    }
    default:
      return null;
  }
}

async function retryTelegramOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const retryAfter = telegramRetryAfterMs(error);
    if (retryAfter === null) {
      throw error;
    }
    await sleep(retryAfter);
    return operation();
  }
}

function telegramRetryAfterMs(error: unknown): number | null {
  const parameters = (error as { parameters?: { retry_after?: number } }).parameters;
  if (typeof parameters?.retry_after === 'number') {
    return (parameters.retry_after + 1) * 1000;
  }

  const description = (error as { description?: string }).description;
  const match = description?.match(/retry after (\d+)/i);
  if (match) {
    return (Number(match[1]) + 1) * 1000;
  }

  return null;
}

function telegramErrorSummary(error: unknown): string {
  const description = (error as { description?: string }).description;
  if (description) {
    return description;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isTelegramMessageNotModified(error: unknown): boolean {
  return /message is not modified/i.test(telegramErrorSummary(error));
}

function compactCommand(command: string): string {
  return command.replace(/\s+/g, ' ').slice(0, 160);
}

function safeFileName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
}

function extensionForMime(mimeType: string | undefined): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'application/pdf':
      return '.pdf';
    case 'video/mp4':
      return '.mp4';
    case 'audio/mpeg':
      return '.mp3';
    case 'audio/ogg':
      return '.ogg';
    default:
      return '';
  }
}

function completedAtMs(item: CodexCompletedItem): number | null {
  const value = item.completedAtMs;
  return typeof value === 'number' ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
