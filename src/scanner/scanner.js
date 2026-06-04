/**
 * Scanner module — Dual decoder strategy:
 * 1. html5-qrcode (ZXing) for continuous camera scanning
 * 2. Native BarcodeDetector API (when available) for better detection
 *    of barcodes at ANY angle (vertical, diagonal, etc.)
 *
 * Supports: torch, zoom, autofocus
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
let nativeDetectorIntervalId = null;
let nativeDetector = null;
const DEBOUNCE_MS = 1500;

/**
 * Start the scanner with dual detection
 */
export async function startScanner(elementId, onScan) {
  if (isRunning) return;

  scanCallback = onScan;
  html5Qrcode = new Html5Qrcode(elementId);

  const config = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => ({
      width: Math.floor(viewfinderWidth * 0.9),
      height: Math.floor(viewfinderHeight * 0.6)
    }),
    aspectRatio: 1.333,
    disableFlip: false,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: false
    }
  };

  try {
    await html5Qrcode.start(
      { facingMode: 'environment' },
      config,
      (decodedText, result) => {
        const format = result?.result?.format?.formatName || 'UNKNOWN';
        handleDecode(decodedText, format);
      },
      () => {}
    );

    isRunning = true;

    const videoElement = document.querySelector(`#${elementId} video`);
    if (videoElement && videoElement.srcObject) {
      currentStream = videoElement.srcObject;
      await applyAdvancedCameraSettings();
    }

    // Start native BarcodeDetector scanning in parallel
    startNativeDetector(elementId);

  } catch (err) {
    console.error('Error starting scanner:', err);
    throw err;
  }
}

/**
 * Handle a decoded barcode (from either ZXing or native detector)
 */
function handleDecode(decodedText, format) {
  const now = Date.now();
  if (decodedText === lastScannedCode && (now - lastScanTime) < DEBOUNCE_MS) {
    return;
  }
  lastScannedCode = decodedText;
  lastScanTime = now;

  if (navigator.vibrate) {
    navigator.vibrate(100);
  }

  if (scanCallback) {
    scanCallback(decodedText, format);
  }
}

/**
 * Start the native BarcodeDetector API scanning.
 * This API detects barcodes at ANY orientation (vertical, angled, etc.)
 * and handles many more format edge cases than ZXing.
 * It runs in parallel with html5-qrcode and does NOT access the camera —
 * it just reads frames from the existing <video> element.
 */
function startNativeDetector(elementId) {
  // Check if BarcodeDetector API is available
  if (!('BarcodeDetector' in window)) {
    console.log('Native BarcodeDetector API not available, using ZXing only');
    return;
  }

  try {
    nativeDetector = new BarcodeDetector({
      formats: [
        'code_39', 'code_128', 'code_93',
        'ean_13', 'ean_8',
        'upc_a', 'upc_e',
        'itf', 'codabar',
        'qr_code', 'data_matrix', 'aztec', 'pdf417'
      ]
    });
  } catch (err) {
    console.warn('Failed to create BarcodeDetector:', err);
    return;
  }

  console.log('Native BarcodeDetector active — supports all orientations');

  nativeDetectorIntervalId = setInterval(async () => {
    if (!isRunning) return;

    try {
      const videoElement = document.querySelector(`#${elementId} video`);
      if (!videoElement || videoElement.readyState < 2) return;

      const barcodes = await nativeDetector.detect(videoElement);

      if (barcodes.length > 0) {
        const barcode = barcodes[0];
        handleDecode(barcode.rawValue, barcode.format);
      }
    } catch {
      // Normal: detect() can fail on some frames
    }
  }, 300); // Scan every 300ms — native API is fast
}

function stopNativeDetector() {
  if (nativeDetectorIntervalId) {
    clearInterval(nativeDetectorIntervalId);
    nativeDetectorIntervalId = null;
  }
  nativeDetector = null;
}

/**
 * Apply advanced camera settings (autofocus, exposure)
 */
async function applyAdvancedCameraSettings() {
  const track = getVideoTrack();
  if (!track) return;

  try {
    const capabilities = track.getCapabilities();
    const adv = {};

    if (capabilities.focusMode?.includes('continuous')) {
      adv.focusMode = 'continuous';
    }
    if (capabilities.exposureMode?.includes('continuous')) {
      adv.exposureMode = 'continuous';
    }
    if (capabilities.whiteBalanceMode?.includes('continuous')) {
      adv.whiteBalanceMode = 'continuous';
    }

    if (Object.keys(adv).length > 0) {
      await track.applyConstraints({ advanced: [adv] });
    }
  } catch (err) {
    console.warn('Could not apply advanced camera settings:', err);
  }
}

/**
 * Trigger manual refocus (tap-to-focus)
 */
export async function triggerRefocus() {
  const track = getVideoTrack();
  if (!track) return;

  try {
    const capabilities = track.getCapabilities();
    if (capabilities.focusMode) {
      if (capabilities.focusMode.includes('manual')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
      }
      setTimeout(async () => {
        try {
          if (capabilities.focusMode.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          }
        } catch { /* ignore */ }
      }, 200);
    }
  } catch { /* ignore */ }
}

/**
 * Stop the scanner
 */
export async function stopScanner() {
  if (!html5Qrcode || !isRunning) return;

  stopNativeDetector();

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

export async function toggleTorch() {
  const track = getVideoTrack();
  if (!track) return false;
  try {
    const caps = track.getCapabilities();
    if (!caps.torch) return false;
    torchEnabled = !torchEnabled;
    await track.applyConstraints({ advanced: [{ torch: torchEnabled }] });
    return torchEnabled;
  } catch { return false; }
}

export function isTorchSupported() {
  const track = getVideoTrack();
  if (!track) return false;
  try { return !!track.getCapabilities().torch; }
  catch { return false; }
}

export async function setZoom(zoomLevel) {
  const track = getVideoTrack();
  if (!track) return false;
  try {
    const caps = track.getCapabilities();
    if (!caps.zoom) return false;
    currentZoom = Math.min(Math.max(zoomLevel, caps.zoom.min), caps.zoom.max);
    await track.applyConstraints({ advanced: [{ zoom: currentZoom }] });
    return true;
  } catch { return false; }
}

export function getZoomCapabilities() {
  const track = getVideoTrack();
  if (!track) return null;
  try {
    const caps = track.getCapabilities();
    if (!caps.zoom) return null;
    return { min: caps.zoom.min || 1, max: caps.zoom.max || 5, step: caps.zoom.step || 0.1 };
  } catch { return null; }
}

function getVideoTrack() {
  if (!currentStream) return null;
  const tracks = currentStream.getVideoTracks();
  return tracks.length > 0 ? tracks[0] : null;
}

export function isScannerRunning() { return isRunning; }
export function isTorchEnabled() { return torchEnabled; }
export function getCurrentZoom() { return currentZoom; }
