/**
 * OCR module — Read printed text from camera frames
 * Uses Tesseract.js for digit recognition on labels.
 * Only loaded on-demand (when capture/OCR button is pressed).
 */

import { getSettings } from '../ui/settings.js';
import { ocrWithGemini } from './gemini.js';

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
    tessjs_create_hocr: '0',
    tessjs_create_tsv: '0',
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
 * Preprocess a canvas in-place using Grayscale + Contrast Boost.
 * This ensures smooth edges and helps Tesseract's internal binarizer read digits correctly.
 */
function preprocessCanvas(canvas, ctx) {
  const w = canvas.width;
  const h = canvas.height;
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
 * Try OCR on a video element by scaling the full frame, preprocessing it once,
 * and recognizing it at all 4 rotations (using Canvas 2D translation and rotation).
 * Returns the best match (longest digit sequence of 3+ chars) or null.
 */
export async function ocrFromVideo(videoElement) {
  if (!videoElement || videoElement.readyState < 2) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  if (!vw || !vh) return null;

  const settings = getSettings();
  if (settings.engine === 'gemini') {
    if (!settings.apiKey) {
      throw new Error('API Key de Gemini no configurada. Por favor, configúrala en Ajustes.');
    }
    return ocrWithGemini(videoElement, settings.apiKey, settings.prompt);
  }

  // Scale down for speed (max 640px on longest side)
  const maxDim = 640;
  const scale = Math.min(maxDim / Math.max(vw, vh), 1);
  const sw = Math.round(vw * scale);
  const sh = Math.round(vh * scale);

  // 1. Create a temporary canvas to hold the full frame
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  
  // Draw the full frame from videoElement
  tempCtx.drawImage(videoElement, 0, 0, sw, sh);

  // 2. Preprocess the frame ONCE (Grayscale + Contrast Boost)
  preprocessCanvas(tempCanvas, tempCtx);

  // 3. Try all 4 rotations: the label text might be at any angle
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

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
    // Draw preprocessed frame with rotation (respects context transforms)
    ctx.drawImage(tempCanvas, 0, 0, sw, sh);
    ctx.restore();

    const results = await recognizeFromCanvas(canvas);
    if (results.length > 0 && results[0].length >= 3) {
      console.log(`OCR found "${results[0]}" at ${rot.angle}°`);
      return results[0];
    }
  }

  return null;
}
