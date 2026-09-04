// Perfil del jugador en este dispositivo: id aleatorio, nombre y color, en
// localStorage. Solo cliente. NO es una cuenta (eso viene después): identifica
// un dispositivo para que la parcela que reclamas sea tuya y tu avatar tenga
// nombre.
import { COLORES, PELOS, PIELES, limpiaNombre } from './piezas';

const CLAVE = 'crisrr_jugador';
let cache = null;

function aleatorio() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  } catch {}
  let s = '';
  while (s.length < 24) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

// Un número estable a partir del id, para el pelo y la piel de serie: como el
// color del marco de la parcela, sale del id y no hay que preguntar nada. Así
// dos vecinos no se parecen desde el primer día, y quien quiera lo cambia.
// Cada rasgo lleva su sufijo: si no, el pelo y la piel irían siempre a juego.
function delId(id, sufijo, n) {
  const s = id + sufijo;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

const indice = (v, n, sino) => (Number.isInteger(v) && v >= 0 && v < n ? v : sino);

function guarda(p) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p));
  } catch {
    /* modo privado o sin storage: el perfil vive lo que viva la pestaña */
  }
}

// {id, nombre (o null si aún no lo ha dicho), color de la ropa (índice en
//  COLORES), pelo (en PELOS), piel (en PIELES)}
// Un perfil viejo no llevaba pelo ni piel: le salen del id, así que al volver
// el avatar de siempre tiene cara propia sin haber tocado nada.
export function perfil() {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE));
    if (v && /^[a-f0-9]{16,32}$/.test(v.id)) {
      cache = {
        id: v.id,
        nombre: limpiaNombre(v.nombre),
        color: indice(v.color, COLORES.length, 0),
        pelo: indice(v.pelo, PELOS.length, delId(v.id, 'pelo', PELOS.length)),
        piel: indice(v.piel, PIELES.length, delId(v.id, 'piel', PIELES.length)),
      };
      return cache;
    }
  } catch {}
  const id = aleatorio();
  cache = {
    id,
    nombre: null,
    color: Math.floor(Math.random() * COLORES.length),
    pelo: delId(id, 'pelo', PELOS.length),
    piel: delId(id, 'piel', PIELES.length),
  };
  guarda(cache);
  return cache;
}

// Cuántos «me gusta» tenía tu parcela la última vez que te lo contamos. Vive
// en este dispositivo porque es un aviso, no un dato del mundo: sirve para
// decirte al volver que mientras no estabas alguien pasó por tu casa.
const CLAVE_GUSTA = 'crisrr_gusta_visto';

export function gustaVisto() {
  try {
    const n = Number(localStorage.getItem(CLAVE_GUSTA));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function guardaGustaVisto(n) {
  try {
    localStorage.setItem(CLAVE_GUSTA, String(n));
  } catch {
    /* modo privado o sin storage: se avisará otra vez */
  }
}

// A quién has silenciado, en este dispositivo. Es lo primero que protege a
// alguien y no necesita servidor ni cuentas: es TU decisión sobre TU pantalla,
// no un castigo para el otro (eso es reportar). Se guarda {id: nombre} para
// poder enseñar a quién silenciaste aunque no esté cerca.
const CLAVE_SILENCIO = 'crisrr_silenciados';
const MAX_SILENCIADOS = 200;

export function silenciados() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_SILENCIO));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function silencia(id, nombre) {
  const v = silenciados();
  v[id] = limpiaNombre(nombre) || 'Alguien';
  const ids = Object.keys(v);
  // los más viejos se caen: la lista no puede crecer sin techo
  for (const k of ids.slice(0, Math.max(0, ids.length - MAX_SILENCIADOS))) delete v[k];
  try {
    localStorage.setItem(CLAVE_SILENCIO, JSON.stringify(v));
  } catch {
    /* sin storage: el silencio dura lo que la pestaña */
  }
  return v;
}

export function quitaSilencio(id) {
  const v = silenciados();
  delete v[id];
  try {
    localStorage.setItem(CLAVE_SILENCIO, JSON.stringify(v));
  } catch {
    /* sin storage */
  }
  return v;
}

export function guardaPerfil(nombre, color, pelo, piel) {
  const p = perfil();
  p.nombre = limpiaNombre(nombre);
  p.color = indice(color, COLORES.length, p.color);
  p.pelo = indice(pelo, PELOS.length, p.pelo);
  p.piel = indice(piel, PIELES.length, p.piel);
  guarda(p);
  return p;
}
