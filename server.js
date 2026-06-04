const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Init DB tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productos (
      id TEXT PRIMARY KEY,
      codigo TEXT,
      nombre TEXT NOT NULL,
      cat TEXT,
      stock_central NUMERIC DEFAULT 0,
      stock_cocina NUMERIC DEFAULT 0,
      stock_restaurante NUMERIC DEFAULT 0,
      minimo NUMERIC DEFAULT 0,
      unidad TEXT DEFAULT 'kg',
      proveedor TEXT,
      precio_fijo NUMERIC DEFAULT 0,
      iva INTEGER DEFAULT 10,
      notas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS proveedores (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      contacto TEXT,
      telefono TEXT,
      email TEXT,
      cat TEXT,
      notas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS albaranes (
      id TEXT PRIMARY KEY,
      fecha DATE,
      numero TEXT,
      proveedor TEXT,
      almacen TEXT DEFAULT 'central',
      lineas JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pedidos (
      id TEXT PRIMARY KEY,
      fecha DATE,
      proveedor TEXT,
      almacen TEXT DEFAULT 'central',
      estado TEXT DEFAULT 'pendiente',
      notas TEXT,
      lineas JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lotes (
      id TEXT PRIMARY KEY,
      prod_id TEXT REFERENCES productos(id) ON DELETE CASCADE,
      lote TEXT,
      almacen TEXT DEFAULT 'central',
      proveedor TEXT,
      fecha_entrada DATE,
      fecha_cad DATE,
      cantidad NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS movimientos (
      id SERIAL PRIMARY KEY,
      fecha DATE,
      producto TEXT,
      tipo TEXT,
      cant TEXT,
      desde TEXT,
      hasta TEXT,
      usuario TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS precios (
      id SERIAL PRIMARY KEY,
      fecha DATE,
      prod_id TEXT,
      producto TEXT,
      proveedor TEXT,
      albaran TEXT,
      precio NUMERIC,
      iva INTEGER DEFAULT 10,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventarios (
      id TEXT PRIMARY KEY,
      fecha DATE,
      almacen TEXT,
      lineas JSONB DEFAULT '[]',
      total_diff NUMERIC DEFAULT 0,
      total_val NUMERIC DEFAULT 0,
      usuario TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT INTO config(key,value) VALUES ('hotel','Hotel Cortijo Chico'),('cad_dias','7'),('usuario','Administrador')
    ON CONFLICT(key) DO NOTHING;
  `);
  console.log('DB ready');
}

// ===== API ROUTES =====

// CONFIG
app.get('/api/config', async (req, res) => {
  const r = await pool.query('SELECT key, value FROM config');
  const cfg = {};
  r.rows.forEach(row => cfg[row.key] = row.value);
  res.json(cfg);
});
app.post('/api/config', async (req, res) => {
  const { hotel, cad_dias, usuario } = req.body;
  await pool.query(`INSERT INTO config(key,value) VALUES ('hotel',$1),('cad_dias',$2),('usuario',$3)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [hotel, cad_dias, usuario]);
  res.json({ ok: true });
});

// PRODUCTOS
app.get('/api/productos', async (req, res) => {
  const r = await pool.query('SELECT * FROM productos ORDER BY nombre');
  res.json(r.rows.map(dbToProducto));
});
app.post('/api/productos', async (req, res) => {
  const p = req.body;
  await pool.query(`INSERT INTO productos(id,codigo,nombre,cat,stock_central,stock_cocina,stock_restaurante,minimo,unidad,proveedor,precio_fijo,iva,notas)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT(id) DO UPDATE SET codigo=$2,nombre=$3,cat=$4,stock_central=$5,stock_cocina=$6,stock_restaurante=$7,minimo=$8,unidad=$9,proveedor=$10,precio_fijo=$11,iva=$12,notas=$13`,
    [p.id,p.codigo||'',p.nombre,p.cat||'Varios',p.stockCentral||0,p.stockCocina||0,p.stockRestaurante||0,p.minimo||0,p.unidad||'kg',p.proveedor||'',p.precioFijo||0,p.iva||10,p.notas||'']);
  res.json({ ok: true });
});
app.put('/api/productos/:id/stock', async (req, res) => {
  const { almacen, cantidad } = req.body;
  const col = 'stock_' + almacen;
  await pool.query(`UPDATE productos SET ${col}=$1 WHERE id=$2`, [cantidad, req.params.id]);
  res.json({ ok: true });
});
app.delete('/api/productos/:id', async (req, res) => {
  await pool.query('DELETE FROM productos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// PROVEEDORES
app.get('/api/proveedores', async (req, res) => {
  const r = await pool.query('SELECT * FROM proveedores ORDER BY nombre');
  res.json(r.rows.map(r => ({ id: r.id, nombre: r.nombre, contacto: r.contacto, telefono: r.telefono, email: r.email, cat: r.cat, notas: r.notas })));
});
app.post('/api/proveedores', async (req, res) => {
  const p = req.body;
  await pool.query(`INSERT INTO proveedores(id,nombre,contacto,telefono,email,cat,notas) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(id) DO UPDATE SET nombre=$2,contacto=$3,telefono=$4,email=$5,cat=$6,notas=$7`,
    [p.id,p.nombre,p.contacto||'',p.telefono||'',p.email||'',p.cat||'Varios',p.notas||'']);
  res.json({ ok: true });
});
app.delete('/api/proveedores/:id', async (req, res) => {
  await pool.query('DELETE FROM proveedores WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ALBARANES
app.get('/api/albaranes', async (req, res) => {
  const r = await pool.query('SELECT * FROM albaranes ORDER BY fecha DESC, created_at DESC');
  res.json(r.rows.map(r => ({ id: r.id, fecha: r.fecha?.toISOString().split('T')[0], numero: r.numero, proveedor: r.proveedor, almacen: r.almacen, lineas: r.lineas })));
});
app.post('/api/albaranes', async (req, res) => {
  const a = req.body;
  await pool.query('INSERT INTO albaranes(id,fecha,numero,proveedor,almacen,lineas) VALUES($1,$2,$3,$4,$5,$6)',
    [a.id, a.fecha, a.numero, a.proveedor, a.almacen, JSON.stringify(a.lineas||[])]);
  res.json({ ok: true });
});
app.delete('/api/albaranes/:id', async (req, res) => {
  await pool.query('DELETE FROM albaranes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// PEDIDOS
app.get('/api/pedidos', async (req, res) => {
  const r = await pool.query('SELECT * FROM pedidos ORDER BY fecha DESC, created_at DESC');
  res.json(r.rows.map(r => ({ id: r.id, fecha: r.fecha?.toISOString().split('T')[0], proveedor: r.proveedor, almacen: r.almacen, estado: r.estado, notas: r.notas, lineas: r.lineas })));
});
app.post('/api/pedidos', async (req, res) => {
  const p = req.body;
  await pool.query('INSERT INTO pedidos(id,fecha,proveedor,almacen,estado,notas,lineas) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [p.id, p.fecha, p.proveedor, p.almacen, p.estado||'pendiente', p.notas||'', JSON.stringify(p.lineas||[])]);
  res.json({ ok: true });
});
app.put('/api/pedidos/:id', async (req, res) => {
  const p = req.body;
  await pool.query('UPDATE pedidos SET estado=$1, lineas=$2 WHERE id=$3',
    [p.estado, JSON.stringify(p.lineas||[]), req.params.id]);
  res.json({ ok: true });
});
app.delete('/api/pedidos/:id', async (req, res) => {
  await pool.query('DELETE FROM pedidos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// LOTES
app.get('/api/lotes', async (req, res) => {
  const r = await pool.query('SELECT * FROM lotes ORDER BY fecha_cad ASC');
  res.json(r.rows.map(r => ({ id: r.id, prodId: r.prod_id, lote: r.lote, almacen: r.almacen, proveedor: r.proveedor, fechaEntrada: r.fecha_entrada?.toISOString().split('T')[0], fechaCad: r.fecha_cad?.toISOString().split('T')[0], cantidad: parseFloat(r.cantidad) })));
});
app.post('/api/lotes', async (req, res) => {
  const l = req.body;
  await pool.query('INSERT INTO lotes(id,prod_id,lote,almacen,proveedor,fecha_entrada,fecha_cad,cantidad) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [l.id, l.prodId, l.lote||'', l.almacen||'central', l.proveedor||'', l.fechaEntrada, l.fechaCad||null, l.cantidad||0]);
  res.json({ ok: true });
});

// MOVIMIENTOS
app.get('/api/movimientos', async (req, res) => {
  const r = await pool.query('SELECT * FROM movimientos ORDER BY created_at DESC LIMIT 100');
  res.json(r.rows.map(r => ({ fecha: r.fecha?.toISOString().split('T')[0], producto: r.producto, tipo: r.tipo, cant: r.cant, desde: r.desde, hasta: r.hasta, usuario: r.usuario })));
});
app.post('/api/movimientos', async (req, res) => {
  const m = req.body;
  await pool.query('INSERT INTO movimientos(fecha,producto,tipo,cant,desde,hasta,usuario) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [m.fecha, m.producto, m.tipo, m.cant, m.desde||'', m.hasta||'', m.usuario||'']);
  res.json({ ok: true });
});

// PRECIOS
app.get('/api/precios', async (req, res) => {
  const r = await pool.query('SELECT * FROM precios ORDER BY fecha DESC, created_at DESC LIMIT 500');
  res.json(r.rows.map(r => ({ fecha: r.fecha?.toISOString().split('T')[0], prodId: r.prod_id, producto: r.producto, proveedor: r.proveedor, albaran: r.albaran, precio: parseFloat(r.precio), iva: r.iva })));
});
app.post('/api/precios', async (req, res) => {
  const p = req.body;
  await pool.query('INSERT INTO precios(fecha,prod_id,producto,proveedor,albaran,precio,iva) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [p.fecha, p.prodId, p.producto, p.proveedor||'', p.albaran||'', p.precio, p.iva||10]);
  res.json({ ok: true });
});

// INVENTARIOS
app.get('/api/inventarios', async (req, res) => {
  const r = await pool.query('SELECT * FROM inventarios ORDER BY fecha DESC');
  res.json(r.rows.map(r => ({ id: r.id, fecha: r.fecha?.toISOString().split('T')[0], almacen: r.almacen, lineas: r.lineas, totalDiff: parseFloat(r.total_diff), totalVal: parseFloat(r.total_val), usuario: r.usuario })));
});
app.post('/api/inventarios', async (req, res) => {
  const inv = req.body;
  await pool.query('INSERT INTO inventarios(id,fecha,almacen,lineas,total_diff,total_val,usuario) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [inv.id, inv.fecha, inv.almacen, JSON.stringify(inv.lineas||[]), inv.totalDiff||0, inv.totalVal||0, inv.usuario||'']);
  res.json({ ok: true });
});

// BUSCAR PRODUCTOS (para autocompletado)
app.get('/api/buscar/productos', async (req, res) => {
  const q = '%' + (req.query.q||'') + '%';
  const r = await pool.query('SELECT * FROM productos WHERE nombre ILIKE $1 OR codigo ILIKE $1 ORDER BY nombre LIMIT 20', [q]);
  res.json(r.rows.map(dbToProducto));
});

// BUSCAR PROVEEDORES
app.get('/api/buscar/proveedores', async (req, res) => {
  const q = '%' + (req.query.q||'') + '%';
  const r = await pool.query('SELECT * FROM proveedores WHERE nombre ILIKE $1 ORDER BY nombre LIMIT 10', [q]);
  res.json(r.rows);
});

// LEER ALBARÁN CON IA
app.post('/api/leer-albaran', upload.single('albaran'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    // Get existing products for matching
    const prodsResult = await pool.query('SELECT id, codigo, nombre, iva, precio_fijo FROM productos ORDER BY nombre');
    const catalogoJSON = JSON.stringify(prodsResult.rows.map(p => ({ id: p.id, codigo: p.codigo, nombre: p.nombre })));

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `Eres un asistente de economato de hostelería. Analiza este albarán y extrae ÚNICAMENTE un JSON válido sin texto adicional ni backticks.

Catálogo existente (intenta hacer matching por nombre o código):
${catalogoJSON}

Formato de respuesta:
{
  "proveedor": "nombre completo",
  "numero_albaran": "número",
  "fecha": "DD/MM/YYYY",
  "total": numero,
  "productos": [
    {
      "codigo": "código si aparece",
      "nombre": "descripción",
      "prod_id_match": "id del producto del catálogo si encuentras coincidencia o null",
      "lote": "lote si aparece o null",
      "fecha_caducidad": "DD/MM/YYYY si aparece o null",
      "kilos": numero_o_null,
      "unidades": numero_o_null,
      "precio_unitario": numero,
      "importe": numero
    }
  ]
}` }
        ]
      }]
    });

    const text = response.content[0].text.trim().replace(/```json|```/g, '').trim();
    const data = JSON.parse(text);

    // Enrich with DB data for matched products
    for (const p of data.productos || []) {
      if (p.prod_id_match) {
        const match = prodsResult.rows.find(r => r.id === p.prod_id_match);
        if (match) {
          p.iva_sugerido = match.iva;
          p.precio_sugerido = parseFloat(match.precio_fijo) || p.precio_unitario;
        }
      }
      // Also try to find last price
      if (p.codigo || p.nombre) {
        const lastPrice = await pool.query(
          `SELECT precio, iva FROM precios WHERE producto ILIKE $1 OR (SELECT codigo FROM productos WHERE id=prod_id) = $2 ORDER BY fecha DESC LIMIT 1`,
          ['%' + p.nombre + '%', p.codigo || '']
        );
        if (lastPrice.rows.length > 0 && !p.precio_unitario) {
          p.precio_unitario = parseFloat(lastPrice.rows[0].precio);
          p.iva_sugerido = lastPrice.rows[0].iva;
        }
      }
    }

    res.json({ ok: true, data });
  } catch (err) {
    console.error('Error leyendo albarán:', err);
    res.status(500).json({ error: 'No se pudo procesar el albarán', detail: err.message });
  }
});

// SYNC - recibe todo el estado del frontend y lo sincroniza
app.post('/api/sync', async (req, res) => {
  const { productos, proveedores, albaranes, pedidos, lotes, movimientos, precios, inventarios, config } = req.body;
  const client2 = await pool.connect();
  try {
    await client2.query('BEGIN');
    if (productos?.length) {
      for (const p of productos) {
        await client2.query(`INSERT INTO productos(id,codigo,nombre,cat,stock_central,stock_cocina,stock_restaurante,minimo,unidad,proveedor,precio_fijo,iva,notas)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT(id) DO UPDATE SET codigo=$2,nombre=$3,cat=$4,stock_central=$5,stock_cocina=$6,stock_restaurante=$7,minimo=$8,unidad=$9,proveedor=$10,precio_fijo=$11,iva=$12,notas=$13`,
          [p.id,p.codigo||'',p.nombre,p.cat||'Varios',p.stockCentral||0,p.stockCocina||0,p.stockRestaurante||0,p.minimo||0,p.unidad||'kg',p.proveedor||'',p.precioFijo||0,p.iva||10,p.notas||'']);
      }
    }
    if (proveedores?.length) {
      for (const p of proveedores) {
        await client2.query(`INSERT INTO proveedores(id,nombre,contacto,telefono,email,cat,notas) VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(id) DO UPDATE SET nombre=$2,contacto=$3,telefono=$4,email=$5,cat=$6,notas=$7`,
          [p.id,p.nombre,p.contacto||'',p.telefono||'',p.email||'',p.cat||'Varios',p.notas||'']);
      }
    }
    await client2.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client2.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client2.release();
  }
});

// LOAD ALL - carga todo para el frontend
app.get('/api/load', async (req, res) => {
  try {
    const [productos, proveedores, albaranes, pedidos, lotes, movimientos, precios, inventarios, cfg] = await Promise.all([
      pool.query('SELECT * FROM productos ORDER BY nombre'),
      pool.query('SELECT * FROM proveedores ORDER BY nombre'),
      pool.query('SELECT * FROM albaranes ORDER BY fecha DESC LIMIT 200'),
      pool.query('SELECT * FROM pedidos ORDER BY fecha DESC LIMIT 100'),
      pool.query('SELECT * FROM lotes ORDER BY fecha_cad ASC'),
      pool.query('SELECT * FROM movimientos ORDER BY created_at DESC LIMIT 200'),
      pool.query('SELECT * FROM precios ORDER BY fecha DESC LIMIT 1000'),
      pool.query('SELECT * FROM inventarios ORDER BY fecha DESC LIMIT 50'),
      pool.query('SELECT key, value FROM config'),
    ]);
    const config = {};
    cfg.rows.forEach(r => config[r.key] = r.value);
    res.json({
      productos: productos.rows.map(dbToProducto),
      proveedores: proveedores.rows.map(r => ({ id: r.id, nombre: r.nombre, contacto: r.contacto||'', telefono: r.telefono||'', email: r.email||'', cat: r.cat||'', notas: r.notas||'' })),
      albaranes: albaranes.rows.map(r => ({ id: r.id, fecha: r.fecha?.toISOString().split('T')[0], numero: r.numero, proveedor: r.proveedor, almacen: r.almacen, lineas: r.lineas })),
      pedidos: pedidos.rows.map(r => ({ id: r.id, fecha: r.fecha?.toISOString().split('T')[0], proveedor: r.proveedor, almacen: r.almacen, estado: r.estado, notas: r.notas||'', lineas: r.lineas })),
      lotes: lotes.rows.map(r => ({ id: r.id, prodId: r.prod_id, lote: r.lote||'', almacen: r.almacen, proveedor: r.proveedor||'', fechaEntrada: r.fecha_entrada?.toISOString().split('T')[0], fechaCad: r.fecha_cad?.toISOString().split('T')[0], cantidad: parseFloat(r.cantidad) })),
      movimientos: movimientos.rows.map(r => ({ fecha: r.fecha?.toISOString().split('T')[0], producto: r.producto, tipo: r.tipo, cant: r.cant, desde: r.desde||'', hasta: r.hasta||'', usuario: r.usuario||'' })),
      precios: precios.rows.map(r => ({ fecha: r.fecha?.toISOString().split('T')[0], prodId: r.prod_id, producto: r.producto, proveedor: r.proveedor||'', albaran: r.albaran||'', precio: parseFloat(r.precio), iva: r.iva })),
      inventarios: inventarios.rows.map(r => ({ id: r.id, fecha: r.fecha?.toISOString().split('T')[0], almacen: r.almacen, lineas: r.lineas, totalDiff: parseFloat(r.total_diff), totalVal: parseFloat(r.total_val), usuario: r.usuario||'' })),
      config: { hotel: config.hotel||'Hotel Cortijo Chico', cadDias: parseInt(config.cad_dias)||7, usuario: config.usuario||'Administrador' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function dbToProducto(r) {
  return { id: r.id, codigo: r.codigo||'', nombre: r.nombre, cat: r.cat||'', stockCentral: parseFloat(r.stock_central)||0, stockCocina: parseFloat(r.stock_cocina)||0, stockRestaurante: parseFloat(r.stock_restaurante)||0, minimo: parseFloat(r.minimo)||0, unidad: r.unidad||'kg', proveedor: r.proveedor||'', precioFijo: parseFloat(r.precio_fijo)||0, iva: r.iva||10, notas: r.notas||'' };
}

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`Economato server on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
