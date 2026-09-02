// Geometría del mundo: una rejilla infinita de parcelas cuadradas sobre un
// suelo plano. Sin dependencias: lo usan cliente y servidor.
//
// Coordenadas del mundo en metros: x hacia el este, y hacia el norte (en la
// escena 3D el norte es -z). La parcela (px, py) ocupa
// [px·PARCELA_M, (px+1)·PARCELA_M) × [py·PARCELA_M, (py+1)·PARCELA_M).
// La 0/0 es la plaza de llegada: pública, de todos, donde aparece quien entra.

export const PARCELA_M = 48;

export function parcelaDe(x, y) {
  return { px: Math.floor(x / PARCELA_M), py: Math.floor(y / PARCELA_M) };
}

export function claveParcela(px, py) {
  return px + '/' + py;
}

// «px/py» con enteros (negativos incluidos) y hasta 5 cifras: ±4.800 km de
// mundo, que es más de lo que nadie va a andar
export const RE_PARCELA = /^-?\d{1,5}\/-?\d{1,5}$/;

export function parseParcela(clave) {
  if (typeof clave !== 'string' || !RE_PARCELA.test(clave)) return null;
  const [a, b] = clave.split('/');
  return { px: Number(a), py: Number(b) };
}

// El centro de una parcela, en metros del mundo
export function centroParcela(px, py) {
  return { x: (px + 0.5) * PARCELA_M, y: (py + 0.5) * PARCELA_M };
}
