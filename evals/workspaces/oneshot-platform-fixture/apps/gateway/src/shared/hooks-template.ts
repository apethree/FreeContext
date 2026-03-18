function tokenizePath(path: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const regex = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    if (typeof match[1] === "string" && match[1].length > 0) {
      tokens.push(match[1]);
      continue;
    }
    if (typeof match[2] === "string" && match[2].length > 0) {
      tokens.push(Number(match[2]));
    }
  }
  return tokens;
}

function readPath(source: unknown, path: string): unknown {
  const tokens = tokenizePath(path);
  let cursor: unknown = source;
  for (const token of tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(cursor) || token < 0 || token >= cursor.length) return undefined;
      cursor = cursor[token];
      continue;
    }
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[token];
  }
  return cursor;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

// Simple, explicit template interpolation for webhook mappings.
// Supports {{foo}} and dotted lookups like {{payload.user.id}}.
export function renderHookTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.\-[\]]+)\s*\}\}/g, (_whole, key: string) => {
    const value = readPath(values, key);
    return toText(value);
  });
}
