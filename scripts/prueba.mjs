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

// Ana se va a un solar libre (parcela -1/0) y lo reclama
// andamos hacia el oeste con el teclado hasta el solar -1/0
await ana.keyboard.down('a');
await ana.waitForTimeout(6500);
await ana.keyboard.up('a');
await ana.waitForTimeout(600);
const accion = (await ana.textContent('.acciones').catch(() => '')) || '';
console.log('acciones de Ana en el solar:', accion.trim());
await ana.click('.acciones .btn-principal');
await ana.waitForTimeout(600);
console.log('toast:', (await ana.textContent('.toast')).trim());
await ana.click('.acciones .btn-principal'); // Construir
await ana.waitForSelector('.paleta');
await ana.click('.paleta button[aria-label="Casa"]');
await ana.click('.paleta .colores .color >> nth=5');
await ana.mouse.click(500, 250);
await ana.click('.paleta button[aria-label="Árbol"]');
await ana.mouse.click(300, 380);
await ana.mouse.click(700, 380);
await ana.click('.paleta button[aria-label="Valla"]');
await ana.mouse.click(400, 470);
await ana.mouse.click(600, 470);
await ana.click('.paleta button[aria-label="Bandera"]');
await ana.mouse.click(500, 470);
await ana.click('.paleta button[aria-label="Borrar"]');
await ana.mouse.click(700, 380);
console.log('cabecera obra:', (await ana.textContent('.deco-cab')).trim());
await ana.waitForTimeout(1500);
await ana.screenshot({ path: path.join(OUT, 'm4-ana-construye.png') });
await ana.click('.paleta .btn-principal'); // Listo
await ana.waitForTimeout(500);

// ¿Lo ve Bea? (sondeo de parcelas cada 6 s)
await bea.keyboard.down('a');
await bea.waitForTimeout(4000);
await bea.keyboard.up('a');
await bea.waitForTimeout(7000);
await bea.screenshot({ path: path.join(OUT, 'm5-bea-ve-la-casa.png') });

const r = await ana.evaluate(async () => (await fetch('/api/mundo?px0=-1&py0=0&px1=-1&py1=0')).json());
console.log('servidor parcela -1/0:', JSON.stringify(r.parcelas[0]));
console.log('errores:', errores.length ? errores : 'ninguno');
await browser.close();
