// Diagnóstico: ¿en qué celda cae cada edificio de la tesela central de BCN?
import fs from 'node:fs';
import Protobuf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const WORLD = 40075016.686;
const Z = 14, x = 8290, y = 6118;
const NT = 2 ** Z, NC = 2 ** 16;

const lat = 41.3874, lng = 2.1686;
const s = Math.sin((lat * Math.PI) / 180);
const origen = {
  mx: (lng / 360) * WORLD,
  my: (WORLD / (4 * Math.PI)) * Math.log((1 + s) / (1 - s)),
};
const k = Math.cos((lat * Math.PI) / 180);

// celdas semilla (las del store)
const seed = new Set();
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++) {
    const cx = Math.floor(((lng + 180) / 360) * NC) + dx;
    const rad = (lat * Math.PI) / 180;
    const cy = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * NC) + dy;
    seed.add('16/' + cx + '/' + cy);
  }
console.log('seed:', [...seed]);

const buf = fs.readFileSync('/tmp/tiles/14-8290-6118.pbf');
const tile = new VectorTile(new Protobuf(buf));
const L = tile.layers.building;
console.log('edificios:', L.length, 'extent:', L.extent);

const base = { mx: (x / NT - 0.5) * WORLD, my: (0.5 - y / NT) * WORLD };
const escala = WORLD / NT / L.extent;

let dentro = 0, fuera = 0;
const porCelda = {};
const muestras = [];
for (let i = 0; i < L.length; i++) {
  const f = L.feature(i);
  if (f.type !== 3) continue;
  const rings = f.loadGeometry();
  const outer = rings[0];
  let ce = 0, cn = 0;
  for (const p of outer) { ce += p.x; cn += p.y; }
  ce /= outer.length; cn /= outer.length;
  const mx = base.mx + ce * escala;
  const my = base.my - cn * escala;
  const cx = Math.floor((mx / WORLD + 0.5) * NC);
  const cy = Math.floor((0.5 - my / WORLD) * NC);
  const key = '16/' + cx + '/' + cy;
  porCelda[key] = (porCelda[key] || 0) + 1;
  if (seed.has(key)) { dentro++; if (muestras.length < 5) muestras.push({ i, key, h: f.properties.render_height }); }
  else fuera++;
}
console.log('en celdas semilla:', dentro, '· fuera:', fuera);
console.log('muestras dentro:', muestras);
const top = Object.entries(porCelda).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log('celdas con más edificios:', top);
