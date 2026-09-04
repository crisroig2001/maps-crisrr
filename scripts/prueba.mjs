// Prueba de extremo a extremo con dos jugadores (npm run prueba, con la app
// servida en npm run dev): presentación, andar, ver al
// otro, hablar y que el otro lo lea, reclamar una parcela, construir, que el
// otro lo vea, y que pueda saber de quién es y darle a me gusta.
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
  // hoja de bienvenida (por DOM: recién arrancado, el servidor compila y la
  // página tarda en responder a la comprobación de «visible» de Playwright)
  await page.waitForSelector('.presenta input', { state: 'attached', timeout: 60000 });
  await page.$eval('.presenta input', (i, v) => (i.value = v), nombre);
  await page.$eval(`.presenta .color:nth-child(${color + 1})`, (b) => b.click());
  await page.$eval('.presenta button[type=submit]', (b) => b.click());
  await page.waitForSelector('.velo', { state: 'detached', timeout: 30000 });
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
const nombresBea = await bea.$$eval('#rotulos .rotulo b', (els) => els.filter((e) => e.parentElement.style.display !== 'none').map((e) => e.textContent));
console.log('Bea ve los nombres:', nombresBea);
await bea.screenshot({ path: path.join(OUT, 'm3-bea-ve-a-ana.png') });

// Hablar: Ana dice algo y hace un gesto, y a Bea le tienen que salir sobre la
// cabeza de Ana. Va por el sondeo de presencia, así que tarda un sondeo suyo
// (que se dispara al hablar) más uno de Bea.
await pulsa(ana, '.chat .btn-cuad');
await ana.$eval('.chat .decir input', (i) => (i.value = '¡Hola, Bea!'));
await pulsa(ana, '.chat .decir button[type=submit]');
await pulsa(ana, '.chat .emote[aria-label="Hola"]');
let gesto = true;
await bea.waitForSelector('#rotulos .gesto', { state: 'attached', timeout: 10000 }).catch(() => (gesto = false));
const dice = await bea.$$eval('#rotulos .rotulo .dice', (els) => els.filter((e) => !e.hidden).map((e) => e.textContent));
console.log('Bea lee la burbuja:', dice.length ? dice : 'NINGUNA', '| gesto:', gesto ? 'sí' : 'NO LLEGA');
await bea.screenshot({ path: path.join(OUT, 'm3b-bea-lee-a-ana.png') });
await pulsa(ana, '.chat .decir button[aria-label="Cerrar"]');

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
await ana.waitForSelector('.panel', { state: 'attached' });
// elegir una pieza: su pestaña y luego la pieza. Los toques van a la
// izquierda de x=640 (a la derecha está el panel).
const elige = async (cat, nombre) => {
  await pulsa(ana, `.panel .tab[data-cat="${cat}"]`);
  await pulsa(ana, `.panel button[aria-label="${nombre}"]`);
};
await elige('casas', 'Casa');
await pulsa(ana, '.panel .colores .color >> nth=5');
await ana.mouse.click(400, 250);
// arrastrar la casa recién colocada (seleccionada) con el ratón
await ana.waitForTimeout(600);
const antesArr = await ana.evaluate(() => window.__mundo.seleccion());
await ana.mouse.move(400, 232);
await ana.mouse.down();
await ana.mouse.move(340, 232, { steps: 6 });
await ana.mouse.move(300, 232, { steps: 6 });
await ana.mouse.up();
await ana.waitForTimeout(400);
const trasArr = await ana.evaluate(() => window.__mundo.seleccion());
console.log('arrastre: x', antesArr?.x, '→', trasArr?.x, trasArr && antesArr && Math.abs(trasArr.x - antesArr.x) > 1.5 ? 'se mueve' : 'NO SE MUEVE');
await elige('naturaleza', 'Árbol');
await ana.mouse.click(300, 380);
await ana.mouse.click(600, 380);
await elige('suelo', 'Valla');
await ana.mouse.click(350, 300);
await ana.mouse.click(550, 300);
await elige('jardin', 'Bandera');
await ana.mouse.click(450, 340);
// la recién colocada queda seleccionada: se empuja, se gira y se borra
await pulsa(ana, '.sel-bar button[aria-label="Mover hacia delante"]');
await pulsa(ana, '.sel-bar button[title="Gira la pieza"]');
console.log('tras mover y girar:', (await ana.textContent('.deco-cab')).trim());
await pulsa(ana, '.sel-bar button[aria-label="Borrar pieza"]');
console.log('cabecera obra:', (await ana.textContent('.deco-cab')).trim());
await ana.waitForTimeout(1500);
await ana.screenshot({ path: path.join(OUT, 'm4-ana-construye.png') });
await pulsa(ana, '.panel .listo'); // Listo
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

// Bea entra en la parcela de Ana: tiene que ver de quién es y poder darle a
// me gusta. A Ana le llega en su sondeo: el cartel sube la cuenta y se lo
// cuentan por el aviso de abajo.
await bea.evaluate(() => window.__mundo.mueve(-2 * 48 + 24, 48 + 12));
await bea.waitForSelector('.acciones .gusta', { state: 'attached', timeout: 20000 });
console.log('Bea, en casa de Ana:', (await bea.textContent('.acciones')).trim());
await pulsa(bea, '.acciones .gusta');
await bea.waitForTimeout(700);
console.log('tras darle a me gusta:', (await bea.textContent('.acciones')).trim());
await bea.screenshot({ path: path.join(OUT, 'm5b-bea-en-casa-de-ana.png') });
const conGusta = await bea.evaluate(async () => (await fetch('/api/mundo?px0=-2&py0=1&px1=-2&py1=1', { cache: 'no-store' })).json());
console.log('servidor me gusta:', conGusta.parcelas?.find((p) => p.k === '-2/1')?.g ?? 'NINGUNO');
// el sondeo de parcelas de Ana es cada 6 s
await ana.waitForTimeout(8000);
const carteles = await ana.$$eval('#rotulos .cartel', (els) => els.filter((e) => e.style.display !== 'none').map((e) => e.textContent));
console.log('cartel que ve Ana:', carteles.length ? carteles : 'NINGUNO', '| aviso:', (await ana.textContent('.toast')).trim());
await ana.screenshot({ path: path.join(OUT, 'm5c-ana-ve-su-cartel.png') });
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
// y en obras: la hoja de piezas plegada, y abierta
await cid.evaluate(() => window.__mundo.mueve(-5 * 48 + 24, -2 * 48 + 12));
await pulsa(cid, '.acciones .btn-principal:has-text("Reclamar")');
await pulsa(cid, '.acciones .btn-principal:has-text("Construir")');
await cid.waitForSelector('.panel.plegado', { state: 'attached', timeout: 15000 });
await cid.mouse.click(195, 300);
await cid.waitForTimeout(800);
console.log('móvil en obras:', (await cid.textContent('.deco-cab')).trim(), '| hoja plegada:', await cid.$('.panel.plegado') !== null);
await cid.screenshot({ path: path.join(OUT, 'm7-movil-obras.png') });
await pulsa(cid, '.panel .actual');
await cid.waitForTimeout(600);
await cid.screenshot({ path: path.join(OUT, 'm8-movil-panel.png') });

console.log('errores:', errores.length ? errores : 'ninguno');
await browser.close();
