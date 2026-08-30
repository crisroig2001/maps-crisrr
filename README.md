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
- **Rótulos**: topónimos (ciudad, distrito, barrio) y nombres de calle salen de
  las capas `place` y `transportation_name`, que ya venían dentro del `.pbf` y
  antes se descartaban — así que **no cuestan ni un byte de red**. No se pintan
  en la textura del suelo (borrosos de cerca, del revés al girar): son `<div>`
  proyectados desde el 3D en cada frame, nítidos a cualquier zoom y con cero
  draw calls. Los de calle se deslizan por la vía para quedarse cerca de lo que
  miras, y se descartan por colisión para que el mapa no se sature.
- **Horizonte**: solo se cargan 3×3 teselas, así que el mundo con edificios
  acaba a 1,5 teselas del centro. Un plano de horizonte más la niebla —
  recalculada por frame según lo lejos que esté la cámara — funden ese borde
  con el cielo: antes se veía cortado en recto.
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
npm run teselas                   # cachea en .teselas/ lo que hace falta (~13 MB)
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
`pie-de-fachada` donde el oscurecido del pie se estiraba por toda la pared.
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
