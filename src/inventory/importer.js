import * as XLSX from 'xlsx';

/**
 * Lee un archivo Excel (.xlsx / .xls) y devuelve las cabeceras,
 * filas como objetos, nombre de la hoja y total de filas.
 * Solo procesa la primera hoja del libro.
 *
 * @param {File} file - Objeto File del input o drag-and-drop.
 * @returns {Promise<{headers: string[], rows: object[], sheetName: string, totalRows: number}>}
 */
export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          reject(new Error('El archivo Excel no contiene ninguna hoja.'));
          return;
        }

        const worksheet = workbook.Sheets[sheetName];

        // Convertir a JSON (cada fila es un objeto con claves = cabeceras)
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        // Extraer cabeceras desde la primera fila del rango
        const headers = rows.length > 0
          ? Object.keys(rows[0])
          : extractHeadersFromSheet(worksheet);

        resolve({
          headers,
          rows,
          sheetName,
          totalRows: rows.length,
        });
      } catch (err) {
        reject(new Error(`Error al procesar el archivo Excel: ${err.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Error al leer el archivo. Verifique que sea un archivo válido.'));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extrae las cabeceras de una hoja vacía (sin filas de datos)
 * leyendo directamente la primera fila del rango.
 *
 * @param {XLSX.WorkSheet} worksheet
 * @returns {string[]}
 */
function extractHeadersFromSheet(worksheet) {
  const ref = worksheet['!ref'];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const headers = [];

  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = worksheet[cellAddress];
    headers.push(cell ? String(cell.v) : `Columna_${col + 1}`);
  }

  return headers;
}

/**
 * Limpia un valor de referencia según las opciones proporcionadas.
 *
 * @param {*} value - Valor original (puede ser string, número, null, etc.).
 * @param {object} [options={}]
 * @param {boolean} [options.stripAsterisks=false] - Eliminar todos los caracteres '*'.
 * @param {boolean} [options.trimSpaces=false] - Recortar espacios al inicio y al final.
 * @returns {string} Valor limpio como cadena de texto.
 */
export function cleanReference(value, options = {}) {
  const { stripAsterisks = false, trimSpaces = false } = options;

  // Convertir a string; null / undefined → cadena vacía
  let cleaned = value == null ? '' : String(value);

  if (stripAsterisks) {
    cleaned = cleaned.replace(/\*/g, '');
  }

  if (trimSpaces) {
    cleaned = cleaned.trim();
  }

  return cleaned;
}

/**
 * Construye un array de ítems de inventario a partir de las filas
 * parseadas, usando la columna indicada como referencia.
 *
 * Filas con referencia vacía o nula se omiten.
 *
 * @param {object[]} rows - Filas devueltas por parseExcelFile().
 * @param {string} columnName - Nombre de la columna que contiene la referencia.
 * @param {object} [options={}] - Opciones de limpieza (pasadas a cleanReference).
 * @returns {{ref: string, originalRef: string, rowData: object}[]}
 */
export function buildInventoryItems(rows, columnName, options = {}) {
  const items = [];

  for (const row of rows) {
    const rawValue = row[columnName];

    // Omitir filas sin valor en la columna de referencia
    if (rawValue == null || String(rawValue).trim() === '') {
      continue;
    }

    const originalRef = String(rawValue);
    const ref = cleanReference(rawValue, options);

    items.push({
      ref,
      originalRef,
      rowData: { ...row },
    });
  }

  return items;
}
