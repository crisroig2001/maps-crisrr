# maps-crisrr — mapa 3D colaborativo estilo cartoon

**https://maps.crisrr.com**

Un mapa 3D del mundo estilo cartoon (tipo Apple/Google Maps) que se va
«coloreando» a medida que los usuarios escanean zonas. Todo el renderizado
ocurre **en la GPU del dispositivo**: el servidor no renderiza nada.

## Cómo funciona

- **Base del mundo**: teselas vectoriales de [OpenFreeMap](https://openfreemap.org)
  (datos © OpenStreetMap contributors), z14. El navegador las descodifica
  (`pbf` + `@mapbox/vector-tile`), dibuja el suelo (calles, parques, agua, usos
  del suelo) en un canvas por tesela y **extruye los edificios** con Three.js —
  colores planos con el sombreado por cara horneado en los vértices (sin luces:
  rapidísimo en móvil).
- **La luz**: hay un sol, con una dirección (`SOL_AZ`), y la comparten las dos
  cosas que dependen de él. Las fachadas hornean en el color de vértice el
  producto **con signo** de su normal por esa dirección, así que la cara que da
  al sol y la que le da la espalda salen distintas — antes ese producto llevaba
  un `Math.abs` y las dos salían igual de claras: había contraste entre
  orientaciones, pero no sol, y la ciudad se leía plana. El arranque de la
  fachada lo oscurece un `aoMap` de un píxel de ancho que **reaprovecha la UV de
  las ventanas** (v = altura en plantas) sin repetir: se recorta a los 3 m, así
  que es una sombra a ras de acera y no un degradado estirado hasta el remate.
  Cero vértices y cero draw calls de más.
- **Sombras de contacto**: la huella de cada edificio, corrida en sentido
  contrario al sol y alargada según su altura, va pintada en el canvas del
  suelo. Es lo que asienta los edificios en el mundo en vez de dejarlos como
  pegatinas. Tampoco cuesta geometría: ~23 ms por tesela, frente a los ~8 s que
  cuesta construir sus edificios.
- **Tejados a cuatro aguas**: OpenMapTiles no dice la forma del tejado (la capa
  `building` solo trae `render_height`, `render_min_height` y `colour`), así que
  se deduce de la huella: se mete el contorno hacia dentro con la misma función
  que separa los edificios pegados y se levanta, lo que da faldones en cualquier
  forma y no solo en rectángulos. El alero **baja** en vez de subir la cumbrera,
  para que el edificio conserve la altura que dice el dato. Solo en edificios
  pequeños y bajos: en el Eixample las azoteas planas son las de verdad. Y con
  un suelo de 40 m², porque por debajo de eso la huella son 3-4 px y el faldón
  no se ve — pero eran el 58% de los candidatos y la mitad de las aristas
  (+9,8 MB de geometría en vez de +27, medido en las 9 teselas de la vista de
  partida).
- **Rótulos**: topónimos (ciudad, distrito, barrio) y nombres de calle salen de
  las capas `place` y `transportation_name`, que ya venían dentro del `.pbf` y
  antes se descartaban — así que **no cuestan ni un byte de red**. No se pintan
  en la textura del suelo (borrosos de cerca, del revés al girar): son `<div>`
  proyectados desde el 3D en cada frame, nítidos a cualquier zoom y con cero
  draw calls. Los de calle se deslizan por la vía para quedarse cerca de lo que
  miras, y se descartan por colisión para que el mapa no se sature.
- **Horizonte**: el bloque de detalle son 3×3 teselas z14, así que los edificios
  acaban a 2,8 km del centro. Más allá va un **anillo de contexto** de teselas
  z11 pintadas solo como suelo: una z11 cubre 8×8 teselas z14 y pesa 119 KB
  contra los ~13 MB que costarían esas 64. Con eso el mundo con suelo pasa de
  2,8 a 9 km por **+9% de descarga**, y la niebla —recalculada por frame— ya no
  tapa un corte sino que funde el escalón de detalle con el cielo. El cielo va en degradado, como
  textura **equirectangular** y no como imagen de fondo plana, para que quede
  anclado al mundo y el horizonte no resbale con la pantalla al inclinar la
  cámara. Su color de abajo y el de la niebla son el mismo a propósito: si no,
  aparece una costura justo donde el mapa se acaba, que es lo que la niebla
  estaba tapando.
- **Zonas escaneadas**: celdas z16 compartidas entre todos los usuarios
  (`/api/scans`, almacén JSON en `DATA_DIR`, volumen persistente en Coolify).
  Una celda escaneada pinta sus edificios a color pastel; el resto queda en gris
  «pendiente». El botón de escanear de momento **simula** el escaneo (la captura
  con cámara es la siguiente fase).
- **Despliegue**: Dockerfile multi-stage → Next.js `standalone`, en Coolify.

## Desarrollo

```bash
npm install
npm run dev
```

Parámetros de URL: `/?lat=41.3874&lng=2.1686`, y opcionalmente la cámara:
`&d=630&pol=47&az=38` (distancia en metros, inclinación y rumbo en grados;
0° de inclinación = cenital). Sin esos tres no cambia nada. La distancia la
recorta `maxDistance`, unos 3.850 m a latitud de Barcelona.

## Banco visual

Un cambio en el visor se juzga mirando capturas, no desplegando a producción.

```bash
npx playwright install chromium   # una vez
npm run teselas                   # cachea en .teselas/ lo que hace falta (~17 MB)
npm run dev                       # en otra terminal
npm run vistas                    # captura y compara
```

Deja `capturas/index.html`: cada vista con su referencia al lado, el porcentaje
de píxeles que han cambiado y, si han cambiado, una imagen que los señala en
magenta. Las teselas salen de disco, así que dos ejecuciones seguidas dan
exactamente lo mismo — un `igual` significa que de verdad no has tocado nada.

```bash
npm run vistas -- --base                  # acepta lo capturado como referencia
npm run vistas -- --solo ras-de-tejados   # una sola vista (la hoja no se vacía)
```

Las vistas están en `scripts/vistas.config.mjs`. **Cada una existe porque un
fallo real se vio ahí** — `ras-de-tejados` es donde los nombres de calle
flotaban sobre los tejados, `lejos-oblicuo` donde el mundo se cortaba en recto,
`pie-de-fachada` donde el oscurecido del pie se estiraba por toda la pared, y
`barrio-de-casas` (Gràcia) porque los tejados a cuatro aguas solo salen en
edificios pequeños y en el Eixample no se aprecian.
Si aparece un fallo nuevo, añade la vista que lo enseña antes de arreglarlo.

Dos detalles del entorno: el banco necesita `npm run dev`, porque `next start`
no sirve bien este proyecto (`next.config.js` usa `output: 'standalone'`); y si
ya tienes un Chromium instalado, `CHROMIUM_BIN=/ruta/a/chrome npm run vistas`
evita que Playwright se baje otro.

## Hoja de ruta

1. ✅ Visor 3D cartoon con datos reales + escaneos compartidos (simulados)
2. Captura real con la cámara (vídeo guiado → reconstrucción → detalles por celda)
3. Cuentas de usuario, moderación, LOD/optimización de teselas

El detalle y el orden real están en los issues; el índice es el
[#10](https://github.com/crisroig2001/maps-crisrr/issues/10).
