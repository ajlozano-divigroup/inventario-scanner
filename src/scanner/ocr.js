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
    // PSM 7: Treat the image as a single text line (excellent for tags/labels)
    tessedit_pageseg_mode: '7',
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
 * Preprocess a canvas in-place using Bradley-Roth Adaptive Thresholding.
 * This binarizes the image adaptively to eliminate shadows, highlight handwritten strokes,
 * and provide a clean black-and-white image to Tesseract.
 */
function preprocessCanvas(canvas, ctx) {
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1. Calculate grayscale values
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // 2. Compute 2D Integral Image (Summed-Area Table)
  const intImg = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      sum += gray[idx];
      if (y === 0) {
        intImg[idx] = sum;
      } else {
        intImg[idx] = intImg[(y - 1) * w + x] + sum;
      }
    }
  }

  // 3. Bradley-Roth Adaptive Thresholding
  const S = Math.round(w / 8); // Window size (typically 1/8 of image width)
  const T = 15; // Threshold percentage
  const s2 = Math.round(S / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;

      // Determine local window boundaries
      const x1 = Math.max(0, x - s2);
      const x2 = Math.min(w - 1, x + s2);
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(h - 1, y + s2);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      // Sum values inside the S x S window using integral image
      let sum = intImg[y2 * w + x2];
      if (x1 > 0) {
        sum -= intImg[y2 * w + (x1 - 1)];
      }
      if (y1 > 0) {
        sum -= intImg[(y1 - 1) * w + x2];
      }
      if (x1 > 0 && y1 > 0) {
        sum += intImg[(y1 - 1) * w + (x1 - 1)];
      }

      // Check if local pixel is significantly darker than the average of its neighbors
      const value = gray[idx];
      const isDarker = (value * count * 100) < (sum * (100 - T));
      const binarized = isDarker ? 0 : 255;

      const dataIdx = idx * 4;
      data[dataIdx] = binarized;
      data[dataIdx + 1] = binarized;
      data[dataIdx + 2] = binarized;
      // data[dataIdx + 3] remains unchanged (alpha channel)
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Try OCR on a video element by cropping the central viewport area,
 * binarizing it adaptively, and recognizing it at all 4 rotations.
 * Returns the best match (longest digit sequence of 3+ chars) or null.
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

  // Define crop bounds in scaled coordinate system (Focus on the central scanning box)
  const cropW = Math.round(sw * 0.70);
  const cropH = Math.round(sh * 0.45);
  const cropX = Math.round((sw - cropW) / 2);
  const cropY = Math.round((sh - cropH) / 2);

  // 1. Create a temporary canvas to hold the cropped frame
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cropW;
  tempCanvas.height = cropH;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  
  // Draw the cropped center from videoElement
  tempCtx.drawImage(
    videoElement,
    Math.round(cropX / scale),
    Math.round(cropY / scale),
    Math.round(cropW / scale),
    Math.round(cropH / scale),
    0,
    0,
    cropW,
    cropH
  );

  // 2. Preprocess the cropped frame ONCE (Grayscale + Bradley-Roth Adaptive Thresholding)
  preprocessCanvas(tempCanvas, tempCtx);

  // 3. Try all 4 rotations: the label text might be at any angle (drawn properly using drawImage)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const rotations = [
    { angle: 0, w: cropW, h: cropH },
    { angle: 90, w: cropH, h: cropW },
    { angle: 270, w: cropH, h: cropW },
    { angle: 180, w: cropW, h: cropH },
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
    ctx.drawImage(tempCanvas, 0, 0, cropW, cropH);
    ctx.restore();

    const results = await recognizeFromCanvas(canvas);
    if (results.length > 0 && results[0].length >= 3) {
      console.log(`OCR found "${results[0]}" at ${rot.angle}°`);
      return results[0];
    }
  }

  return null;
}
