// Cachea en disco las teselas que necesitan las vistas del banco.
// Se ejecuta UNA vez (npm run teselas); a partir de ahí el banco no toca la red,
// así que las capturas son reproducibles y no dependen del CDN.
import fs from 'node:fs';
import path from 'node:path';
import { VISTAS, RADIO_TESELAS, Z, DIR_TESELAS } from './vistas.config.mjs';

const TILEJSON = 'https://tiles.openfreemap.org/planet';

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

const dir = path.resolve(DIR_TESELAS);
fs.mkdirSync(dir, { recursive: true });

// qué teselas hacen falta, sin repetir
const quiero = new Set();
for (const v of VISTAS) {
  const t = lonLatToTile(v.lng, v.lat, Z);
  for (let dx = -RADIO_TESELAS; dx <= RADIO_TESELAS; dx++) {
    for (let dy = -RADIO_TESELAS; dy <= RADIO_TESELAS; dy++) {
      quiero.add(t.x + dx + '-' + (t.y + dy));
    }
  }
}

const faltan = [...quiero].filter((k) => !fs.existsSync(path.join(dir, k + '.pbf')));
console.log(`${quiero.size} teselas necesarias · ${quiero.size - faltan.length} ya en caché · ${faltan.length} por bajar`);
if (!faltan.length) {
  console.log(`Caché completa en ${DIR_TESELAS}/`);
  process.exit(0);
}

// La URL está versionada; hay que leerla del TileJSON
const tj = await fetch(TILEJSON).then((r) => r.json());
const plantilla = tj?.tiles?.[0];
if (!plantilla) throw new Error('TileJSON sin plantilla de teselas');

let hechas = 0;
let bytes = 0;
// de 6 en 6: bajar 50 teselas a la vez es maleducado con un CDN gratuito
for (let i = 0; i < faltan.length; i += 6) {
  await Promise.all(
    faltan.slice(i, i + 6).map(async (k) => {
      const [x, y] = k.split('-');
      const url = plantilla.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  ${k}: HTTP ${res.status}`);
        return;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(dir, k + '.pbf'), buf);
      hechas++;
      bytes += buf.length;
      process.stdout.write(`\r  ${hechas}/${faltan.length} (${(bytes / 1048576).toFixed(1)} MB)   `);
    })
  );
}
console.log(`\nListo: ${DIR_TESELAS}/ con ${quiero.size} teselas, ${(bytes / 1048576).toFixed(1)} MB nuevos.`);
