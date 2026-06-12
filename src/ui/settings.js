/**
 * Settings module — Manage user preferences (OCR Engine, API Keys, Prompts)
 * Persisted in browser localStorage.
 */

const DEFAULT_PROMPT = 'Extrae solo la referencia alfanumérica o el código principal de inventario de esta imagen. Devuelve ÚNICAMENTE el código limpio, sin texto adicional, sin formato Markdown y sin explicaciones.';

export function getSettings() {
  return {
    engine: localStorage.getItem('ocr_engine') || 'local',
    apiKey: localStorage.getItem('gemini_api_key') || '',
    prompt: localStorage.getItem('gemini_prompt') || DEFAULT_PROMPT
  };
}

export function saveSettings({ engine, apiKey, prompt }) {
  localStorage.setItem('ocr_engine', engine || 'local');
  localStorage.setItem('gemini_api_key', apiKey || '');
  localStorage.setItem('gemini_prompt', prompt || DEFAULT_PROMPT);
}
