/**
 * OCR module — Read printed text from camera frames
 * Uses Tesseract.js for digit recognition on labels.
 * Only loaded on-demand (when capture button is pressed).
 */

let worker = null;

/**
 * Initialize Tesseract worker (lazy — only on first use)
 */
async function getWorker() {
  if (worker) return worker;

  const Tesseract = await import('tesseract.js');
  worker = await Tesseract.createWorker('eng', 1, {
    logger: () => {} // suppress logs
  });
  await worker.setParameters({
    // Only recognize digits — faster and more accurate for inventory labels
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7', // Treat image as a single text line
  });
  return worker;
}

/**
 * Run OCR on a video element or canvas.
 * Returns an array of detected digit sequences (sorted by length, longest first).
 * @param {HTMLVideoElement|HTMLCanvasElement} source
 * @returns {Promise<string[]>} array of digit strings found
 */
export async function recognizeDigits(source) {
  // Draw source to a preprocessed canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let sw, sh;
  if (source instanceof HTMLVideoElement) {
    sw = source.videoWidth;
    sh = source.videoHeight;
  } else {
    sw = source.width;
    sh = source.height;
  }

  // Scale down to max 800px for speed
  const maxDim = 800;
  const scale = Math.min(maxDim / sw, maxDim / sh, 1);
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  // Preprocess: grayscale + high contrast + binary threshold
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const bw = gray > 140 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = bw;
  }
  ctx.putImageData(imageData, 0, 0);

  try {
    const w = await getWorker();
    const result = await w.recognize(canvas);

    // Extract digit sequences (3+ digits)
    const text = result.data.text || '';
    const matches = text.match(/\d{3,}/g) || [];

    // Sort by length descending (prefer longer sequences)
    return matches.sort((a, b) => b.length - a.length);
  } catch (err) {
    console.error('OCR error:', err);
    return [];
  }
}

/**
 * Try OCR on a video element at multiple rotations.
 * Returns the best match (longest digit sequence) or null.
 */
export async function ocrFromVideo(videoElement) {
  if (!videoElement || videoElement.readyState < 2) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  if (!vw || !vh) return null;

  // Try original orientation first
  let results = await recognizeDigits(videoElement);
  if (results.length > 0 && results[0].length >= 4) {
    return results[0];
  }

  // Try 90° rotation (for vertical labels)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = vh;
  canvas.height = vw;
  ctx.translate(vh, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(videoElement, 0, 0, vw, vh);

  results = await recognizeDigits(canvas);
  if (results.length > 0 && results[0].length >= 4) {
    return results[0];
  }

  return null;
}
