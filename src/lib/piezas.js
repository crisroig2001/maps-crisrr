// Catálogo de piezas: lo que un jugador puede construir en su parcela.
// Compartido por cliente (paleta y render) y servidor (validación), sin
// dependencias a propósito.
//
// Una pieza guardada es {t, x, y, r, c}:
//   t  tipo (clave de PIEZAS)
//   x, y  posición en METROS dentro de la parcela, desde su esquina suroeste
//         (1 decimal); así el dato no depende de dónde esté la parcela
//   r  giro en cuartos de vuelta (0..3)
//   c  color, índice en COLORES (solo cuenta en las piezas con `tinte`)
//
// Cada entrada:
//   nombre, icono   lo que ve el jugador en la paleta; el icono es el
//                   respaldo si falta la miniatura
//   mini            tiene miniatura en /miniaturas/<clave>.png. Las genera
//                   `npm run miniaturas` con el MOTOR: misma luz, misma
//                   rampa, mismo encuadre y mismo tamaño para todas, que es
//                   lo que antes no pasaba (venían de tres kits distintos,
//                   con seis tamaños y la escala invertida)
//   glb             modelo en /modelos/<glb>.glb (Kenney, CC0); sin glb, la
//                   pieza es geometría generada en el visor
//   ancho           a cuánto se escala el modelo: su lado mayor EN PLANTA, en
//                   metros. Ojo: quien manda es la altura que sale de ahí,
//                   porque es lo que se compara con el avatar (1,8 m). Un
//                   modelo alto y estrecho necesita un `ancho` pequeño:
//                   `node scripts/medidas.mjs` lista lo que mide cada pieza.
//   tinte           se pinta del color elegido. `true` en las piezas
//                   generadas (el color de vértice es blanco: solo la luz);
//                   en las de .glb, el NOMBRE del material que se pinta (o
//                   una lista), y ahí el tinte se MULTIPLICA sobre el color
//                   original, normalizado a luminancia 1 — así lo que ya
//                   está guardado (que lleva c = 0) sigue viéndose igual
//   rejilla         se pega a una rejilla de 4 m (caminos, vallas, puentes)
//   viento          se mece con el aire por encima de 1,5 m (copas)
//   suelo           es plana y a ras de suelo: la hierba la esquiva
//   cat             pestaña de la paleta (CATEGORIAS)
//   solido          radio en metros que el avatar no puede atravesar
//
// Las claves antiguas (casa, arbol, pino, arbusto, flores, camino, valla,
// banco) se conservan con su nombre: lo que ya está guardado sigue valiendo.

export const PIEZAS = {
  // casas (City Kit Suburban)
  casa: { nombre: 'Casa', icono: '🏠', mini: true, glb: 'casa-a', ancho: 10, cat: 'casas', solido: 4.2 },
  'casa-b': { nombre: 'Casa grande', icono: '🏡', mini: true, glb: 'casa-b', ancho: 10, cat: 'casas', solido: 4.2 },
  'casa-c': { nombre: 'Chalet', icono: '🏘️', mini: true, glb: 'casa-c', ancho: 10.5, cat: 'casas', solido: 4.4 },
  'casa-d': { nombre: 'Casona', icono: '🏚️', mini: true, glb: 'casa-d', ancho: 13, cat: 'casas', solido: 5.5 },
  torre: { nombre: 'Torre', icono: '🗼', mini: true, tinte: true, ancho: 5.6, cat: 'casas', solido: 2.6 },
  tienda: { nombre: 'Tienda', icono: '⛺', mini: true, glb: 'tienda', ancho: 5, tinte: 'colorRed', cat: 'casas', solido: 2.2 },
  // Geometría generada, 0 bytes de descarga. Las cuatro casas del City Kit
  // son el mismo edificio (bloque + tejado, 8-8,8 m de alto): lo que faltaba
  // era SILUETA, algo pequeño y algo bajo y largo. Y son tintables, que las
  // del atlas no pueden serlo.
  caseta: { nombre: 'Caseta', icono: '🛖', mini: true, tinte: true, ancho: 5.4, cat: 'casas', solido: 2.6 },
  cobertizo: { nombre: 'Cobertizo', icono: '🏚️', mini: true, tinte: true, ancho: 8.4, cat: 'casas', solido: 3.6 },
  // árboles y plantas (Nature Kit)
  arbol: { nombre: 'Árbol', icono: '🌳', mini: true, glb: 'arbol', ancho: 5.5, viento: true, cat: 'naturaleza', solido: 0.6 },
  roble: { nombre: 'Roble', icono: '🌳', mini: true, glb: 'roble', ancho: 5, viento: true, cat: 'naturaleza', solido: 0.6 },
  pino: { nombre: 'Pino', icono: '🌲', mini: true, glb: 'pino', ancho: 2.6, viento: true, cat: 'naturaleza', solido: 0.5 },
  palmera: { nombre: 'Palmera', icono: '🌴', mini: true, glb: 'palmera', ancho: 6, viento: true, cat: 'naturaleza', solido: 0.5 },
  arbusto: { nombre: 'Arbusto', icono: '🌿', mini: true, glb: 'arbusto', ancho: 2.4, viento: true, tinte: 'grass', cat: 'naturaleza' },
  flores: { nombre: 'Flores rojas', icono: '🌷', mini: true, glb: 'flores-rojas', ancho: 0.5, cat: 'naturaleza' }, // 0,8 m de alto
  'flores-amarillas': { nombre: 'Flores amarillas', icono: '🌼', mini: true, glb: 'flores-amarillas', ancho: 0.9, cat: 'naturaleza' },
  'flores-moradas': { nombre: 'Flores moradas', icono: '💐', mini: true, glb: 'flores-moradas', ancho: 0.7, cat: 'naturaleza' },
  setas: { nombre: 'Setas', icono: '🍄', mini: true, glb: 'setas', ancho: 0.8, cat: 'naturaleza' },
  calabaza: { nombre: 'Calabaza', icono: '🎃', mini: true, glb: 'calabaza', ancho: 0.7, cat: 'naturaleza' },
  maceta: { nombre: 'Maceta', icono: '🪴', mini: true, glb: 'maceta', ancho: 0.4, cat: 'jardin', solido: 0.2 }, // 1,1 m con la planta
  // rocas y madera
  roca: { nombre: 'Roca', icono: '🪨', mini: true, glb: 'roca', ancho: 3.4, cat: 'naturaleza', solido: 1.5 },
  rocas: { nombre: 'Piedras', icono: '🪨', mini: true, glb: 'rocas', ancho: 1.6, cat: 'naturaleza', solido: 0.7 },
  tronco: { nombre: 'Troncos', icono: '🪵', mini: true, glb: 'tronco', ancho: 2.2, cat: 'naturaleza', solido: 0.9 },
  hoguera: { nombre: 'Hoguera', icono: '🔥', mini: true, glb: 'hoguera', ancho: 1.4, cat: 'jardin', solido: 0.7 },
  // suelo y cierres
  camino: { nombre: 'Camino', icono: '🟫', mini: true, glb: 'camino', ancho: 4, rejilla: true, suelo: true, cat: 'suelo' },
  puente: { nombre: 'Puente', icono: '🌉', mini: true, glb: 'puente', ancho: 6, rejilla: true, suelo: true, cat: 'suelo' },
  valla: { nombre: 'Valla', icono: '🪵', mini: true, glb: 'valla', ancho: 4, rejilla: true, tinte: ['wood', 'woodDark'], cat: 'suelo' },
  // Suelo que se DIBUJA. Antes la categoría eran tres piezas y ninguna hacía
  // una forma: un patio de 12 × 12 eran 9 toques a la rejilla de 4 m y el 6 %
  // del presupuesto de la parcela. Con estas es 1 toque y 1 pieza. Son
  // geometría generada, así que TESELAN de verdad (una baldosa por cada 4 m)
  // en vez de estirar una textura, que es lo que pasaría escalando un modelo.
  losa: { nombre: 'Losa', icono: '⬜', mini: true, tinte: true, ancho: 4, rejilla: true, suelo: true, cat: 'suelo' },
  patio: { nombre: 'Patio', icono: '🔲', mini: true, tinte: true, ancho: 8, rejilla: true, suelo: true, cat: 'suelo' },
  'patio-g': { nombre: 'Patio grande', icono: '⬛', mini: true, tinte: true, ancho: 12, rejilla: true, suelo: true, cat: 'suelo' },
  parterre: { nombre: 'Parterre', icono: '🟤', mini: true, ancho: 4, rejilla: true, suelo: true, cat: 'suelo' },
  cartel: { nombre: 'Cartel', icono: '🪧', mini: true, glb: 'cartel', ancho: 1.2, cat: 'jardin', solido: 0.3 }, // 1,7 m: se lee de pie
  // mobiliario (Furniture Kit) y piezas generadas
  banco: { nombre: 'Banco', icono: '🪑', mini: true, glb: 'banco', ancho: 0.95, cat: 'jardin', solido: 0.5 }, // 1,1 m con respaldo
  mesa: { nombre: 'Mesa', icono: '🍽️', mini: true, glb: 'mesa', ancho: 1.6, cat: 'jardin', solido: 0.8 }, // 0,7 m: ya estaba bien
  silla: { nombre: 'Silla', icono: '💺', mini: true, glb: 'silla', ancho: 0.45, cat: 'jardin' }, // 1,05 m de respaldo
  farola: { nombre: 'Farola', icono: '💡', mini: true, ancho: 1.2, cat: 'jardin', solido: 0.3 },
  fuente: { nombre: 'Fuente', icono: '⛲', mini: true, ancho: 6.4, cat: 'jardin', solido: 3.4 },
  bandera: { nombre: 'Bandera', icono: '🚩', mini: true, tinte: true, ancho: 2.6, cat: 'jardin' },
  // El jardín de estar: nada de esto pedía descargar un modelo nuevo.
  tendedero: { nombre: 'Tendedero', icono: '🧺', mini: true, tinte: true, ancho: 3.5, cat: 'jardin', solido: 0.3 },
  arenero: { nombre: 'Arenero', icono: '🏖️', mini: true, ancho: 3, suelo: true, cat: 'jardin' },
  buzon: { nombre: 'Buzón', icono: '📮', mini: true, tinte: true, ancho: 0.7, cat: 'jardin', solido: 0.2 },
  barbacoa: { nombre: 'Barbacoa', icono: '🍖', mini: true, ancho: 1.2, cat: 'jardin', solido: 0.6 },
};

// Pestañas de la paleta, en su orden
export const CATEGORIAS = { casas: 'Casas', naturaleza: 'Naturaleza', jardin: 'Jardín', suelo: 'Suelo' };

// Paleta de tintes (pastel, a juego con el look cartoon). El índice es lo que
// se guarda, así que el orden NO se cambia: añadir al final.
export const COLORES = [
  '#f3e2c7', // arena
  '#f0b8a8', // salmón
  '#e8c9a0', // melocotón
  '#f7e39a', // amarillo
  '#cfe6c9', // menta
  '#bcd8f0', // celeste
  '#d8c8ee', // lila
  '#f2f2f2', // blanco
];

// El pelo y la piel del avatar. Están aquí, con los tintes, porque el
// servidor valida el índice que llega con la presencia igual que valida el
// color de la ropa. El orden NO se cambia: es lo que se guarda.
export const PELOS = [
  '#553d2c', // castaño
  '#2b2320', // negro
  '#8a5a34', // avellana
  '#c9a227', // rubio
  '#a8442a', // pelirrojo
  '#6f7a86', // canoso
  '#e8dcc8', // platino
];
export const PIELES = ['#f7d6b8', '#f0c39a', '#d9a173', '#b87a4e', '#8d5a34', '#5f3a22'];

// tope por parcela: 48×48 m con 150 piezas ya es una parcela llena
export const MAX_PIEZAS = 150;

// id anónimo de jugador (localStorage). No es una cuenta: identifica un
// dispositivo para que cada uno construya en SU parcela.
export const RE_JUGADOR = /^[a-f0-9]{16,32}$/;
export const MAX_NOMBRE = 18;

// --- lo que se dice sobre la cabeza ---
// Un mensaje corto en una burbuja, o un gesto de esta lista. Va por el mismo
// sondeo que la presencia (cada 1,5 s), que para movimiento sería poco pero
// para hablar sobra: un mensaje tarda un segundo o dos en llegar y nadie lo
// nota. NO se guarda en disco: vive en la memoria del servidor los segundos
// que dura la burbuja y desaparece.
export const MAX_MENSAJE = 80;
export const MENSAJE_MS = 9000; // lo que dura una burbuja
export const EMOTE_MS = 3000; // lo que un gesto sigue disponible para quien sondee después

// Los gestos son una lista cerrada: el cliente manda la CLAVE, no el emoji,
// así que por aquí no entra texto arbitrario. El orden es el del anillo de
// botones. `cuerpo` es lo que hace el avatar además de soltar el emoji: un
// emoji flotando lo hace cualquier chat, pero que el muñeco levante el brazo
// es lo que hace que dos personas en el mismo sitio se noten.
export const EMOTES = {
  hola: { emoji: '👋', nombre: 'Hola', cuerpo: 'saluda' },
  risa: { emoji: '😄', nombre: 'Risa', cuerpo: 'salta' },
  corazon: { emoji: '❤️', nombre: 'Me gusta', cuerpo: 'abraza' },
  fiesta: { emoji: '🎉', nombre: 'Fiesta', cuerpo: 'salta' },
  gracias: { emoji: '🙏', nombre: 'Gracias', cuerpo: 'abraza' },
  vaya: { emoji: '😮', nombre: 'Vaya', cuerpo: 'abraza' },
};

// Un mensaje que viene del navegador: sin caracteres de control (que
// romperían la burbuja), sin espacios de sobra y acotado. Vacío → null.
export function limpiaMensaje(m) {
  if (typeof m !== 'string') return null;
  const s = m
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MENSAJE);
  return s || null;
}

// Normaliza y valida una lista de piezas que viene del navegador. Devuelve la
// lista limpia o null si algo no vale. Recorta a MAX_PIEZAS en vez de
// rechazar, para que un cliente con un tope mayor no lo pierda todo.
export function validaPiezas(lista, lado) {
  if (!Array.isArray(lista)) return null;
  const out = [];
  for (const p of lista) {
    if (!p || typeof p !== 'object' || !PIEZAS[p.t]) return null;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!(x >= 0 && x <= lado && y >= 0 && y <= lado)) return null;
    const r = Number(p.r) || 0;
    const c = Number(p.c) || 0;
    if (!(r >= 0 && r <= 3) || !(c >= 0 && c < COLORES.length)) return null;
    out.push({ t: p.t, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: r | 0, c: c | 0 });
    if (out.length >= MAX_PIEZAS) break;
  }
  return out;
}

// Un nombre de jugador: sin caracteres de control ni exceso. Vacío → null.
export function limpiaNombre(n) {
  if (typeof n !== 'string') return null;
  const s = n
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOMBRE);
  return s || null;
}
