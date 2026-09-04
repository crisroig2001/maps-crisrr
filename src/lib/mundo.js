// Almacén del mundo: un JSON en DATA_DIR (volumen persistente en Coolify).
// Volumen de escrituras bajo → fichero plano con escritura atómica (tmp +
// rename), sin dependencias nativas. Solo servidor.
//
//   parcelas: { "px/py": { o: dueño, t: último cambio, d: [piezas],
//                          g: [ids a quien les gusta] } }
//   jugadores: { id: { n: nombre, c: color, p: "px/py" o null, x, y, t } }
//
// La presencia (quién está dónde AHORA) va aparte y en memoria: cambia cada
// segundo y no tiene sentido persistirla.
import fs from 'node:fs';
import path from 'node:path';
import { PARCELA_M, claveParcela } from './parcela';
import { validaPiezas, limpiaNombre, limpiaMensaje, COLORES, PELOS, PIELES, MAX_NOMBRE, EMOTES, MENSAJE_MS, EMOTE_MS, RE_JUGADOR } from './piezas';
import { tipoParcela, esPublica, piezasPublicas, RADIO_RESIDENCIAL } from './paisaje';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'mundo.json');
// Los reportes van en su propio fichero: no son el mundo, y así el moderador
// los lee (o los borra) sin tocar lo que la gente ha construido.
const FILE_REPORTES = path.join(DIR, 'reportes.json');

// Ids bloqueados, por variable de entorno (BLOQUEADOS=id1,id2). Sin cuentas
// esto no es una expulsión de verdad —quien la reciba puede vaciar el
// localStorage y volver con otro id—, pero cuesta algo y es la única palanca
// que hay hasta que existan cuentas. Para quien está bloqueado el mundo sigue
// igual, solo que nadie le ve ni le oye: si le dijéramos que está bloqueado,
// lo primero que haría es volver con otro id.
const BLOQUEADOS = new Set(
  (process.env.BLOQUEADOS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
export const estaBloqueado = (id) => BLOQUEADOS.has(id);

// cuántas parcelas puede reclamar un jugador. Una, de momento: el mundo se
// llena de vecinos, no de un solo constructor.
export const MAX_PARCELAS_POR_JUGADOR = 1;

// Tope de «me gusta» por parcela. Se guardan los ids (no un contador) porque
// hace falta saber si TÚ ya lo diste, para poder quitarlo; el tope es lo que
// impide que una parcela famosa se coma el fichero.
export const MAX_GUSTA = 500;

let cache = null;

// Versión de la semilla. Al cambiar el número, las parcelas del «mundo» (la
// plaza y la casa de muestra) se reescriben en el arranque: la semilla solo
// se creaba la primera vez y producción se quedaba con la muestra vieja.
const SEMILLA = 3;

// Lo público de serie: la plaza, los paseos, los parques y la casa de
// muestra, con dueño «mundo» (nadie las reclama ni las cambia). Sale del
// plano de src/lib/paisaje.js, determinista, así que sembrar dos veces da lo
// mismo.
function seed() {
  const t = Date.now();
  const parcelas = {};
  for (let px = -RADIO_RESIDENCIAL; px <= RADIO_RESIDENCIAL; px++) {
    for (let py = -RADIO_RESIDENCIAL; py <= RADIO_RESIDENCIAL; py++) {
      const tipo = tipoParcela(px, py);
      if (!esPublica(tipo)) continue;
      parcelas[claveParcela(px, py)] = { o: 'mundo', t, d: piezasPublicas(px, py) };
    }
  }
  return { semilla: SEMILLA, parcelas, jugadores: {} };
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
    // solo las parcelas del «mundo»: lo de los jugadores no se toca. Las
    // del mundo que ya no son públicas en el plano nuevo se borran.
    const nueva = seed();
    for (const k of Object.keys(cache.parcelas)) {
      if (cache.parcelas[k].o === 'mundo' && !nueva.parcelas[k]) delete cache.parcelas[k];
    }
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
//
// Con `jugador` va además lo que hace falta para el cartel: el NOMBRE del
// dueño (que si no, una casa es de un id de 24 letras y el mundo parece
// vacío aunque esté lleno), cuánta gente le ha dado a me gusta y si este
// jugador es una de ellas. Los ids de quién ha dado a me gusta NO salen del
// servidor: sale la cuenta.
export function getParcelas(caja, desde, jugador) {
  const m = load();
  const ps = m.parcelas;
  const out = [];
  for (const k of Object.keys(ps)) {
    const e = ps[k];
    if (desde && !(e.t > desde)) continue;
    if (caja) {
      const [px, py] = k.split('/').map(Number);
      if (px < caja.px0 || px > caja.px1 || py < caja.py0 || py > caja.py1) continue;
    }
    const p = { k, o: e.o, t: e.t, d: e.d || [] };
    if (e.o && e.o !== 'mundo') {
      p.n = m.jugadores[e.o]?.n || 'Alguien';
      if (e.g?.length) p.g = e.g.length;
      if (jugador && e.g?.includes(jugador)) p.mg = 1;
    }
    out.push(p);
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
export function reclama(clave, jugador, nombre) {
  if (BLOQUEADOS.has(jugador)) return 'bloqueado';
  const m = load();
  const [px, py] = clave.split('/').map(Number);
  // solo en la zona residencial: ni en el paseo, ni en el río, ni en el campo
  if (tipoParcela(px, py) !== 'residencial') return 'no_residencial';
  if (m.parcelas[clave]) return 'ocupada';
  const j = m.jugadores[jugador] || (m.jugadores[jugador] = { t: Date.now() });
  // el nombre viene con la petición: la presencia lo persiste cada 20 s, y
  // hasta entonces el cartel de una casa recién reclamada diría «Alguien»
  const n = limpiaNombre(nombre);
  if (n) j.n = n.slice(0, MAX_NOMBRE);
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
  if (BLOQUEADOS.has(jugador)) return 'bloqueado';
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

// Me gusta a la parcela de otro: se pone y se quita, uno por jugador. Es lo
// que hace que construir tenga público aunque no coincidáis conectados; por
// eso se guarda (a diferencia de lo que se dice, que se desvanece). Toca `t`
// para que el cambio viaje en el delta y lo vean todos.
export function gusta(clave, jugador) {
  const m = load();
  const e = m.parcelas[clave];
  if (!e || !e.o) return 'sin_reclamar';
  if (e.o === 'mundo') return 'del_mundo';
  if (e.o === jugador) return 'propia';
  const g = e.g || (e.g = []);
  const i = g.indexOf(jugador);
  if (i >= 0) g.splice(i, 1);
  else if (g.length >= MAX_GUSTA) return 'lleno';
  else g.push(jugador);
  e.t = Date.now();
  save();
  return null;
}

// --- reportes ---
// Reportar a alguien no le hace nada automáticamente: deja constancia para
// que una persona lo mire. Lo que dijo lo pone el SERVIDOR, de la presencia
// viva, no quien reporta: así el reporte no se puede inventar. Sin cuentas
// esto es lo honesto que se puede ser; lo demás lo decide el moderador
// mirando el fichero.
const MAX_REPORTES = 500;
const REPORTE_REPETIDO_MS = 30 * 60_000;
let reportes = null;

function cargaReportes() {
  if (reportes) return reportes;
  try {
    const v = JSON.parse(fs.readFileSync(FILE_REPORTES, 'utf8'));
    reportes = Array.isArray(v) ? v : [];
  } catch {
    reportes = []; // aún no hay ninguno
  }
  return reportes;
}

function guardaReportes() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE_REPORTES + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(reportes));
    fs.renameSync(tmp, FILE_REPORTES);
  } catch (e) {
    console.error('reportes save failed', e?.message);
  }
}

// {t, de, deNombre, a, aNombre, dijo, x, y}. Devuelve null si va bien, o el
// motivo: 'a_ti_mismo', 'no_esta' (no hay nadie con ese id ahora mismo) o
// 'ya' (mismo reporte hace nada).
//
// No se exporta: se llama desde presencia(), en este mismo módulo. Tuvo su
// propia ruta y no funcionaba: la presencia vive en memoria y en Next cada
// ruta puede acabar con SU copia del módulo, así que /api/reporte miraba un
// `vivos` vacío y los reportes salían sin lo que la persona dijo. La memoria
// de la presencia solo es de fiar en la ruta que la escribe.
function reporta(de, a) {
  if (de === a) return 'a_ti_mismo';
  const v = vivos.get(a);
  const m = load();
  const nombre = v?.n || m.jugadores[a]?.n;
  if (!nombre) return 'no_esta';
  const lista = cargaReportes();
  const now = Date.now();
  if (lista.some((r) => r.de === de && r.a === a && now - r.t < REPORTE_REPETIDO_MS)) return 'ya';
  lista.push({
    t: now,
    de,
    deNombre: vivos.get(de)?.n || m.jugadores[de]?.n || null,
    a,
    aNombre: nombre,
    dijo: v?.m || null, // lo que estaba diciendo, según el servidor
    x: v ? Math.round(v.x) : null,
    y: v ? Math.round(v.y) : null,
  });
  // los viejos se van cayendo: el fichero es una bandeja de entrada, no un
  // archivo histórico
  if (lista.length > MAX_REPORTES) lista.splice(0, lista.length - MAX_REPORTES);
  guardaReportes();
  return null;
}

// --- presencia: quién está dónde ahora mismo (memoria, una instancia) ---
// El perfil (nombre, color, última posición) sí se persiste, con poca
// frecuencia, para que al volver aparezcas donde lo dejaste.
// Lo que se dice (m: mensaje, e: gesto) vive AQUÍ y solo aquí: en memoria,
// con su instante, y caduca solo. No se persiste ni se lleva registro; una
// burbuja que ya no se ve no ha dejado rastro en ningún sitio.
const vivos = new Map(); // id → {n, c, p, s, x, y, r, t, m, mt, e, et}
const PRESENCIA_VIVA_MS = 12_000;
const RADIO_VECINOS_M = 400;
let ultimaPersistencia = 0;

export function presencia(id, datos) {
  const now = Date.now();
  // a quien está bloqueado no se le registra ni se le cuenta nada de nadie:
  // anda por un mundo vacío
  if (BLOQUEADOS.has(id)) return { cerca: [], conectados: vivos.size };
  const nombre = limpiaNombre(datos.nombre) || 'Alguien';
  const indice = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
  const color = indice(datos.color, COLORES.length);
  const pelo = indice(datos.p, PELOS.length);
  const piel = indice(datos.s, PIELES.length);
  const x = Number(datos.x);
  const y = Number(datos.y);
  const r = Number(datos.r) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // lo dicho se arrastra de un sondeo al siguiente mientras dure: el cliente
  // manda el mensaje UNA vez y la burbuja sigue viva para quien llegue luego
  const antes = vivos.get(id);
  const dicho = limpiaMensaje(datos.m);
  const gesto = typeof datos.e === 'string' && EMOTES[datos.e] ? datos.e : null;
  const mio = { n: nombre.slice(0, MAX_NOMBRE), c: color, p: pelo, s: piel, x, y, r, t: now };
  if (dicho) {
    mio.m = dicho;
    mio.mt = now;
  } else if (antes?.m && now - antes.mt < MENSAJE_MS) {
    mio.m = antes.m;
    mio.mt = antes.mt;
  }
  if (gesto) {
    mio.e = gesto;
    mio.et = now;
  } else if (antes?.e && now - antes.et < EMOTE_MS) {
    mio.e = antes.e;
    mio.et = antes.et;
  }
  vivos.set(id, mio);

  const cerca = [];
  for (const [k, v] of vivos) {
    if (now - v.t > PRESENCIA_VIVA_MS) {
      vivos.delete(k);
      continue;
    }
    if (k === id) continue;
    if (Math.hypot(v.x - x, v.y - y) > RADIO_VECINOS_M) continue;
    const d = { id: k, n: v.n, c: v.c, p: v.p, s: v.s, x: v.x, y: v.y, r: v.r };
    // el instante va con el dato: es lo que deja al cliente distinguir un
    // gesto nuevo de el mismo gesto repetido en tres sondeos seguidos
    if (v.m && now - v.mt < MENSAJE_MS) {
      d.m = v.m;
      d.mt = v.mt;
    }
    if (v.e && now - v.et < EMOTE_MS) {
      d.e = v.e;
      d.et = v.et;
    }
    cerca.push(d);
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
  const salida = { cerca, conectados: vivos.size };
  // Reportar viaja montado en el sondeo, como lo que se dice: se resuelve
  // aquí, donde está la presencia viva, y así el reporte puede llevar lo que
  // el reportado estaba diciendo según el servidor.
  if (typeof datos.reporta === 'string' && RE_JUGADOR.test(datos.reporta)) {
    salida.reporte = reporta(id, datos.reporta) || 'ok';
  }
  return salida;
}

// Dónde dejó su avatar este jugador, cuál es su parcela (o null: aparece en
// la plaza y no tiene ninguna) y a cuánta gente le gusta: eso último se
// manda estés donde estés, para poder avisarte al volver de que mientras no
// estabas alguien pasó por tu casa.
export function estadoJugador(id) {
  const m = load();
  const j = m.jugadores[id];
  let p = null;
  let g = 0;
  for (const k of Object.keys(m.parcelas)) {
    if (m.parcelas[k].o !== id) continue;
    p = k;
    g = m.parcelas[k].g?.length || 0;
  }
  if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y)) return { x: null, y: null, p, g };
  return { x: j.x, y: j.y, p, g };
}
