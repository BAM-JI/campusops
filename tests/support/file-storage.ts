import { mkdtempSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KeyValueStorage } from '../../src/persistence/key-value-storage';

export function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'campusops-week08-'));
}

/** Disk-backed storage for tests: write to a temp file and rename so each key is replaced atomically. */
export function createFileStorage(directory: string): KeyValueStorage {
  const pathFor = (key: string) => join(directory, `${encodeURIComponent(key)}.json`);
  return {
    async getItem(key) {
      try {
        return await fs.readFile(pathFor(key), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async setItem(key, value) {
      const target = pathFor(key);
      const temporary = `${target}.tmp`;
      await fs.writeFile(temporary, value, 'utf8');
      await fs.rename(temporary, target);
    },
    async removeItem(key) {
      await fs.rm(pathFor(key), { force: true });
    },
  };
}

type Fault = Readonly<{ method: 'setItem' | 'removeItem'; key: string; mode: 'throw' | 'hang' }>;

/** Wraps a storage and fails once on the selected write: `throw` is an I/O error, `hang` simulates the app being killed. */
export function withFault(storage: KeyValueStorage, fault: Fault): KeyValueStorage {
  let triggered = false;
  const trip = (method: Fault['method'], key: string): Promise<never> | null => {
    if (triggered || method !== fault.method || key !== fault.key) return null;
    triggered = true;
    return fault.mode === 'throw'
      ? Promise.reject(new Error(`injected ${method} failure on ${key}`))
      : new Promise<never>(() => undefined);
  };
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => trip('setItem', key) ?? storage.setItem(key, value),
    removeItem: (key) => trip('removeItem', key) ?? storage.removeItem(key),
  };
}
