// Las vistas del banco visual. Cada una existe para juzgar algo concreto del
// mundo; si alguna deja de tener motivo, bórrala, y si aparece un fallo
// nuevo, añade la vista que lo enseña antes de arreglarlo.
//
// x, y = posición del avatar en metros del mundo (y hacia el norte)
// d    = distancia de la cámara al avatar, en metros (6..140)
// pol  = inclinación en grados (0 = cenital, 83 = tope)
// az   = rumbo desde el que mira la cámara (180 = desde el sur, mirando al norte)

export const VISTAS = [
  {
    id: 'plaza-llegada',
    desc: 'Lo que ve quien entra por primera vez: la plaza, la fuente y la casa de muestra a la derecha.',
    x: 24,
    y: 12,
    d: 26,
    pol: 58,
    az: 180,
  },
  {
    id: 'casa-de-muestra',
    desc: 'La parcela 1/0 de cerca: casa con tejado, vallas a la rejilla de 4 m, camino y jardín. Aquí se juzga el look de las piezas.',
    x: 72,
    y: 14,
    d: 34,
    pol: 55,
    az: 200,
  },
  {
    id: 'a-ras-de-suelo',
    desc: 'Cámara casi horizontal detrás del avatar: el horizonte, la niebla y que el suelo no se corte.',
    x: 24,
    y: 4,
    d: 12,
    pol: 80,
    az: 180,
  },
  {
    id: 'desde-arriba',
    desc: 'Casi cenital y lejos: la trama de parcelas, el suelo de la plaza y los marcos de dueño.',
    x: 48,
    y: 24,
    d: 130,
    pol: 12,
    az: 180,
  },
];

export const DIR_CAPTURAS = 'capturas';
export const ANCHO = 1000;
export const ALTO = 640;
