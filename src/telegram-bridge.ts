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

type ChatSessionState = {
  userId: number;
  chatId: number;
  codex: CodexSession;
  outputBuffer: string;
  lastOutputAt: Date | null;
  turnActive: boolean;
  renderItems: Map<string, RenderItem>;
  renderMessageIds: number[];
  typingTimer: NodeJS.Timeout | null;
  sendQueue: Promise<void>;
};

const attachmentTmpDir = join(tmpdir(), 'codex-telegram-bridge');

export class TelegramCodexBridge {
  private readonly bot: Bot;
  private readonly sessions = new Map<number, ChatSessionState>();

  constructor(private readonly config: BridgeConfig) {
    this.bot = new Bot(config.token);
  }

  async start(): Promise<void> {
    this.bot.on('message', async (context) => this.handleMessage(context));
    this.bot.catch((error) => {
      console.error('Telegram bot error:', error.message);
    });

    this.bot.start();
  }

  async stop(): Promise<void> {
    for (const state of this.sessions.values()) {
      this.stopTypingIndicator(state);
      await state.codex.stop();
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

    const state = this.getUserState(userId, chatId);
    const text = context.message?.text ?? context.message?.caption ?? '';
    const attachmentSources = this.extractAttachmentSources(context);
    if (!text.trim() && attachmentSources.length === 0) {
      await context.reply('Send text or an attachment to forward it to Codex.');
      return;
    }

    if (context.message?.text && await this.handleCommand(context, state, text.trim())) {
      return;
    }

    if (state.turnActive) {
      await context.reply('Codex is still working. Please wait, or send /interrupt to stop the current turn first.');
      return;
    }

    if (!state.codex.isRunning) {
      await state.codex.start();
    }

    this.resetTurnRenderState(state);
    state.turnActive = true;
    const streamMessage = await context.reply('Codex is working…');
    state.renderMessageIds = [streamMessage.message_id];
    this.startTypingIndicator(state);

    try {
      const attachments = await this.downloadAttachments(attachmentSources);
      await state.codex.sendText(text, attachments);
    } catch (error) {
      state.turnActive = false;
      this.stopTypingIndicator(state);
      await context.reply(`Failed to send prompt to Codex: ${telegramErrorSummary(error)}`);
    }
  }

  private getUserState(userId: number, chatId: number): ChatSessionState {
    const existing = this.sessions.get(userId);
    if (existing) {
      if (!existing.turnActive) {
        existing.chatId = chatId;
      }
      return existing;
    }

    const codex = new CodexSession(this.config);
    const state: ChatSessionState = {
      userId,
      chatId,
      codex,
      outputBuffer: '',
      lastOutputAt: null,
      turnActive: false,
      renderItems: new Map(),
      renderMessageIds: [],
      typingTimer: null,
      sendQueue: Promise.resolve(),
    };

    codex.on('itemCompleted', (item) => void this.handleCodexItemCompleted(state, item));
    codex.on('turnCompleted', () => void this.handleCodexTurnCompleted(state));
    codex.on('error', (message) => console.error(`Codex app-server [user ${userId}, chat ${state.chatId}]:`, message));
    codex.on('exit', (code, signal) => {
      console.error(`Codex app-server exited [user ${userId}, chat ${state.chatId}]:`, code ?? signal ?? 'unknown');
      state.turnActive = false;
      this.stopTypingIndicator(state);
    });

    this.sessions.set(userId, state);
    return state;
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

  private async handleCommand(context: Context, state: ChatSessionState, text: string): Promise<boolean> {
    switch (text) {
      case '/start':
      case '/help':
        await context.reply(this.helpText());
        return true;
      case '/status':
        await context.reply(this.statusText(state));
        return true;
      case '/flush':
        await this.renderTurnCache(state, true);
        return true;
      case '/interrupt':
        await state.codex.interrupt();
        state.turnActive = false;
        this.stopTypingIndicator(state);
        await context.reply('Interrupted Codex. Send another message when ready.');
        return true;
      case '/restart':
        await state.codex.restart();
        this.resetSnapshots(state);
        await context.reply('Restarted Codex app-server for this chat.');
        return true;
      case '/stop':
        await state.codex.stop();
        state.turnActive = false;
        this.stopTypingIndicator(state);
        await context.reply('Stopped Codex app-server for this chat. Send any message to start it again.');
        return true;
      default:
        return false;
    }
  }

  private startTypingIndicator(state: ChatSessionState): void {
    this.stopTypingIndicator(state);
    void this.sendTypingAction(state);
    state.typingTimer = setInterval(() => {
      void this.sendTypingAction(state);
    }, this.config.typingIntervalMs);
  }

  private stopTypingIndicator(state: ChatSessionState): void {
    if (state.typingTimer) {
      clearInterval(state.typingTimer);
      state.typingTimer = null;
    }
  }

  private async sendTypingAction(state: ChatSessionState): Promise<void> {
    await this.bot.api.sendChatAction(state.chatId, 'typing').catch(() => undefined);
  }

  private async handleCodexItemCompleted(state: ChatSessionState, item: CodexCompletedItem): Promise<void> {
    if (!state.turnActive) {
      return;
    }

    const rendered = renderCompletedItem(item);
    if (!rendered) {
      return;
    }

    state.lastOutputAt = new Date();
    state.renderItems.set(rendered.id, rendered);
    state.outputBuffer = this.renderCachedText(state);
    await this.renderTurnCache(state, false);
  }

  private async handleCodexTurnCompleted(state: ChatSessionState): Promise<void> {
    if (!state.turnActive) {
      return;
    }

    await this.renderTurnCache(state, true);
    state.turnActive = false;
    state.outputBuffer = '';
    this.resetTurnRenderState(state);
    this.stopTypingIndicator(state);
  }

  private async renderTurnCache(state: ChatSessionState, force: boolean): Promise<void> {
    const text = this.renderCachedText(state);
    if (!text) {
      if (force) {
        await this.queueTelegramSend(state, () => this.bot.api.sendMessage(state.chatId, 'No completed output yet.'));
      }
      return;
    }

    const markdownChunks = formatTelegramMarkdownChunks(text, this.config.maxTelegramChars);
    const fallbackChunks = safePlainTelegramChunks(text, this.config.maxTelegramChars);

    for (let index = 0; index < markdownChunks.length; index += 1) {
      const markdown = markdownChunks[index];
      const fallback = fallbackChunks[index] ?? safePlainTelegramText(markdown);
      const messageId = state.renderMessageIds[index];
      if (messageId) {
        const edited = await this.editFormattedMarkdown(state, messageId, markdown, fallback);
        if (!edited) {
          const sent = await this.sendFormattedMarkdownAndReturn(state, markdown, fallback);
          if (sent) {
            state.renderMessageIds[index] = sent.message_id;
          }
        }
      } else {
        const sent = await this.sendFormattedMarkdownAndReturn(state, markdown, fallback);
        if (sent) {
          state.renderMessageIds[index] = sent.message_id;
        }
      }
    }

    state.renderMessageIds = state.renderMessageIds.slice(0, markdownChunks.length);
  }

  private renderCachedText(state: ChatSessionState): string {
    return [...state.renderItems.values()]
      .sort((first, second) => first.order - second.order)
      .map((item) => item.text)
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  private async sendFormattedMarkdownAndReturn(state: ChatSessionState, markdown: string, fallback: string): Promise<Message.TextMessage | null> {
    const sent = await this.queueTelegramSend(state, () => this.bot.api.sendMessage(state.chatId, markdown, { parse_mode: 'MarkdownV2' }))
      .catch((error) => {
        console.error('Telegram Markdown send failed:', telegramErrorSummary(error));
        return null;
      });
    if (sent) {
      return sent;
    }

    return this.queueTelegramSend(state, () => this.bot.api.sendMessage(state.chatId, fallback)).catch(() => null);
  }

  private async editFormattedMarkdown(state: ChatSessionState, messageId: number, markdown: string, fallback: string): Promise<boolean> {
    const edited = await this.bot.api.editMessageText(state.chatId, messageId, markdown, {
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

    return this.bot.api.editMessageText(state.chatId, messageId, fallback)
      .then(() => true)
      .catch(() => false);
  }

  private queueTelegramSend<T>(state: ChatSessionState, operation: () => Promise<T>): Promise<T> {
    const run = async () => {
      await sleep(350);
      return retryTelegramOperation(operation);
    };

    const next = state.sendQueue.then(run, run);
    state.sendQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private statusText(state: ChatSessionState): string {
    return [
      `Codex: ${state.codex.isRunning ? 'running' : 'stopped'}`,
      `Turn: ${state.turnActive ? 'active' : 'idle'}`,
      'Transport: stdio app-server',
      `User: ${state.userId}`,
      `Chat: ${state.chatId}`,
      `CWD: ${this.config.codexCwd}`,
      `Command: ${this.config.codexCommand} app-server --stdio`,
      `Approval policy: ${this.config.codexApprovalPolicy}`,
      `Sandbox: ${this.config.codexSandbox}`,
      `Completed items: ${state.renderItems.size}`,
      `Buffered chars: ${state.outputBuffer.length}`,
      `Last output: ${state.lastOutputAt?.toISOString() ?? 'none'}`,
    ].join('\n');
  }

  private helpText(): string {
    return [
      'Telegram ↔ Codex bridge commands:',
      '/status - show your bridge status',
      '/flush - send your completed Codex output now',
      '/interrupt - interrupt your active Codex turn',
      '/restart - restart your Codex app-server',
      '/stop - stop your Codex app-server',
      '',
      'Any other text or attachment is sent directly to your Codex session.',
    ].join('\n');
  }

  private resetSnapshots(state: ChatSessionState): void {
    state.outputBuffer = '';
    state.lastOutputAt = null;
    this.resetTurnRenderState(state);
    this.stopTypingIndicator(state);
  }

  private resetTurnRenderState(state: ChatSessionState): void {
    state.turnActive = false;
    state.renderItems.clear();
    state.renderMessageIds = [];
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
