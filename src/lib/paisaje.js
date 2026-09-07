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
//   - la URBANIZACIÓN alrededor del paseo del sur y a lo largo del del este,
//     entre los dos ríos: calles por las lindes, doce casas hechas (en venta),
//     una zona común y solares libres
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

// Hacia dónde CORRE el río en un punto: la tangente de su eje. El rizado del
// agua se calcula en estas coordenadas, así que las ondas bajan con la
// corriente en vez de cruzar el cauce en diagonal como si fuera un mar.
// Recibe coordenadas del mundo (y al norte) y devuelve el vector en XZ —con
// el z = -y ya aplicado—, que es donde vive el shader del agua.
export const GLSL_FLUJO = `
vec2 flujoRio(float x, float y) {
  float dE = abs(x - rioEsteX(y));
  float dS = abs(y - rioSurY(x));
  vec2 t = dE <= dS
    ? vec2(26.0 * 0.011 * cos(y * 0.011) + 10.0 * 0.031 * cos(y * 0.031 + 1.7), 1.0)
    : vec2(1.0, 26.0 * 0.009 * cos(x * 0.009 + 0.6) + 10.0 * 0.027 * cos(x * 0.027));
  return normalize(vec2(t.x, -t.y));
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
  // el barrio: las casas hechas y la zona común; sus solares libres siguen
  // siendo 'residencial', que es lo que los hace reclamables
  if (CASAS[px + '/' + py]) return 'barrio';
  if (COMUNES.has(px + '/' + py)) return 'comun';
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

// Dónde se puede reclamar: en un solar de la zona residencial, y en una casa
// del barrio (que nace en venta, y si su dueño la abandona vuelve a ser solar)
export function esReclamable(tipo) {
  return tipo === 'residencial' || tipo === 'barrio';
}
export function esPublica(tipo) {
  return tipo === 'plaza' || tipo === 'paseo' || tipo === 'parque' || tipo === 'muestra' || tipo === 'barrio' || tipo === 'comun';
}
// las que llevan suelo de piedra
export function conSuelo(tipo) {
  return tipo === 'plaza' || tipo === 'paseo';
}

// --- la urbanización ---
// Un barrio de serie al sur del paseo del este, entre los dos ríos: calles de
// verdad (las baldosas del City Kit Roads) por las LINDES de las parcelas,
// casas ya hechas con su jardín, una zona común con fuente y solares libres
// en medio, que se reclaman como cualquier otro. Es lo que hace que quien
// llega vea un sitio habitado y no una pradera con una casa de muestra; y los
// solares de en medio son los que más apetece reclamar, que es la idea.
//
// Las calles NO se guardan en ninguna parcela. Salen de este plano y el visor
// las pinta encima de lo que haya, sea de quien sea la parcela (la mitad de
// una calle cae en un solar que alguien puede reclamar, y una parcela
// reclamada guarda solo lo suyo). Lo único que cambia para el dueño de un
// solar del barrio es que los 4 m de calle que le tocan no se construyen:
// `enCalle` lo mira el servidor al guardar y el visor al colocar.
export const CALLE_ANCHO = 8; // una baldosa del kit, a la escala de sus casas
const CALLE_SEMI = CALLE_ANCHO / 2;
// Tramos por el CENTRO de la calzada, en metros del mundo, de centro de la
// primera baldosa a centro de la última. Van por las lindes —múltiplos de 48,
// que lo son de 8—, así que cada calle deja 4 m a cada parcela que separa y
// a ninguna se le come más que eso. Las baldosas caen en múltiplos de 8, que
// es lo que hace que un cruce con la linde de al lado case sin cortar nada.
const CALLES = [
  { y: -48, x0: -288, x1: 176 }, // la principal: de la punta oeste al río del este, cruzando el paseo del sur
  { y: -96, x0: -288, x1: -144 }, // la de abajo, solo en la manzana del oeste: acaba en el parque
  { x: -192, y0: -144, y1: 96 }, // la del oeste: del parque del noroeste al río del sur, cruzando el paseo
  { x: -96, y0: -48, y1: 96 }, // la del medio: de la fila norte a la principal (más al sur partiría el parque en dos)
  { x: 96, y0: -96, y1: 0 }, // la del este: del paseo al río del sur
];
// Las casas hechas: qué casa, a qué calle mira (`cara`: s/e/n/w) y `u`, dónde
// está a lo largo de su calle, en el marco canónico de `casaDeSerie` (la
// calle al sur, u de oeste a este). Tiene que ser múltiplo de 8 para que la
// entrada de coches caiga en una baldosa. La del -1/-2 va corrida a 32
// porque su vecina de enfrente, la -1/-1, ya tiene la entrada en la baldosa
// de en medio y una baldosa no puede tener entrada a los dos lados.
// `valla` es el tinte de la valla, el buzón, el tendedero y el borde de la
// piscina (índice de COLORES): el 0 es el naranja del kit, que ya manda
// bastante en el mundo. `piscina`: lleva piscina en el jardín de atrás.
// Todas nacen EN VENTA: quien las reclama se las queda con todo lo de dentro.
const CASAS = {
  // al norte del paseo del este, mirando a las calles que suben
  '-5/1': { casa: 'mirador', cara: 'e', u: 24, valla: 7, piscina: true },
  '-3/1': { casa: 'casa', cara: 'e', u: 24, valla: 2 },
  // la acera norte de la calle principal
  '-6/-1': { casa: 'moderna', cara: 's', u: 24, valla: 5, piscina: true },
  '-4/-1': { casa: 'casa-d', cara: 's', u: 24, valla: 7, piscina: true },
  '-3/-1': { casa: 'casa-c', cara: 's', u: 24, valla: 7 },
  '-1/-1': { casa: 'cochera', cara: 's', u: 24, valla: 5 },
  '1/-1': { casa: 'casa-b', cara: 's', u: 24, valla: 2 },
  '3/-1': { casa: 'villa', cara: 's', u: 24, valla: 7, piscina: true }, // la de la orilla
  // la acera sur
  '-5/-2': { casa: 'casa', cara: 'n', u: 24, valla: 4 },
  '-1/-2': { casa: 'bungalo', cara: 'n', u: 32, valla: 4 },
  // la calle de abajo, en la manzana del oeste
  '-6/-3': { casa: 'casa-b', cara: 'n', u: 24, valla: 2 },
  '-4/-3': { casa: 'bungalo', cara: 'n', u: 24, valla: 7, piscina: true },
};
// La zona común: fuente, bancos, arenero y merendero, sin valla
const COMUNES = new Set(['1/-2']);

// Todas las baldosas, por el centro: 'X,Y' → {X, Y}
const BALDOSAS = new Map();
for (const c of CALLES) {
  if (c.y !== undefined) for (let x = c.x0; x <= c.x1; x += CALLE_ANCHO) BALDOSAS.set(x + ',' + c.y, { X: x, Y: c.y });
  else for (let y = c.y0; y <= c.y1; y += CALLE_ANCHO) BALDOSAS.set(c.x + ',' + y, { X: c.x, Y: y });
}
const hayBaldosa = (X, Y) => BALDOSAS.has(X + ',' + Y);
// La caja de parcelas que tienen algún trozo de calle: es lo que el visor
// recorre para pintarlas (una parcela sin nada guardado no está en su mapa).
export const CAJA_CALLES = { px0: Infinity, py0: Infinity, px1: -Infinity, py1: -Infinity };
for (const { X, Y } of BALDOSAS.values()) {
  const px = Math.floor(X / L);
  const py = Math.floor(Y / L);
  CAJA_CALLES.px0 = Math.min(CAJA_CALLES.px0, px);
  CAJA_CALLES.px1 = Math.max(CAJA_CALLES.px1, px);
  CAJA_CALLES.py0 = Math.min(CAJA_CALLES.py0, py);
  CAJA_CALLES.py1 = Math.max(CAJA_CALLES.py1, py);
}

// ¿Cae (x, y) del mundo en una calzada? Con `margen`, también a esa
// distancia de ella (para no plantar un árbol con el tronco en el bordillo).
export function enCalle(wx, wy, margen = 0) {
  const m = CALLE_SEMI + margen;
  for (const c of CALLES) {
    if (c.y !== undefined) {
      if (Math.abs(wy - c.y) < m && wx > c.x0 - m && wx < c.x1 + m) return true;
    } else if (Math.abs(wx - c.x) < m && wy > c.y0 - m && wy < c.y1 + m) return true;
  }
  return false;
}

// Por qué lados de la parcela pasa una calle: {s, e, n, w}. La losa del paseo
// se recorta por el lado que diga esto, y las casas de serie ponen la valla
// más adentro por ahí. Hacen falta DOS baldosas en la linde: una sola es el
// cruce de la calle de al lado tocando la esquina, no una calle por ese lado.
export function ladosCalle(px, py) {
  const bx = px * L;
  const by = py * L;
  const n = { s: 0, e: 0, n: 0, w: 0 };
  for (const { X, Y } of BALDOSAS.values()) {
    const enX = X >= bx && X < bx + L;
    const enY = Y >= by && Y < by + L;
    if (enX && Y === by) n.s++;
    if (enX && Y === by + L) n.n++;
    if (enY && X === bx) n.w++;
    if (enY && X === bx + L) n.e++;
  }
  return { s: n.s >= 2, e: n.e >= 2, n: n.n >= 2, w: n.w >= 2 };
}

// Qué baldosa va en cada sitio, por lo que tiene alrededor. Los giros salen
// de la geometría de los modelos (la acera es lo que está levantado):
//   calle        r=0 va de este a oeste; r=1, de norte a sur
//   calle-curva  r=0 une sur y este; cada cuarto de vuelta gira eso en
//                sentido antihorario visto desde arriba (r=1 este-norte…)
//   calle-t      r=0 cerrada por el norte (sale por oeste, este y sur)
//   calle-final  r=0 cerrada por el oeste (la calle llega por el este)
//   calle-entrada r=0 la entrada de coches sale hacia el sur
//   paso-cebra   como la calle
// Un giro (`r`) de una pieza es antihorario desde arriba: lo que está al
// este pasa al norte.
function baldosa(X, Y) {
  const n = hayBaldosa(X, Y + CALLE_ANCHO);
  const s = hayBaldosa(X, Y - CALLE_ANCHO);
  const e = hayBaldosa(X + CALLE_ANCHO, Y);
  const w = hayBaldosa(X - CALLE_ANCHO, Y);
  const k = n + s + e + w;
  if (k === 4) return { t: 'calle-cruce', r: 0 };
  if (k === 3) return { t: 'calle-t', r: !n ? 0 : !w ? 1 : !s ? 2 : 3 };
  if (k === 2) {
    if (e && w) return { t: 'calle', r: 0 };
    if (n && s) return { t: 'calle', r: 1 };
    if (s && e) return { t: 'calle-curva', r: 0 };
    if (e && n) return { t: 'calle-curva', r: 1 };
    if (n && w) return { t: 'calle-curva', r: 2 };
    return { t: 'calle-curva', r: 3 };
  }
  return { t: 'calle-final', r: e ? 0 : n ? 1 : w ? 2 : 3 };
}
// Las baldosas que no salen de lo de alrededor: el paso de cebra donde el
// paseo del sur cruza la calle principal, y la entrada de coches de cada casa
const ESPECIALES = new Map([
  ['24,-48', { t: 'paso-cebra', r: 0 }],
  ['-96,24', { t: 'paso-cebra', r: 1 }],
  ['-192,24', { t: 'paso-cebra', r: 1 }],
]);
const CARA_K = { s: 0, e: 1, n: 2, w: 3 }; // cuartos de vuelta del marco canónico
for (const [k, def] of Object.entries(CASAS)) {
  const [px, py] = k.split('/').map(Number);
  const g = CARA_K[def.cara];
  // dónde cae la entrada en el mundo, según a qué lado mira la casa
  const X = g === 0 ? px * L + def.u : g === 1 ? (px + 1) * L : g === 2 ? px * L + (L - def.u) : px * L;
  const Y = g === 0 ? py * L : g === 1 ? py * L + def.u : g === 2 ? (py + 1) * L : py * L + (L - def.u);
  // solo si ahí hay un tramo recto: en un cruce no cabe una entrada
  if (hayBaldosa(X, Y) && baldosa(X, Y).t === 'calle') ESPECIALES.set(X + ',' + Y, { t: 'calle-entrada', r: (g + 2) % 4 });
}

// Del marco canónico (la calle al sur, u de oeste a este, v desde la calle
// hacia dentro) a las coordenadas de la parcela, girando k cuartos de vuelta
function gira(k, u, v) {
  if (k === 1) return { x: L - v, y: u };
  if (k === 2) return { x: L - u, y: L - v };
  if (k === 3) return { x: v, y: L - u };
  return { x: u, y: v };
}
function pon(out, k, t, u, v, r = 0, c = 0) {
  const p = gira(k, u, v);
  out.push({ t, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, r: (r + k) % 4, c });
}

// Lo que el visor pinta de la calle en una parcela, esté guardada o no: las
// baldosas de calzada que le tocan, las farolas de su acera y un cartel a la
// entrada si es un solar libre del barrio (`senal` = 'solar') o una casa en
// venta ('venta': en la puerta de las casas de serie, y a pie de calle en las
// de la gente). En metros de la parcela, como las piezas de verdad. NO se
// guarda: se pinta encima de lo que haya.
export function piezasCalle(px, py, senal) {
  const bx = px * L;
  const by = py * L;
  const out = [];
  for (const { X, Y } of BALDOSAS.values()) {
    if (X < bx || X >= bx + L || Y < by || Y >= by + L) continue;
    const b = ESPECIALES.get(X + ',' + Y) || baldosa(X, Y);
    out.push({ t: b.t, x: X - bx, y: Y - by, r: b.r, c: 0 });
  }
  const lados = ladosCalle(px, py);
  // las farolas, sobre la acera (la baldosa lleva 1 m de acera a cada lado)
  // y a 12 y 36 m de la esquina; solo donde de verdad hay calzada, que un
  // tramo puede acabar a media parcela (con margen negativo: en el último
  // medio metro de la última baldosa no se planta)
  for (const k of [12, 36]) {
    if (lados.s && enCalle(bx + k, by, -0.5)) out.push({ t: 'farola', x: k, y: 3.2, r: 0, c: 0 });
    if (lados.n && enCalle(bx + k, by + L, -0.5)) out.push({ t: 'farola', x: k, y: L - 3.2, r: 0, c: 0 });
    if (lados.w && enCalle(bx, by + k, -0.5)) out.push({ t: 'farola', x: 3.2, y: k, r: 0, c: 0 });
    if (lados.e && enCalle(bx + L, by + k, -0.5)) out.push({ t: 'farola', x: L - 3.2, y: k, r: 0, c: 0 });
  }
  if (senal) {
    const def = CASAS[px + '/' + py];
    if (senal === 'venta' && def) pon(out, CARA_K[def.cara], 'cartel', def.u - 3.5, 5.2); // junto a la puerta de la valla
    else {
      // mirando a su calle (a la principal si la tiene); sin calle, nada:
      // el cartel que flota sobre la parcela ya lo dice
      const k = lados.s ? 0 : lados.n ? 2 : lados.e ? 1 : lados.w ? 3 : -1;
      if (k >= 0) pon(out, k, 'cartel', 24, 5.6);
    }
  }
  return out;
}

// Una casa hecha, con su jardín, en el marco canónico: la calle al sur, la
// valla a 6 m de la linde por los lados con calle (4 de calzada y 2 de
// hierba) y a 2 por los demás, la casa mirando a la calle con su camino,
// su buzón y sus flores, y detrás el jardín de estar. Cada una varía un poco
// por su semilla: los árboles, las flores y lo que hay en la parte de atrás.
function casaDeSerie(px, py, def) {
  const k = CARA_K[def.cara];
  const lados = ladosCalle(px, py);
  const actual = [lados.s, lados.e, lados.n, lados.w];
  const calleEn = (c) => actual[(c + k) % 4]; // lado canónico c → lado real
  const iS = 6;
  const iE = calleEn(1) ? 6 : 2;
  const iN = calleEn(2) ? 6 : 2;
  const iW = calleEn(3) ? 6 : 2;
  const uC = def.u;
  const vF = L - iN; // la valla del fondo
  const rnd = prng(px * 7919 + py * 104729 + 23);
  const out = [];
  const P = (t, u, v, r = 0, c = 0) => pon(out, k, t, u, v, r, c);
  // la valla, con la puerta delante del camino
  for (let u = iW + 2; u + 2 <= L - iE + 0.01; u += 4) {
    if (Math.abs(u - uC) >= 4) P('valla', u, iS, 0, def.valla);
    P('valla', u, vF, 0, def.valla);
  }
  for (let v = iS + 2; v + 2 <= vF + 0.01; v += 4) {
    P('valla', iW, v, 1, def.valla);
    P('valla', L - iE, v, 1, def.valla);
  }
  P(def.casa, uC, 27);
  for (let v = 8; v <= 20; v += 4) P('camino', uC, v, 1);
  P('buzon', uC + 3.5, 5.2, 0, def.valla);
  const flores = ['flores', 'flores-amarillas', 'flores-moradas'];
  const f0 = Math.floor(rnd() * 3);
  P(flores[f0], uC - 2.4, 9.5);
  P(flores[(f0 + 1) % 3], uC + 2.4, 12.5);
  P(flores[(f0 + 2) % 3], uC - 2.4, 17);
  P('arbusto', uC - 7.5, 21.5);
  P('arbusto', uC + 7.5, 21.5);
  P('maceta', uC + 3.4, 21.8);
  // los árboles de las esquinas de atrás, y uno pequeño delante
  P(rnd() < 0.5 ? 'roble' : 'arbol', iW + 5, vF - 5);
  P(rnd() < 0.5 ? 'arbol' : 'roble', L - iE - 5, vF - 5);
  P(['pino', 'palmera', 'pino'][Math.floor(rnd() * 3)], L - iE - 4.5, 11);
  P('rocas', iW + 4, iS + 4);
  // el jardín de estar: merendero a un lado, banco al otro, y detrás de la
  // casa un tendedero o un arenero
  P('mesa', uC - 9, 37);
  P('silla', uC - 10.5, 37, 1);
  P('silla', uC - 7.5, 37, 3);
  P('barbacoa', uC - 9, 41);
  if (def.piscina) {
    // la piscina a un lado del jardín, con dos sillas mirándola
    P('piscina', uC + 8, 37.5, 0, def.valla);
    P('silla', uC + 6, 34, 2);
    P('silla', uC + 10, 34, 2);
  } else P('banco', uC + 9, 36, 0);
  P(rnd() < 0.5 ? 'tendedero' : 'arenero', uC, vF - 3.2, 0, def.valla);
  return out;
}

// La zona común del barrio: una fuente en un patio con bancos, un arenero,
// un merendero y árboles, y dos caminos que entran desde sus dos calles.
// En metros de la parcela; hecha para la 1/-2, que tiene calle al norte y al
// este, pero sin nada a menos de 6 m de ninguna linde, así que valdría en
// cualquier otra.
function comunDeSerie() {
  const out = [];
  const P = (t, x, y, r = 0, c = 0) => out.push({ t, x, y, r, c });
  P('patio-g', 22, 22, 0, 0);
  P('fuente', 22, 22);
  P('banco', 22, 15, 2);
  P('banco', 15, 22, 1);
  P('banco', 18.5, 30, 0);
  P('banco', 25.5, 30, 0);
  P('banco', 30, 18.5, 3);
  P('banco', 30, 25.5, 3);
  for (const [x, y] of [[15, 15], [29, 15], [15, 29], [29, 29]]) P('farola', x, y);
  for (let y = 30; y <= 42; y += 4) P('camino', 22, y, 1);
  for (let x = 30; x <= 42; x += 4) P('camino', x, 22, 0);
  P('bandera', 22, 12, 0, 5);
  // el arenero y el merendero
  P('arenero', 9, 9);
  P('banco', 9, 13.5, 2);
  P('mesa', 38, 9);
  P('silla', 36.5, 9, 1);
  P('silla', 39.5, 9, 3);
  P('barbacoa', 38, 13);
  // árboles y lo demás
  P('palmera', 5, 24);
  P('palmera', 39, 39);
  P('roble', 6, 40);
  P('arbol', 40, 30);
  P('pino', 30, 5);
  P('arbol', 17, 5);
  P('arbusto', 12, 30);
  P('arbusto', 33, 33);
  P('arbusto', 6, 6);
  P('flores', 18, 34);
  P('flores-amarillas', 26, 34);
  P('flores-moradas', 34, 18);
  P('flores', 34, 26);
  P('rocas', 7, 34);
  P('roca', 3, 44);
  P('setas', 8, 44);
  P('cartel', 19, 41.5, 2);
  return out;
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
  const seco = (x, y) => !enAgua(bx + x, by + y) && distRio(bx + x, by + y).d > RIO_ANCHO + 3 && !enCalle(bx + x, by + y, 1.5);
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
      if (enCalle(bx + x, by + y, 0.5)) continue; // ahí está la calle del barrio, con su paso de cebra
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
  if (tipo === 'barrio') return casaDeSerie(px, py, CASAS[px + '/' + py]);
  if (tipo === 'comun') return comunDeSerie();
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
