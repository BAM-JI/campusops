import type { JsonObject, SyncRecord } from '../course-evaluation/contracts';

export type SyncResolution =
  | Readonly<{ kind: 'merged'; fields: JsonObject }>
  | Readonly<{ kind: 'conflict'; fields: readonly string[] }>;

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` compare as the same content. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * Three-way merge by field (docs/sync-policy.md). A field changed on one side only takes that
 * side; a field changed on both sides to different content is a conflict. Conflicts are reported
 * sorted by name and nothing is merged when there is at least one. Inputs are never mutated.
 */
export function resolveSync(base: SyncRecord, local: SyncRecord, remote: SyncRecord): SyncResolution {
  const names = [...new Set([...Object.keys(base.fields), ...Object.keys(local.fields), ...Object.keys(remote.fields)])].sort();
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];

  for (const name of names) {
    const baseValue = base.fields[name];
    const localValue = local.fields[name];
    const remoteValue = remote.fields[name];
    const baseJson = canonicalJson(baseValue);
    const localChanged = canonicalJson(localValue) !== baseJson;
    const remoteChanged = canonicalJson(remoteValue) !== baseJson;

    let chosen: unknown;
    if (localChanged && remoteChanged) {
      if (canonicalJson(localValue) !== canonicalJson(remoteValue)) {
        conflicts.push(name);
        continue;
      }
      chosen = localValue;
    } else if (localChanged) {
      chosen = localValue;
    } else if (remoteChanged) {
      chosen = remoteValue;
    } else {
      chosen = baseValue;
    }
    // A field removed on the winning side stays removed.
    if (chosen !== undefined) merged[name] = JSON.parse(JSON.stringify(chosen)) as unknown;
  }

  return conflicts.length > 0 ? { kind: 'conflict', fields: conflicts } : { kind: 'merged', fields: merged };
}
