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
