// Matemática de teselas y Mercator — compartida por cliente y servidor.
// Sin dependencias a propósito.

export const WORLD = 40075016.686; // circunferencia Mercator en metros
export const Z_TILE = 14; // teselas de datos (OpenFreeMap llega hasta z14)
export const Z_CELL = 16; // celdas de escaneo (4x4 por tesela)

export function lonLatToMerc(lon, lat) {
  const mx = (lon / 360) * WORLD;
  const s = Math.sin((lat * Math.PI) / 180);
  const my = (WORLD / (4 * Math.PI)) * Math.log((1 + s) / (1 - s));
  return { mx, my };
}

// inversa de lonLatToMerc: hace falta para que la URL siga a la vista
export function mercToLonLat(mx, my) {
  return {
    lon: (mx / WORLD) * 360,
    lat: (2 * Math.atan(Math.exp((my * 2 * Math.PI) / WORLD)) - Math.PI / 2) * (180 / Math.PI),
  };
}

// índice de tesela (x, y) para un lon/lat en el zoom z
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

// esquina NO de la tesela en metros Mercator
export function tileToMerc(z, x, y) {
  const n = 2 ** z;
  return {
    mx: (x / n - 0.5) * WORLD,
    my: (0.5 - y / n) * WORLD,
  };
}

export function cellKey(cx, cy) {
  return Z_CELL + '/' + cx + '/' + cy;
}

export const CELL_RE = /^16\/\d{1,6}\/\d{1,6}$/;
