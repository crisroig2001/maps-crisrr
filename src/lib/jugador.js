// Identidad anónima del jugador: un id aleatorio guardado en localStorage.
// Solo cliente. Sirve para que la manzana que escaneas sea TUYA para decorar;
// no es una cuenta ni pretende serlo (ver adornos.js).
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

export function idJugador() {
  if (cache) return cache;
  try {
    const v = localStorage.getItem(CLAVE);
    if (v && /^[a-f0-9]{16,32}$/.test(v)) return (cache = v);
  } catch {
    /* modo privado o sin storage: el id vive lo que viva la pestaña */
  }
  cache = aleatorio();
  try {
    localStorage.setItem(CLAVE, cache);
  } catch {}
  return cache;
}
