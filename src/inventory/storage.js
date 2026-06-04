/**
 * storage.js — Persistencia IndexedDB para el escáner de inventario.
 *
 * Base de datos : inventario2  (versión 1)
 * Object stores : inventory, scans, session
 */

const DB_NAME = 'inventario2';
const DB_VERSION = 1;

const STORE_INVENTORY = 'inventory';
const STORE_SCANS = 'scans';
const STORE_SESSION = 'session';

/** @type {IDBDatabase|null} */
let db = null;

/* ------------------------------------------------------------------ */
/*  Helpers internos                                                   */
/* ------------------------------------------------------------------ */

/**
 * Envuelve una IDBRequest en una Promise.
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Envuelve una IDBTransaction para detectar su finalización.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada'));
  });
}

/**
 * Obtiene la instancia de la BD; lanza si no fue inicializada.
 * @returns {IDBDatabase}
 */
function getDB() {
  if (!db) {
    throw new Error('La base de datos no ha sido inicializada. Llama a initDB() primero.');
  }
  return db;
}

/* ------------------------------------------------------------------ */
/*  Inicialización                                                     */
/* ------------------------------------------------------------------ */

/**
 * Abre o crea la base de datos IndexedDB.
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // inventory — clave: ref
      if (!database.objectStoreNames.contains(STORE_INVENTORY)) {
        database.createObjectStore(STORE_INVENTORY, { keyPath: 'ref' });
      }

      // scans — clave auto-incremental id
      if (!database.objectStoreNames.contains(STORE_SCANS)) {
        const scansStore = database.createObjectStore(STORE_SCANS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        scansStore.createIndex('code', 'code', { unique: false });
        scansStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // session — clave: id
      if (!database.objectStoreNames.contains(STORE_SESSION)) {
        database.createObjectStore(STORE_SESSION, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Operaciones globales                                               */
/* ------------------------------------------------------------------ */

/**
 * Limpia todos los object stores.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const database = getDB();
  const tx = database.transaction(
    [STORE_INVENTORY, STORE_SCANS, STORE_SESSION],
    'readwrite',
  );

  tx.objectStore(STORE_INVENTORY).clear();
  tx.objectStore(STORE_SCANS).clear();
  tx.objectStore(STORE_SESSION).clear();

  return txComplete(tx);
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

/**
 * Guarda un array de ítems de inventario (borra los existentes primero).
 * @param {Array<{ref: string, originalRef: string, rowData: object}>} items
 * @returns {Promise<void>}
 */
export async function saveInventory(items) {
  const database = getDB();
  const tx = database.transaction(STORE_INVENTORY, 'readwrite');
  const store = tx.objectStore(STORE_INVENTORY);

  store.clear();

  for (const item of items) {
    store.put(item);
  }

  return txComplete(tx);
}

/**
 * Obtiene un ítem de inventario por su referencia.
 * @param {string} ref
 * @returns {Promise<object|undefined>}
 */
export async function getInventoryItem(ref) {
  const database = getDB();
  const tx = database.transaction(STORE_INVENTORY, 'readonly');
  const store = tx.objectStore(STORE_INVENTORY);
  return promisify(store.get(ref));
}

/**
 * Devuelve todos los ítems de inventario.
 * @returns {Promise<Array<object>>}
 */
export async function getAllInventory() {
  const database = getDB();
  const tx = database.transaction(STORE_INVENTORY, 'readonly');
  const store = tx.objectStore(STORE_INVENTORY);
  return promisify(store.getAll());
}

/**
 * Devuelve la cantidad de ítems en el inventario.
 * @returns {Promise<number>}
 */
export async function getInventoryCount() {
  const database = getDB();
  const tx = database.transaction(STORE_INVENTORY, 'readonly');
  const store = tx.objectStore(STORE_INVENTORY);
  return promisify(store.count());
}

/* ------------------------------------------------------------------ */
/*  Scans                                                              */
/* ------------------------------------------------------------------ */

/**
 * Guarda un escaneo individual.
 * @param {{code: string, timestamp: number, matched: boolean, matchedRef: string|null}} scan
 * @returns {Promise<number>} El id asignado al escaneo.
 */
export async function saveScan(scan) {
  const database = getDB();
  const tx = database.transaction(STORE_SCANS, 'readwrite');
  const store = tx.objectStore(STORE_SCANS);
  const id = await promisify(store.add(scan));
  await txComplete(tx);
  return id;
}

/**
 * Devuelve todos los escaneos ordenados por timestamp descendente.
 * @returns {Promise<Array<object>>}
 */
export async function getAllScans() {
  const database = getDB();
  const tx = database.transaction(STORE_SCANS, 'readonly');
  const store = tx.objectStore(STORE_SCANS);
  const all = await promisify(store.getAll());
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all;
}

/**
 * Devuelve la cantidad de escaneos registrados.
 * @returns {Promise<number>}
 */
export async function getScansCount() {
  const database = getDB();
  const tx = database.transaction(STORE_SCANS, 'readonly');
  const store = tx.objectStore(STORE_SCANS);
  return promisify(store.count());
}

/**
 * Comprueba si un código ya fue escaneado.
 * @param {string} code
 * @returns {Promise<boolean>}
 */
export async function isScanDuplicate(code) {
  const database = getDB();
  const tx = database.transaction(STORE_SCANS, 'readonly');
  const store = tx.objectStore(STORE_SCANS);
  const index = store.index('code');
  const result = await promisify(index.getKey(code));
  return result !== undefined;
}

/**
 * Limpia únicamente el store de escaneos.
 * @returns {Promise<void>}
 */
export async function clearScans() {
  const database = getDB();
  const tx = database.transaction(STORE_SCANS, 'readwrite');
  tx.objectStore(STORE_SCANS).clear();
  return txComplete(tx);
}

/* ------------------------------------------------------------------ */
/*  Session                                                            */
/* ------------------------------------------------------------------ */

/**
 * Guarda los metadatos de la sesión actual.
 * @param {{id: string, importedAt: number, fileName: string, columnName: string, totalRefs: number, options: object}} session
 * @returns {Promise<void>}
 */
export async function saveSession(session) {
  const database = getDB();
  const tx = database.transaction(STORE_SESSION, 'readwrite');
  const store = tx.objectStore(STORE_SESSION);
  store.put(session);
  return txComplete(tx);
}

/**
 * Obtiene la sesión actual (la primera encontrada).
 * @returns {Promise<object|undefined>}
 */
export async function getSession() {
  const database = getDB();
  const tx = database.transaction(STORE_SESSION, 'readonly');
  const store = tx.objectStore(STORE_SESSION);
  const all = await promisify(store.getAll());
  return all[0];
}
