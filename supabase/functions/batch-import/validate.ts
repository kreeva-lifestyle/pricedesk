// Validation logic for the batch-import Edge Function.
// Extracted into its own file so Vitest (Node) can import it
// without pulling in Deno runtime types.

export interface SkuRow {
  id: string;
  sku?: string | null;
  style_id?: string | null;
  brand_id?: string | null;
  category?: string | null;
  level?: string;
  cost?: number;
  markup?: number;
  discount?: number;
  ignore_threshold?: boolean;
  archived?: boolean;
  tags?: string[];
  note?: string;
  updated_at?: string;
}

export interface BatchImportBody {
  skus?: unknown;
}

export interface ValidationError {
  index: number;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  rows: SkuRow[];
  errors: ValidationError[];
}

const VALID_LEVELS = new Set(['Level 1', 'Level 2', 'Level 3', 'Level 4']);
const MAX_ROWS = 10_000;

export function validateSku(raw: unknown, index: number): { row: SkuRow | null; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      row: null,
      errors: [{ index, field: '', message: 'Row must be an object' }],
    };
  }

  const r = raw as Record<string, unknown>;

  // id is the only strictly required field — it's the primary key
  if (typeof r.id !== 'string' || r.id.length === 0) {
    errors.push({ index, field: 'id', message: 'id is required and must be a non-empty string' });
  } else if (r.id.length > 200) {
    errors.push({ index, field: 'id', message: 'id must be at most 200 characters' });
  }

  // Strings (optional)
  for (const f of ['sku', 'style_id', 'brand_id', 'category', 'note'] as const) {
    if (r[f] !== undefined && r[f] !== null && typeof r[f] !== 'string') {
      errors.push({ index, field: f, message: `${f} must be a string or null` });
    }
  }

  // level (optional, but if present must be a known value)
  if (r.level !== undefined && r.level !== null) {
    if (typeof r.level !== 'string') {
      errors.push({ index, field: 'level', message: 'level must be a string' });
    } else if (!VALID_LEVELS.has(r.level)) {
      errors.push({ index, field: 'level', message: `level must be one of: ${[...VALID_LEVELS].join(', ')}` });
    }
  }

  // Numbers (optional)
  for (const f of ['cost', 'markup', 'discount'] as const) {
    if (r[f] !== undefined && r[f] !== null) {
      if (typeof r[f] !== 'number' || !Number.isFinite(r[f] as number)) {
        errors.push({ index, field: f, message: `${f} must be a finite number` });
      } else if ((r[f] as number) < 0) {
        errors.push({ index, field: f, message: `${f} must be >= 0` });
      }
    }
  }

  // Booleans (optional)
  for (const f of ['ignore_threshold', 'archived'] as const) {
    if (r[f] !== undefined && r[f] !== null && typeof r[f] !== 'boolean') {
      errors.push({ index, field: f, message: `${f} must be a boolean` });
    }
  }

  // tags must be an array of strings if present
  if (r.tags !== undefined && r.tags !== null) {
    if (!Array.isArray(r.tags)) {
      errors.push({ index, field: 'tags', message: 'tags must be an array' });
    } else if (r.tags.some((t) => typeof t !== 'string')) {
      errors.push({ index, field: 'tags', message: 'every tag must be a string' });
    }
  }

  if (errors.length > 0) {
    return { row: null, errors };
  }

  // Normalize: fill in defaults for fields that pd_skus_v2 has defaults for
  const row: SkuRow = {
    id: r.id as string,
    sku: (r.sku ?? null) as string | null,
    style_id: (r.style_id ?? null) as string | null,
    brand_id: (r.brand_id ?? null) as string | null,
    category: (r.category ?? null) as string | null,
    level: (r.level ?? 'Level 2') as string,
    cost: (r.cost ?? 0) as number,
    markup: (r.markup ?? 0) as number,
    discount: (r.discount ?? 0) as number,
    ignore_threshold: (r.ignore_threshold ?? false) as boolean,
    archived: (r.archived ?? false) as boolean,
    tags: ((r.tags ?? []) as string[]),
    note: (r.note ?? '') as string,
    updated_at: (r.updated_at ?? new Date().toISOString()) as string,
  };

  return { row, errors: [] };
}

export function validateBatch(body: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const rows: SkuRow[] = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      rows: [],
      errors: [{ index: -1, field: '', message: 'Body must be a JSON object' }],
    };
  }

  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.skus)) {
    return {
      valid: false,
      rows: [],
      errors: [{ index: -1, field: 'skus', message: 'skus must be an array' }],
    };
  }

  if (b.skus.length === 0) {
    return {
      valid: false,
      rows: [],
      errors: [{ index: -1, field: 'skus', message: 'skus must contain at least one row' }],
    };
  }

  if (b.skus.length > MAX_ROWS) {
    return {
      valid: false,
      rows: [],
      errors: [{ index: -1, field: 'skus', message: `skus must contain at most ${MAX_ROWS} rows` }],
    };
  }

  // Catch duplicate ids within the same batch
  const seenIds = new Map<string, number>();

  b.skus.forEach((raw, index) => {
    const { row, errors: rowErrors } = validateSku(raw, index);
    errors.push(...rowErrors);
    if (row) {
      const prev = seenIds.get(row.id);
      if (prev !== undefined) {
        errors.push({
          index,
          field: 'id',
          message: `Duplicate id "${row.id}" already at index ${prev}`,
        });
      } else {
        seenIds.set(row.id, index);
        rows.push(row);
      }
    }
  });

  return {
    valid: errors.length === 0,
    rows,
    errors,
  };
}
