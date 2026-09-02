// Catálogo de adornos: lo que un usuario puede colocar en una manzana que ha
// escaneado. Compartido por cliente y servidor (validación) y sin
// dependencias a propósito.
//
// Un adorno es {t, x, y}: tipo y posición como FRACCIÓN de la celda z18
// (0..1 desde su esquina noroeste, 3 decimales = 11 cm). Así el dato no
// depende de la latitud ni del origen de la escena, y pesa 30 bytes.

export const TIPOS = {
  arbol: { nombre: 'Árbol', icono: '🌳' },
  farola: { nombre: 'Farola', icono: '💡' },
  banco: { nombre: 'Banco', icono: '🪑' },
  fuente: { nombre: 'Fuente', icono: '⛲' },
  bandera: { nombre: 'Bandera', icono: '🚩' },
};

// tope por manzana: más que esto y el dato deja de ser «un adorno» para ser un
// vertedero de geometría en la tesela de todos
export const MAX_ADORNOS = 40;

// id anónimo de jugador: lo genera el navegador y lo guarda en localStorage.
// NO es una cuenta (eso es el punto 3 de la hoja de ruta): identifica un
// dispositivo para que cada uno decore SU manzana, nada más.
export const RE_JUGADOR = /^[a-f0-9]{16,32}$/;

// Normaliza y valida una lista de adornos que viene del navegador. Devuelve
// la lista limpia o null si no vale. Recorta a MAX_ADORNOS en vez de
// rechazar: un cliente viejo con un tope mayor no debe perderlo todo.
export function validaAdornos(lista) {
  if (!Array.isArray(lista)) return null;
  const out = [];
  for (const a of lista) {
    if (!a || typeof a !== 'object') return null;
    if (!TIPOS[a.t]) return null;
    const x = Number(a.x);
    const y = Number(a.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
    out.push({ t: a.t, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
    if (out.length >= MAX_ADORNOS) break;
  }
  return out;
}
