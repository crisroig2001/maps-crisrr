// Perfil del jugador en este dispositivo: id aleatorio, nombre y color, en
// localStorage. Solo cliente. NO es una cuenta (eso viene después): identifica
// un dispositivo para que la parcela que reclamas sea tuya y tu avatar tenga
// nombre.
import { COLORES, limpiaNombre } from './piezas';

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

function guarda(p) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p));
  } catch {
    /* modo privado o sin storage: el perfil vive lo que viva la pestaña */
  }
}

// {id, nombre (o null si aún no lo ha dicho), color (índice en COLORES)}
export function perfil() {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE));
    if (v && /^[a-f0-9]{16,32}$/.test(v.id)) {
      cache = {
        id: v.id,
        nombre: limpiaNombre(v.nombre),
        color: Number.isInteger(v.color) && v.color >= 0 && v.color < COLORES.length ? v.color : 0,
      };
      return cache;
    }
  } catch {}
  cache = { id: aleatorio(), nombre: null, color: Math.floor(Math.random() * COLORES.length) };
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

export function guardaPerfil(nombre, color) {
  const p = perfil();
  p.nombre = limpiaNombre(nombre);
  if (Number.isInteger(color) && color >= 0 && color < COLORES.length) p.color = color;
  guarda(p);
  return p;
}
