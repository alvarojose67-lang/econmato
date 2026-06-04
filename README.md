# Economato — Hotel Cortijo Chico

Sistema de gestión de economato con lectura automática de albaranes por IA.

## Funcionalidades
- Panel con alertas de stock y caducidades
- Catálogo de productos con stock mínimo
- Lector de albaranes con IA (foto → datos automáticos)
- Entrada manual de mercancía
- Gestión de lotes y fechas de caducidad
- Pedido semanal automático por proveedor
- Directorio de proveedores
- Historial de precios por artículo y proveedor

---

## Despliegue en Railway (paso a paso)

### 1. Subir el código a GitHub
1. Ve a https://github.com/new y crea un repositorio nuevo (ej: `economato-hotel`)
2. En tu ordenador, instala Git si no lo tienes: https://git-scm.com
3. Abre terminal en la carpeta del proyecto y ejecuta:
```
git init
git add .
git commit -m "primer commit"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/economato-hotel.git
git push -u origin main
```

### 2. Crear proyecto en Railway
1. Ve a https://railway.app y regístrate con tu cuenta de GitHub
2. Clic en **"New Project"**
3. Elige **"Deploy from GitHub repo"**
4. Selecciona el repositorio `economato-hotel`
5. Railway detecta automáticamente que es Node.js y lo despliega

### 3. Añadir la API key de Anthropic
1. En Railway, ve a tu proyecto → pestaña **"Variables"**
2. Clic en **"New Variable"**
3. Nombre: `ANTHROPIC_API_KEY`
4. Valor: tu API key (la encuentras en https://console.anthropic.com)
5. Guarda — Railway reinicia el servidor automáticamente

### 4. Acceder a la app
- Railway te da una URL pública tipo: `https://economato-hotel-production.up.railway.app`
- Esa es tu app, accesible desde cualquier dispositivo

---

## Obtener API key de Anthropic
1. Ve a https://console.anthropic.com
2. Regístrate o inicia sesión
3. Ve a **"API Keys"** → **"Create Key"**
4. Copia la clave y pégala en Railway como `ANTHROPIC_API_KEY`

---

## Uso local (opcional)
```bash
npm install
ANTHROPIC_API_KEY=tu_clave node server.js
```
Luego abre http://localhost:3000
