# crisrr world

Mundo 3D cartoon en Next.js + Three.js, sin mapa real: suelo infinito por
parcelas de 48 m, cada quien reclama una y construye. https://maps.crisrr.com

**El README es la documentación de verdad y está muy trabajado. Léelo antes de
tocar el visor** — explica el porqué de cada decisión de render, y casi
cualquier cambio "obvio" ya está discutido ahí. Este fichero solo tiene lo que
ahorra tiempo desde el minuto uno.

## Dónde está lo que queda por hacer

En `README.md`, sección **Hoja de ruta**:

- **Lo que dejó apuntado la auditoría visual** — primera auditoría.
- **Lo que queda de la segunda auditoría visual** — la última (sept. 2026), por
  orden de impacto: el naranja del kit, el contraste de las losas del
  `camino`, y la carga diferida de los modelos. Incluye una hipótesis
  **descartada** — apuntada para que nadie la "arregle" otra vez.
- **El horizonte, ya con relieve** y **El rizado del agua, sin moiré** — los dos
  primeros puntos de esa auditoría, hechos: qué se metió, por qué cada número y
  lo que hay que saber antes de tocarlo. En el del agua, además, la hipótesis
  que traía la auditoría era la equivocada.
- **La fuga de luz en la pared en sombra** — hecho: por qué el rayado de las
  paredes NO se arregla con más resolución (con más sale peor) y qué se probó
  antes de dar con la línea que lo cierra.
- **Si se mete otro kit** — lo aprendido metiendo el City Kit Roads.
- **La urbanización de serie** — hecha: un barrio con calles por las LINDES
  de las parcelas, doce casas hechas EN VENTA (se reclaman con todo dentro),
  piscinas, zona común y solares libres. Las calles no se guardan: salen del
  plano y el visor las pinta encima de lo que haya. Y cualquier dueño puede
  poner su parcela en venta (`v: 1`, `accion: 'venta'`).
- **Cabos sueltos**.

## Comandos

```bash
npm run dev          # la app
npm run vistas       # banco visual: captura las 10 vistas y compara
npm run movil        # la casa de muestra desde un teléfono, de cerca: lo que el banco NO ve
npm run medidas      # qué mide cada pieza de verdad (altura vs. avatar 1,8 m)
npm run miniaturas   # regenera public/miniaturas/*.png con el MOTOR
npm run atlas        # quita el tramado a los atlas de color de Kenney
npm run prueba       # integración: dos jugadores de verdad en dos pestañas
npm run prueba-chat  # el chat: texto, fotos y audios, dentro y fuera de un corro
```

## Reglas que cuestan tiempo si no se saben

- **Un cambio en el visor se juzga con `npm run vistas`, no desplegando.** Deja
  `capturas/index.html` con cada vista al lado de su referencia. Las
  referencias NO están en el repo, así que la primera vez las crea en vez de
  comparar.
- **Borra `.data/` y reinicia `npm run dev` antes del banco.** `npm run prueba`
  reclama una parcela, y un `.data/` con parcelas de prueba encima cambia las
  capturas.
- **Al añadir una pieza**: `npm run medidas` para comprobar la ALTURA (el
  catálogo escala por el lado mayor en planta, así que la altura sale de
  rebote), luego `npm run miniaturas` y **commitea el PNG**.
- **Cada kit con atlas va en su propia carpeta** bajo `public/modelos/`. Todos
  los kits de Kenney llaman a su atlas `Textures/colormap.png` aunque sean
  imágenes distintas, y `cargaModelo` comparte material por la RUTA. Y al
  meterlo, **`npm run atlas`**: si el `colormap.png` es indexado viene TRAMADO,
  y eso no se ve en el banco —solo de cerca y en un móvil—. El README lo cuenta
  entero en «El tramado de las paredes, que era el atlas».
- **El banco visual no lo ve todo.** Sus diez vistas son de escritorio a
  densidad 1. Un defecto que necesite que un téxel mida un píxel (el tramado
  del atlas era uno: 0,00 % en el banco y a simple vista en un iPhone) solo
  sale con **`npm run movil`**, que mide lo fino que queda la pared de la casa
  de muestra desde el suelo y a densidad 3.
- **`rejilla` en `src/lib/piezas.js` es el paso EN METROS**, no una bandera: 4
  los caminos y vallas, 8 la calle. Úsalo por `pasoRejilla(t)`. `true` sigue
  valiendo y significa 4.
- **El reloj del mundo se congela con `?t=12`** para capturar. Si tocas algo que
  dependa del tiempo, el banco lo verá.
- **Los shaders viven en template literals de JS**, así que un backtick dentro
  de un comentario del GLSL cierra la cadena y rompe el build. Comillas
  angulares o nada.
- **Si el banco no abre Chromium**, es que la versión de Playwright del repo no
  cuadra con el navegador instalado: `CHROMIUM_BIN=/ruta/al/chrome npm run
  vistas`. Y un `npm run build` con el `npm run dev` levantado deja el dev
  server sirviendo 404: mátalo, borra `.next` y relánzalo.
- **Solo tres vistas del banco enseñan el horizonte** (`horizonte`,
  `a-ras-de-suelo` y `a-escala`): hace falta `pol` ≥ 65,4° para que el cielo
  entre en cuadro. Si tocas la corona del horizonte y las otras seis se mueven,
  has tocado otra cosa.
- **Todo lo social va montado en el POST de presencia**, sin ruta propia: lo
  que se dice, los gestos, el corro, los reportes y ahora las **fotos y los
  audios** (`src/lib/adjuntos.js`). La presencia vive en memoria y en Next cada
  ruta puede acabar con SU copia del módulo, así que esa memoria solo es de
  fiar en la ruta que la escribe. Un adjunto no viaja dentro del sondeo: con el
  mensaje va su FICHA (id, tipo, segundos) y quien lo quiere lo pide por id
  (`trae: [...]`), que si no una foto se manda seis veces a cada vecino.
- **Nada que se dibuje con un patrón fino puede llevar un `step()` pelado.**
  Ni el agua ni la hierba ni las losas: el ancho del corte lo tiene que poner
  `fwidth`, o de lejos el borde cae siempre dentro de un píxel y hierve. Y una
  onda hay que apagarla cuando su fase avanza más de un píxel, no a los tantos
  metros: los metros no saben cuántos píxeles mide una onda.
- **El `normalBias` de la sombra está en TÉXELES, no en metros.** Subir
  `mapSize` o encoger `LADO_SOMBRA` sin tocarlo lo reduce en metros, y en
  metros es donde se cierran las fugas de luz: más resolución sale PEOR. Y al
  mapa de sombras van solo las caras que miran al sol (`shadowSide`), que es
  lo que quita el rayado de las paredes en sombra: pide piezas cerradas.
- **Las calles del barrio no están en ninguna parcela.** Salen de
  `piezasCalle` en `src/lib/paisaje.js` y el visor las pinta recorriendo
  `CAJA_CALLES`, no el mapa de parcelas (un solar vacío no está en el mapa
  y la calle pasa igual). Los 4 m de calzada que caen en un solar no se
  construyen (`enCalle`, en el visor y en el servidor). Qué baldosa va en
  cada sitio lo decide lo que tiene alrededor, y los giros salieron de la
  GEOMETRÍA de los modelos, no de capturas: la recta va de este a oeste con
  r = 0, y un cuarto de vuelta es antihorario desde arriba.
- **Lo lejano NO lleva la niebla del mundo.** `scene.fog` satura a 325 m, así
  que cualquier cosa a más de 300 m con la niebla de serie sale del color
  exacto del cielo. La corona del horizonte y sus arboledas van con `fog:
  false` y su propia calima (`calimaLejos` en `GLSL_HORIZONTE`).

## Desplegar

Empujar a `main` **no** despliega solo:

```bash
curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_BASE_URL/api/v1/deploy?uuid=pldgqjztsx5bfm2rbjnipmgh&force=true"
```

**Sin `&force=true` reusa la imagen cacheada**, termina en quince segundos y
deja la web como estaba.

Para comprobar que lo servido es lo nuevo, el hash de `page-*.js` **no sirve**
(es una envoltura de 3 KB que casi nunca cambia). Hay que seguir el mapa de
trozos de `webpack-*.js` hasta el trozo del mundo:

```bash
HTML=$(curl -s https://maps.crisrr.com/)
printf '%s' "$HTML" | grep -o '/_next/static/chunks/[A-Za-z0-9_./-]*\.js' | sort -u > lista.txt
WP=$(grep -m1 'webpack-' lista.txt)
curl -s "https://maps.crisrr.com$WP" > wp.js
grep -o '[0-9]\{2,4\}:"[a-z0-9]\{12,\}"' wp.js \
  | sed 's#\([0-9]*\):"\([a-z0-9]*\)"#/_next/static/chunks/\1.\2.js#' >> lista.txt
sort -u lista.txt -o lista.txt
while read -r t; do curl -s "https://maps.crisrr.com$t" | grep -q CADENA && echo "$t"; done < lista.txt
```

Dos avisos, los dos por haberlos sufrido:

- En el mapa de webpack las entradas son `123:"hash"`, **sin comillas en la
  clave**. Un regex que las espere no encuentra nada y se lee como «no está
  desplegado» cuando sí lo está.
- Busca **dos** cadenas: una que solo exista en el commit NUEVO y otra que solo
  existiera en el VIEJO. Con una sola no distingues «no desplegado» de «mi
  búsqueda está mal».

Y ojo con el estado que devuelve Coolify: el contenido servido puede ser ya el
nuevo mientras el registro del despliegue sigue en `in_progress`, porque cierra
después de conmutar el tráfico. Manda lo que sirve la web.

## Estado

57 piezas en 5 pestañas (casas, naturaleza, jardín, suelo, calle). 42 modelos
glTF de Kenney (CC0), 1,3 MB, **todos cargados al arrancar** — cuando el
catálogo crezca otra vez, toca cargar por pestaña.

El **chat** es un panel de mensajería (burbujas a un lado y a otro, hora,
fotos y audios) que convive con las burbujas sobre las cabezas: el chat es
dónde se lee lo hablado y la burbuja es quién lo dijo y desde dónde. Va
anclado a un lado, nunca en el centro —tapaba al avatar y a quien se le
habla— y esconde el joystick mientras está abierto. Fuera de un corro lo
hablado vive en el navegador (`charlaCerca`); dentro, el hilo es el del corro
y lo guarda el servidor mientras dure. Se prueba con `npm run prueba-chat`
(texto, fotos y audios de ida y vuelta, y que un adjunto de corro no se sirva
fuera); `npm run prueba` ya toca además la caja de escribir.
