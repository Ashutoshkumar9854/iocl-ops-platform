const DB_NAME = 'IOCL_LocalDB';
const DB_VERSION = 1;

/**
 * Initializes the local IndexedDB instance.
 */
export function openLocalDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store to queue pending offline operations
      if (!db.objectStoreNames.contains('mutations_queue')) {
        db.createObjectStore('mutations_queue', { keyPath: 'mutation_id' });
      }
      
      // Stores to cache read-only/offline data
      if (!db.objectStoreNames.contains('cached_logs')) {
        db.createObjectStore('cached_logs', { keyPath: 'log_id' });
      }

      if (!db.objectStoreNames.contains('cached_assets')) {
        db.createObjectStore('cached_assets', { keyPath: 'asset_id' });
      }

      if (!db.objectStoreNames.contains('cached_incidents')) {
        db.createObjectStore('cached_incidents', { keyPath: 'incident_id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Helper to interact with a store.
 */
function getStore(db, storeName, mode = 'readonly') {
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

// Mutations Queue Methods
export async function queueMutation(mutation) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const store = getStore(db, 'mutations_queue', 'readwrite');
    const request = store.put(mutation);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getQueuedMutations() {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const store = getStore(db, 'mutations_queue');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function clearMutation(mutationId) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const store = getStore(db, 'mutations_queue', 'readwrite');
    const request = store.delete(mutationId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Caching Methods
export async function cacheData(storeName, items) {
  const db = await openLocalDB();
  // Defensive: ensure items is always a real array before iterating
  const safeItems = Array.isArray(items) ? items : [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    
    // Clear old cache
    store.clear();
    
    // Put new items
    safeItems.forEach(item => store.put(item));
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getCachedData(storeName) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const store = getStore(db, storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function addSingleCachedItem(storeName, item) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const store = getStore(db, storeName, 'readwrite');
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
