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
//   nombre, icono   lo que ve el jugador en la paleta (mini = miniatura PNG)
//   glb             modelo en /modelos/<glb>.glb (Kenney, CC0); sin glb, la
//                   pieza es geometría generada en el visor
//   ancho           a cuánto se escala el modelo: su lado mayor en metros
//   zoom            la miniatura deja mucho aire: se recorta al centro
//   tinte           se pinta del color elegido (solo piezas generadas)
//   rejilla         se pega a una rejilla de 4 m (caminos, vallas, puentes)
//   suelo           es plana y a ras de suelo: la hierba la esquiva
//   cat             pestaña de la paleta (CATEGORIAS)
//   solido          radio en metros que el avatar no puede atravesar
//
// Las claves antiguas (casa, arbol, pino, arbusto, flores, camino, valla,
// banco) se conservan con su nombre: lo que ya está guardado sigue valiendo.

export const PIEZAS = {
  // casas (City Kit Suburban)
  casa: { nombre: 'Casa', icono: '🏠', glb: 'casa-a', mini: true, ancho: 10, cat: 'casas', solido: 4.2 },
  'casa-b': { nombre: 'Casa grande', icono: '🏡', glb: 'casa-b', mini: true, ancho: 10, cat: 'casas', solido: 4.2 },
  'casa-c': { nombre: 'Chalet', icono: '🏘️', glb: 'casa-c', mini: true, ancho: 10.5, cat: 'casas', solido: 4.4 },
  'casa-d': { nombre: 'Casona', icono: '🏚️', glb: 'casa-d', mini: true, ancho: 13, cat: 'casas', solido: 5.5 },
  torre: { nombre: 'Torre', icono: '🗼', tinte: true, ancho: 5.6, cat: 'casas', solido: 2.6 },
  tienda: { nombre: 'Tienda', icono: '⛺', glb: 'tienda', mini: true, zoom: true, ancho: 5, cat: 'casas', solido: 2.2 },
  // árboles y plantas (Nature Kit)
  arbol: { nombre: 'Árbol', icono: '🌳', glb: 'arbol', mini: true, zoom: true, ancho: 5.5, cat: 'naturaleza', solido: 0.6 },
  roble: { nombre: 'Roble', icono: '🌳', glb: 'roble', mini: true, zoom: true, ancho: 5, cat: 'naturaleza', solido: 0.6 },
  pino: { nombre: 'Pino', icono: '🌲', glb: 'pino', mini: true, zoom: true, ancho: 2.6, cat: 'naturaleza', solido: 0.5 },
  palmera: { nombre: 'Palmera', icono: '🌴', glb: 'palmera', mini: true, zoom: true, ancho: 6, cat: 'naturaleza', solido: 0.5 },
  arbusto: { nombre: 'Arbusto', icono: '🌿', glb: 'arbusto', mini: true, zoom: true, ancho: 2.4, cat: 'naturaleza' },
  flores: { nombre: 'Flores rojas', icono: '🌷', glb: 'flores-rojas', mini: true, zoom: true, ancho: 1.1, cat: 'naturaleza' },
  'flores-amarillas': { nombre: 'Flores amarillas', icono: '🌼', glb: 'flores-amarillas', mini: true, zoom: true, ancho: 1.3, cat: 'naturaleza' },
  'flores-moradas': { nombre: 'Flores moradas', icono: '💐', glb: 'flores-moradas', mini: true, zoom: true, ancho: 1.1, cat: 'naturaleza' },
  setas: { nombre: 'Setas', icono: '🍄', glb: 'setas', mini: true, zoom: true, ancho: 1.2, cat: 'naturaleza' },
  calabaza: { nombre: 'Calabaza', icono: '🎃', glb: 'calabaza', mini: true, zoom: true, ancho: 1.4, cat: 'naturaleza' },
  maceta: { nombre: 'Maceta', icono: '🪴', glb: 'maceta', mini: true, ancho: 0.9, cat: 'jardin', solido: 0.4 },
  // rocas y madera
  roca: { nombre: 'Roca', icono: '🪨', glb: 'roca', mini: true, zoom: true, ancho: 3.4, cat: 'naturaleza', solido: 1.5 },
  rocas: { nombre: 'Piedras', icono: '🪨', glb: 'rocas', mini: true, zoom: true, ancho: 1.6, cat: 'naturaleza', solido: 0.7 },
  tronco: { nombre: 'Troncos', icono: '🪵', glb: 'tronco', mini: true, zoom: true, ancho: 3, cat: 'naturaleza', solido: 1.2 },
  hoguera: { nombre: 'Hoguera', icono: '🔥', glb: 'hoguera', mini: true, zoom: true, ancho: 1.8, cat: 'jardin', solido: 0.9 },
  // suelo y cierres
  camino: { nombre: 'Camino', icono: '🟫', glb: 'camino', mini: true, zoom: true, ancho: 4, rejilla: true, suelo: true, cat: 'suelo' },
  puente: { nombre: 'Puente', icono: '🌉', glb: 'puente', mini: true, zoom: true, ancho: 6, rejilla: true, suelo: true, cat: 'suelo' },
  valla: { nombre: 'Valla', icono: '🪵', glb: 'valla', mini: true, zoom: true, ancho: 4, rejilla: true, cat: 'suelo' },
  cartel: { nombre: 'Cartel', icono: '🪧', glb: 'cartel', mini: true, zoom: true, ancho: 1.6, cat: 'jardin', solido: 0.3 },
  // mobiliario (Furniture Kit) y piezas generadas
  banco: { nombre: 'Banco', icono: '🪑', glb: 'banco', mini: true, ancho: 1.8, cat: 'jardin', solido: 0.8 },
  mesa: { nombre: 'Mesa', icono: '🍽️', glb: 'mesa', mini: true, ancho: 1.6, cat: 'jardin', solido: 0.8 },
  silla: { nombre: 'Silla', icono: '💺', glb: 'silla', mini: true, ancho: 0.8, cat: 'jardin' },
  farola: { nombre: 'Farola', icono: '💡', ancho: 1.2, cat: 'jardin', solido: 0.3 },
  fuente: { nombre: 'Fuente', icono: '⛲', ancho: 6.4, cat: 'jardin', solido: 3.4 },
  bandera: { nombre: 'Bandera', icono: '🚩', tinte: true, ancho: 2.6, cat: 'jardin' },
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

// tope por parcela: 48×48 m con 150 piezas ya es una parcela llena
export const MAX_PIEZAS = 150;

// id anónimo de jugador (localStorage). No es una cuenta: identifica un
// dispositivo para que cada uno construya en SU parcela.
export const RE_JUGADOR = /^[a-f0-9]{16,32}$/;
export const MAX_NOMBRE = 18;

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
  const s = n.replace(/[ -]/g, '').trim().slice(0, MAX_NOMBRE);
  return s || null;
}
