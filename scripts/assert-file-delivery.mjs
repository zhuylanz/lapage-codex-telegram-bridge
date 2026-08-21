import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseTelegramFileRequests,
  resolveWorkspaceFile,
} from '../dist/telegram-bridge.js';

assert.deepEqual(
  parseTelegramFileRequests([
    'Your exports are ready.',
    '[[telegram-file:/workspace/report.pdf]]',
    '[[telegram-file:/workspace/data export.csv]]',
    '[[telegram-file:/workspace/report.pdf]]',
  ].join('\n')),
  {
    text: 'Your exports are ready.',
    paths: ['/workspace/report.pdf', '/workspace/data export.csv'],
  },
);

const workspace = await mkdtemp(join(tmpdir(), 'codex-telegram-workspace-'));
const outside = await mkdtemp(join(tmpdir(), 'codex-telegram-outside-'));
const reportPath = join(workspace, 'report.txt');
const outsidePath = join(outside, 'secret.txt');
await writeFile(reportPath, 'report');
await writeFile(outsidePath, 'secret');
await mkdir(join(workspace, 'folder'));
await symlink(outsidePath, join(workspace, 'outside-link.txt'));

assert.equal(await resolveWorkspaceFile(workspace, 'report.txt'), await realpath(reportPath));
await assert.rejects(() => resolveWorkspaceFile(workspace, outsidePath), /outside CODEX_CWD/);
await assert.rejects(() => resolveWorkspaceFile(workspace, 'outside-link.txt'), /outside CODEX_CWD/);
await assert.rejects(() => resolveWorkspaceFile(workspace, 'folder'), /not a regular file/);

await rm(workspace, { recursive: true });
await rm(outside, { recursive: true });

console.log('Telegram file delivery assertions passed.');
