/**
 * Scanner module — wraps html5-qrcode for barcode/QR scanning
 * Supports: torch, zoom, autofocus, vertical barcode detection via canvas rotation
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
let rotationIntervalId = null;
const DEBOUNCE_MS = 1500;

// Offscreen canvas and secondary scanner for rotation scanning
let rotationCanvas = null;
let rotationCtx = null;
let rotationScannerBusy = false;

/**
 * Start the scanner
 */
export async function startScanner(elementId, onScan) {
  if (isRunning) return;

  scanCallback = onScan;
  html5Qrcode = new Html5Qrcode(elementId);

  const config = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      return {
        width: Math.floor(viewfinderWidth * 0.9),
        height: Math.floor(viewfinderHeight * 0.6)
      };
    },
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
        handleDecode(decodedText, result);
      },
      () => { /* ignore scan failures */ }
    );

    isRunning = true;

    // Get the video track for torch/zoom/focus
    const videoElement = document.querySelector(`#${elementId} video`);
    if (videoElement && videoElement.srcObject) {
      currentStream = videoElement.srcObject;
      await applyAdvancedCameraSettings();
    }

    // Start rotation scanning for vertical barcodes
    startRotationScanning(elementId);

  } catch (err) {
    console.error('Error starting scanner:', err);
    throw err;
  }
}

/**
 * Handle a decoded barcode
 */
function handleDecode(decodedText, result) {
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
}

/**
 * Periodically grab the video frame, rotate 90°, and scan the rotated
 * image using a SEPARATE Html5Qrcode.scanFile() call (no camera access).
 * The key is: we do NOT create the secondary scanner until after the
 * primary scanner has fully started, and scanFile doesn't touch the camera.
 */
function startRotationScanning(elementId) {
  rotationCanvas = document.createElement('canvas');
  rotationCtx = rotationCanvas.getContext('2d');

  rotationIntervalId = setInterval(() => {
    if (!isRunning || rotationScannerBusy) return;
    rotationScannerBusy = true;
    scanRotatedFrame(elementId).finally(() => {
      rotationScannerBusy = false;
    });
  }, 800);
}

/**
 * Grab current video frame, rotate 90°, scan as image file
 */
async function scanRotatedFrame(elementId) {
  try {
    const videoElement = document.querySelector(`#${elementId} video`);
    if (!videoElement || videoElement.readyState < 2) return;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (!vw || !vh) return;

    // Draw rotated 90° clockwise
    rotationCanvas.width = vh;
    rotationCanvas.height = vw;
    rotationCtx.save();
    rotationCtx.translate(vh, 0);
    rotationCtx.rotate(Math.PI / 2);
    rotationCtx.drawImage(videoElement, 0, 0, vw, vh);
    rotationCtx.restore();

    // Convert to blob
    const blob = await new Promise(resolve =>
      rotationCanvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    if (!blob) return;

    const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });

    // Use the SAME html5Qrcode instance's scanFile method
    // This does NOT access the camera - it just decodes an image
    const result = await html5Qrcode.scanFileV2(file, false);
    if (result && result.decodedText) {
      handleDecode(result.decodedText, result);
    }
  } catch {
    // Expected: most frames won't contain a readable barcode
  }
}

function stopRotationScanning() {
  if (rotationIntervalId) {
    clearInterval(rotationIntervalId);
    rotationIntervalId = null;
  }
  rotationCanvas = null;
  rotationCtx = null;
  rotationScannerBusy = false;
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

  stopRotationScanning();

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
