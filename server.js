const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Leer albarán con IA
app.post('/api/leer-albaran', upload.single('albaran'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          },
          {
            type: 'text',
            text: `Eres un asistente de economato de hostelería. Analiza este albarán de venta y extrae ÚNICAMENTE un JSON válido sin texto adicional, sin backticks, sin explicaciones.

Formato exacto:
{
  "proveedor": "nombre completo del proveedor",
  "numero_albaran": "número de albarán",
  "fecha": "fecha en formato DD/MM/YYYY",
  "total": numero_sin_simbolo,
  "productos": [
    {
      "codigo": "código artículo si aparece",
      "nombre": "descripción del artículo",
      "lote": "número de lote si aparece",
      "fecha_caducidad": "DD/MM/YYYY si aparece",
      "kilos": numero_o_null,
      "unidades": numero_o_null,
      "precio_unitario": numero,
      "importe": numero
    }
  ]
}

Extrae todos los productos que veas. Para campos no visibles usa null.`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('Error leyendo albarán:', err);
    res.status(500).json({ error: 'No se pudo procesar el albarán', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Economato server running on port ${PORT}`));
