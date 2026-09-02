// Almacén del mundo: un JSON en DATA_DIR (volumen persistente en Coolify).
// Volumen de escrituras bajo → fichero plano con escritura atómica (tmp +
// rename), sin dependencias nativas. Solo servidor.
//
//   parcelas: { "px/py": { o: dueño, t: último cambio, d: [piezas] } }
//   jugadores: { id: { n: nombre, c: color, p: "px/py" o null, x, y, t } }
//
// La presencia (quién está dónde AHORA) va aparte y en memoria: cambia cada
// segundo y no tiene sentido persistirla.
import fs from 'node:fs';
import path from 'node:path';
import { PARCELA_M, claveParcela } from './parcela';
import { validaPiezas, limpiaNombre, COLORES, MAX_NOMBRE } from './piezas';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'mundo.json');

// cuántas parcelas puede reclamar un jugador. Una, de momento: el mundo se
// llena de vecinos, no de un solo constructor.
export const MAX_PARCELAS_POR_JUGADOR = 1;

let cache = null;

// Versión de la semilla. Al cambiar el número, las parcelas del «mundo» (la
// plaza y la casa de muestra) se reescriben en el arranque: la semilla solo
// se creaba la primera vez y producción se quedaba con la muestra vieja.
const SEMILLA = 2;

// La plaza de llegada (0/0) y una casa de muestra al lado, para que quien
// entra vea qué se puede hacer sin tener que construirlo. Dueño «mundo»: nadie
// las puede reclamar ni cambiar.
function seed() {
  const L = PARCELA_M;
  const plaza = [
    { t: 'fuente', x: L / 2, y: L / 2, r: 0, c: 0 },
    { t: 'bandera', x: L / 2, y: L / 2 + 10, r: 0, c: 1 },
    { t: 'banco', x: L / 2 - 7, y: L / 2, r: 1, c: 0 },
    { t: 'banco', x: L / 2 + 7, y: L / 2, r: 3, c: 0 },
    { t: 'banco', x: L / 2, y: L / 2 - 7, r: 0, c: 0 },
    { t: 'farola', x: 8, y: 8, r: 0, c: 0 },
    { t: 'farola', x: L - 8, y: 8, r: 0, c: 0 },
    { t: 'farola', x: 8, y: L - 8, r: 0, c: 0 },
    { t: 'farola', x: L - 8, y: L - 8, r: 0, c: 0 },
    { t: 'roble', x: 6, y: L / 2, r: 0, c: 0 },
    { t: 'arbol', x: L - 6, y: L / 2, r: 0, c: 0 },
    { t: 'palmera', x: L / 2, y: L - 6, r: 0, c: 0 },
    { t: 'flores', x: L / 2 - 5, y: L / 2 + 6, r: 0, c: 1 },
    { t: 'flores-amarillas', x: L / 2 + 5, y: L / 2 + 6, r: 0, c: 3 },
    { t: 'maceta', x: L / 2 - 4, y: L / 2 - 4, r: 0, c: 0 },
    { t: 'maceta', x: L / 2 + 4, y: L / 2 - 4, r: 0, c: 0 },
  ];
  // camino de la plaza hacia la casa de muestra (este)
  for (let x = L / 2 + 6; x < L; x += 4) plaza.push({ t: 'camino', x, y: L / 2 - 8, r: 0, c: 0 });

  const casa = [
    { t: 'casa', x: L / 2, y: L / 2 + 6, r: 0, c: 2 },
    { t: 'roble', x: 8, y: L - 8, r: 0, c: 0 },
    { t: 'pino', x: L - 8, y: L - 8, r: 0, c: 0 },
    { t: 'pino', x: L - 8, y: 8, r: 0, c: 0 },
    { t: 'arbusto', x: L / 2 - 9, y: L / 2 - 1, r: 0, c: 0 },
    { t: 'arbusto', x: L / 2 + 9, y: L / 2 - 1, r: 0, c: 0 },
    { t: 'flores-moradas', x: L / 2 - 5, y: L / 2 - 2, r: 0, c: 3 },
    { t: 'flores', x: L / 2 + 5, y: L / 2 - 2, r: 0, c: 1 },
    { t: 'banco', x: L / 2 + 13, y: L / 2 + 2, r: 0, c: 0 },
    { t: 'mesa', x: L / 2 + 13, y: L / 2 - 4, r: 0, c: 0 },
    { t: 'silla', x: L / 2 + 11.5, y: L / 2 - 4, r: 1, c: 0 },
    { t: 'silla', x: L / 2 + 14.5, y: L / 2 - 4, r: 3, c: 0 },
    { t: 'farola', x: L / 2 - 12, y: L / 2 - 8, r: 0, c: 0 },
    { t: 'roca', x: 6, y: 8, r: 0, c: 0 },
    { t: 'rocas', x: 10, y: 6, r: 0, c: 0 },
    { t: 'setas', x: 11, y: L - 9, r: 0, c: 0 },
    { t: 'tronco', x: L - 10, y: L / 2 + 10, r: 1, c: 0 },
    { t: 'hoguera', x: L - 14, y: L / 2 + 14, r: 0, c: 0 },
    { t: 'tienda', x: L - 10, y: L / 2 + 18, r: 2, c: 0 },
    { t: 'cartel', x: 4, y: L / 2 - 11, r: 0, c: 0 },
    { t: 'calabaza', x: 8, y: L / 2 + 12, r: 0, c: 0 },
    { t: 'calabaza', x: 10, y: L / 2 + 13.5, r: 1, c: 0 },
  ];
  for (let x = 2; x < L / 2; x += 4) casa.push({ t: 'camino', x, y: L / 2 - 8, r: 0, c: 0 });
  casa.push({ t: 'camino', x: L / 2, y: L / 2 - 4, r: 0, c: 0 });
  for (let i = 0; i < 12; i++) casa.push({ t: 'valla', x: 2 + i * 4, y: 2, r: 0, c: 0 });
  for (let i = 0; i < 12; i++) casa.push({ t: 'valla', x: 2 + i * 4, y: L - 2, r: 0, c: 0 });
  for (let i = 0; i < 11; i++) casa.push({ t: 'valla', x: L - 2, y: 4 + i * 4, r: 1, c: 0 });

  const t = Date.now();
  return {
    semilla: SEMILLA,
    parcelas: {
      [claveParcela(0, 0)]: { o: 'mundo', t, d: plaza },
      [claveParcela(1, 0)]: { o: 'mundo', t, d: casa },
    },
    jugadores: {},
  };
}

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.parcelas) cache = parsed;
  } catch {
    /* primera ejecución o fichero corrupto → se resiembra */
  }
  if (!cache) {
    cache = seed();
    save();
  } else if (cache.semilla !== SEMILLA) {
    // solo las parcelas del «mundo»: lo de los jugadores no se toca
    const nueva = seed();
    for (const k of Object.keys(nueva.parcelas)) {
      if (!cache.parcelas[k] || cache.parcelas[k].o === 'mundo') cache.parcelas[k] = nueva.parcelas[k];
    }
    cache.semilla = SEMILLA;
    save();
  }
  if (!cache.jugadores) cache.jugadores = {};
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(cache));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) {
    console.error('mundo save failed', e?.message);
  }
}

// Parcelas dentro de una caja de índices, opcionalmente solo las cambiadas
// después de `desde`. Una parcela vacía (sin piezas) también se manda: su
// dueño se pinta en el suelo.
export function getParcelas(caja, desde) {
  const ps = load().parcelas;
  const out = [];
  for (const k of Object.keys(ps)) {
    const e = ps[k];
    if (desde && !(e.t > desde)) continue;
    if (caja) {
      const [px, py] = k.split('/').map(Number);
      if (px < caja.px0 || px > caja.px1 || py < caja.py0 || py > caja.py1) continue;
    }
    out.push({ k, o: e.o, t: e.t, d: e.d || [] });
  }
  return out;
}

export function ultimoCambio() {
  const ps = load().parcelas;
  let max = 0;
  for (const k of Object.keys(ps)) if (ps[k].t > max) max = ps[k].t;
  return max;
}

export function totalParcelas() {
  return Object.keys(load().parcelas).length;
}

// Reclama una parcela libre. Reglas: no puede ser de nadie, y el jugador no
// puede tener ya su cupo. Devuelve null si va bien o el motivo.
export function reclama(clave, jugador) {
  const m = load();
  if (m.parcelas[clave]) return 'ocupada';
  const j = m.jugadores[jugador] || (m.jugadores[jugador] = { t: Date.now() });
  const suyas = Object.keys(m.parcelas).filter((k) => m.parcelas[k].o === jugador).length;
  if (suyas >= MAX_PARCELAS_POR_JUGADOR) return 'cupo';
  m.parcelas[clave] = { o: jugador, t: Date.now(), d: [] };
  j.p = clave;
  j.t = Date.now();
  save();
  return null;
}

// Sustituye las piezas de una parcela. Solo el dueño; nunca las del «mundo».
export function setPiezas(clave, jugador, lista) {
  const m = load();
  const e = m.parcelas[clave];
  if (!e) return 'sin_reclamar';
  if (e.o !== jugador) return 'ajena';
  const d = validaPiezas(lista, PARCELA_M);
  if (!d) return 'bad_piezas';
  e.d = d;
  e.t = Date.now(); // el delta por `desde` tiene que traer este cambio
  save();
  return null;
}

// Abandona la parcela: vuelve a estar libre para otro, con sus piezas
// borradas (una parcela libre es un solar). Para el delta, en vez de
// desaparecer se deja una lápida sin dueño ni piezas hasta que alguien la
// reclame: si simplemente se borrara, un cliente con `desde` nunca se
// enteraría de que ya no hay nada.
export function abandona(clave, jugador) {
  const m = load();
  const e = m.parcelas[clave];
  if (!e) return 'sin_reclamar';
  if (e.o !== jugador) return 'ajena';
  m.parcelas[clave] = { o: null, t: Date.now(), d: [] };
  const j = m.jugadores[jugador];
  if (j && j.p === clave) j.p = null;
  save();
  return null;
}

// --- presencia: quién está dónde ahora mismo (memoria, una instancia) ---
// El perfil (nombre, color, última posición) sí se persiste, con poca
// frecuencia, para que al volver aparezcas donde lo dejaste.
const vivos = new Map(); // id → {n, c, x, y, r, t}
const PRESENCIA_VIVA_MS = 12_000;
const RADIO_VECINOS_M = 400;
let ultimaPersistencia = 0;

export function presencia(id, datos) {
  const now = Date.now();
  const nombre = limpiaNombre(datos.nombre) || 'Alguien';
  const color = Number.isInteger(datos.color) && datos.color >= 0 && datos.color < COLORES.length ? datos.color : 0;
  const x = Number(datos.x);
  const y = Number(datos.y);
  const r = Number(datos.r) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  vivos.set(id, { n: nombre.slice(0, MAX_NOMBRE), c: color, x, y, r, t: now });

  const cerca = [];
  for (const [k, v] of vivos) {
    if (now - v.t > PRESENCIA_VIVA_MS) {
      vivos.delete(k);
      continue;
    }
    if (k === id) continue;
    if (Math.hypot(v.x - x, v.y - y) > RADIO_VECINOS_M) continue;
    cerca.push({ id: k, n: v.n, c: v.c, x: v.x, y: v.y, r: v.r });
  }

  // el perfil se guarda como mucho cada 20 s por proceso: es lo que hace
  // falta para volver a aparecer donde estabas, no un rastro
  if (now - ultimaPersistencia > 20_000) {
    ultimaPersistencia = now;
    const m = load();
    for (const [k, v] of vivos) {
      const j = m.jugadores[k] || (m.jugadores[k] = {});
      j.n = v.n;
      j.c = v.c;
      j.x = Math.round(v.x * 10) / 10;
      j.y = Math.round(v.y * 10) / 10;
      j.t = v.t;
    }
    save();
  }
  return { cerca, conectados: vivos.size };
}

// Dónde dejó su avatar este jugador y cuál es su parcela (o null: aparece en
// la plaza y no tiene ninguna)
export function estadoJugador(id) {
  const m = load();
  const j = m.jugadores[id];
  let p = null;
  for (const k of Object.keys(m.parcelas)) if (m.parcelas[k].o === id) p = k;
  if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y)) return { x: null, y: null, p };
  return { x: j.x, y: j.y, p };
}
