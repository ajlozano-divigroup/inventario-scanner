/**
 * Scanner module — wraps html5-qrcode for barcode/QR scanning
 * Optimized for reading barcodes on physical labels (often blurry/small)
 * Supports: torch (flashlight), zoom, continuous autofocus, high resolution
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
 * Start the scanner with optimized settings for barcode reading
 * @param {string} elementId - The ID of the container element
 * @param {Function} onScan - Callback(decodedText, format) called on each successful scan
 * @returns {Promise<void>}
 */
export async function startScanner(elementId, onScan) {
  if (isRunning) return;

  scanCallback = onScan;
  html5Qrcode = new Html5Qrcode(elementId);

  const config = {
    fps: 20,  // Higher FPS for faster detection
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      // Larger scan area = better chance of reading
      const w = Math.floor(viewfinderWidth * 0.85);
      const h = Math.floor(viewfinderHeight * 0.5);
      return { width: w, height: h };
    },
    aspectRatio: 1.333,
    disableFlip: false,
    formatsToSupport: [
      0,  // QR_CODE
      1,  // AZTEC
      2,  // CODABAR
      3,  // CODE_39
      4,  // CODE_93
      5,  // CODE_128
      6,  // DATA_MATRIX
      7,  // ITF
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

  // Request high resolution + continuous autofocus
  const cameraConstraints = {
    facingMode: 'environment',
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    focusMode: { ideal: 'continuous' },
    // Prefer a wider aperture / higher exposure for reading labels
    exposureMode: { ideal: 'continuous' },
    whiteBalanceMode: { ideal: 'continuous' }
  };

  try {
    await html5Qrcode.start(
      cameraConstraints,
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

    // Get the video track for torch/zoom/focus
    const videoElement = document.querySelector(`#${elementId} video`);
    if (videoElement && videoElement.srcObject) {
      currentStream = videoElement.srcObject;
      // Apply advanced camera settings after stream is established
      await applyAdvancedCameraSettings();
    }
  } catch (err) {
    console.error('Error starting scanner:', err);
    throw err;
  }
}

/**
 * Apply advanced camera settings for better barcode reading:
 * - Continuous autofocus
 * - Higher resolution
 * - Continuous exposure
 */
async function applyAdvancedCameraSettings() {
  const track = getVideoTrack();
  if (!track) return;

  try {
    const capabilities = track.getCapabilities();
    const advancedConstraints = {};

    // Enable continuous autofocus if supported
    if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
      advancedConstraints.focusMode = 'continuous';
    }

    // Enable continuous exposure if supported
    if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
      advancedConstraints.exposureMode = 'continuous';
    }

    // Enable continuous white balance if supported
    if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
      advancedConstraints.whiteBalanceMode = 'continuous';
    }

    if (Object.keys(advancedConstraints).length > 0) {
      await track.applyConstraints({
        advanced: [advancedConstraints]
      });
      console.log('Advanced camera settings applied:', advancedConstraints);
    }
  } catch (err) {
    console.warn('Could not apply advanced camera settings:', err);
  }
}

/**
 * Trigger a manual focus attempt (tap-to-focus)
 * Switches focus mode to 'manual' briefly, then back to 'continuous'
 * Some devices respond to this by re-triggering autofocus
 */
export async function triggerRefocus() {
  const track = getVideoTrack();
  if (!track) return;

  try {
    const capabilities = track.getCapabilities();

    if (capabilities.focusMode) {
      // Toggle focus mode to retrigger autofocus
      if (capabilities.focusMode.includes('manual')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'manual' }]
        });
      }

      // Switch back to continuous after a brief pause
      setTimeout(async () => {
        try {
          if (capabilities.focusMode.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' }]
            });
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
