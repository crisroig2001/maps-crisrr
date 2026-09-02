// Prueba de extremo a extremo con dos jugadores (npm run prueba, con la app
// servida en npm run dev): presentación, andar, ver al
// otro, reclamar una parcela, construir y que el otro lo vea.
import { chromium } from 'playwright';
import path from 'node:path';

const OUT = process.env.OUT || '.';
const URL = 'http://localhost:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errores = [];
async function abre(nombre, color, q = '') {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(nombre + ': ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(nombre + ' consola: ' + m.text());
  });
  await page.goto(URL + '/' + q, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mundoListo === true, { timeout: 60000 });
  // hoja de bienvenida
  await page.fill('.presenta input', nombre);
  await page.click(`.presenta .color >> nth=${color}`);
  await page.click('.presenta button[type=submit]');
  await page.waitForSelector('.velo', { state: 'detached' });
  return page;
}

// Los botones se pulsan por DOM: con dos pestañas y render por software, la
// comprobación de «visible y estable» de Playwright se queda sin frames.
const pulsa = async (pg, sel) => {
  await pg.waitForSelector(sel, { state: 'attached', timeout: 20000 });
  await pg.$eval(sel, (b) => b.click());
};

const ana = await abre('Ana', 1);
await ana.waitForTimeout(800);
await ana.screenshot({ path: path.join(OUT, 'm1-llegada.png') });
console.log('cabecera Ana:', (await ana.textContent('.cabecera')).trim());

// andar tocando el suelo: hacia el norte (arriba en pantalla)
await ana.mouse.click(500, 200);
await ana.waitForTimeout(2500);
await ana.screenshot({ path: path.join(OUT, 'm2-andando.png') });

// segundo jugador, en la misma plaza
const bea = await abre('Bea', 4);
await bea.waitForTimeout(3500); // dos sondeos de presencia
const nombresBea = await bea.$$eval('#rotulos .nombre', (els) => els.filter((e) => e.style.display !== 'none').map((e) => e.textContent));
console.log('Bea ve los nombres:', nombresBea);
await bea.screenshot({ path: path.join(OUT, 'm3-bea-ve-a-ana.png') });

// el teclado mueve: un par de segundos hacia el oeste y la x baja
const antes = await ana.evaluate(() => window.__mundo.pos());
await ana.keyboard.down('a');
await ana.waitForTimeout(2000);
await ana.keyboard.up('a');
const despues = await ana.evaluate(() => window.__mundo.pos());
console.log('teclado: x', antes.x.toFixed(1), '→', despues.x.toFixed(1), despues.x < antes.x - 1 ? 'anda' : 'NO ANDA');

// Ana se va a un solar libre (parcela -2/1) y lo reclama. Se teletransporta:
// con render por software (CI) un paseo de 100 m tarda lo que tarde.
await ana.evaluate(() => window.__mundo.mueve(-2 * 48 + 24, 48 + 12));
await ana.waitForTimeout(2500);
// se espera al botón CONCRETO: la parcela tarda un sondeo en saberse libre,
// y tras reclamar, «Construir» tarda un frame en pintarse
const reclamar = '.acciones .btn-principal:has-text("Reclamar")';
await ana.waitForSelector(reclamar, { state: 'attached', timeout: 20000 });
console.log('acciones de Ana en el solar:', (await ana.textContent('.acciones')).trim());
await pulsa(ana, reclamar);
const construir = '.acciones .btn-principal:has-text("Construir")';
await ana.waitForSelector(construir, { state: 'attached', timeout: 20000 });
console.log('toast:', (await ana.textContent('.toast')).trim());
await pulsa(ana, construir);
await ana.waitForSelector('.paleta', { state: 'attached' });
await pulsa(ana, '.paleta button[aria-label="Casa"]');
await pulsa(ana, '.paleta .colores .color >> nth=5');
await ana.mouse.click(500, 250);
await pulsa(ana, '.paleta button[aria-label="Árbol"]');
await ana.mouse.click(300, 380);
await ana.mouse.click(700, 380);
// (los toques van por encima de y=420: más abajo está la paleta)
await pulsa(ana, '.paleta button[aria-label="Valla"]');
await ana.mouse.click(400, 300);
await ana.mouse.click(600, 300);
await pulsa(ana, '.paleta button[aria-label="Bandera"]');
await ana.mouse.click(560, 340);
// la recién colocada queda seleccionada: se empuja, se gira y se borra
await pulsa(ana, '.paleta button[aria-label="Mover hacia delante"]');
await pulsa(ana, '.paleta button[title="Gira la pieza"]');
console.log('tras mover y girar:', (await ana.textContent('.deco-cab')).trim());
await pulsa(ana, '.paleta button[aria-label="Borrar pieza"]');
console.log('cabecera obra:', (await ana.textContent('.deco-cab')).trim());
await ana.waitForTimeout(1500);
await ana.screenshot({ path: path.join(OUT, 'm4-ana-construye.png') });
await pulsa(ana, '.paleta .btn-principal'); // Listo
await ana.waitForTimeout(500);

// ¿Lo ve Bea? (sondeo de parcelas cada 6 s)
await bea.evaluate(() => window.__mundo.mueve(-2 * 48 + 24, 48 - 20));
await bea.waitForTimeout(7500);
await bea.screenshot({ path: path.join(OUT, 'm5-bea-ve-la-casa.png') });

// el guardado va con retardo: se pregunta hasta tres veces
let guardada = null;
for (let i = 0; i < 3 && !guardada; i++) {
  const r = await ana.evaluate(async () => (await fetch('/api/mundo?px0=-2&py0=1&px1=-2&py1=1', { cache: 'no-store' })).json());
  guardada = r.parcelas?.find((p) => p.k === '-2/1' && p.d?.length) || null;
  if (!guardada) await ana.waitForTimeout(1500);
}
console.log('servidor parcela -2/1:', guardada ? guardada.d.length + ' piezas, dueño ' + guardada.o : 'NO GUARDADA');
// Móvil: con pantalla táctil sale el joystick, y arrastrarlo mueve el avatar.
// Las otras dos pestañas se cierran antes: tres mundos con sombras a la vez
// dejan sin frames al render por software.
await ana.context().close();
await bea.context().close();
const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const cid = await movil.newPage();
cid.on('pageerror', (e) => errores.push('Cid: ' + e.message));
await cid.goto(URL + '/', { waitUntil: 'domcontentloaded' });
await cid.waitForFunction(() => window.__mundoListo === true, { timeout: 60000 });
await cid.$eval('.presenta input', (i) => (i.value = 'Cid'));
await pulsa(cid, '.presenta button[type=submit]');
await cid.waitForSelector('.joy', { timeout: 15000 });
const joy = await cid.$('.joy');
const jb = await joy.boundingBox();
const jc = { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 };
const p0 = await cid.evaluate(() => window.__mundo.pos());
await cid.mouse.move(jc.x, jc.y);
await cid.mouse.down();
await cid.mouse.move(jc.x, jc.y - 45, { steps: 5 });
await cid.waitForTimeout(2000);
await cid.mouse.up();
const p1 = await cid.evaluate(() => window.__mundo.pos());
console.log('joystick móvil: y', p0.y.toFixed(1), '→', p1.y.toFixed(1), p1.y > p0.y + 1 ? 'anda' : 'NO ANDA');
await cid.screenshot({ path: path.join(OUT, 'm6-movil-joystick.png') });

console.log('errores:', errores.length ? errores : 'ninguno');
await browser.close();
