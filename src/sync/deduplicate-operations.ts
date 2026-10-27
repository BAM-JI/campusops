/** Keeps the first occurrence of each operationId and never mutates the input. */
export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const operation of operations) {
    if (seen.has(operation.operationId)) continue;
    seen.add(operation.operationId);
    unique.push(operation);
  }
  return unique;
}
