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
    desc: 'La casa de muestra (parcela 1/1) de cerca: casa con tejado, vallas a la rejilla de 4 m, camino y jardín. Aquí se juzga el look de las piezas.',
    x: 72,
    y: 62,
    d: 34,
    pol: 55,
    az: 200,
  },
  {
    id: 'a-escala',
    desc: 'El avatar pegado a la casa de muestra y a su jardín. Aquí se juzga el TAMAÑO: una persona mide 1,8 m, así que la puerta le tiene que venir un poco alta, el banco por la cadera y la valla por el pecho.',
    x: 72,
    y: 60,
    d: 11,
    pol: 76,
    az: 195,
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
    id: 'rio-y-paseo',
    desc: 'El paseo del este llegando al río y al puente. Aquí se juzga el agua, el cauce y que la hierba no entre en el río.',
    x: 190,
    y: 30,
    d: 42,
    pol: 55,
    az: 235,
  },
  {
    id: 'rio-lejos',
    desc: 'El río alejándose trescientos metros, casi desde arriba. Aquí se juzga el RIZADO a distancia: una onda que baja del par de píxeles no se puede dibujar y lo que sale es el batido con la rejilla de la pantalla, un enrejado regular de rombos. Si vuelve a aparecer un tramado en la parte de arriba del río, se ha roto el corte por Nyquist del shader del agua.',
    x: 190,
    y: 30,
    d: 140,
    pol: 40,
    az: 235,
  },
  {
    id: 'parque',
    desc: 'Un parque público, sembrado por el plano: árboles, rocas y un banco, sin suelo de piedra.',
    x: 120,
    y: 100,
    d: 60,
    pol: 50,
    az: 200,
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
  {
    id: 'horizonte',
    desc: 'Campo abierto y la cámara casi horizontal (pol 83), sin nada delante: aquí SOLO se juzga el horizonte. Que el mundo no se acabe en una raya verde recta contra el cielo, que haya relieve y silueta más allá de la niebla, y que se lean varias distancias.',
    x: -520,
    y: 120,
    d: 18,
    pol: 83,
    az: 180,
  },
  {
    id: 'urbanizacion',
    desc: 'La manzana del oeste desde arriba y un poco de lado: la calle principal y la de abajo, las dos de norte a sur, las casas hechas con su jardín (dos con piscina), el parque y los solares libres entre medias. Aquí se juzga que se lea como un barrio y no como piezas sueltas, y que las calles casen (rectas, cruces, T, finales, entradas de coches).',
    x: -150,
    y: -70,
    d: 190,
    pol: 30,
    az: 180,
  },
  {
    id: 'urbanizacion-calle',
    desc: 'A ras de calle, en el cruce de la del este con la principal: la calzada y sus aceras, las farolas, la valla a 2 m del bordillo, el camino hasta la puerta y el buzón. Aquí se juzga que la calle case (baldosas, cruce, entrada de coches) y que la hierba no crezca en el asfalto.',
    x: 80,
    y: -52,
    d: 32,
    pol: 60,
    az: 160,
  },
  {
    id: 'urbanizacion-piscina',
    desc: 'La casona del -4/-1 por detrás, con su piscina: el borde de piedra teñido, el agua un palmo más baja, la escalerilla y las dos sillas. Aquí se juzga la piscina, que es geometría generada, y el cartel de «en venta» flotando sobre una casa del mundo.',
    x: -160,
    y: -16,
    d: 28,
    pol: 60,
    az: 340,
  },
  {
    id: 'urbanizacion-plano',
    desc: 'Casi cenital sobre el cruce del paseo del sur con la calle principal: el paso de cebra, la losa del paseo recortada en la calzada, y las cuatro parcelas de alrededor (dos casas, la zona común y el paseo).',
    x: 24,
    y: -50,
    d: 140,
    pol: 14,
    az: 180,
  },
  {
    id: 'catalogo',
    desc: 'La hoja de contacto del catálogo: TODAS las piezas a escala real, por categorías, con el avatar al lado. Aquí se ve de un golpe si una pieza está mal escalada o desentona con las demás. El encuadre va con el número de piezas: con la calle son 56 y 8 filas, y con 6 filas se salían por abajo.',
    x: 52,
    y: -45,
    d: 165,
    pol: 40,
    az: 180,
    extra: 'muestrario=1',
  },
];

export const DIR_CAPTURAS = 'capturas';
export const ANCHO = 1000;
export const ALTO = 640;
