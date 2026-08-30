// Banco visual: captura todas las vistas con las teselas cacheadas y las
// compara con la referencia. Un cambio en el visor se juzga mirando la hoja de
// contactos, no desplegando a producción.
//
//   npm run vistas            captura y compara con la referencia
//   npm run vistas -- --base  acepta lo capturado COMO nueva referencia
//   npm run vistas -- --solo ras-de-tejados     una sola vista
//
// La app tiene que estar servida (npm run dev). Ojo: `next start` NO sirve bien
// este proyecto porque next.config.js usa output:'standalone'.
//
// Variables: URL_BANCO (por defecto http://localhost:3000) y CHROMIUM_BIN
// (para usar un Chromium ya instalado en vez del de Playwright).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { VISTAS, Z, DIR_TESELAS, DIR_CAPTURAS, ANCHO, ALTO } from './vistas.config.mjs';

const args = process.argv.slice(2);
const esBase = args.includes('--base');
const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null;
const URL_APP = process.env.URL_BANCO || 'http://localhost:3000';

const dirTeselas = path.resolve(DIR_TESELAS);
const dirBase = path.join(path.resolve(DIR_CAPTURAS), 'base');
const dirAhora = path.join(path.resolve(DIR_CAPTURAS), 'ahora');
const dirDiff = path.join(path.resolve(DIR_CAPTURAS), 'diff');
for (const d of [dirBase, dirAhora, dirDiff]) fs.mkdirSync(d, { recursive: true });

if (!fs.existsSync(dirTeselas) || !fs.readdirSync(dirTeselas).length) {
  console.error(`No hay teselas en ${DIR_TESELAS}/. Ejecuta primero:  npm run teselas`);
  process.exit(1);
}
try {
  const r = await fetch(URL_APP, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
} catch (e) {
  console.error(`No responde ${URL_APP} (${e.message}).  Arranca la app:  npm run dev`);
  process.exit(1);
}

const vistas = solo ? VISTAS.filter((v) => v.id === solo) : VISTAS;
if (!vistas.length) {
  console.error(`No existe la vista «${solo}». Hay: ${VISTAS.map((v) => v.id).join(', ')}`);
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch({
    // CHROMIUM_BIN permite usar un Chromium ya instalado (contenedores, CI)
    // en vez del que se baja Playwright
    executablePath: process.env.CHROMIUM_BIN || undefined,
    args: [
      // sin GPU real (CI, contenedores) Chromium no da WebGL sin esto
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
  });
} catch (e) {
  console.error(`No se pudo abrir Chromium: ${e.message.split('\n')[0]}`);
  console.error('  · en tu máquina:   npx playwright install chromium');
  console.error('  · si ya tienes uno: CHROMIUM_BIN=/ruta/a/chrome npm run vistas');
  process.exit(1);
}
const page = await browser.newPage({ viewport: { width: ANCHO, height: ALTO } });

const problemas = [];
page.on('pageerror', (e) => problemas.push('error de página: ' + e.message.slice(0, 160)));
page.on('console', (m) => {
  if (m.type() === 'error') problemas.push('consola: ' + m.text().slice(0, 160));
});

// Las teselas salen del disco: ni red, ni CDN, ni sorpresas entre ejecuciones.
let sinCache = 0;
await page.route('**tiles.openfreemap.org/**', (route) => {
  const u = route.request().url();
  if (u.endsWith('/planet')) {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tilejson: '3.0.0',
        tiles: ['https://tiles.openfreemap.org/planet/local/{z}/{x}/{y}.pbf'],
      }),
    });
  }
  const m = u.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  const f = m && path.join(dirTeselas, `${m[2]}-${m[3]}.pbf`);
  if (f && fs.existsSync(f)) {
    return route.fulfill({
      contentType: 'application/vnd.mapbox-vector-tile',
      body: fs.readFileSync(f),
    });
  }
  sinCache++;
  problemas.push(`tesela sin cachear: ${m ? m[2] + '-' + m[3] : u.slice(-24)} (sube RADIO_TESELAS y relanza npm run teselas)`);
  return route.fulfill({ status: 404, body: '' });
});

// % de píxeles distintos + imagen de diferencias, calculado en el propio
// navegador con data: URLs (no ensucian el canvas, así que se puede leer)
async function compara(pngA, pngB) {
  return page.evaluate(
    async ([a, b]) => {
      const carga = (d) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = 'data:image/png;base64,' + d;
        });
      const [ia, ib] = await Promise.all([carga(a), carga(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { pct: 100, diff: null };
      const w = ia.width;
      const h = ia.height;
      const lienzo = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.getContext('2d').getImageData(0, 0, w, h).data;
      };
      const da = lienzo(ia);
      const db = lienzo(ib);
      const salida = document.createElement('canvas');
      salida.width = w;
      salida.height = h;
      const ctx = salida.getContext('2d');
      const out = ctx.createImageData(w, h);
      let distintos = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > 24) {
          distintos++;
          out.data[i] = 235;
          out.data[i + 1] = 30;
          out.data[i + 2] = 90;
          out.data[i + 3] = 255;
        } else {
          // lo que no cambia queda de fondo, muy claro, para situarse
          const g = 235 - (255 - da[i]) * 0.12;
          out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
          out.data[i + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      return {
        pct: (distintos / (w * h)) * 100,
        diff: salida.toDataURL('image/png').split(',')[1],
      };
    },
    [pngA.toString('base64'), pngB.toString('base64')]
  );
}

// El estado se guarda para que `--solo` no vacíe la hoja de contactos: las
// vistas que no se han vuelto a capturar siguen apareciendo con su último dato.
const fEstado = path.join(path.resolve(DIR_CAPTURAS), 'estado.json');
let estado = {};
try {
  estado = JSON.parse(fs.readFileSync(fEstado, 'utf8'));
} catch {
  /* primera ejecución */
}

for (const v of vistas) {
  const q = `?lat=${v.lat}&lng=${v.lng}&d=${v.d}&pol=${v.pol}&az=${v.az}`;
  process.stdout.write(`${v.id.padEnd(20)} `);
  await page.goto(URL_APP + '/' + q, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#lienzo', { timeout: 30000 });

  // esperar a que la escena esté COMPLETA y siga estándolo (asegura() puede
  // arrancar teselas nuevas justo después)
  let estable = false;
  for (let intento = 0; intento < 40 && !estable; intento++) {
    await page.waitForFunction(() => window.__mapaListo === true, { timeout: 120000 });
    await page.waitForTimeout(900);
    estable = await page.evaluate(() => window.__mapaListo === true);
  }
  // dos frames más, para que lo último construido llegue a pintarse
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );

  const png = await page.screenshot();
  fs.writeFileSync(path.join(dirAhora, v.id + '.png'), png);

  const fBase = path.join(dirBase, v.id + '.png');
  let pct = null;
  if (esBase || !fs.existsSync(fBase)) {
    fs.writeFileSync(fBase, png);
    console.log(esBase ? 'referencia actualizada' : 'referencia creada (primera vez)');
  } else {
    const r = await compara(fs.readFileSync(fBase), png);
    pct = r.pct;
    if (r.diff) fs.writeFileSync(path.join(dirDiff, v.id + '.png'), Buffer.from(r.diff, 'base64'));
    console.log(pct < 0.05 ? 'igual' : `${pct.toFixed(2)}% de píxeles distintos`);
  }
  estado[v.id] = { pct, cuando: Date.now() };
}
fs.writeFileSync(fEstado, JSON.stringify(estado, null, 2));

// la hoja lista SIEMPRE todas las vistas que tengan captura, se hayan
// refrescado ahora o no
const ahoraIds = new Set(vistas.map((v) => v.id));
const filas = VISTAS.filter((v) => fs.existsSync(path.join(dirAhora, v.id + '.png'))).map((v) => ({
  ...v,
  pct: estado[v.id]?.pct ?? null,
  fresca: ahoraIds.has(v.id),
}));

// hoja de contactos
const html = `<!doctype html><meta charset="utf-8"><title>Banco visual — maps-crisrr</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 28px; background: #f6f7f9; color: #1d2530; }
  @media (prefers-color-scheme: dark) { body { background: #14171c; color: #e6e9ee; } .v { background: #1c2027; } }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .sub { color: #6b7684; margin: 0 0 24px; }
  .v { background: #fff; border-radius: 12px; padding: 16px 18px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.09); }
  .cab { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .id { font-weight: 700; font-size: 15px; }
  .desc { color: #6b7684; font-size: 12.5px; flex: 1 1 320px; }
  .pct { font-weight: 700; font-variant-numeric: tabular-nums; padding: 2px 9px; border-radius: 99px; font-size: 12px; }
  .ok { background: #dff3e4; color: #1d6b38; }
  .cambio { background: #fde4ec; color: #a3184b; }
  .vieja { background: #eceef1; color: #6b7684; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 12px; }
  figure { margin: 0; }
  figcaption { font-size: 11.5px; color: #6b7684; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .6px; }
  img { width: 100%; display: block; border-radius: 7px; border: 1px solid rgba(128,128,128,.25); }
</style>
<h1>Banco visual — maps-crisrr</h1>
<p class="sub">${new Date().toLocaleString('es-ES')} · ${filas.length} vistas (${filas.filter((f) => f.fresca).length} recapturadas) · teselas desde <code>${DIR_TESELAS}/</code> (z${Z}, sin red)</p>
${filas
  .map(
    (f) => `<div class="v">
  <div class="cab">
    <span class="id">${f.id}</span>
    ${f.pct == null ? '<span class="pct ok">referencia</span>' : f.pct < 0.05 ? '<span class="pct ok">igual</span>' : `<span class="pct cambio">${f.pct.toFixed(2)}% distinto</span>`}
    ${f.fresca ? '' : '<span class="pct vieja">no recapturada</span>'}
    <span class="desc">${f.desc}</span>
  </div>
  <div class="grid">
    <figure><figcaption>referencia</figcaption><img src="base/${f.id}.png" alt=""></figure>
    <figure><figcaption>ahora</figcaption><img src="ahora/${f.id}.png" alt=""></figure>
    ${f.pct != null && f.pct >= 0.05 ? `<figure><figcaption>diferencias</figcaption><img src="diff/${f.id}.png" alt=""></figure>` : ''}
  </div>
</div>`
  )
  .join('\n')}`;
fs.writeFileSync(path.join(path.resolve(DIR_CAPTURAS), 'index.html'), html);

await browser.close();

console.log(`\nHoja de contactos: ${DIR_CAPTURAS}/index.html`);
if (sinCache) console.log(`⚠ ${sinCache} peticiones de teselas sin cachear: las capturas tienen huecos.`);
const unicos = [...new Set(problemas)];
if (unicos.length) {
  console.log('\nProblemas detectados:');
  for (const p of unicos.slice(0, 10)) console.log('  · ' + p);
  process.exitCode = 1;
} else {
  console.log('Sin errores de consola.');
}
