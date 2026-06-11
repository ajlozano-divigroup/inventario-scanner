# Inventario 2.0 — Escáner

Aplicación web móvil SPA optimizada para el conteo, control y verificación de inventario físico mediante escaneo de códigos de barra/QR o reconocimiento óptico de caracteres (OCR).

## Características principales

- **Importación y mapeo de Excel**: Permite cargar inventarios desde archivos `.xlsx` / `.xls` mapeando la columna de referencia y realizando limpieza automática.
- **Escáner integrado**: Detección de códigos de barra y códigos QR con `html5-qrcode` y fallback manual de captura multi-ángulo.
- **Reconocimiento Óptico (OCR)**: Lector de texto e identificadores numéricos de etiquetas con `tesseract.js`.
- **Resultados en tiempo real**: Clasificación automática de ítems en Encontrados, Pendientes y No reconocidos con barra de progreso.
- **Exportación de reportes**: Genera un archivo consolidado en Excel con las discrepancias detectadas.
- **Persistencia local**: Todos los datos se guardan de forma local en el navegador usando `IndexedDB`.

---

## Mejoras de Reconocimiento OCR de Números Escritos a Mano

Se implementaron las siguientes mejoras técnicas para aumentar significativamente la precisión y velocidad del escaneo de números manuscritos (bolígrafo, rotulador, etc.) en etiquetas:

1. **Binarización Adaptativa (Algoritmo de Bradley-Roth)**:
   - Se reemplazó el procesamiento de contraste estático por una binarización dinámica basada en una ventana local (1/8 del ancho de la imagen) con integral 2D.
   - Elimina sombras de iluminación irregular (como las producidas al sostener el móvil) y aísla los trazos oscuros sobre fondos claros, asegurando un contraste óptimo.
2. **Ajuste de Segmentación de Página (PSM 7)**:
   - Se reconfiguró Tesseract.js de `PSM 6` (bloque de texto) a `PSM 7` (línea única de texto).
   - Esto evita que el motor intente agrupar o detectar diseños estructurados complejos en el lienzo, centrándose exclusivamente en secuencias de dígitos individuales continuas.
3. **Desactivación de Salidas Innecesarias**:
   - Se configuraron los parámetros `tessjs_create_hocr: '0'` y `tessjs_create_tsv: '0'` para agilizar el proceso y reducir el consumo de CPU.

### Mejoras Futuras Identificadas
- **Modelo MNIST con TensorFlow.js**: Para lectura exclusiva de dígitos manuscritos individuales aislados, un modelo liviano en TensorFlow.js puede ser integrado localmente para mayor velocidad (< 100ms) y precisión libre de Tesseract.
- **Servicio Cloud**: Integrar la API de Google Cloud Vision para obtener 100% de precisión bajo cualquier tipografía y deformación (requiere conexión activa).
