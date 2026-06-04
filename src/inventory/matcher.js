/**
 * Matcher module — compares scanned codes against inventory
 */

/**
 * Find a match in the inventory for a scanned code
 * @param {string} scannedCode - The raw code from the scanner
 * @param {Map<string, object>} inventoryMap - Map of cleaned refs to inventory items
 * @returns {{ matched: boolean, item: object|null }}
 */
export function findMatch(scannedCode, inventoryMap) {
  if (!scannedCode || !inventoryMap || inventoryMap.size === 0) {
    return { matched: false, item: null };
  }

  // Direct match
  const code = String(scannedCode).trim();
  if (inventoryMap.has(code)) {
    return { matched: true, item: inventoryMap.get(code) };
  }

  // Try case-insensitive
  const codeLower = code.toLowerCase();
  for (const [ref, item] of inventoryMap) {
    if (ref.toLowerCase() === codeLower) {
      return { matched: true, item };
    }
  }

  return { matched: false, item: null };
}

/**
 * Build a lookup map from inventory items
 * @param {Array<{ref: string, originalRef: string, rowData: object}>} items
 * @returns {Map<string, object>}
 */
export function buildInventoryMap(items) {
  const map = new Map();
  for (const item of items) {
    if (item.ref) {
      map.set(item.ref, item);
    }
  }
  return map;
}

/**
 * Compute inventory verification stats
 * @param {Array} inventoryItems - All inventory items
 * @param {Array} scans - All scan records
 * @returns {{ total: number, found: number, unknown: number, pending: number, percentage: number }}
 */
export function computeStats(inventoryItems, scans) {
  const total = inventoryItems.length;
  const matchedRefs = new Set();
  let unknown = 0;

  for (const scan of scans) {
    if (scan.matched && scan.matchedRef) {
      matchedRefs.add(scan.matchedRef);
    } else if (!scan.matched) {
      unknown++;
    }
  }

  const found = matchedRefs.size;
  const pending = total - found;
  const percentage = total > 0 ? Math.round((found / total) * 100) : 0;

  return { total, found, unknown, pending, percentage };
}

/**
 * Categorize results for the results screen
 * @param {Array} inventoryItems
 * @param {Array} scans
 * @returns {{ found: Array, unknown: Array, pending: Array }}
 */
export function categorizeResults(inventoryItems, scans) {
  const matchedRefs = new Map(); // ref -> scan info

  const found = [];
  const unknown = [];

  for (const scan of scans) {
    if (scan.matched && scan.matchedRef) {
      if (!matchedRefs.has(scan.matchedRef)) {
        matchedRefs.set(scan.matchedRef, scan);
      }
    } else if (!scan.matched) {
      unknown.push(scan);
    }
  }

  // Build found list with inventory data
  for (const [ref, scan] of matchedRefs) {
    const invItem = inventoryItems.find(i => i.ref === ref);
    found.push({
      ref,
      scan,
      rowData: invItem ? invItem.rowData : {}
    });
  }

  // Build pending list
  const pending = inventoryItems.filter(item => !matchedRefs.has(item.ref));

  return { found, unknown, pending };
}
