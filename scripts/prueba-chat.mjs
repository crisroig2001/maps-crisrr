// Prueba del CHAT con dos jugadoras de verdad (npm run prueba-chat, con la
// app servida en npm run dev). `npm run prueba` ya toca la caja de escribir;
// esto es lo que aquella no mira: que lo hablado se lea en el panel con las
// burbujas del lado que toca, y que las FOTOS y los AUDIOS lleguen —y solo a
// quien puede leerlos—.
//
// Lo que comprueba, en orden:
//   1. lo que escribe Ana le sale a Bea en su chat, a la izquierda, y a Ana
//      a la derecha
//   2. una foto de Bea le llega a Ana: en el chat y en la burbuja sobre su
//      cabeza (y se reduce en el navegador antes de salir)
//   3. un audio de Ana le llega a Bea con su duración
//   4. dentro de un CORRO, la foto viaja por el hilo del corro, el chat dice
//      «Corro» y el globo del mundo se esconde mientras el chat está abierto
//      y vuelve al cerrarlo, con la foto dentro
//   5. un tercero que NO está en el corro pide los adjuntos por id y NO se
//      le sirve el del corro (el id no basta: hay que estar dentro)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = process.env.OUT || '.';
const URL = process.env.URL_BANCO || 'http://localhost:3000';

try {
  const r = await fetch(URL, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
} catch (e) {
  console.error(`No responde ${URL} (${e.message}).  Arranca la app:  npm run dev`);
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || undefined,
  // el micrófono, falso y sin preguntar: si no, grabar abre un diálogo
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const errores = [];
async function abre(nombre, color) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(nombre + ': ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(nombre + ' consola: ' + m.text());
  });
  await page.goto(URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mundoListo === true, { timeout: 90000 });
  await page.waitForSelector('.presenta input', { state: 'attached', timeout: 60000 });
  await page.$eval('.presenta input', (i, v) => (i.value = v), nombre);
  await page.$eval(`.presenta .color:nth-child(${color + 1})`, (b) => b.click());
  await page.$eval('.presenta button[type=submit]', (b) => b.click());
  await page.waitForSelector('.velo', { state: 'detached', timeout: 30000 });
  return page;
}
// por DOM: con dos pestañas y render por software, la comprobación de
// «visible y estable» de Playwright se queda sin fotogramas
const pulsa = async (pg, sel) => {
  await pg.waitForSelector(sel, { state: 'attached', timeout: 20000 });
  await pg.$eval(sel, (b) => b.click());
};
// el sondeo se fuerza: una pestaña de fondo se queda sin fotogramas y el
// sondeo normal va con el bucle de dibujo
const sondea = (pg) => pg.evaluate(() => window.__mundo.sondea());
// dos sondeos: el primero se entera del mensaje y pide el adjunto por id, el
// segundo lo trae
const sondeaDos = async (pg) => {
  await sondea(pg);
  await pg.waitForTimeout(600);
  await sondea(pg);
};

// Una foto de verdad para mandar (PNG a rayas, sin dependencias). El cliente
// la reduce a JPEG antes de que salga del navegador, que es parte de lo que
// se está probando: 640×480 entran, y lo que viaja son ~18 KB.
function png(w, h) {
  const filas = [];
  for (let y = 0; y < h; y++) {
    const fila = [0];
    for (let x = 0; x < w; x++) fila.push(((x >> 3) + (y >> 3)) % 2 ? 230 : 40, 90, 200);
    filas.push(Buffer.from(fila));
  }
  const trozo = (tipo, datos) => {
    const t = Buffer.from(tipo, 'latin1');
    const ln = Buffer.alloc(4);
    ln.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, datos])));
    return Buffer.concat([ln, t, datos, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(Buffer.concat(filas))),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}
fs.mkdirSync(OUT, { recursive: true });
const FOTO = path.join(OUT, 'foto-prueba.png');
fs.writeFileSync(FOTO, png(640, 480));

const ana = await abre('Ana', 1);
const bea = await abre('Bea', 4);
await bea.waitForTimeout(3500); // dos sondeos: que se vean

// 1. escribir
// el chat abierto es la tira de escribir; lo hablado se lee sobre las cabezas
// y, si se quiere de antes, en el historial, que se abre a mano
await pulsa(ana, '.chat .btn-cuad');
await ana.waitForSelector('.chat.abierto', { state: 'attached' });
await pulsa(ana, '.chat .historial');
await ana.$eval('.chat .decir input[type=text]', (i) => (i.value = 'Hola desde el chat'));
await pulsa(ana, '.chat .decir button[type=submit]');
await ana.waitForTimeout(800);
await sondea(bea);
await pulsa(bea, '.chat .btn-cuad');
await pulsa(bea, '.chat .historial');
await bea.waitForFunction(() => document.querySelectorAll('.chat-hilo .msg').length >= 1, null, { timeout: 15000 });
const lee = (pg) => pg.$$eval('.chat-hilo .msg', (els) => els.map((e) => (e.classList.contains('mio') ? 'derecha: ' : 'izquierda: ') + e.textContent));
console.log('Bea lee en su chat:', await lee(bea));
console.log('Ana ve lo suyo:   ', await lee(ana));

// 2. una foto de Bea
await bea.setInputFiles('.chat input[type=file]', FOTO);
await bea.waitForFunction(() => document.querySelectorAll('.chat-hilo .msg .foto img').length >= 1, null, { timeout: 15000 });
const suFoto = await bea.$eval('.chat-hilo .msg .foto img', (i) => i.src);
// sale como JPEG y no como el PNG que entró: el navegador la reduce a 720 px
// de lado antes de mandarla (el tamaño del fichero de prueba no dice nada, que
// es un patrón de rayas y comprime como ninguna foto de verdad)
console.log('Bea manda una foto de 640×480:', suFoto.slice(0, 22) + '…', 'viaja como', Math.round(suFoto.length / 1024), 'KB');
await bea.waitForTimeout(900);
await sondeaDos(ana);
await ana.waitForFunction(() => [...document.querySelectorAll('.chat-hilo .msg')].some((m) => !m.classList.contains('mio') && m.querySelector('.foto img')), null, { timeout: 15000 });
console.log('a Ana le llega la foto: sí');
const enBurbuja = await ana
  .waitForFunction(() => document.querySelectorAll('#rotulos .rotulo .dice img').length >= 1, null, { timeout: 15000 })
  .then(() => true, () => false);
console.log('y sobre la cabeza de Bea, en el mundo:', enBurbuja ? 'sí' : 'NO SALE');
await ana.screenshot({ path: path.join(OUT, 'chat-1-cerca-ana.png') });

// 3. un audio de Ana, manteniendo pulsado el micrófono
const mic = await ana.$('.chat .btn-adj.mic');
const caja = await mic.boundingBox();
await ana.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
await ana.mouse.down();
await ana.waitForSelector('.chat .grabando', { state: 'attached', timeout: 8000 });
await ana.waitForTimeout(1500);
await ana.mouse.up();
await ana.waitForFunction(() => document.querySelectorAll('.chat-hilo .msg .audio').length >= 1, null, { timeout: 15000 });
console.log('Ana graba un audio de', await ana.$eval('.chat-hilo .msg .audio small', (e) => e.textContent));
await ana.waitForTimeout(900);
await sondeaDos(bea);
await bea.waitForFunction(() => document.querySelectorAll('.chat-hilo .msg .audio').length >= 1, null, { timeout: 15000 });
console.log('a Bea le llega el audio de', await bea.$eval('.chat-hilo .msg .audio small', (e) => e.textContent));
await bea.screenshot({ path: path.join(OUT, 'chat-2-audio-bea.png') });

// 4. el corro: Ana toca a Bea en el mundo y le pide hablar
await pulsa(ana, '.chat-cab .cerrar');
await pulsa(bea, '.chat-cab .cerrar');
const sueltos = await bea.evaluate(() => window.__mundo.adjuntos());
const posBea = await bea.evaluate(() => window.__mundo.pos());
await ana.evaluate(([x, y]) => window.__mundo.mueve(x, y - 5), [posBea.x, posBea.y]);
await sondea(ana);
await sondea(bea);
await ana.waitForTimeout(2500);
// se toca el CUERPO de Bea (a metro y pico del suelo), no sus pies
const enPantalla = await ana.evaluate(([x, y]) => window.__mundo.proyecta(x, y, 1.1), [posBea.x, posBea.y]);
await ana.mouse.click(enPantalla.sx, enPantalla.sy);
await ana.waitForSelector('.ficha', { state: 'attached', timeout: 15000 });
await pulsa(ana, '.ficha .btn-principal.ancho');
await sondea(bea);
await bea.waitForSelector('.corro-zona .aviso', { state: 'attached', timeout: 20000 });
await pulsa(bea, '.corro-zona .aviso .btn-principal');
await bea.waitForFunction(() => window.__mundo.corro() !== null, null, { timeout: 20000, polling: 300 });
await sondea(ana);
await ana.waitForFunction(() => window.__mundo.corro() !== null, null, { timeout: 20000, polling: 300 });
// entrar en un corro abre el chat solo
await ana.waitForSelector('.chat.abierto', { state: 'attached', timeout: 10000 });
console.log('cabecera del chat de Ana en el corro:', (await ana.textContent('.chat-cab')).trim());
await ana.setInputFiles('.chat input[type=file]', FOTO);
await ana.waitForTimeout(900);
await sondeaDos(bea);
await bea.waitForSelector('.chat.abierto', { state: 'attached', timeout: 10000 });
// el historial se queda como lo dejó cada uno: si Bea lo tenía abierto, ya está
if (!(await bea.$('.chat-hilo'))) await pulsa(bea, '.chat .historial');
await bea.waitForFunction(() => [...document.querySelectorAll('.chat-hilo .msg')].some((m) => !m.classList.contains('mio') && m.querySelector('.foto img')), null, { timeout: 15000 });
console.log('Bea ve la foto en el hilo del corro: sí');
await bea.screenshot({ path: path.join(OUT, 'chat-3-corro-bea.png') });
// el globo del mundo se esconde con el historial abierto y vuelve al cerrarlo
const globoConChat = await bea.$eval('#rotulos .carrete', (c) => c.style.display !== 'none').catch(() => null);
await pulsa(bea, '.chat-cab .cerrar');
await bea.waitForTimeout(1500);
const globo = await bea.$eval('#rotulos .carrete', (c) => ({ visible: c.style.display !== 'none', fotos: c.querySelectorAll('img').length })).catch(() => null);
console.log('el globo del corro: con el historial abierto', globoConChat ? 'SE VE (mal)' : 'escondido (bien)', '| al cerrarlo:', JSON.stringify(globo));
await bea.screenshot({ path: path.join(OUT, 'chat-4-globo-bea.png') });
if (globo?.visible) {
  await bea.$eval('#rotulos .carrete', (c) => c.click());
  const abre2 = await bea.waitForSelector('.chat.abierto', { state: 'attached', timeout: 5000 }).then(() => true, () => false);
  console.log('tocar el globo abre el chat:', abre2 ? 'sí' : 'NO');
}

// 5. un tercero pide los adjuntos por id: los sueltos sí (el id es la llave y
//    solo lo tiene quien recibió el mensaje), el del corro NO
const todos = await bea.evaluate(() => window.__mundo.adjuntos());
const delCorro = todos.filter((id) => !sueltos.includes(id));
const r = await fetch(URL + '/api/presencia', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jugador: 'c1d2e3f4a5b6c7d8', nombre: 'Cid', color: 0, x: posBea.x + 3, y: posBea.y, r: 0, trae: todos }),
}).then((r) => r.json());
const recibe = Object.keys(r.adjuntos || {});
console.log(`un tercero pide ${todos.length} adjuntos y recibe ${recibe.length}; el del corro:`, delCorro.some((id) => recibe.includes(id)) ? 'LO RECIBE (MAL)' : 'no le llega (bien)');

console.log(errores.length ? '\nERRORES:\n' + errores.join('\n') : '\nerrores: ninguno');
await browser.close();
if (errores.length) process.exitCode = 1;
