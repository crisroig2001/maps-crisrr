// Banco visual: captura todas las vistas y las compara con la referencia. Un
// cambio en el visor se juzga mirando la hoja de contactos, no desplegando.
//
//   npm run vistas            captura y compara con la referencia
//   npm run vistas -- --base  acepta lo capturado COMO nueva referencia
//   npm run vistas -- --solo casa-de-muestra     una sola vista
//
// La app tiene que estar servida (npm run dev) con el almacén de semilla: el
// banco mira la plaza y la casa de muestra, así que un .data/ con parcelas de
// pruebas encima cambia las capturas. Ojo: `next start` NO sirve bien este
// proyecto porque next.config.js usa output:'standalone'.
//
// Variables: URL_BANCO (por defecto http://localhost:3000) y CHROMIUM_BIN
// (para usar un Chromium ya instalado en vez del de Playwright).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { VISTAS, DIR_CAPTURAS, ANCHO, ALTO } from './vistas.config.mjs';

const args = process.argv.slice(2);
const esBase = args.includes('--base');
const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null;
const URL_APP = process.env.URL_BANCO || 'http://localhost:3000';
// El segundo del mundo en el que se captura. Con el reloj congelado (`?t=`)
// la hierba, las copas, el agua, las sombras de nube, los cúmulos y los
// pájaros están SIEMPRE en la misma posición, así que dos pasadas seguidas
// dan la misma imagen y el porcentaje vuelve a significar algo. Una vista
// puede pedir otro segundo con `t` en vistas.config.mjs.
const T_MUNDO = 12;
// Con el reloj quieto lo que queda es ruido de compresión y de rasterizado,
// que vive por debajo del 0,01 %: se puede apretar el umbral 5 veces.
const UMBRAL = 0.01;
// `--estricto` hace que el banco FALLE (exitCode 1) si alguna vista se mueve.
// Sin él solo informa, que es lo que se quiere mientras se está iterando.
const estricto = args.includes('--estricto');

const dirBase = path.join(path.resolve(DIR_CAPTURAS), 'base');
const dirAhora = path.join(path.resolve(DIR_CAPTURAS), 'ahora');
const dirDiff = path.join(path.resolve(DIR_CAPTURAS), 'diff');
for (const d of [dirBase, dirAhora, dirDiff]) fs.mkdirSync(d, { recursive: true });

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
    executablePath: process.env.CHROMIUM_BIN || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
} catch (e) {
  console.error(`No se pudo abrir Chromium: ${e.message.split('\n')[0]}`);
  console.error('  · en tu máquina:   npx playwright install chromium');
  console.error('  · si ya tienes uno: CHROMIUM_BIN=/ruta/a/chrome npm run vistas');
  process.exit(1);
}
const ctx = await browser.newContext({ viewport: { width: ANCHO, height: ALTO } });
// El banco ya «se ha presentado»: un perfil fijo, para que no salga la hoja
// de bienvenida y el nombre sobre el avatar sea siempre el mismo.
await ctx.addInitScript(() => {
  localStorage.setItem('crisrr_jugador', JSON.stringify({ id: 'bac0bac0bac0bac0bac0bac0', nombre: 'Banco', color: 5 }));
});
const page = await ctx.newPage();

const problemas = [];
page.on('pageerror', (e) => problemas.push('error de página: ' + e.message.slice(0, 160)));
page.on('console', (m) => {
  if (m.type() === 'error') problemas.push('consola: ' + m.text().slice(0, 160));
});

// % de píxeles distintos + imagen de diferencias, calculado en el navegador
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
      const c2 = salida.getContext('2d');
      const out = c2.createImageData(w, h);
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
          const g = 235 - (255 - da[i]) * 0.12;
          out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
          out.data[i + 3] = 255;
        }
      }
      c2.putImageData(out, 0, 0);
      return { pct: (distintos / (w * h)) * 100, diff: salida.toDataURL('image/png').split(',')[1] };
    },
    [pngA.toString('base64'), pngB.toString('base64')]
  );
}

const fEstado = path.join(path.resolve(DIR_CAPTURAS), 'estado.json');
let estado = {};
try {
  estado = JSON.parse(fs.readFileSync(fEstado, 'utf8'));
} catch {
  /* primera ejecución */
}

for (const v of vistas) {
  const q = `?x=${v.x}&y=${v.y}&d=${v.d}&pol=${v.pol}&az=${v.az}&t=${v.t ?? T_MUNDO}` + (v.extra ? '&' + v.extra : '');
  process.stdout.write(`${v.id.padEnd(20)} `);
  await page.goto(URL_APP + '/' + q, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#lienzo', { timeout: 30000 });
  await page.waitForFunction(() => window.__mundoListo === true, { timeout: 60000 });
  // que la cámara asiente (damping) y lo último pintado llegue a la pantalla
  await page.waitForTimeout(900);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

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
    console.log(pct < UMBRAL ? 'igual' : `${pct.toFixed(2)}% de píxeles distintos`);
  }
  estado[v.id] = { pct, desc: v.desc, t: Date.now() };
}
await browser.close();
fs.writeFileSync(fEstado, JSON.stringify(estado, null, 2));

// hoja de contactos
const filas = VISTAS.filter((v) => estado[v.id])
  .map((v) => {
    const e = estado[v.id];
    const pct = e.pct == null ? 'referencia' : e.pct < UMBRAL ? 'igual' : e.pct.toFixed(2) + '% distinto';
    const diff = e.pct != null && e.pct >= UMBRAL ? `<img src="diff/${v.id}.png" alt="diferencias">` : '';
    return `<section><h2>${v.id} <small>${pct}</small></h2><p>${e.desc}</p><div class="par"><figure><img src="base/${v.id}.png" alt="referencia"><figcaption>referencia</figcaption></figure><figure><img src="ahora/${v.id}.png" alt="ahora"><figcaption>ahora</figcaption></figure>${diff}</div></section>`;
  })
  .join('\n');
fs.writeFileSync(
  path.join(path.resolve(DIR_CAPTURAS), 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>banco visual</title><style>body{font:14px/1.4 system-ui;margin:20px;color:#2b3440}h2 small{color:#5c6875;font-weight:normal}.par{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0}img{max-width:480px;border:1px solid #ddd}figcaption{font-size:12px;color:#5c6875}</style>${filas}`
);
if (problemas.length) {
  console.log('\nProblemas:');
  for (const p of [...new Set(problemas)]) console.log('  · ' + p);
  process.exitCode = 1;
}
// Con `--estricto` el banco es una RED, no un visor: una vista que se mueve
// sin que nadie haya aceptado la nueva referencia es un fallo.
const movidas = VISTAS.filter((v) => estado[v.id]?.pct != null && estado[v.id].pct >= UMBRAL);
if (estricto && movidas.length) {
  console.log(`\nSe han movido ${movidas.length} vistas: ${movidas.map((v) => v.id).join(', ')}`);
  console.log('Míralas en capturas/index.html y, si el cambio es el que buscabas:  npm run vistas -- --base');
  process.exitCode = 1;
}
console.log(`\nHoja de contactos: ${DIR_CAPTURAS}/index.html`);
