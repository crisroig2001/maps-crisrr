// Almacén de celdas escaneadas: un JSON en DATA_DIR (volumen persistente en
// Coolify). Volumen de escrituras bajísimo → fichero plano con escritura
// atómica (tmp + rename), sin dependencias nativas. Solo servidor.
import fs from 'node:fs';
import path from 'node:path';
import { lonLatToTile, cellKey, Z_CELL } from './geo';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'scans.json');

let cache = null;

// Semilla: 3x3 celdas alrededor de plaça de Catalunya (Barcelona) para que la
// primera visita ya enseñe la diferencia color/gris.
function seed() {
  const cells = {};
  const t = lonLatToTile(2.1686, 41.3874, Z_CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      cells[cellKey(t.x + dx, t.y + dy)] = { t: Date.now(), seed: true };
    }
  }
  return cells;
}

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.cells) cache = parsed;
  } catch {
    /* primera ejecución o fichero corrupto → se resiembra */
  }
  if (!cache) {
    cache = { cells: seed() };
    save();
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(cache));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) {
    console.error('scans save failed', e?.message);
  }
}

export function getCells() {
  const c = load().cells;
  // {k, c}: c es el color de fachada capturado con la cámara (o null)
  return Object.keys(c).map((k) => ({ k, c: c[k].c || null }));
}

export function addCell(key, color) {
  const c = load();
  const ya = c.cells[key];
  if (ya) {
    // el primero que escanea manda; un color posterior solo rellena si no había
    if (color && !ya.c) {
      ya.c = color;
      save();
      return true;
    }
    return false;
  }
  const e = { t: Date.now() };
  if (color) e.c = color;
  c.cells[key] = e;
  save();
  return true;
}
