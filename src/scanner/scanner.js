/**
 * Scanner module — Simple, stable barcode/QR scanning
 * Uses html5-qrcode with native BarcodeDetector (handles all orientations)
 * Falls back to ZXing if native API not available
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
const DEBOUNCE_MS = 1500;

/**
 * Start the scanner
 */
export async function startScanner(elementId, onScan) {
  if (isRunning) return;

  scanCallback = onScan;
  html5Qrcode = new Html5Qrcode(elementId);

  // Check if native BarcodeDetector is available
  const hasNativeDetector = 'BarcodeDetector' in window;

  const config = {
    fps: 5,
    qrbox: (viewfinderWidth, viewfinderHeight) => ({
      width: Math.floor(viewfinderWidth * 0.9),
      height: Math.floor(viewfinderHeight * 0.5)
    }),
    aspectRatio: 1.333,
    disableFlip: false,
    experimentalFeatures: {
      // Use native BarcodeDetector if available — it handles
      // barcodes at ANY angle (vertical, diagonal) and is
      // hardware-accelerated. Falls back to ZXing JS otherwise.
      useBarCodeDetectorIfSupported: hasNativeDetector
    }
  };

  try {
    await html5Qrcode.start(
      { facingMode: 'environment' },
      config,
      (decodedText, result) => {
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
          const format = result?.result?.format?.formatName || 'UNKNOWN';
          scanCallback(decodedText, format);
        }
      },
      () => {}
    );

    isRunning = true;

    const videoElement = document.querySelector(`#${elementId} video`);
    if (videoElement && videoElement.srcObject) {
      currentStream = videoElement.srcObject;
      await applyAdvancedCameraSettings();
    }
  } catch (err) {
    console.error('Error starting scanner:', err);
    throw err;
  }
}

/**
 * Apply autofocus + exposure settings
 */
async function applyAdvancedCameraSettings() {
  const track = getVideoTrack();
  if (!track) return;
  try {
    const caps = track.getCapabilities();
    const adv = {};
    if (caps.focusMode?.includes('continuous')) adv.focusMode = 'continuous';
    if (caps.exposureMode?.includes('continuous')) adv.exposureMode = 'continuous';
    if (Object.keys(adv).length > 0) {
      await track.applyConstraints({ advanced: [adv] });
    }
  } catch { /* ignore */ }
}

/**
 * Tap-to-focus
 */
export async function triggerRefocus() {
  const track = getVideoTrack();
  if (!track) return;
  try {
    const caps = track.getCapabilities();
    if (caps.focusMode?.includes('manual')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
      setTimeout(async () => {
        try {
          if (caps.focusMode.includes('continuous')) {
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
