const IGNORED_FIELDS = new Set(['updated_at', 'created_at', 'deleted_at']);

export interface FieldDiff {
  old: unknown;
  new: unknown;
}

export function diffObjects(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, FieldDiff> | null {
  if (!before || !after) {
    return null;
  }

  const changes: Record<string, FieldDiff> = {};

  for (const key of Object.keys(after)) {
    if (IGNORED_FIELDS.has(key)) {
      continue;
    }

    const oldValue = before[key];
    const newValue = after[key];

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { old: oldValue, new: newValue };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}
