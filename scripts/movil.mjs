// El mundo desde un MÓVIL, de cerca (npm run movil, con la app en npm run dev).
//
// El banco visual (`npm run vistas`) son diez vistas de escritorio a 1000×640
// y densidad 1. Hay defectos que ahí no se pueden ver, porque solo aparecen
// cuando un téxel de una textura llega a medir un píxel de pantalla: eso pide
// estar CERCA y una pantalla DENSA. El tramado del atlas de Kenney era uno —el
// banco no lo movía ni un 0,01 % y en un iPhone se veía a simple vista—, y por
// eso existe este guion.
//
// Captura la casa de muestra desde el suelo, con el encuadre y la densidad de
// un teléfono, y mide lo FINO que queda la pared: cada píxel contra la media
// móvil de nueve de su fila. Eso quita el degradado (que es legítimo: niebla y
// luz) y deja solo lo que no debería estar.
//
//   npm run movil          captura y mide
//   npm run movil -- --ver deja también la captura sin recortar
//
// De referencia, en la pared de la casa de muestra: con el atlas tramado salía
// 0,18; con el atlas limpio, 0,0013. Por encima de 0,05 hay algo que mirar.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const URL = process.env.URL_BANCO || 'http://localhost:3000';
const DESTINO = path.resolve('capturas');
// delante de la casa de muestra (parcela 1/1), a ras de suelo y con el reloj
// del mundo congelado, como el banco
const VISTA = '?x=72&y=54&d=9&pol=74&az=180&t=12';
// el trozo de pared LIMPIA que se mide: sin ventanas, sin puerta y sin bordes
const PARED = { x0: 500, x1: 560, y0: 580, y1: 690 };
const UMBRAL = 0.05;

try {
  const r = await fetch(URL, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
} catch (e) {
  console.error(`No responde ${URL} (${e.message}).  Arranca la app:  npm run dev`);
  process.exit(1);
}

fs.mkdirSync(DESTINO, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ ...devices['iPhone 13 Pro Max'], isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
const problemas = [];
pg.on('pageerror', (e) => problemas.push(e.message));
await pg.goto(URL + '/' + VISTA, { waitUntil: 'domcontentloaded' });
await pg.waitForFunction(() => window.__mundoListo === true, { timeout: 120000 });
await pg.waitForSelector('.presenta input', { state: 'attached', timeout: 60000 });
await pg.$eval('.presenta input', (i) => (i.value = 'Banco'));
await pg.$eval('.presenta button[type=submit]', (b) => b.click());
await pg.waitForSelector('.velo', { state: 'detached', timeout: 30000 });
await pg.waitForTimeout(2500);
const destino = path.join(DESTINO, 'movil.png');
await pg.screenshot({ path: destino });
const dpr = await pg.evaluate(() => window.devicePixelRatio + '× ' + window.innerWidth + '×' + window.innerHeight);
await browser.close();

// --- medir lo fino de la pared ---
// PNG a mano, como en scripts/atlas.mjs: solo hace falta leer lo que acaba de
// escribir Chromium (color real, 8 bits, sin entrelazar).
const zlib = await import('node:zlib');
const buf = fs.readFileSync(destino);
let i = 8;
let idat = [];
let w = 0;
let h = 0;
let canales = 3;
while (i < buf.length) {
  const ln = buf.readUInt32BE(i);
  const tipo = buf.toString('latin1', i + 4, i + 8);
  if (tipo === 'IHDR') {
    w = buf.readUInt32BE(i + 8);
    h = buf.readUInt32BE(i + 12);
    canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[buf[i + 17]];
  } else if (tipo === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + ln));
  else if (tipo === 'IEND') break;
  i += 12 + ln;
}
const cruda = zlib.inflateSync(Buffer.concat(idat));
const paso = w * canales;
const filas = [];
let prev = Buffer.alloc(paso);
let p = 0;
for (let y = 0; y < h; y++) {
  const f = cruda[p++];
  const l = Buffer.from(cruda.subarray(p, p + paso));
  p += paso;
  for (let x = 0; x < paso; x++) {
    const a = x >= canales ? l[x - canales] : 0;
    const b = prev[x];
    const c = x >= canales ? prev[x - canales] : 0;
    if (f === 1) l[x] = (l[x] + a) & 255;
    else if (f === 2) l[x] = (l[x] + b) & 255;
    else if (f === 3) l[x] = (l[x] + ((a + b) >> 1)) & 255;
    else if (f === 4) {
      const pp = a + b - c;
      const pa = Math.abs(pp - a);
      const pb = Math.abs(pp - b);
      const pc = Math.abs(pp - c);
      l[x] = (l[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  filas.push(l);
  prev = l;
}
let suma = 0;
let n = 0;
for (let y = PARED.y0; y < PARED.y1; y++) {
  const f = [];
  for (let x = PARED.x0 - 4; x < PARED.x1 + 4; x++) f.push(filas[y][x * canales]);
  for (let k = 4; k < f.length - 4; k++) {
    let m = 0;
    for (let d = -4; d <= 4; d++) m += f[k + d];
    suma += Math.abs(f[k] - m / 9);
    n++;
  }
}
const fino = suma / n;
console.log(`captura: ${path.relative(process.cwd(), destino)}  (${dpr})`);
console.log(`pared de la casa de muestra: ${fino.toFixed(4)} ${fino > UMBRAL ? `— POR ENCIMA de ${UMBRAL}: hay algo fino que no debería estar` : '(liso)'}`);
if (!process.argv.includes('--ver')) fs.rmSync(destino, { force: true });
if (problemas.length) {
  console.log('Problemas:');
  for (const x of [...new Set(problemas)]) console.log('  · ' + x);
  process.exitCode = 1;
}
if (fino > UMBRAL) process.exitCode = 1;
