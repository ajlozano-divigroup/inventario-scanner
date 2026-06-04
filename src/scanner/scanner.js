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

/**
 * Capture current video frame, rotate it in 4 angles, and try to
 * scan each rotation. Returns the first successful decode or null.
 * This is a manual fallback for barcodes that the live scanner can't
 * read (e.g. vertical 1D barcodes).
 *
 * Strategy:
 * 1. Try native BarcodeDetector API first (handles all orientations correctly)
 * 2. Fall back to ZXing with 0° and 90° rotations + horizontal flip
 *    (180°/270° cause reversed reads → wrong data like 731311 instead of 600134)
 *
 * @param {string} elementId - Scanner container element ID
 * @returns {Promise<{text: string, format: string} | null>}
 */
export async function captureAndScan(elementId) {
  const videoElement = document.querySelector(`#${elementId} video`);
  if (!videoElement || videoElement.readyState < 2) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  if (!vw || !vh) return null;

  // === Strategy 1: Native BarcodeDetector (best — handles orientation + direction) ===
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({
        formats: [
          'code_39', 'code_128', 'code_93',
          'ean_13', 'ean_8',
          'upc_a', 'upc_e',
          'itf', 'codabar',
          'qr_code', 'data_matrix', 'aztec', 'pdf417'
        ]
      });

      // Try on the raw video frame first (handles all orientations natively)
      const barcodes = await detector.detect(videoElement);
      if (barcodes.length > 0) {
        return { text: barcodes[0].rawValue, format: barcodes[0].format };
      }

      // If not found, try on a rotated canvas (some implementations
      // still struggle with vertical 1D barcodes)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = vh;
      canvas.height = vw;
      ctx.translate(vh, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(videoElement, 0, 0, vw, vh);

      const rotatedBarcodes = await detector.detect(canvas);
      if (rotatedBarcodes.length > 0) {
        return { text: rotatedBarcodes[0].rawValue, format: rotatedBarcodes[0].format };
      }
    } catch (err) {
      console.warn('Native BarcodeDetector capture failed:', err);
    }
  }

  // === Strategy 2: ZXing via html5-qrcode (fallback) ===
  // Try all 4 rotations. Order matters: 270° is tried BEFORE 90° because
  // for vertical barcodes on labels, 90° reads right-to-left (wrong: 731311)
  // while 270° reads left-to-right (correct: 600134). First match wins.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const transforms = [
    { label: '0°', w: vw, h: vh, angle: 0 },
    { label: '270°', w: vh, h: vw, angle: 270 },
    { label: '180°', w: vw, h: vh, angle: 180 },
    { label: '90°', w: vh, h: vw, angle: 90 },
  ];

  // Create hidden container for temp scanner
  let hiddenDiv = document.getElementById('__capture_scan__');
  if (!hiddenDiv) {
    hiddenDiv = document.createElement('div');
    hiddenDiv.id = '__capture_scan__';
    hiddenDiv.style.display = 'none';
    document.body.appendChild(hiddenDiv);
  }

  for (const t of transforms) {
    // Set canvas size and draw rotated frame
    canvas.width = t.w;
    canvas.height = t.h;
    ctx.save();
    if (t.angle === 90) {
      ctx.translate(t.w, 0);
    } else if (t.angle === 180) {
      ctx.translate(t.w, t.h);
    } else if (t.angle === 270) {
      ctx.translate(0, t.h);
    }
    ctx.rotate((t.angle * Math.PI) / 180);
    ctx.drawImage(videoElement, 0, 0, vw, vh);
    ctx.restore();

    try {
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9)
      );
      if (!blob) continue;

      const file = new File([blob], `capture.jpg`, { type: 'image/jpeg' });
      const tempScanner = new Html5Qrcode('__capture_scan__', false);

      try {
        const result = await tempScanner.scanFileV2(file, false);
        tempScanner.clear();

        if (result && result.decodedText) {
          hiddenDiv.remove();
          return {
            text: result.decodedText,
            format: result?.result?.format?.formatName || t.label
          };
        }
      } catch {
        try { tempScanner.clear(); } catch { /* ignore */ }
      }
    } catch { /* next transform */ }
  }

  if (hiddenDiv) hiddenDiv.remove();
  return null;
}
