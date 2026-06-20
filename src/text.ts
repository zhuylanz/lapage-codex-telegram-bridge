import stripAnsi from 'strip-ansi';

export function normalizeTerminalOutput(data: string): string {
  return stripAnsi(data)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function visibleText(data: string): string {
  return normalizeTerminalOutput(data);
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

  const lastResponseBullet = findLastIndex(lines, (line) => {
    const trimmed = visibleText(line).trimStart();
    return trimmed.startsWith('• ') && !/^•\s*Working\s*\(/i.test(trimmed);
  });
  if (lastResponseBullet === -1) {
    return null;
  }

  const promptStart = findLastIndex(lines.slice(0, lastResponseBullet), (line) => isUserPromptLine(visibleText(line).trim()));
  const responseStart = promptStart === -1 ? lastResponseBullet : promptStart + 1;
  const response: string[] = [];
  for (const line of lines.slice(responseStart)) {
    const trimmed = visibleText(line).trim();
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
  return paneLines(data).some((line) => /esc to interrupt|^\s*•\s*Working\s*\(/i.test(visibleText(line)));
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

export function formatTelegramMarkdown(text: string): string {
  return formatTelegramMarkdownLines(text)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatTelegramMarkdownLines(text: string): string[] {
  return normalizeWrappedLines(text)
    .split('\n')
    .map(formatTelegramLine)
    .filter((line) => line.trim().length > 0);
}

export function plainTelegramText(text: string): string {
  return plainTelegramLines(text)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainTelegramLines(text: string): string[] {
  return normalizeWrappedLines(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function isDecorativeLine(line: string): boolean {
  const trimmed = visibleText(line).trim();
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
    .filter((line) => visibleText(line).trim().length > 0)
    .filter((line) => !isDecorativeLine(line))
    .filter((line) => !isIgnorablePaneLine(visibleText(line).trim()));
}

function isPromptOrStatusLine(trimmed: string): boolean {
  return isUserPromptLine(trimmed)
    || /^agentic\s+/.test(trimmed)
    || /^•\s*Working\s*\(/i.test(trimmed)
    || /^─\s*Worked for\b/.test(trimmed);
}

function isUserPromptLine(trimmed: string): boolean {
  return trimmed.startsWith('› ');
}

function isIgnorablePaneLine(trimmed: string): boolean {
  return /^⚠ Model metadata for `agentic` not found/.test(trimmed)
    || /^can degrade performance and cause issues\.$/.test(trimmed)
    || /^fallback metadata;/.test(trimmed)
    || /^issues\.$/.test(trimmed)
    || /^─\s*Worked for\b/.test(trimmed)
    || /^agentic\s+/.test(trimmed)
    || /^› (Write tests for @filename|Summarize recent commits|Implement \{feature\}|Improve documentation in @filename)/.test(trimmed);
}

function isIgnorableResponseLine(trimmed: string): boolean {
  return isIgnorablePaneLine(trimmed) || /^⚠ /.test(trimmed);
}

function normalizeWrappedLines(text: string): string {
  const lines = text.split('\n');
  const normalized: string[] = [];

  for (const line of lines) {
    const current = line.trimEnd();
    const previous = normalized[normalized.length - 1];
    if (previous && shouldJoinSoftWrap(previous, current)) {
      const separator = previous.trimEnd().endsWith('-') ? '' : ' ';
      normalized[normalized.length - 1] = `${previous.replace(/\s+$/, '')}${separator}${current.trimStart()}`;
    } else {
      normalized.push(current);
    }
  }

  return normalized.join('\n');
}

function shouldJoinSoftWrap(previous: string, current: string): boolean {
  const trimmedPrevious = visibleText(previous).trim();
  const trimmedCurrent = visibleText(current).trim();
  if (!trimmedCurrent) {
    return false;
  }
  if (/^(•|-|└|↳|›|```)/.test(trimmedCurrent)) {
    return false;
  }
  if (/^(└|↳)/.test(trimmedPrevious)) {
    return false;
  }
  if (/^\//.test(trimmedCurrent)) {
    return false;
  }
  if (/^(•|-|└|↳|›)/.test(trimmedPrevious) && !/[.!?:;)]$/.test(trimmedPrevious)) {
    return true;
  }
  if (/\b(and|or|with|to|from|by|for|including|containing|credential-)$/i.test(trimmedPrevious)) {
    return true;
  }
  if (trimmedPrevious.endsWith('-')) {
    return true;
  }
  return !/[.!?:;)]$/.test(trimmedPrevious) && /^[a-z0-9(/]/i.test(trimmedCurrent);
}

function formatTelegramLine(line: string): string {
  const style = lineStyle(line);
  const trimmed = visibleText(line).trim();
  if (!trimmed) {
    return '';
  }

  if (style.hasBold && /(?:^•\s+)?Ran\b/.test(trimmed)) {
    const command = trimmed.replace(/^•\s+Ran\s+/, '').replace(/^Ran\s+/, '');
    return blockQuote(`🔧 *Ran* ${inlineCode(command)}`);
  }
  if (trimmed.startsWith('• Ran ')) {
    return blockQuote(`🔧 *Ran* ${inlineCode(trimmed.slice('• Ran '.length))}`);
  }
  if (style.hasBold && /background terminal/i.test(trimmed)) {
    return blockQuote(`🔧 _${escapeMarkdownV2(trimmed.replace(/^•\s+/, ''))}_`);
  }
  if (trimmed.startsWith('• Waited for background terminal')) {
    return blockQuote(`🔧 _${escapeMarkdownV2(trimmed.slice(2))}_`);
  }
  if (style.hasDim && isThinkingLine(trimmed)) {
    return blockQuote(`🧠 _${escapeMarkdownV2(trimmed.slice(2))}_`);
  }
  if (trimmed.startsWith('↳ Interacted with background terminal')) {
    return blockQuote(`🔧 _${escapeMarkdownV2(trimmed)}_`);
  }
  if (trimmed.startsWith('└')) {
    return blockQuote(`   _${escapeMarkdownV2(trimmed)}_`);
  }
  if (trimmed.startsWith('• Explored')) {
    return '*Explored*';
  }
  if (trimmed.startsWith('• ')) {
    return `• ${escapeMarkdownV2(trimmed.slice(2))}`;
  }
  if (trimmed.startsWith('- ')) {
    return `  ◦ ${escapeMarkdownV2(trimmed.slice(2))}`;
  }
  if (/^\s{2,}\S/.test(visibleText(line))) {
    return `   ${escapeMarkdownV2(trimmed)}`;
  }

  return escapeMarkdownV2(trimmed);
}

function inlineCode(text: string): string {
  return `\`${text.replace(/[`\\]/g, '\\$&')}\``;
}

function lineStyle(line: string): { hasDim: boolean; hasBold: boolean } {
  const sgrMatches = line.match(/\x1b\[[0-9;]*m/g) ?? [];
  let hasDim = false;
  let hasBold = false;

  for (const match of sgrMatches) {
    const codes = match.slice(2, -1).split(';').map((code) => Number(code || 0));
    if (codes.includes(0)) {
      continue;
    }
    if (codes.includes(1)) {
      hasBold = true;
    }
    if (codes.includes(2)) {
      hasDim = true;
    }
  }

  return { hasDim, hasBold };
}

function blockQuote(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function isThinkingLine(trimmed: string): boolean {
  return /^•\s+I(?:’|'|`)?m\s+(thinking|considering|checking|looking|trying|wondering|deciding|figuring|reasoning|planning)\b/i.test(trimmed)
    || /^•\s+I\s+need\s+to\s+think\b/i.test(trimmed)
    || /^•\s+I\s+need\s+to\s+(provide|answer|decide|figure|check|inspect|verify)\b/i.test(trimmed)
    || /^•\s+Let\s+me\s+think\b/i.test(trimmed);
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
