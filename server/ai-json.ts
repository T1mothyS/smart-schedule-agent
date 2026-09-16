function firstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }

  return null;
}

function escapeUnexpectedQuotes(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        result += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        let next = index + 1;
        while (/\s/.test(json[next] || '')) next += 1;
        const nextChar = json[next] || '';
        if (nextChar === '' || [',', '}', ']', ':'].includes(nextChar)) {
          result += char;
          inString = false;
        } else {
          result += '\\"';
        }
        continue;
      }
      result += char;
      continue;
    }

    result += char;
    if (char === '"') inString = true;
  }

  return result;
}

/**
 * CodeBuddy SDK 的最终文本通常在 assistant.message.content 中，
 * 但部分返回路径只在 result.result（或 structured_output）中提供结果。
 * 统一从两种消息形态读取，避免把合法的最终回答误判为空响应。
 */
export function extractAiMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const value = message as {
    type?: unknown;
    message?: { content?: unknown };
    result?: unknown;
    structured_output?: unknown;
  };

  if (value.type === 'assistant') {
    const content = value.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((block): block is { type?: unknown; text?: unknown } => !!block && typeof block === 'object')
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('');
  }

  if (value.type === 'result') {
    if (typeof value.result === 'string') return value.result;
    if (typeof value.structured_output === 'string') return value.structured_output;
    if (value.structured_output && typeof value.structured_output === 'object') {
      try { return JSON.stringify(value.structured_output); } catch { return ''; }
    }
  }

  return '';
}

export function parseAiJsonCandidates(candidates: readonly string[]): { value: any; repaired: boolean } {
  let firstError: unknown;
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      return parseAiJson(candidate);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError instanceof Error) throw firstError;
  throw new Error('AI 返回格式错误：未找到 JSON 对象');
}

export function parseAiJson(raw: string): { value: any; repaired: boolean } {
  const candidate = firstJsonObject(raw);
  if (!candidate) throw new Error('AI 返回格式错误：未找到 JSON 对象');

  try {
    return { value: JSON.parse(candidate), repaired: false };
  } catch (firstError) {
    const repaired = escapeUnexpectedQuotes(candidate);
    try {
      return { value: JSON.parse(repaired), repaired: true };
    } catch {
      const preview = candidate.replace(/\s+/g, ' ').slice(0, 240);
      throw new Error(`AI 返回 JSON 无法解析：${firstError instanceof Error ? firstError.message : '格式错误'}；片段：${preview}`);
    }
  }
}
