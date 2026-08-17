import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

import type { BridgeConfig } from './config.js';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

type RpcResponse = {
  id: number;
  result?: JsonValue;
  error?: {
    code: number;
    message: string;
    data?: JsonValue;
  };
};

type ServerNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type PendingRequest = {
  resolve: (value: JsonValue | undefined) => void;
  reject: (error: Error) => void;
};

export type CodexCompletedItem = Record<string, unknown> & {
  id?: string;
  type?: string;
};

export type CodexAttachment = {
  path: string;
  name: string;
  mimeType?: string;
  kind: 'image' | 'file';
};

export type CodexThreadSummary = {
  id: string;
  name: string | null;
  preview: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
};

export type CodexSessionEvents = {
  itemCompleted: [item: CodexCompletedItem];
  turnStarted: [];
  turnCompleted: [];
  error: [message: string];
  exit: [code: number | null, signal: NodeJS.Signals | null];
};

export function codexAppServerArgs(
  config: Pick<BridgeConfig, 'codexModel' | 'codexReasoningEffort'>,
): string[] {
  const args: string[] = [];

  if (config.codexModel) {
    args.push('--model', config.codexModel);
  }

  if (config.codexReasoningEffort) {
    args.push('-c', `model_reasoning_effort=${config.codexReasoningEffort}`);
  }

  args.push('app-server', '--stdio');
  return args;
}

export declare interface CodexSession {
  on<K extends keyof CodexSessionEvents>(
    event: K,
    listener: (...args: CodexSessionEvents[K]) => void,
  ): this;
  off<K extends keyof CodexSessionEvents>(
    event: K,
    listener: (...args: CodexSessionEvents[K]) => void,
  ): this;
  emit<K extends keyof CodexSessionEvents>(
    event: K,
    ...args: CodexSessionEvents[K]
  ): boolean;
}

export class CodexSession extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private running = false;
  private serverStartPromise: Promise<void> | null = null;
  private defaultThreadPromise: Promise<CodexThreadSummary> | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private threadId: string | null = null;
  private activeTurnId: string | null = null;

  constructor(private readonly config: BridgeConfig) {
    super();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentThreadId(): string | null {
    return this.threadId;
  }

  async start(): Promise<void> {
    await this.ensureServer();
    if (this.threadId) {
      return;
    }

    if (!this.defaultThreadPromise) {
      this.defaultThreadPromise = this.startNewThreadInternal('startup').finally(() => {
        this.defaultThreadPromise = null;
      });
    }

    await this.defaultThreadPromise;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.threadId = null;
    this.activeTurnId = null;
    this.serverStartPromise = null;
    this.defaultThreadPromise = null;

    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Codex app-server stopped.'));
    }
    this.pendingRequests.clear();

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
    this.process = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async newThread(): Promise<CodexThreadSummary> {
    await this.ensureServer();
    this.assertNoActiveTurn();
    return this.startNewThreadInternal('clear');
  }

  async listThreads(limit = 10): Promise<CodexThreadSummary[]> {
    await this.ensureServer();
    const result = await this.request('thread/list', {
      limit,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: ['appServer', 'cli', 'vscode', 'exec'],
      archived: false,
      cwd: this.config.codexCwd,
    });

    const data = (result as { data?: unknown } | undefined)?.data;
    return Array.isArray(data)
      ? data.map(parseThreadSummary).filter((thread): thread is CodexThreadSummary => thread !== null)
      : [];
  }

  async resumeThread(threadId: string): Promise<CodexThreadSummary> {
    await this.ensureServer();
    this.assertNoActiveTurn();

    const previousThreadId = this.threadId;
    const result = await this.request('thread/resume', {
      threadId,
      cwd: this.config.codexCwd,
      approvalPolicy: this.config.codexApprovalPolicy,
      sandbox: this.config.codexSandbox,
    });
    const thread = parseThreadFromResult(result);
    this.threadId = thread.id;
    this.activeTurnId = null;
    await this.unsubscribePreviousThread(previousThreadId, thread.id);
    return thread;
  }

  async sendText(text: string, attachments: CodexAttachment[] = []): Promise<void> {
    await this.start();
    if (!this.threadId) {
      throw new Error('Codex thread is not ready.');
    }

    const input: JsonValue[] = [{
      type: 'text',
      text: textWithAttachmentContext(text, attachments),
      text_elements: [],
    }];

    for (const attachment of attachments) {
      if (attachment.kind === 'image') {
        input.push({
          type: 'localImage',
          path: attachment.path,
        });
      }
    }

    const result = await this.request('turn/start', {
      threadId: this.threadId,
      input,
    });

    const turnId = getString(
      (result as { turn?: { id?: unknown } } | undefined)?.turn?.id,
    );
    if (turnId) {
      this.activeTurnId = turnId;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.activeTurnId) {
      return;
    }

    await this.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    }).catch(() => undefined);
    this.activeTurnId = null;
  }

  private async ensureServer(): Promise<void> {
    if (this.running && this.process && !this.process.killed) {
      return;
    }

    if (!this.serverStartPromise) {
      this.serverStartPromise = this.startServer().finally(() => {
        this.serverStartPromise = null;
      });
    }

    await this.serverStartPromise;
  }

  private async startNewThreadInternal(sessionStartSource: 'startup' | 'clear'): Promise<CodexThreadSummary> {
    const previousThreadId = this.threadId;
    const result = await this.request('thread/start', {
      cwd: this.config.codexCwd,
      approvalPolicy: this.config.codexApprovalPolicy,
      sandbox: this.config.codexSandbox,
      threadSource: 'telegram-bridge',
      sessionStartSource,
      ephemeral: false,
    });
    const thread = parseThreadFromResult(result);
    this.threadId = thread.id;
    this.activeTurnId = null;
    await this.unsubscribePreviousThread(previousThreadId, thread.id);
    return thread;
  }

  private async unsubscribePreviousThread(previousThreadId: string | null, nextThreadId: string): Promise<void> {
    if (!previousThreadId || previousThreadId === nextThreadId) {
      return;
    }

    await this.request('thread/unsubscribe', { threadId: previousThreadId }).catch(() => undefined);
  }

  private assertNoActiveTurn(): void {
    if (this.activeTurnId) {
      throw new Error('Cannot switch threads while a Codex turn is active.');
    }
  }

  private async startServer(): Promise<void> {
    if (this.running && this.process && !this.process.killed) {
      return;
    }

    this.process = spawn(this.config.codexCommand, codexAppServerArgs(this.config), {
      cwd: this.config.codexCwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.on('exit', (code, signal) => {
      this.running = false;
      this.threadId = null;
      this.activeTurnId = null;
      this.process = null;
      for (const pending of this.pendingRequests.values()) {
        pending.reject(
          new Error(
            `Codex app-server exited${code === null ? '' : ` with code ${code}`}.`,
          ),
        );
      }
      this.pendingRequests.clear();
      this.emit('exit', code, signal);
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) {
        this.emit('error', message);
      }
    });

    createInterface({ input: this.process.stdout }).on('line', (line) =>
      this.handleLine(line),
    );

    await this.request('initialize', {
      clientInfo: {
        name: 'lapage-codex-telegram-bridge',
        title: 'LaPage Codex Telegram Bridge',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    });

    this.notify('initialized');
    this.running = true;
  }

  private request(method: string, params: JsonValue): Promise<JsonValue | undefined> {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error('Codex app-server is not running.'));
    }

    const id = this.requestId++;
    const payload = { method, id, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process!.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  private notify(method: string, params?: JsonValue): void {
    if (!this.process?.stdin.writable) {
      return;
    }

    const payload = params === undefined ? { method } : { method, params };
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: RpcResponse | ServerNotification;
    try {
      message = JSON.parse(line) as RpcResponse | ServerNotification;
    } catch {
      this.emit('error', line);
      return;
    }

    if ('id' in message) {
      this.handleResponse(message);
      return;
    }

    this.handleNotification(message);
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  private handleNotification(notification: ServerNotification): void {
    const notificationThreadId = getString(notification.params?.threadId);
    if (notificationThreadId && this.threadId && notificationThreadId !== this.threadId) {
      return;
    }

    switch (notification.method) {
      case 'turn/started': {
        const turnId = getString(
          (notification.params as { turn?: { id?: unknown } } | undefined)?.turn
            ?.id,
        );
        if (turnId) {
          this.activeTurnId = turnId;
        }
        this.emit('turnStarted');
        return;
      }
      case 'item/completed': {
        const item = (notification.params as { item?: unknown } | undefined)
          ?.item;
        if (isCompletedItem(item)) {
          this.emit('itemCompleted', item);
        }
        return;
      }
      case 'turn/completed': {
        this.activeTurnId = null;
        this.emit('turnCompleted');
        return;
      }
      case 'error': {
        const message = getString(
          (notification.params as { message?: unknown } | undefined)?.message,
        );
        if (message) {
          this.emit('error', message);
        }
        return;
      }
      default:
        return;
    }
  }
}

function isCompletedItem(value: unknown): value is CodexCompletedItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseThreadFromResult(result: JsonValue | undefined): CodexThreadSummary {
  const thread = (result as { thread?: unknown } | undefined)?.thread;
  const parsed = parseThreadSummary(thread);
  if (!parsed) {
    throw new Error('Codex app-server did not return a valid thread.');
  }
  return parsed;
}

function parseThreadSummary(value: unknown): CodexThreadSummary | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const thread = value as Record<string, unknown>;
  const id = getString(thread.id);
  const createdAt = getNumber(thread.createdAt);
  const updatedAt = getNumber(thread.updatedAt);
  const cwd = getString(thread.cwd);
  if (!id || createdAt === null || updatedAt === null || !cwd) {
    return null;
  }

  return {
    id,
    name: getString(thread.name),
    preview: getString(thread.preview) ?? '',
    createdAt,
    updatedAt,
    cwd,
  };
}

function textWithAttachmentContext(text: string, attachments: CodexAttachment[]): string {
  const trimmed = text.trim();
  if (attachments.length === 0) {
    return trimmed;
  }

  const attachmentLines = attachments.map((attachment, index) => {
    const mime = attachment.mimeType ? `, ${attachment.mimeType}` : '';
    return `${index + 1}. ${attachment.name} (${attachment.kind}${mime}): ${attachment.path}`;
  });

  return [
    trimmed || 'Please inspect the attached file(s).',
    '',
    'Attached file(s) saved locally:',
    ...attachmentLines,
  ].join('\n');
}
