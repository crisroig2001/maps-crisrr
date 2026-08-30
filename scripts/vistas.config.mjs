// Las vistas del banco visual. Cada una existe porque un fallo REAL se vio ahí:
// si alguna deja de tener motivo, bórrala; si aparece un fallo nuevo, añade la
// vista que lo enseña antes de arreglarlo.
//
// d   = distancia de la cámara al target, en metros. OJO: la app la recorta a
//       maxDistance (~3.850 m a latitud de BCN), y lo hace en silencio; si
//       pones más, la captura no será el encuadre que has escrito.
// pol = inclinación en grados (0 = cenital, 77 = tope de la app)
// az  = rumbo en grados

const BCN = { lat: 41.3874, lng: 2.1686 }; // plaça de Catalunya
const RURAL = { lat: 42.0503, lng: 2.75 }; // Garrotxa: campo, casi sin edificios
const CASAS = { lat: 41.4046, lng: 2.1602 }; // Gràcia: la mancha de casas bajas
// más densa de las teselas cacheadas (264 en 230 m), buscada a propósito

export const VISTAS = [
  {
    id: 'eixample-medio',
    desc: 'La vista de partida. Es la que ve todo el mundo al abrir.',
    ...BCN,
    d: 630,
    pol: 47,
    az: 38,
  },
  {
    id: 'eixample-cenital',
    desc: 'Casi cenital: aquí se leen los usos del suelo y la trama de calles.',
    ...BCN,
    d: 900,
    pol: 8,
    az: 0,
  },
  {
    id: 'ras-de-tejados',
    desc:
      'Cámara tumbada al máximo. Aquí se vio que los nombres de calle flotaban ' +
      'sobre los tejados (issue #2): no debe quedar ni uno.',
    ...BCN,
    d: 520,
    pol: 72,
    az: 20,
  },
  {
    id: 'lejos-oblicuo',
    desc:
      'Alejado y oblicuo: el peor caso para el borde del mundo. Antes se veía ' +
      'la ciudad cortada en recto flotando en el cielo.',
    ...BCN,
    d: 3800,
    pol: 62,
    az: 300,
  },
  {
    id: 'plaza-cerca',
    desc:
      'A ras de plaza. Enseña la borrosidad de la textura del suelo (1024 px ' +
      'para 1.835 m) y si los rótulos siguen nítidos.',
    ...BCN,
    d: 130,
    pol: 50,
    az: 120,
  },
  {
    id: 'pie-de-fachada',
    desc:
      'A pie de calle, mirando el arranque de las fachadas. Aquí se vio que el ' +
      'oscurecido del pie no era una sombra a ras de acera sino un degradado ' +
      'estirado por toda la fachada, porque iba en el color de vértice de una ' +
      'pared de un solo tramo. Debe verse una banda baja, no una rampa.\n' +
      'La cámara va casi tan abajo como deja la app (minDistance 90 m, tope de ' +
      'inclinación 76°): 27 m de altura, metida en un cañón de calle para que ' +
      'se vea dónde la fachada se encuentra con la acera.',
    ...BCN,
    d: 110,
    pol: 76,
    az: 300,
  },
  {
    id: 'barrio-de-casas',
    desc:
      'Gràcia: edificios pequeños y bajos, que son los únicos que llevan tejado ' +
      'a cuatro aguas. En el Eixample no se aprecia porque allí las manzanas ' +
      'son grandes y altas — y de azotea plana, que es lo correcto. Aquí es ' +
      'donde se juzga si los faldones valen la geometría que cuestan.',
    ...CASAS,
    d: 260,
    pol: 55,
    az: 25,
  },
  {
    id: 'rural-girona',
    desc:
      'Campo, casi sin edificios. Un escaneo aquí no tiene fachadas que pintar: ' +
      'es donde se comprobó que hacía falta el marco de celda.',
    ...RURAL,
    d: 900,
    pol: 45,
    az: 0,
  },
];

// Radio de teselas a cachear alrededor de cada sitio. La app carga un 3x3
// (radio 1); el 2 por defecto da margen si alguna vista acaba paneando.
export const RADIO_TESELAS = 2;

export const Z = 14;
export const DIR_TESELAS = '.teselas';
export const DIR_CAPTURAS = 'capturas';
export const ANCHO = 1000;
export const ALTO = 640;
