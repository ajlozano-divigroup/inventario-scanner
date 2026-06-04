/**
 * Scanner module — wraps html5-qrcode for barcode/QR scanning
 * Supports: torch, zoom, autofocus, vertical barcode rotation scan
 */
import { Html5Qrcode } from 'html5-qrcode';

let html5Qrcode = null;
let rotationScanner = null; // Secondary scanner for rotated frames
let currentStream = null;
let torchEnabled = false;
let currentZoom = 1;
let scanCallback = null;
let isRunning = false;
let lastScannedCode = '';
let lastScanTime = 0;
let rotationIntervalId = null;
const DEBOUNCE_MS = 1500;

/**
 * Start the scanner
 * @param {string} elementId - The ID of the container element
 * @param {Function} onScan - Callback(decodedText, format) called on each successful scan
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
    // Let ZXing try ALL barcode formats automatically
    experimentalFeatures: {
      // Force ZXing JS decoder (more reliable for short barcodes)
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
 * Handle a decoded barcode (from either normal or rotation scan)
 */
function handleDecode(decodedText, result) {
  const now = Date.now();
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
}

/**
 * Start periodic rotation scanning to detect vertical barcodes.
 * Every 500ms, grabs the video frame, rotates it 90°, and scans
 * the rotated image with a separate Html5Qrcode instance.
 */
function startRotationScanning(elementId) {
  // Create an offscreen canvas for rotation
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Create secondary scanner instance for file scanning
  rotationScanner = new Html5Qrcode('__rotation_scanner__', /* verbose= */ false);

  // Create a hidden container for the secondary scanner
  let hiddenDiv = document.getElementById('__rotation_scanner__');
  if (!hiddenDiv) {
    hiddenDiv = document.createElement('div');
    hiddenDiv.id = '__rotation_scanner__';
    hiddenDiv.style.display = 'none';
    document.body.appendChild(hiddenDiv);
  }

  rotationIntervalId = setInterval(async () => {
    if (!isRunning) return;

    try {
      const videoElement = document.querySelector(`#${elementId} video`);
      if (!videoElement || videoElement.readyState < 2) return;

      const vw = videoElement.videoWidth;
      const vh = videoElement.videoHeight;
      if (!vw || !vh) return;

      // Draw video frame rotated 90° clockwise
      canvas.width = vh;
      canvas.height = vw;
      ctx.save();
      ctx.translate(vh, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(videoElement, 0, 0, vw, vh);
      ctx.restore();

      // Convert canvas to blob and scan
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) return;

      const file = new File([blob], 'rotated.jpg', { type: 'image/jpeg' });

      const decoded = await rotationScanner.scanFileV2(file, /* showImage= */ false);
      if (decoded && decoded.decodedText) {
        handleDecode(decoded.decodedText, decoded);
      }
    } catch {
      // Scan failures are normal (no barcode found in rotated frame)
    }
  }, 600); // Scan rotated frame every 600ms
}

/**
 * Stop rotation scanning
 */
function stopRotationScanning() {
  if (rotationIntervalId) {
    clearInterval(rotationIntervalId);
    rotationIntervalId = null;
  }
  if (rotationScanner) {
    rotationScanner.clear();
    rotationScanner = null;
  }
  const hiddenDiv = document.getElementById('__rotation_scanner__');
  if (hiddenDiv) hiddenDiv.remove();
}

/**
 * Apply advanced camera settings (autofocus, exposure)
 */
async function applyAdvancedCameraSettings() {
  const track = getVideoTrack();
  if (!track) return;

  try {
    const capabilities = track.getCapabilities();
    const advancedConstraints = {};

    if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
      advancedConstraints.focusMode = 'continuous';
    }
    if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
      advancedConstraints.exposureMode = 'continuous';
    }
    if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
      advancedConstraints.whiteBalanceMode = 'continuous';
    }

    if (Object.keys(advancedConstraints).length > 0) {
      await track.applyConstraints({ advanced: [advancedConstraints] });
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
  } catch (err) {
    console.warn('Refocus failed:', err);
  }
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

/**
 * Toggle the torch (flashlight)
 */
export async function toggleTorch() {
  const track = getVideoTrack();
  if (!track) return false;

  try {
    const capabilities = track.getCapabilities();
    if (!capabilities.torch) return false;

    torchEnabled = !torchEnabled;
    await track.applyConstraints({ advanced: [{ torch: torchEnabled }] });
    return torchEnabled;
  } catch (err) {
    console.error('Error toggling torch:', err);
    return false;
  }
}

/**
 * Check if torch is supported
 */
export function isTorchSupported() {
  const track = getVideoTrack();
  if (!track) return false;
  try {
    return !!track.getCapabilities().torch;
  } catch {
    return false;
  }
}

/**
 * Set camera zoom level
 */
export async function setZoom(zoomLevel) {
  const track = getVideoTrack();
  if (!track) return false;

  try {
    const capabilities = track.getCapabilities();
    if (!capabilities.zoom) return false;

    const { min, max } = capabilities.zoom;
    currentZoom = Math.min(Math.max(zoomLevel, min), max);
    await track.applyConstraints({ advanced: [{ zoom: currentZoom }] });
    return true;
  } catch (err) {
    console.error('Error setting zoom:', err);
    return false;
  }
}

/**
 * Get zoom capabilities
 */
export function getZoomCapabilities() {
  const track = getVideoTrack();
  if (!track) return null;
  try {
    const caps = track.getCapabilities();
    if (!caps.zoom) return null;
    return {
      min: caps.zoom.min || 1,
      max: caps.zoom.max || 5,
      step: caps.zoom.step || 0.1
    };
  } catch {
    return null;
  }
}

function getVideoTrack() {
  if (!currentStream) return null;
  const tracks = currentStream.getVideoTracks();
  return tracks.length > 0 ? tracks[0] : null;
}

export function isScannerRunning() { return isRunning; }
export function isTorchEnabled() { return torchEnabled; }
export function getCurrentZoom() { return currentZoom; }
