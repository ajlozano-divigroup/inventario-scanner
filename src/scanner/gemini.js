/**
 * Gemini OCR module — Send video frame to Gemini 1.5 Flash API
 * Handles base64 conversion and JSON post requests.
 */

export async function ocrWithGemini(videoElement, apiKey, prompt) {
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
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, sw, sh);

  try {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return null;

    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 30
        }
      })
    });

    if (!response.ok) {
      let errorMessage = `Error de API (${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson.error && errorJson.error.message) {
          if (errorJson.error.message.includes('API key not valid')) {
            errorMessage = 'La API Key de Gemini no es válida. Por favor, verifícala en Ajustes.';
          } else {
            errorMessage = errorJson.error.message;
          }
        }
      } catch {
        const text = await response.text();
        if (text) errorMessage = `${errorMessage}: ${text}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Clean up Gemini output (remove markdown tags, spaces, quotes, newlines)
    const cleanText = rawText.replace(/[\`\*\s\r\n\'\u201c\u201d]/g, '').trim();
    return cleanText || null;
  } catch (err) {
    console.error('Gemini OCR failed:', err);
    throw err;
  }
}
