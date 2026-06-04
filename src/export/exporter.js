import * as XLSX from 'xlsx';

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Pad a number to two digits.
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Format a Date (or timestamp value) as DD/MM/YYYY HH:mm:ss.
 * @param {Date|number|string} value
 * @returns {string}
 */
function formatTimestamp(value) {
  const d = value instanceof Date ? value : new Date(value);
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Build a compact date-time tag for file names: YYYYMMDD_HHmmss.
 * @param {Date} d
 * @returns {string}
 */
function fileTimestamp(d) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// ── Main export ────────────────────────────────────────────────────

/**
 * Generate and download an Excel report with four sheets:
 *   Resumen · Encontrados · No Reconocidos · Pendientes
 *
 * @param {Array<{ref: string, originalRef: string, rowData: Object}>} inventoryItems
 * @param {Array<{code: string, timestamp: *, matched: boolean, matchedRef?: string}>} scans
 * @param {{fileName: string, importedAt: *, columnName: string, totalRefs: number}} sessionInfo
 */
export function exportReport(inventoryItems, scans, sessionInfo) {
  const now = new Date();
  const wb = XLSX.utils.book_new();

  // ── Classify scans ───────────────────────────────────────────────
  const matchedScans = scans.filter((s) => s.matched === true);
  const unmatchedScans = scans.filter((s) => s.matched === false);

  // Set of refs that were found via scanning
  const matchedRefs = new Set(matchedScans.map((s) => s.matchedRef));

  // Inventory items not covered by any matched scan
  const pendingItems = inventoryItems.filter((item) => !matchedRefs.has(item.ref));

  // ── 1. Resumen ───────────────────────────────────────────────────
  const pct =
    inventoryItems.length > 0
      ? ((matchedRefs.size / inventoryItems.length) * 100).toFixed(2) + '%'
      : '0.00%';

  const resumenData = [
    ['Fecha del informe', formatTimestamp(now)],
    ['Archivo de inventario', sessionInfo.fileName],
    ['Columna de referencia', sessionInfo.columnName],
    ['Total referencias', inventoryItems.length],
    ['Total escaneos', scans.length],
    ['Encontrados', matchedRefs.size],
    ['No reconocidos (escaneados sin match)', unmatchedScans.length],
    ['Pendientes (no escaneados)', pendingItems.length],
    ['Porcentaje completado', pct],
  ];

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // ── Discover extra rowData columns (stable order) ────────────────
  const extraCols = _collectRowDataColumns(inventoryItems);

  // ── 2. Encontrados ──────────────────────────────────────────────
  const encontradosHeader = ['Referencia', 'Fecha/Hora escaneo', ...extraCols];

  // Build a lookup: ref → inventoryItem for fast joining
  const itemByRef = new Map(inventoryItems.map((item) => [item.ref, item]));

  const encontradosRows = matchedScans.map((scan) => {
    const item = itemByRef.get(scan.matchedRef);
    const rowDataValues = extraCols.map((col) =>
      item && item.rowData ? (item.rowData[col] ?? '') : '',
    );
    return [scan.matchedRef, formatTimestamp(scan.timestamp), ...rowDataValues];
  });

  const wsEncontrados = XLSX.utils.aoa_to_sheet([encontradosHeader, ...encontradosRows]);
  XLSX.utils.book_append_sheet(wb, wsEncontrados, 'Encontrados');

  // ── 3. No Reconocidos ───────────────────────────────────────────
  const noReconocidosHeader = ['Código Escaneado', 'Fecha/Hora escaneo'];
  const noReconocidosRows = unmatchedScans.map((scan) => [
    scan.code,
    formatTimestamp(scan.timestamp),
  ]);

  const wsNoReconocidos = XLSX.utils.aoa_to_sheet([noReconocidosHeader, ...noReconocidosRows]);
  XLSX.utils.book_append_sheet(wb, wsNoReconocidos, 'No Reconocidos');

  // ── 4. Pendientes ──────────────────────────────────────────────
  const pendientesHeader = ['Referencia', ...extraCols];
  const pendientesRows = pendingItems.map((item) => {
    const rowDataValues = extraCols.map((col) =>
      item.rowData ? (item.rowData[col] ?? '') : '',
    );
    return [item.ref, ...rowDataValues];
  });

  const wsPendientes = XLSX.utils.aoa_to_sheet([pendientesHeader, ...pendientesRows]);
  XLSX.utils.book_append_sheet(wb, wsPendientes, 'Pendientes');

  // ── Trigger download ───────────────────────────────────────────
  const fileName = `Inventario_Informe_${fileTimestamp(now)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Collect all unique column names from inventoryItems' rowData objects,
 * preserving insertion order from the first item that defines each key.
 *
 * @param {Array<{rowData?: Object}>} items
 * @returns {string[]}
 */
function _collectRowDataColumns(items) {
  const seen = new Set();
  const cols = [];
  for (const item of items) {
    if (!item.rowData) continue;
    for (const key of Object.keys(item.rowData)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}
