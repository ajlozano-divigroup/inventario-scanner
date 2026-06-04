/**
 * Inventario 2.0 — Main Application Controller
 * Connects all modules and handles UI interactions
 */
import './style.css';
import { initDB, saveInventory, getAllInventory, getInventoryCount, saveScan, getAllScans, getScansCount, isScanDuplicate, saveSession, getSession, clearAll, clearScans } from './inventory/storage.js';
import { parseExcelFile, cleanReference, buildInventoryItems } from './inventory/importer.js';
import { startScanner, stopScanner, toggleTorch, setZoom, getZoomCapabilities, isTorchSupported, triggerRefocus } from './scanner/scanner.js';
import { findMatch, buildInventoryMap, computeStats, categorizeResults } from './inventory/matcher.js';
import { showToast, showSuccess, showError, showWarning, showInfo } from './ui/toast.js';
import { exportReport } from './export/exporter.js';

// ============================================================
// App State
// ============================================================
let inventoryMap = new Map();
let inventoryItems = [];
let scans = [];
let sessionInfo = null;
let isTestMode = false;
let currentScreen = 'dashboard';

// ============================================================
// Init
// ============================================================
async function init() {
  try {
    await initDB();
  } catch (err) {
    showError('Error al iniciar la base de datos');
    console.error(err);
  }

  // Restore session if exists
  await restoreSession();

  // Bind event listeners
  bindNavigation();
  bindDashboard();
  bindImport();
  bindScanner();
  bindResults();
  bindModal();

  // Update UI
  updateDashboard();
}

// ============================================================
// Session Restore
// ============================================================
async function restoreSession() {
  try {
    sessionInfo = await getSession();
    if (sessionInfo) {
      inventoryItems = await getAllInventory();
      inventoryMap = buildInventoryMap(inventoryItems);
      scans = await getAllScans();
    }
  } catch (err) {
    console.error('Error restoring session:', err);
  }
}

// ============================================================
// Navigation
// ============================================================
function bindNavigation() {
  document.querySelectorAll('.back-btn[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.target);
    });
  });
}

function navigateTo(screenId) {
  const prevScreen = document.querySelector('.screen.active');
  const nextScreen = document.getElementById(`screen-${screenId}`);

  if (!nextScreen || prevScreen === nextScreen) return;

  // Before leaving scanner, stop it
  if (currentScreen === 'scanner' && screenId !== 'scanner') {
    stopScanner().catch(() => {});
  }

  prevScreen.classList.remove('active');
  prevScreen.classList.add('slide-out');

  nextScreen.classList.add('active');

  setTimeout(() => {
    prevScreen.classList.remove('slide-out');
  }, 300);

  currentScreen = screenId;

  // Post-navigation actions
  if (screenId === 'dashboard') {
    updateDashboard();
  } else if (screenId === 'results') {
    updateResults();
  }
}

// ============================================================
// Dashboard
// ============================================================
function bindDashboard() {
  document.getElementById('btn-import').addEventListener('click', () => {
    navigateTo('import');
  });

  document.getElementById('btn-scan').addEventListener('click', () => {
    isTestMode = false;
    navigateTo('scanner');
    startScannerScreen();
  });

  document.getElementById('btn-test-mode').addEventListener('click', () => {
    isTestMode = true;
    navigateTo('scanner');
    startScannerScreen();
  });

  document.getElementById('btn-results').addEventListener('click', () => {
    navigateTo('results');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    doExport();
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    showModal(
      'Limpiar sesión',
      '¿Estás seguro de que quieres borrar todos los datos? Se eliminará el inventario importado y todos los escaneos.',
      async () => {
        await clearAll();
        inventoryItems = [];
        inventoryMap = new Map();
        scans = [];
        sessionInfo = null;
        updateDashboard();
        showSuccess('Sesión limpiada correctamente');
      }
    );
  });
}

function updateDashboard() {
  const hasInventory = inventoryItems.length > 0;
  const hasScans = scans.length > 0;

  // Status
  const statusDot = document.querySelector('#status-indicator .status-dot');
  const statusText = document.getElementById('status-text');

  if (hasInventory) {
    statusDot.className = 'status-dot online';
    statusText.textContent = `${inventoryItems.length} referencias cargadas`;
  } else {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Sin inventario cargado';
  }

  // Stats
  const statsGrid = document.getElementById('dashboard-stats');
  const progressContainer = document.getElementById('dashboard-progress');

  if (hasInventory) {
    statsGrid.classList.remove('hidden');
    const stats = computeStats(inventoryItems, scans);
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-found').textContent = stats.found;
    document.getElementById('stat-unknown').textContent = stats.unknown;
    document.getElementById('stat-pending').textContent = stats.pending;

    progressContainer.classList.remove('hidden');
    document.getElementById('progress-fill').style.width = `${stats.percentage}%`;
    document.getElementById('progress-text').textContent = `${stats.percentage}%`;
  } else {
    statsGrid.classList.add('hidden');
    progressContainer.classList.add('hidden');
  }

  // Buttons
  document.getElementById('btn-scan').disabled = !hasInventory;
  document.getElementById('btn-results').disabled = !hasInventory;

  // Quick actions
  const quickActions = document.getElementById('quick-actions');
  if (hasInventory || hasScans) {
    quickActions.classList.remove('hidden');
  } else {
    quickActions.classList.add('hidden');
  }
}

// ============================================================
// Import
// ============================================================
let parsedData = null;

function bindImport() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = ''; // Reset for re-selection
  });

  document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);
}

async function handleFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showError('Solo se aceptan archivos .xlsx o .xls');
    return;
  }

  showInfo('Leyendo archivo...');

  try {
    parsedData = await parseExcelFile(file);
    parsedData.fileName = file.name;
    showPreview(parsedData);
    showSuccess(`Archivo leído: ${parsedData.totalRows} filas`);
  } catch (err) {
    showError('Error al leer el archivo Excel');
    console.error(err);
  }
}

function showPreview(data) {
  const preview = document.getElementById('import-preview');
  preview.classList.remove('hidden');

  document.getElementById('file-name').textContent = data.fileName;
  document.getElementById('file-rows').textContent = `${data.totalRows} filas`;

  // Table header
  const thead = document.getElementById('preview-thead');
  thead.innerHTML = '<tr>' + data.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr>';

  // Table body (show first 5 rows)
  const tbody = document.getElementById('preview-tbody');
  const previewRows = data.rows.slice(0, 5);
  tbody.innerHTML = previewRows.map(row =>
    '<tr>' + data.headers.map(h => `<td>${escapeHtml(String(row[h] ?? ''))}</td>`).join('') + '</tr>'
  ).join('');

  // Column selector
  const select = document.getElementById('column-select');
  select.innerHTML = data.headers.map(h => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');

  // Auto-select column that looks like "MATRÍCULA" or "REF"
  const autoCol = data.headers.find(h => {
    const lower = h.toLowerCase();
    return lower.includes('matrícula') || lower.includes('matricula') || lower.includes('referencia') || lower.includes('ref') || lower.includes('código') || lower.includes('codigo') || lower.includes('barcode') || lower.includes('ean');
  });
  if (autoCol) {
    select.value = autoCol;
  }
}

async function confirmImport() {
  if (!parsedData) return;

  const columnName = document.getElementById('column-select').value;
  const stripAsterisks = document.getElementById('strip-asterisks').checked;
  const trimSpaces = document.getElementById('trim-spaces').checked;

  const options = { stripAsterisks, trimSpaces };
  const items = buildInventoryItems(parsedData.rows, columnName, options);

  if (items.length === 0) {
    showError('No se encontraron referencias en la columna seleccionada');
    return;
  }

  try {
    // Clear previous scans when importing new inventory
    await clearAll();
    await saveInventory(items);

    const session = {
      id: 'current',
      importedAt: new Date().toISOString(),
      fileName: parsedData.fileName,
      columnName,
      totalRefs: items.length,
      options
    };
    await saveSession(session);

    inventoryItems = items;
    inventoryMap = buildInventoryMap(items);
    scans = [];
    sessionInfo = session;

    showSuccess(`${items.length} referencias importadas correctamente`);
    navigateTo('dashboard');
  } catch (err) {
    showError('Error al guardar el inventario');
    console.error(err);
  }
}

// ============================================================
// Scanner
// ============================================================
function bindScanner() {
  document.getElementById('btn-stop-scan').addEventListener('click', () => {
    stopScanner().catch(() => {});
  });

  document.getElementById('btn-torch').addEventListener('click', handleTorch);

  // Zoom controls
  const slider = document.getElementById('zoom-slider');
  slider.addEventListener('input', (e) => {
    const zoom = parseFloat(e.target.value);
    setZoom(zoom);
    document.getElementById('zoom-value').textContent = `${zoom.toFixed(1)}x`;
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    const val = Math.min(parseFloat(slider.value) + 0.5, parseFloat(slider.max));
    slider.value = val;
    slider.dispatchEvent(new Event('input'));
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const val = Math.max(parseFloat(slider.value) - 0.5, parseFloat(slider.min));
    slider.value = val;
    slider.dispatchEvent(new Event('input'));
  });

  // Tap-to-focus: touching the camera viewport re-triggers autofocus
  document.querySelector('.scanner-viewport').addEventListener('click', () => {
    triggerRefocus();
    showInfo('Reenfocando...');
  });
}

async function startScannerScreen() {
  // Update title
  const title = document.getElementById('scanner-title');
  title.textContent = isTestMode ? 'Modo Prueba' : 'Escáner';

  // Reset UI
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('scan-history-list').innerHTML = '<li class="empty-state">Escanea un código para empezar</li>';
  document.getElementById('scan-count').textContent = '0';
  document.getElementById('zoom-slider').value = 1;
  document.getElementById('zoom-value').textContent = '1.0x';
  document.getElementById('btn-torch').classList.remove('active');

  try {
    await startScanner('scanner-reader', handleScanResult);

    // Setup zoom capabilities after scanner starts
    setTimeout(() => {
      const caps = getZoomCapabilities();
      if (caps) {
        const slider = document.getElementById('zoom-slider');
        slider.min = caps.min;
        slider.max = Math.min(caps.max, 10);
        slider.step = caps.step;
      }

      // Show/hide torch button
      if (!isTorchSupported()) {
        document.getElementById('btn-torch').style.display = 'none';
      } else {
        document.getElementById('btn-torch').style.display = '';
      }
    }, 500);
  } catch (err) {
    showError('No se pudo acceder a la cámara. Verifica los permisos.');
    console.error(err);
    navigateTo('dashboard');
  }
}

async function handleTorch() {
  const torchState = await toggleTorch();
  const btn = document.getElementById('btn-torch');
  btn.classList.toggle('active', torchState);
}

async function handleScanResult(decodedText, format) {
  if (isTestMode) {
    // Test mode: just show the code, no matching
    showScanResultUI(decodedText, 'test-mode', '🔍', 'Modo Prueba', `Formato: ${format}`);
    addToHistory(decodedText, '🔍');
    return;
  }

  // Check for duplicate scan
  const isDuplicate = await isScanDuplicate(decodedText);

  if (isDuplicate) {
    showScanResultUI(decodedText, 'duplicate', '⚠️', 'Ya escaneado', 'Este código ya fue registrado');
    return;
  }

  // Try to match
  const { matched, item } = findMatch(decodedText, inventoryMap);

  const scan = {
    code: decodedText,
    timestamp: new Date().toISOString(),
    matched,
    matchedRef: matched ? item.ref : null
  };

  try {
    await saveScan(scan);
    scans.push(scan);
  } catch (err) {
    console.error('Error saving scan:', err);
  }

  if (matched) {
    const details = buildDetailRows(item.rowData);
    showScanResultUI(decodedText, 'found', '✅', 'Encontrado en inventario', details);
    addToHistory(decodedText, '✅');
  } else {
    showScanResultUI(decodedText, 'not-found', '❌', 'No encontrado', 'Este código no está en el inventario');
    addToHistory(decodedText, '❌');
  }

  // Update scan count
  document.getElementById('scan-count').textContent = scans.length;
}

function showScanResultUI(code, className, icon, statusText, details) {
  const container = document.getElementById('scan-result');
  const inner = document.getElementById('scan-result-inner');
  const iconEl = document.getElementById('scan-result-icon');
  const codeEl = document.getElementById('scan-result-code');
  const statusEl = document.getElementById('scan-result-status');
  const detailsEl = document.getElementById('scan-result-details');

  container.classList.remove('hidden');
  inner.className = `scan-result-inner glass-card ${className}`;
  iconEl.textContent = icon;
  codeEl.textContent = code;
  statusEl.textContent = statusText;

  if (typeof details === 'string') {
    detailsEl.innerHTML = `<span>${escapeHtml(details)}</span>`;
  } else {
    detailsEl.innerHTML = details;
  }

  // Re-trigger animation
  inner.style.animation = 'none';
  inner.offsetHeight; // Force reflow
  inner.style.animation = '';
}

function buildDetailRows(rowData) {
  if (!rowData) return '';
  const keys = Object.keys(rowData);
  const maxShow = 4;
  return keys.slice(0, maxShow).map(key => {
    const val = rowData[key] ?? '';
    return `<div class="detail-row"><span class="detail-label">${escapeHtml(key)}:</span> <span class="detail-value">${escapeHtml(String(val))}</span></div>`;
  }).join('');
}

function addToHistory(code, icon) {
  const list = document.getElementById('scan-history-list');

  // Remove empty state
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const li = document.createElement('li');
  li.className = 'history-item';

  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  li.innerHTML = `
    <span class="history-icon">${icon}</span>
    <span class="history-code">${escapeHtml(code)}</span>
    <span class="history-time">${time}</span>
  `;

  list.insertBefore(li, list.firstChild);

  // Keep max 50 items in the visible list
  while (list.children.length > 50) {
    list.removeChild(list.lastChild);
  }
}

// ============================================================
// Results
// ============================================================
function bindResults() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Search
  document.getElementById('results-search').addEventListener('input', (e) => {
    filterResults(e.target.value);
  });

  // Export button in results header
  document.getElementById('btn-export-results').addEventListener('click', doExport);
}

function updateResults() {
  const { found, unknown, pending } = categorizeResults(inventoryItems, scans);
  const stats = computeStats(inventoryItems, scans);

  // Progress
  document.getElementById('results-progress-fill').style.width = `${stats.percentage}%`;
  document.getElementById('results-progress-text').textContent =
    `${stats.found} de ${stats.total} verificadas (${stats.percentage}%)`;

  // Tab counts
  document.getElementById('tab-count-found').textContent = found.length;
  document.getElementById('tab-count-unknown').textContent = unknown.length;
  document.getElementById('tab-count-pending').textContent = pending.length;

  // Found list
  renderResultList('list-found', found.map(f => ({
    icon: '✅',
    ref: f.ref,
    desc: getFirstExtraField(f.rowData),
    time: formatTime(f.scan.timestamp)
  })));

  // Unknown list
  renderResultList('list-unknown', unknown.map(u => ({
    icon: '❌',
    ref: u.code,
    desc: 'No coincide con ninguna referencia',
    time: formatTime(u.timestamp)
  })));

  // Pending list
  renderResultList('list-pending', pending.map(p => ({
    icon: '⏳',
    ref: p.ref,
    desc: getFirstExtraField(p.rowData),
    time: ''
  })));
}

function renderResultList(listId, items) {
  const list = document.getElementById(listId);

  if (items.length === 0) {
    list.innerHTML = '<li class="result-empty">No hay elementos</li>';
    return;
  }

  list.innerHTML = items.map(item => `
    <li class="result-item" data-ref="${escapeHtml(item.ref.toLowerCase())}">
      <span class="result-icon">${item.icon}</span>
      <div class="result-info">
        <span class="result-ref">${escapeHtml(item.ref)}</span>
        <span class="result-desc">${escapeHtml(item.desc)}</span>
      </div>
      ${item.time ? `<span class="result-time">${item.time}</span>` : ''}
    </li>
  `).join('');
}

function filterResults(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.tab-content.active .result-item').forEach(item => {
    const ref = item.dataset.ref || '';
    item.style.display = ref.includes(q) ? '' : 'none';
  });
}

function getFirstExtraField(rowData) {
  if (!rowData) return '';
  const keys = Object.keys(rowData);
  // Skip the first key (usually the reference itself), get the second
  if (keys.length > 1) return String(rowData[keys[1]] ?? '');
  return '';
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ============================================================
// Export
// ============================================================
async function doExport() {
  if (inventoryItems.length === 0 && scans.length === 0) {
    showWarning('No hay datos para exportar');
    return;
  }

  try {
    exportReport(inventoryItems, scans, sessionInfo || {
      fileName: 'N/A',
      importedAt: new Date().toISOString(),
      columnName: 'N/A',
      totalRefs: inventoryItems.length
    });
    showSuccess('Informe exportado correctamente');
  } catch (err) {
    showError('Error al exportar el informe');
    console.error(err);
  }
}

// ============================================================
// Modal
// ============================================================
let modalConfirmCallback = null;

function bindModal() {
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-confirm').addEventListener('click', () => {
    if (modalConfirmCallback) modalConfirmCallback();
    hideModal();
  });
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal();
  });
}

function showModal(title, message, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  modalConfirmCallback = onConfirm;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalConfirmCallback = null;
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', init);
