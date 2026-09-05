// Genera las miniaturas de la paleta con el MOTOR DE VERDAD (npm run miniaturas).
//
// Las que había eran los previews que reparte Kenney con cada kit: tres kits,
// tres encuadres, seis tamaños distintos (y cuatro ni siquiera cuadradas), con
// el objeto ocupando del 3 % al 100 % del lienzo. Salían dos cosas mal:
//   · la escala INVERTIDA — una silla de 0,45 m se dibujaba tres veces más
//     grande que un árbol de 5,5 m
//   · el color no era el del mundo, porque el kit trae el turquesa original y
//     el visor lo lleva a la familia del césped
// y las piezas generadas (torre, farola, fuente, bandera y las nuevas) no
// tenían miniatura ninguna: salían como emoji.
//
// Ahora cada una se pinta con `?miniatura=<tipo>`: la misma escena, las mismas
// luces, la misma rampa y el mismo ACES que el mundo, con cámara ortográfica
// desde el mismo sitio (45° de acimut, 60° de polar) y un encuadre que sale
// del tamaño real de la pieza con una ley sublineal — así una casa se ve más
// grande que una silla, pero la silla se sigue viendo.
//
// La app tiene que estar servida (npm run dev).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PIEZAS } from '../src/lib/piezas.js';

const URL_APP = process.env.URL_BANCO || 'http://localhost:3000';
const LADO = 256;
const DESTINO = path.resolve('public/miniaturas');

const args = process.argv.slice(2);
const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null;

try {
  const r = await fetch(URL_APP, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
} catch (e) {
  console.error(`No responde ${URL_APP} (${e.message}).  Arranca la app:  npm run dev`);
  process.exit(1);
}

fs.mkdirSync(DESTINO, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: LADO, height: LADO }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('crisrr_jugador', JSON.stringify({ id: 'bac0bac0bac0bac0bac0bac0', nombre: 'Banco', color: 5 }));
});
const page = await ctx.newPage();
const problemas = [];
page.on('pageerror', (e) => problemas.push('error de página: ' + e.message.slice(0, 160)));

const tipos = solo ? [solo] : Object.keys(PIEZAS);
let hechas = 0;
for (const t of tipos) {
  if (!PIEZAS[t]) {
    console.error(`No existe la pieza «${t}»`);
    continue;
  }
  process.stdout.write(t.padEnd(20) + ' ');
  await page.goto(`${URL_APP}/?miniatura=${encodeURIComponent(t)}&t=12`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#lienzo', { timeout: 30000 });
  await page.waitForFunction(() => window.__mundoListo === true, { timeout: 60000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = await page.screenshot({ omitBackground: false });
  fs.writeFileSync(path.join(DESTINO, t + '.png'), png);
  hechas++;
  console.log('ok');
}
await browser.close();

console.log(`\n${hechas} miniaturas en ${path.relative(process.cwd(), DESTINO)}/ (${LADO}×${LADO}, dpr 2)`);
if (problemas.length) {
  console.log('\nProblemas:');
  for (const p of [...new Set(problemas)]) console.log('  · ' + p);
  process.exitCode = 1;
}
