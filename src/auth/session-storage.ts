import * as SecureStore from 'expo-secure-store';

/** Port for the place where the session is persisted. In the app it is the device keychain/keystore. */
export interface SecureSessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export const SESSION_KEY = 'campusops.session';

/** expo-secure-store: Keychain on iOS, encrypted SharedPreferences/Keystore on Android. Never AsyncStorage. */
export const secureStoreDriver: SecureSessionStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

export function createMemorySessionStorage(): SecureSessionStorage & { snapshot(): ReadonlyMap<string, string> } {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    deleteItem: async (key) => {
      values.delete(key);
    },
    snapshot: () => new Map(values),
  };
}
