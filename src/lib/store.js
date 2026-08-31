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

// Devuelve las celdas, opcionalmente acotadas a un rango de celdas z16
// (la vista del cliente) y a las cambiadas desde `desde`.
// Sin filtro devolvía el planeta entero a cada cliente cada 25 s.
export function getCells(caja, desde) {
  const c = load().cells;
  const out = [];
  for (const k of Object.keys(c)) {
    const e = c[k];
    if (desde && !(e.t > desde)) continue;
    if (caja) {
      const p = k.split('/');
      const cx = Number(p[1]);
      const cy = Number(p[2]);
      if (cx < caja.cx0 || cx > caja.cx1 || cy < caja.cy0 || cy > caja.cy1) continue;
    }
    // {k, c, t}: c es el color de fachada capturado con la cámara (o null)
    out.push({ k, c: e.c || null, t: e.t || 0 });
  }
  return out;
}

// El instante del último cambio, para que el cliente pueda pedir solo deltas
// y para construir el ETag.
export function ultimoCambio() {
  const c = load().cells;
  let max = 0;
  for (const k of Object.keys(c)) if (c[k].t > max) max = c[k].t;
  return max;
}

export function totalCeldas() {
  return Object.keys(load().cells).length;
}

export function addCell(key, color) {
  const c = load();
  const ya = c.cells[key];
  if (ya) {
    // el primero que escanea manda; un color posterior solo rellena si no había
    if (color && !ya.c) {
      ya.c = color;
      ya.t = Date.now(); // si no, un delta por `desde` se perdería este cambio
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
