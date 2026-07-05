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

export function formatTelegramMarkdownChunks(text: string, maxLength: number): string[] {
  const lines = formatTelegramMarkdownLines(text);
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const nextLine = current ? `\n\n${line}` : line;
    if (current && current.length + nextLine.length > maxLength) {
      chunks.push(current);
      current = line;
      continue;
    }
    current += nextLine;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.flatMap((chunk) => chunk.length > maxLength ? hardSplitText(chunk, maxLength) : [chunk]);
}

export function formatTelegramMarkdownLines(text: string): string[] {
  const lines = normalizeTerminalOutput(text).split('\n');
  const formatted: string[] = [];
  let codeFenceLanguage = '';
  let codeFenceLines: string[] = [];

  for (const line of lines) {
    const trimmed = visibleText(line).trim();
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*$/);

    if (fenceMatch && codeFenceLines.length === 0 && codeFenceLanguage === '') {
      codeFenceLanguage = fenceMatch[1] || 'text';
      codeFenceLines = [];
      continue;
    }

    if (trimmed === '```' && codeFenceLanguage) {
      formatted.push(formatCodeBlock(codeFenceLines.join('\n'), codeFenceLanguage));
      codeFenceLanguage = '';
      codeFenceLines = [];
      continue;
    }

    if (codeFenceLanguage) {
      codeFenceLines.push(line);
      continue;
    }

    const formattedLine = formatTelegramLine(line);
    if (formattedLine.trim().length > 0) {
      formatted.push(formattedLine);
    }
  }

  if (codeFenceLanguage) {
    formatted.push(formatCodeBlock(codeFenceLines.join('\n'), codeFenceLanguage));
  }

  return formatted;
}

export function plainTelegramText(text: string): string {
  return plainTelegramLines(text)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function safePlainTelegramText(text: string): string {
  return plainTelegramText(text)
    .replace(/^```[a-zA-Z0-9_-]*\s*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*-\s+/gm, '• ')
    .replace(/^\s{2,}•\s+/gm, '  ◦ ')
    .trim();
}

export function safePlainTelegramChunks(text: string, maxLength: number): string[] {
  return chunkText(safePlainTelegramText(text), maxLength);
}

export function plainTelegramLines(text: string): string[] {
  return normalizeWrappedLines(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
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
  const trimmed = visibleText(line).trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('• Ran ')) {
    return blockQuote(`🔧 *Ran* ${inlineCode(trimmed.slice('• Ran '.length))}`);
  }
  if (trimmed.startsWith('• Waited for background terminal')) {
    return blockQuote(`🔧 _${escapeMarkdownV2(trimmed.slice(2))}_`);
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
    return `• ${formatInlineMarkdown(trimmed.slice(2))}`;
  }
  if (/^\s{2,}\S/.test(visibleText(line))) {
    return `   ${escapeMarkdownV2(trimmed)}`;
  }

  return formatInlineMarkdown(trimmed);
}

function hardSplitText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function inlineCode(text: string): string {
  return `\`${text.replace(/[`\\]/g, '\\$&')}\``;
}

function formatCodeBlock(text: string, language: string): string {
  return `\`\`\`${escapeCodeFenceLanguage(language)}\n${escapePreText(text)}\n\`\`\``;
}

function escapeCodeFenceLanguage(language: string): string {
  return language.replace(/[^a-zA-Z0-9_-]/g, '') || 'text';
}

function escapePreText(text: string): string {
  return text.replace(/[`\\]/g, '\\$&');
}

function formatInlineMarkdown(text: string): string {
  const segments = splitInlineMarkdown(text);
  return segments.map((segment) => {
    if (segment.type === 'code') {
      return inlineCode(segment.text);
    }
    if (segment.type === 'bold') {
      return `*${escapeMarkdownV2(segment.text)}*`;
    }
    return escapeMarkdownV2(segment.text);
  }).join('');
}

function splitInlineMarkdown(text: string): Array<{ type: 'plain' | 'bold' | 'code'; text: string }> {
  const segments: Array<{ type: 'plain' | 'bold' | 'code'; text: string }> = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > index) {
      segments.push({ type: 'plain', text: text.slice(index, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'code', text: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: 'bold', text: match[2] });
    }
    index = pattern.lastIndex;
  }

  if (index < text.length) {
    segments.push({ type: 'plain', text: text.slice(index) });
  }

  return segments;
}

function blockQuote(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*.\[\]()~`>#+\-=|{}!\\])/g, '\\$1');
}
