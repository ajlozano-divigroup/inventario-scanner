/**
 * Scanner module — Stable barcode/QR scanning
 * Uses html5-qrcode with native BarcodeDetector when available.
 * Lightweight: no heavy overlays, no pixel processing.
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

  const config = {
    fps: 5,
    disableFlip: false,
    formatsToSupport: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    experimentalFeatures: {
      // DISABLED: native BarcodeDetector can't read this barcode format.
      // ZXing JS decoder CAN — but needs barcode to be horizontal.
      useBarCodeDetectorIfSupported: false
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
 * Apply autofocus + try to get 720p resolution
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
    // Try 720p — much better than 480p but won't crash like 1080p
    try {
      await track.applyConstraints({
        width: { ideal: 1280 },
        height: { ideal: 720 }
      });
    } catch { /* keep default */ }
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

/**
 * Get current camera resolution for debug display
 */
export function getCameraResolution(elementId) {
  const videoElement = document.querySelector(`#${elementId} video`);
  if (!videoElement) return null;
  return { w: videoElement.videoWidth, h: videoElement.videoHeight };
}

/**
 * Capture current video frame and try to scan it using the native
 * BarcodeDetector at multiple rotations. Falls back to ZXing scanFile.
 * Lightweight: no pixel manipulation, just rotation.
 */
export async function captureAndScan(elementId) {
  const videoElement = document.querySelector(`#${elementId} video`);
  if (!videoElement || videoElement.readyState < 2) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  if (!vw || !vh) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // === Strategy 1: Native BarcodeDetector (handles orientation) ===
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({
        formats: [
          'code_39', 'code_128', 'code_93',
          'ean_13', 'ean_8', 'upc_a', 'upc_e',
          'itf', 'codabar',
          'qr_code', 'data_matrix', 'aztec', 'pdf417'
        ]
      });

      // Try raw frame
      let barcodes = await detector.detect(videoElement);
      if (barcodes.length > 0) {
        return { text: barcodes[0].rawValue, format: barcodes[0].format };
      }

      // Try 90° rotation
      canvas.width = vh; canvas.height = vw;
      ctx.translate(vh, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(videoElement, 0, 0, vw, vh);
      barcodes = await detector.detect(canvas);
      if (barcodes.length > 0) {
        return { text: barcodes[0].rawValue, format: barcodes[0].format };
      }
    } catch (err) {
      console.warn('Native capture failed:', err);
    }
  }

  // === Strategy 2: ZXing file scan at 270° (correct direction for vertical barcodes) ===
  const rotations = [270, 0, 90, 180];

  let hiddenDiv = document.getElementById('__capture_scan__');
  if (!hiddenDiv) {
    hiddenDiv = document.createElement('div');
    hiddenDiv.id = '__capture_scan__';
    hiddenDiv.style.display = 'none';
    document.body.appendChild(hiddenDiv);
  }

  for (const angle of rotations) {
    if (angle === 90 || angle === 270) {
      canvas.width = vh; canvas.height = vw;
    } else {
      canvas.width = vw; canvas.height = vh;
    }

    ctx.save();
    if (angle === 90) ctx.translate(vh, 0);
    else if (angle === 180) ctx.translate(vw, vh);
    else if (angle === 270) ctx.translate(0, vw);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(videoElement, 0, 0, vw, vh);
    ctx.restore();

    try {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) continue;
      const file = new File([blob], 'c.jpg', { type: 'image/jpeg' });
      const tmp = new Html5Qrcode('__capture_scan__', false);
      try {
        const result = await tmp.scanFileV2(file, false);
        tmp.clear();
        if (result && result.decodedText) {
          hiddenDiv.remove();
          return { text: result.decodedText, format: result?.result?.format?.formatName || `${angle}°` };
        }
      } catch { try { tmp.clear(); } catch {} }
    } catch {}
  }

  if (hiddenDiv) hiddenDiv.remove();
  return null;
}

// No-op functions for detection overlay (removed for stability)
export function startDetectionOverlay() {}
export function stopDetectionOverlay() {}
