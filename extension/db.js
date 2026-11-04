// IndexedDB: store "cards" (key = passcode → { name, th, status, en_sha256 }), store "meta" (key → value)
const DB_NAME = "ygo-th";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("cards");
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp = null;
const db = () => (dbp ??= open().catch(e => { dbp = null; throw e; }));

const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction failed"));
});

export async function getCard(id) {
  const tx = (await db()).transaction("cards");
  return new Promise((resolve, reject) => {
    const r = tx.objectStore("cards").get(id);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
}

export async function getMeta() {
  const tx = (await db()).transaction("meta");
  return new Promise((resolve, reject) => {
    const r = tx.objectStore("meta").get("db");
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
}

/** Replace the whole database in ONE transaction — either the new version lands completely or nothing changes. */
export async function replaceAll(cards, meta) {
  const tx = (await db()).transaction(["cards", "meta"], "readwrite");
  const store = tx.objectStore("cards");
  store.clear();
  for (const [id, c] of Object.entries(cards)) store.put(c, id);
  tx.objectStore("meta").put(meta, "db");
  await done(tx);
}
