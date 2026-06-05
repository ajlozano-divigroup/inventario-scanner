/**
 * OCR module — Read printed text from camera frames
 * Uses Tesseract.js for digit recognition on labels.
 * Only loaded on-demand (when capture/OCR button is pressed).
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
    // PSM 6: Assume uniform block of text (works better than single line for labels)
    tessedit_pageseg_mode: '6',
  });
  return worker;
}

/**
 * Run OCR on a canvas or image source.
 * Returns an array of detected digit sequences (3+ digits, sorted longest first).
 */
async function recognizeFromCanvas(canvas) {
  try {
    const w = await getWorker();
    const result = await w.recognize(canvas);
    const text = result.data.text || '';
    // Extract digit sequences of 3+ digits
    const matches = text.match(/\d{3,}/g) || [];
    return matches.sort((a, b) => b.length - a.length);
  } catch (err) {
    console.error('OCR error:', err);
    return [];
  }
}

/**
 * Preprocess a video frame for OCR: grayscale only (no binary threshold).
 * Binary threshold can destroy thin characters at low resolution.
 */
function drawPreprocessed(ctx, source, w, h) {
  ctx.drawImage(source, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Simple grayscale + mild contrast boost
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
    data[i] = data[i + 1] = data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Try OCR on a video element at ALL 4 rotations.
 * Returns the best match (longest digit sequence of 4+ chars) or null.
 */
export async function ocrFromVideo(videoElement) {
  if (!videoElement || videoElement.readyState < 2) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  if (!vw || !vh) return null;

  // Scale down for speed (max 640px on longest side)
  const maxDim = 640;
  const scale = Math.min(maxDim / Math.max(vw, vh), 1);
  const sw = Math.round(vw * scale);
  const sh = Math.round(vh * scale);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Try all 4 rotations: the label text might be at any angle
  const rotations = [
    { angle: 0, w: sw, h: sh },
    { angle: 90, w: sh, h: sw },
    { angle: 270, w: sh, h: sw },
    { angle: 180, w: sw, h: sh },
  ];

  for (const rot of rotations) {
    canvas.width = rot.w;
    canvas.height = rot.h;

    ctx.save();
    if (rot.angle === 90) {
      ctx.translate(rot.w, 0);
      ctx.rotate(Math.PI / 2);
    } else if (rot.angle === 180) {
      ctx.translate(rot.w, rot.h);
      ctx.rotate(Math.PI);
    } else if (rot.angle === 270) {
      ctx.translate(0, rot.h);
      ctx.rotate(-Math.PI / 2);
    }
    drawPreprocessed(ctx, videoElement, sw, sh);
    ctx.restore();

    const results = await recognizeFromCanvas(canvas);
    if (results.length > 0 && results[0].length >= 4) {
      console.log(`OCR found "${results[0]}" at ${rot.angle}°`);
      return results[0];
    }
  }

  return null;
}
