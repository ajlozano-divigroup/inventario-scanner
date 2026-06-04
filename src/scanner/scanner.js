/**
 * Scanner module — wraps html5-qrcode for barcode/QR scanning
 * Supports: torch (flashlight), zoom, pause/resume
 */
import { Html5Qrcode } from 'html5-qrcode';

let html5Qrcode = null;
let currentStream = null;
let torchEnabled = false;
let currentZoom = 1;
let scanCallback = null;
let isRunning = false;
let lastScannedCode = '';
let lastScanTime = 0;
const DEBOUNCE_MS = 1500; // Prevent rapid re-scans of same code

/**
 * Start the scanner
 * @param {string} elementId - The ID of the container element
 * @param {Function} onScan - Callback(decodedText, format) called on each successful scan
 * @returns {Promise<void>}
 */
export async function startScanner(elementId, onScan) {
  if (isRunning) return;

  scanCallback = onScan;
  html5Qrcode = new Html5Qrcode(elementId);

  const config = {
    fps: 15,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const size = Math.floor(minEdge * 0.7);
      return { width: size, height: Math.floor(size * 0.6) };
    },
    aspectRatio: 1.333,
    formatsToSupport: [
      0,  // QR_CODE
      1,  // AZTEC
      2,  // CODABAR
      3,  // CODE_39
      4,  // CODE_93
      5,  // CODE_128
      6,  // DATA_MATRIX
      7,  // MAXICODE (ITF)
      8,  // EAN_13
      9,  // EAN_8
      10, // PDF_417
      11, // RSS_14
      12, // RSS_EXPANDED
      13, // UPC_A
      14, // UPC_E
      15, // UPC_EAN_EXTENSION
    ],
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true
    }
  };

  try {
    await html5Qrcode.start(
      { facingMode: 'environment' },
      config,
      (decodedText, result) => {
        const now = Date.now();
        // Debounce: don't re-fire for same code within DEBOUNCE_MS
        if (decodedText === lastScannedCode && (now - lastScanTime) < DEBOUNCE_MS) {
          return;
        }
        lastScannedCode = decodedText;
        lastScanTime = now;

        // Haptic feedback
        if (navigator.vibrate) {
          navigator.vibrate(100);
        }

        if (scanCallback) {
          const format = result?.result?.format?.formatName || 'UNKNOWN';
          scanCallback(decodedText, format);
        }
      },
      () => { /* ignore scan failures */ }
    );

    isRunning = true;

    // Get the video track for torch/zoom
    const videoElement = document.querySelector(`#${elementId} video`);
    if (videoElement && videoElement.srcObject) {
      currentStream = videoElement.srcObject;
    }
  } catch (err) {
    console.error('Error starting scanner:', err);
    throw err;
  }
}

/**
 * Stop the scanner
 */
export async function stopScanner() {
  if (!html5Qrcode || !isRunning) return;

  try {
    await html5Qrcode.stop();
    html5Qrcode.clear();
  } catch (err) {
    console.error('Error stopping scanner:', err);
  }

  html5Qrcode = null;
  currentStream = null;
  isRunning = false;
  torchEnabled = false;
  currentZoom = 1;
  lastScannedCode = '';
  lastScanTime = 0;
}

/**
 * Toggle the torch (flashlight)
 * @returns {boolean} New torch state
 */
export async function toggleTorch() {
  const track = getVideoTrack();
  if (!track) return false;

  try {
    const capabilities = track.getCapabilities();
    if (!capabilities.torch) {
      console.warn('Torch not supported on this device');
      return false;
    }

    torchEnabled = !torchEnabled;
    await track.applyConstraints({
      advanced: [{ torch: torchEnabled }]
    });
    return torchEnabled;
  } catch (err) {
    console.error('Error toggling torch:', err);
    return false;
  }
}

/**
 * Check if torch is supported
 * @returns {boolean}
 */
export function isTorchSupported() {
  const track = getVideoTrack();
  if (!track) return false;
  try {
    const capabilities = track.getCapabilities();
    return !!capabilities.torch;
  } catch {
    return false;
  }
}

/**
 * Set camera zoom level
 * @param {number} zoomLevel - Zoom factor (1.0 = no zoom)
 * @returns {boolean} Success
 */
export async function setZoom(zoomLevel) {
  const track = getVideoTrack();
  if (!track) return false;

  try {
    const capabilities = track.getCapabilities();
    if (!capabilities.zoom) {
      console.warn('Zoom not supported on this device');
      return false;
    }

    const { min, max } = capabilities.zoom;
    const clampedZoom = Math.min(Math.max(zoomLevel, min), max);
    currentZoom = clampedZoom;

    await track.applyConstraints({
      advanced: [{ zoom: clampedZoom }]
    });
    return true;
  } catch (err) {
    console.error('Error setting zoom:', err);
    return false;
  }
}

/**
 * Get zoom capabilities
 * @returns {{ min: number, max: number, step: number } | null}
 */
export function getZoomCapabilities() {
  const track = getVideoTrack();
  if (!track) return null;

  try {
    const capabilities = track.getCapabilities();
    if (!capabilities.zoom) return null;
    return {
      min: capabilities.zoom.min || 1,
      max: capabilities.zoom.max || 5,
      step: capabilities.zoom.step || 0.1
    };
  } catch {
    return null;
  }
}

/**
 * Get the current video track
 */
function getVideoTrack() {
  if (!currentStream) return null;
  const tracks = currentStream.getVideoTracks();
  return tracks.length > 0 ? tracks[0] : null;
}

/**
 * Check if scanner is running
 */
export function isScannerRunning() {
  return isRunning;
}

/**
 * Get current torch state
 */
export function isTorchEnabled() {
  return torchEnabled;
}

/**
 * Get current zoom
 */
export function getCurrentZoom() {
  return currentZoom;
}
