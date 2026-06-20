import stripAnsi from 'strip-ansi';

export function normalizeTerminalOutput(data: string): string {
  return stripAnsi(data)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function cleanPaneSnapshot(data: string): string {
  const lines = paneLines(data);

  return collapseRepeatedLines(lines).join('\n').trim();
}

export function latestCompletedCodexResponse(data: string): string | null {
  const lines = paneLines(data);
  if (isCodexWorking(data)) {
    return null;
  }

  return latestCodexResponse(data);
}

export function latestCodexResponse(data: string): string | null {
  const lines = paneLines(data);

  const bulletStart = findLastIndex(lines, (line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('• ') && !/^•\s*Working\s*\(/i.test(trimmed);
  });
  if (bulletStart === -1) {
    return null;
  }

  const response: string[] = [];
  for (const line of lines.slice(bulletStart)) {
    const trimmed = line.trim();
    if (response.length > 0 && isPromptOrStatusLine(trimmed)) {
      break;
    }
    if (isIgnorableResponseLine(trimmed)) {
      continue;
    }
    response.push(line);
  }

  const cleaned = collapseRepeatedLines(response).join('\n').trim();
  return cleaned || null;
}

export function isCodexWorking(data: string): boolean {
  return paneLines(data).some((line) => /esc to interrupt|^\s*•\s*Working\s*\(/i.test(line));
}

export function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const newlineIndex = remaining.lastIndexOf('\n', maxLength);
    const splitIndex = newlineIndex > maxLength * 0.5 ? newlineIndex : maxLength;
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export function wrapCodeBlock(text: string): string {
  return `\`\`\`text\n${escapeMarkdownV2(text)}\n\`\`\``;
}

function isDecorativeLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^[╭╮╰╯│─┌┐└┘├┤┬┴┼╞╡═\s]+$/.test(trimmed)) {
    return true;
  }
  if (/^Tip: /.test(trimmed)) {
    return true;
  }
  if (/^model:\s+/.test(trimmed) || /^directory:\s+/.test(trimmed)) {
    return true;
  }
  if (/^>_ OpenAI Codex/.test(trimmed)) {
    return true;
  }
  return false;
}

function paneLines(data: string): string[] {
  return normalizeTerminalOutput(data)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isDecorativeLine(line))
    .filter((line) => !isIgnorablePaneLine(line.trim()));
}

function isPromptOrStatusLine(trimmed: string): boolean {
  return trimmed.startsWith('› ') || /^agentic\s+/.test(trimmed) || /^•\s*Working\s*\(/i.test(trimmed);
}

function isIgnorablePaneLine(trimmed: string): boolean {
  return /^⚠ Model metadata for `agentic` not found/.test(trimmed)
    || /^fallback metadata;/.test(trimmed)
    || /^issues\.$/.test(trimmed)
    || /^agentic\s+/.test(trimmed)
    || /^› (Write tests for @filename|Summarize recent commits|Implement \{feature\}|Improve documentation in @filename)/.test(trimmed);
}

function isIgnorableResponseLine(trimmed: string): boolean {
  return isIgnorablePaneLine(trimmed) || /^⚠ /.test(trimmed);
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

function collapseRepeatedLines(lines: string[]): string[] {
  const collapsed: string[] = [];
  for (const line of lines) {
    if (collapsed[collapsed.length - 1] !== line) {
      collapsed.push(line);
    }
  }
  return collapsed;
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*.\[\]()~`>#+\-=|{}!\\])/g, '\\$1');
}
