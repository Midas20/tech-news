// Minimal JSON Schema validation.
//
// One prompt per job, provider-agnostic; schema validation is what catches the
// weaker models rather than per-provider prompt tuning. A second parse failure
// flags the item for the next cycle instead of dropping it -- an item that
// silently disappears is indistinguishable from a source that went quiet.

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function validate<T>(value: unknown, schema: JsonSchema, path = '$'): ValidationResult<T> {
  const errors: string[] = [];
  check(value, schema, path, errors);
  return errors.length === 0
    ? { ok: true, value: value as T }
    : { ok: false, errors };
}

function check(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in obj)) errors.push(`${path}.${key}: required`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj) check(obj[key], sub, `${path}.${key}`, errors);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return;
      }
      if (schema.items) value.forEach((v, i) => check(v, schema.items!, `${path}[${i}]`, errors));
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string`);
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: ${value} not in enum`);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`${path}: longer than ${schema.maxLength}`);
      }
      return;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path}: expected number`);
        return;
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${path}: expected integer`);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: below minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: above maximum ${schema.maximum}`);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      return;
    }
  }
}

/**
 * Models wrap JSON in prose and code fences no matter how the prompt is worded.
 * Recovering the object is cheaper and more reliable than another round trip.
 */
export function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to bracket matching */
  }
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === open) depth++;
    else if (candidate[i] === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
