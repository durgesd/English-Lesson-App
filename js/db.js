/* =========================================================
   DATABASE (IndexedDB)
   All lesson data, word-bank recordings and settings live here,
   directly on the teacher's phone/computer — nothing is sent
   anywhere unless Google Drive backup is explicitly set up.
   ========================================================= */
const DB_NAME = 'englishLessonAppDB';
const DB_VERSION = 1;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('words')) {
        idb.createObjectStore('words', { keyPath: 'key' }); // key = normalized lowercase word
      }
      if (!idb.objectStoreNames.contains('lessons')) {
        idb.createObjectStore('lessons', { keyPath: 'id' });
      }
      if (!idb.objectStoreNames.contains('settings')) {
        idb.createObjectStore('settings', { keyPath: 'key' });
      }
      // Local, network-independent safety snapshots. These save instantly
      // to this same device and don't depend on Google Drive being set up
      // or the internet being available — a last line of defence against
      // data loss (e.g. an app update, or the browser clearing storage).
      if (!idb.objectStoreNames.contains('localSnapshots')) {
        idb.createObjectStore('localSnapshots', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e);
  });
}

function dbGetAll(store) {
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function dbGet(store, key) {
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

function dbPut(store, obj) {
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/* Mobile browsers can silently evict an app's local data under storage
   pressure if the site isn't considered "important" enough. Requesting
   persistent storage tells the browser not to do that. This never shows
   an intrusive prompt — it either silently succeeds or has no effect. */
function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((already) => {
      if (!already) navigator.storage.persist();
    }).catch(() => {});
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
