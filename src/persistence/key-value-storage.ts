/**
 * Minimal storage port used by the local database. Each `setItem` must replace
 * the whole value atomically: the database relies on that to never expose a
 * half-written document.
 */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
