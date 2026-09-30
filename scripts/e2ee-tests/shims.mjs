/**
 * Minimal browser shims so the REAL src/services/cryptoService.ts can run
 * under Node. Nothing here re-implements cryptography — WebCrypto comes from
 * Node's own SubtleCrypto (`globalThis.crypto`), which is the same API the
 * browser gives the app.
 *
 * Only three browser globals are simulated, and each simulated device gets its
 * own pair, so "Device A" and "Device B" have genuinely separate key stores:
 *   - window        -> points at globalThis (for `window.crypto`)
 *   - indexedDB     -> in-memory, per device (stores the ECDH identity)
 *   - localStorage  -> in-memory, per device (stores the device id)
 */

export function createMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    _dump: () => Object.fromEntries(store),
  };
}

export function createMemoryIndexedDB() {
  const databases = new Map();

  return {
    open(name, version = 1) {
      const request = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        result: null,
        error: null,
      };

      // Callbacks are async (like the real IDB API) so handlers assigned after
      // `open()` returns are still observed — cryptoService relies on that.
      setTimeout(() => {
        let entry = databases.get(name);
        const needsUpgrade = !entry;
        if (!entry) {
          entry = { stores: new Map(), version: 0 };
          databases.set(name, entry);
        }
        entry.version = version;

        const db = {
          objectStoreNames: { contains: (s) => entry.stores.has(s) },
          createObjectStore: (s) => {
            if (!entry.stores.has(s)) entry.stores.set(s, new Map());
            return { name: s };
          },
          transaction: (storeName) => {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const finish = () => setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);

            tx.objectStore = () => {
              const records = entry.stores.get(storeName) ?? new Map();
              if (!entry.stores.has(storeName)) entry.stores.set(storeName, records);
              return {
                get: (key) => {
                  const r = { onsuccess: null, onerror: null, result: undefined };
                  setTimeout(() => {
                    r.result = records.has(key) ? records.get(key) : undefined;
                    if (r.onsuccess) r.onsuccess({ target: r });
                    finish();
                  }, 0);
                  return r;
                },
                put: (value, key) => {
                  const r = { onsuccess: null, onerror: null };
                  setTimeout(() => {
                    records.set(key, value);
                    if (r.onsuccess) r.onsuccess({ target: r });
                    finish();
                  }, 0);
                  return r;
                },
              };
            };
            return tx;
          },
          close: () => {},
        };

        request.result = db;
        if (needsUpgrade && request.onupgradeneeded) {
          request.onupgradeneeded({ target: request });
        }
        if (request.onsuccess) request.onsuccess({ target: request });
      }, 0);

      return request;
    },
  };
}

/**
 * A simulated device. `use()` installs its globals so the next call into
 * cryptoService runs as that device.
 */
export function createDevice(label) {
  const device = {
    label,
    localStorage: createMemoryLocalStorage(),
    indexedDB: createMemoryIndexedDB(),
  };
  device.use = () => {
    globalThis.window = globalThis;
    globalThis.indexedDB = device.indexedDB;
    globalThis.localStorage = device.localStorage;
    return device;
  };
  return device;
}

/** Install a default `window` pointing at globalThis (for window.crypto). */
export function installWindowGlobal() {
  globalThis.window = globalThis;
}
