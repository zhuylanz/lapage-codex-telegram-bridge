import assert from 'node:assert/strict';

import {
  codexAppServerArgs,
  codexThreadResumeParams,
  codexThreadStartParams,
  codexTurnStartParams,
  telegramFileDeliveryInstructions,
} from '../dist/codex-session.js';

const baseConfig = {
  token: 'test-token',
  allowedUserIds: new Set([1]),
  codexCommand: 'codex',
  codexCwd: '/workspace',
  codexApprovalPolicy: 'never',
  codexSandbox: 'danger-full-access',
  streamEditIntervalMs: 650,
  streamMinChangeChars: 24,
  typingIntervalMs: 4000,
  maxTelegramChars: 3500,
};

const cases = [
  {
    name: 'unset',
    overrides: {},
    cli: ['app-server', '--stdio'],
    thread: {},
    turn: {},
  },
  {
    name: 'model only',
    overrides: { codexModel: 'gpt-test-model' },
    cli: ['--model', 'gpt-test-model', 'app-server', '--stdio'],
    thread: { model: 'gpt-test-model' },
    turn: { model: 'gpt-test-model' },
  },
  {
    name: 'effort only',
    overrides: { codexReasoningEffort: 'high' },
    cli: ['-c', 'model_reasoning_effort=high', 'app-server', '--stdio'],
    thread: { config: { model_reasoning_effort: 'high' } },
    turn: { effort: 'high' },
  },
  {
    name: 'model and effort',
    overrides: {
      codexModel: 'gpt-test-model',
      codexReasoningEffort: 'high',
    },
    cli: [
      '--model',
      'gpt-test-model',
      '-c',
      'model_reasoning_effort=high',
      'app-server',
      '--stdio',
    ],
    thread: {
      model: 'gpt-test-model',
      config: { model_reasoning_effort: 'high' },
    },
    turn: { model: 'gpt-test-model', effort: 'high' },
  },
];

const input = [{ type: 'text', text: 'hello', text_elements: [] }];

for (const testCase of cases) {
  const config = { ...baseConfig, ...testCase.overrides };

  assert.deepEqual(
    codexAppServerArgs(config),
    testCase.cli,
    `${testCase.name}: CLI arguments`,
  );
  assert.deepEqual(
    codexThreadStartParams(config, 'clear'),
    {
      cwd: '/workspace',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      threadSource: 'telegram-bridge',
      sessionStartSource: 'clear',
      ephemeral: false,
      developerInstructions: telegramFileDeliveryInstructions,
      ...testCase.thread,
    },
    `${testCase.name}: thread/start params`,
  );
  assert.deepEqual(
    codexThreadResumeParams(config, 'thread-123'),
    {
      threadId: 'thread-123',
      cwd: '/workspace',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      developerInstructions: telegramFileDeliveryInstructions,
      ...testCase.thread,
    },
    `${testCase.name}: thread/resume params`,
  );
  assert.deepEqual(
    codexTurnStartParams(config, 'thread-123', input),
    { threadId: 'thread-123', input, ...testCase.turn },
    `${testCase.name}: turn/start params`,
  );
}

console.log(`RPC override assertions passed (${cases.length} configurations).`);
