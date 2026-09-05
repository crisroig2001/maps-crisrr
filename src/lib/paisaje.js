// El paisaje de serie: dónde van los ríos, el paseo, los parques y en qué
// parcelas se puede construir. Todo determinista y sin dependencias, porque
// lo usan el servidor (para sembrar lo público y decidir qué se reclama) y el
// cliente (para pintar el agua, hundir el terreno y no dejar andar por el
// río). El relieve de colinas está en el visor; aquí solo el cauce.
//
// Plano (en parcelas de 48 m; x al este, y al norte):
//   - la plaza de llegada en 0/0, con un PASEO de este a oeste (py = 0,
//     |px| ≤ 6) y otro hacia el sur (px = 0, py = -1..-4)
//   - un RÍO de norte a sur al este de la plaza (x ≈ 4,5 parcelas) y otro de
//     este a oeste al sur (y ≈ -3,5 parcelas), con un puente donde los
//     cruza el paseo
//   - tres PARQUES públicos con árboles, rocas y bancos
//   - alrededor, hasta 9 parcelas de la plaza, la ZONA RESIDENCIAL, que es la
//     única donde se puede reclamar; más allá, campo
import { PARCELA_M as L } from './parcela';

export const RIO_ANCHO = 9; // semiancho del agua, en metros
export const RIO_ORILLA = 11; // pendiente desde el agua hasta el nivel normal
export const LECHO = -2.4; // altura del fondo del río
export const NIVEL_AGUA = -0.9;
// El agua es un plano a NIVEL_AGUA que solo existe en la banda del río: fuera
// de ella se hunde (si no, aparecía un lago en cualquier valle de las colinas).
export const BANDA_AGUA = RIO_ANCHO + RIO_ORILLA;
export const RADIO_RESIDENCIAL = 9; // parcelas desde la plaza

// centro del río del este (x en función de y) y del río del sur (y de x)
export function rioEsteX(y) {
  return 4.5 * L + 26 * Math.sin(y * 0.011) + 10 * Math.sin(y * 0.031 + 1.7);
}
export function rioSurY(x) {
  return -3.5 * L + 26 * Math.sin(x * 0.009 + 0.6) + 10 * Math.sin(x * 0.027);
}
// Los puentes: donde el paseo cruza el río del este (y = L/2) y donde el
// paseo del sur cruza el del sur (x = L/2). En esos tramos el terreno no se
// hunde y el agua no corta el paso.
const PUENTE_ANCHO = 7;

function suave(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

// Distancia al río más cercano: {d, cual, puente}. La distancia es la
// horizontal (o vertical) al centro, que para un río que serpentea poco es
// lo bastante buena.
export function distRio(x, y) {
  const dE = Math.abs(x - rioEsteX(y));
  const dS = Math.abs(y - rioSurY(x));
  if (dE <= dS) return { d: dE, cual: 'este', puente: Math.abs(y - L / 2) < PUENTE_ANCHO };
  return { d: dS, cual: 'sur', puente: Math.abs(x - L / 2) < PUENTE_ANCHO };
}

export function enAgua(x, y) {
  const r = distRio(x, y);
  return r.d < RIO_ANCHO && !r.puente;
}

// Cuánto manda el cauce en (x, y): 0 lejos del río, 1 en el agua. El
// terreno se mezcla con el LECHO según este factor, así el fondo queda
// siempre bajo el agua sea cual sea la colina. Bajo un puente no se hunde
// (el puente es un paso elevado sobre tierra firme), con transición de 4 m.
export function cauce(x, y) {
  const r = distRio(x, y);
  if (r.d > RIO_ANCHO + RIO_ORILLA) return 0;
  const hondo = 1 - suave((r.d - RIO_ANCHO) / RIO_ORILLA);
  const lejosDelPuente = r.cual === 'este' ? suave((Math.abs(y - L / 2) - PUENTE_ANCHO) / 4) : suave((Math.abs(x - L / 2) - PUENTE_ANCHO) / 4);
  return hondo * lejosDelPuente;
}

// La misma función en GLSL, para el vertex shader del suelo.
export const GLSL_CAUCE = `
float suaveP(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float rioEsteX(float y) { return ${(4.5 * L).toFixed(1)} + 26.0 * sin(y * 0.011) + 10.0 * sin(y * 0.031 + 1.7); }
float rioSurY(float x) { return ${(-3.5 * L).toFixed(1)} + 26.0 * sin(x * 0.009 + 0.6) + 10.0 * sin(x * 0.027); }
float distRioG(float x, float y) { return min(abs(x - rioEsteX(y)), abs(y - rioSurY(x))); }
float cauce(float x, float y) {
  float dE = abs(x - rioEsteX(y));
  float dS = abs(y - rioSurY(x));
  float d = min(dE, dS);
  float lejosPuente = dE <= dS ? suaveP((abs(y - ${(L / 2).toFixed(1)}) - ${PUENTE_ANCHO.toFixed(1)}) / 4.0) : suaveP((abs(x - ${(L / 2).toFixed(1)}) - ${PUENTE_ANCHO.toFixed(1)}) / 4.0);
  float hondo = 1.0 - suaveP((d - ${RIO_ANCHO.toFixed(1)}) / ${RIO_ORILLA.toFixed(1)});
  return hondo * lejosPuente;
}`;

// Parques públicos: cajas de parcelas [px0, px1, py0, py1]
const PARQUES = [
  [-4, -3, 2, 3],
  [2, 3, 2, 3],
  [-3, -2, -3, -2],
];

// Qué es cada parcela: 'plaza' | 'paseo' | 'rio' | 'parque' | 'muestra' |
// 'residencial' | 'campo'. Solo en 'residencial' se puede reclamar.
export function tipoParcela(px, py) {
  if (px === 0 && py === 0) return 'plaza';
  if (px === 1 && py === 1) return 'muestra';
  if (py === 0 && Math.abs(px) <= 6) return 'paseo';
  if (px === 0 && py <= -1 && py >= -4) return 'paseo';
  // el río pasa por la parcela si su centro cruza alguna de sus filas o columnas
  for (let i = 0; i <= 4; i++) {
    const y = (py + i / 4) * L;
    const xr = rioEsteX(y);
    if (xr > px * L - RIO_ANCHO && xr < (px + 1) * L + RIO_ANCHO) return 'rio';
    const x = (px + i / 4) * L;
    const yr = rioSurY(x);
    if (yr > py * L - RIO_ANCHO && yr < (py + 1) * L + RIO_ANCHO) return 'rio';
  }
  for (const [x0, x1, y0, y1] of PARQUES) if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return 'parque';
  if (Math.abs(px) <= RADIO_RESIDENCIAL && Math.abs(py) <= RADIO_RESIDENCIAL) return 'residencial';
  return 'campo';
}

export function esPublica(tipo) {
  return tipo === 'plaza' || tipo === 'paseo' || tipo === 'parque' || tipo === 'muestra';
}
// las que llevan suelo de piedra
export function conSuelo(tipo) {
  return tipo === 'plaza' || tipo === 'paseo';
}

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Las piezas de serie de una parcela pública (determinista por parcela).
// Las coordenadas van en metros dentro de la parcela.
export function piezasPublicas(px, py) {
  const tipo = tipoParcela(px, py);
  const bx = px * L;
  const by = py * L;
  const seco = (x, y) => !enAgua(bx + x, by + y) && distRio(bx + x, by + y).d > RIO_ANCHO + 3;
  const out = [];
  if (tipo === 'plaza') {
    out.push(
      { t: 'fuente', x: L / 2, y: L / 2, r: 0, c: 0 },
      { t: 'bandera', x: L / 2, y: L / 2 + 10, r: 0, c: 1 },
      { t: 'banco', x: L / 2 - 7, y: L / 2, r: 1, c: 0 },
      { t: 'banco', x: L / 2 + 7, y: L / 2, r: 3, c: 0 },
      { t: 'banco', x: L / 2, y: L / 2 - 7, r: 0, c: 0 },
      { t: 'farola', x: 8, y: 8, r: 0, c: 0 },
      { t: 'farola', x: L - 8, y: 8, r: 0, c: 0 },
      { t: 'farola', x: 8, y: L - 8, r: 0, c: 0 },
      { t: 'farola', x: L - 8, y: L - 8, r: 0, c: 0 },
      { t: 'roble', x: 6, y: L / 2 + 8, r: 0, c: 0 },
      { t: 'arbol', x: L - 6, y: L / 2 + 8, r: 0, c: 0 },
      { t: 'palmera', x: L / 2, y: L - 6, r: 0, c: 0 },
      { t: 'flores', x: L / 2 - 5, y: L / 2 + 6, r: 0, c: 1 },
      { t: 'flores-amarillas', x: L / 2 + 5, y: L / 2 + 6, r: 0, c: 3 },
      { t: 'maceta', x: L / 2 - 4, y: L / 2 - 4, r: 0, c: 0 },
      { t: 'maceta', x: L / 2 + 4, y: L / 2 - 4, r: 0, c: 0 }
    );
    // Los caminos que salen hacia los paseos. OJO CON EL GIRO: la losa
    // (`camino.glb`, path_stone) mide 4,0 × 2,3 m, o sea que con r = 0 el
    // lado LARGO va en x. Un tramo que avanza de 4 en 4 tiene que llevar sus
    // 4 m en la dirección en que avanza, o entre losa y losa quedan 1,7 m de
    // hierba y el camino sale a trozos: en x, r = 0; en y, r = 1. Es la misma
    // regla que ya seguían las vallas de la casa de muestra.
    // los caminos que salen hacia los paseos
    for (let x = 2; x < L; x += 4) if (Math.abs(x - L / 2) > 9) out.push({ t: 'camino', x, y: L / 2, r: 0, c: 0 });
    for (let y = 2; y < L / 2 - 9; y += 4) out.push({ t: 'camino', x: L / 2, y, r: 1, c: 0 });
    return out;
  }
  if (tipo === 'paseo') {
    const horizontal = py === 0;
    const rnd = prng(px * 7919 + py * 104729 + 3);
    for (let i = 2; i < L; i += 4) {
      const x = horizontal ? i : L / 2;
      const y = horizontal ? L / 2 : i;
      // sobre el río va el puente; en la orilla, nada (ya lo hunde el cauce)
      const r = distRio(bx + x, by + y);
      out.push({ t: r.d < RIO_ANCHO + 4 ? 'puente' : 'camino', x, y, r: horizontal ? 0 : 1, c: 0 });
    }
    const lado = (k) => (horizontal ? { x: k, y: L / 2 } : { x: L / 2, y: k });
    const aparte = (p, d) => (horizontal ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y });
    for (const k of [8, 40]) {
      const a = aparte(lado(k), 6);
      const b = aparte(lado(k), -6);
      if (seco(a.x, a.y)) out.push({ t: 'farola', ...a, r: 0, c: 0 });
      if (seco(b.x, b.y)) out.push({ t: 'farola', ...b, r: 0, c: 0 });
    }
    for (const k of [16, 32]) {
      const a = aparte(lado(k), 11);
      const b = aparte(lado(k), -11);
      if (seco(a.x, a.y)) out.push({ t: rnd() < 0.5 ? 'roble' : 'arbol', ...a, r: 0, c: 0 });
      if (seco(b.x, b.y)) out.push({ t: rnd() < 0.5 ? 'arbol' : 'roble', ...b, r: 0, c: 0 });
    }
    const banco = aparte(lado(24), -5);
    if (seco(banco.x, banco.y)) out.push({ t: 'banco', ...banco, r: horizontal ? 0 : 1, c: 0 });
    const flor = aparte(lado(24), 5);
    if (seco(flor.x, flor.y)) out.push({ t: rnd() < 0.5 ? 'flores' : 'flores-moradas', ...flor, r: 0, c: 0 });
    return out;
  }
  if (tipo === 'parque') {
    const rnd = prng(px * 7919 + py * 104729 + 11);
    const arboles = ['roble', 'arbol', 'pino', 'arbol', 'roble', 'palmera'];
    const n = 7 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const x = 4 + rnd() * (L - 8);
      const y = 4 + rnd() * (L - 8);
      if (seco(x, y)) out.push({ t: arboles[Math.floor(rnd() * arboles.length)], x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.floor(rnd() * 4), c: 0 });
    }
    const otros = ['arbusto', 'arbusto', 'roca', 'rocas', 'flores', 'flores-amarillas', 'flores-moradas', 'setas', 'tronco'];
    const m = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < m; i++) {
      const x = 3 + rnd() * (L - 6);
      const y = 3 + rnd() * (L - 6);
      if (seco(x, y)) out.push({ t: otros[Math.floor(rnd() * otros.length)], x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.floor(rnd() * 4), c: 0 });
    }
    const b = { x: 8 + rnd() * (L - 16), y: 8 + rnd() * (L - 16) };
    if (seco(b.x, b.y)) out.push({ t: 'banco', x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, r: Math.floor(rnd() * 4), c: 0 });
    return out;
  }
  if (tipo === 'muestra') {
    out.push(
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
      { t: 'calabaza', x: 10, y: L / 2 + 13.5, r: 1, c: 0 }
    );
    for (let x = 2; x < L / 2; x += 4) out.push({ t: 'camino', x, y: L / 2 - 8, r: 0, c: 0 });
    out.push({ t: 'camino', x: L / 2, y: L / 2 - 4, r: 1, c: 0 });
    for (let i = 0; i < 12; i++) out.push({ t: 'valla', x: 2 + i * 4, y: 2, r: 0, c: 0 });
    for (let i = 0; i < 12; i++) out.push({ t: 'valla', x: 2 + i * 4, y: L - 2, r: 0, c: 0 });
    for (let i = 0; i < 11; i++) out.push({ t: 'valla', x: L - 2, y: 4 + i * 4, r: 1, c: 0 });
    return out;
  }
  return out;
}
