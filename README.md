# crisrr world — un mundo que se construye entre todos

**https://maps.crisrr.com**

Un mundo 3D estilo cartoon, sin mapa real: un suelo infinito dividido en
parcelas por el que cada persona anda con su avatar, reclama una parcela y
construye en ella su casa, su jardín o lo que quiera. Lo que construye uno lo
ven todos. Todo el renderizado ocurre **en la GPU del dispositivo**: el
servidor solo guarda qué hay en cada parcela y quién anda cerca.

## Cómo funciona

- **El mundo**: una rejilla infinita de parcelas de 48 m
  (`src/lib/parcela.js`). Coordenadas en metros, x al este e y al norte.
- **El paisaje de serie** (`src/lib/paisaje.js`, determinista y compartido
  por servidor y cliente): la **plaza de llegada** en 0/0, un **paseo** de
  este a oeste y otro hacia el sur con losas, farolas, árboles y bancos, dos
  **ríos** que serpentean (uno al este, otro al sur) con un **puente** donde
  los cruza el paseo, tres **parques** públicos sembrados con árboles, rocas
  y flores, y una **casa de muestra** en 1/1. Todo eso es del «mundo»: nadie
  lo reclama ni lo cambia, y el servidor lo resiembra si cambia el plano
  (la semilla lleva versión). Solo se puede reclamar en la **zona
  residencial**: hasta 9 parcelas de la plaza, fuera de paseos, ríos y
  parques; más allá es campo. El terreno se hunde hasta el lecho junto a los
  ríos (la misma función en JS y en GLSL) y el agua es un plano a su nivel
  que solo existe en la banda del río; el avatar no entra en el agua, salvo
  por el puente.
- **El look, tarde de verano**, imitando la receta de
  [Summer Afternoon](https://summer-afternoon.vlucendo.com/): un **sol** (luz
  direccional cálida, baja y del suroeste, con sombras proyectadas de 2048 px
  que siguen al avatar), un **cielo** (luz hemisférica fría desde arriba y
  verdosa rebotada desde abajo) y materiales **toon con rampa de dos tonos**:
  un corte duro justo donde la cara deja de mirar al sol y un tercer escalón
  apenas más claro en lo que le da de frente; como la luz es dorada y el
  cielo azul, lo iluminado sale cálido y la sombra azulada sin pintar nada a
  mano. El **cielo** es una cúpula pintada en el shader, como la de la
  referencia: azul intenso arriba, celeste pálido en el horizonte, una banda
  de **cúmulos** (textura de una franja, pintada al arrancar) que gira muy
  despacio y una calima blanquecina a ras de horizonte. La **niebla** no tiñe
  de un color: con la distancia todo pierde saturación y se aclara (se mezcla
  en HSV), así el verde lejano sigue siendo verde, solo más pálido; y antes
  de ella un revelado ligero (algo más de saturación y contraste, lo que la
  referencia hace con una LUT). El **verde del suelo** lo calcula el shader
  con ruido a varias escalas (dos verdes a manchas grandes, calvas más claras
  y matas más oscuras); la textura solo pone la trama de parcelas. Los verdes
  menta del Nature Kit se llevan al verde hierba, para que el follaje sea de
  la familia del suelo. Las formas son redondas (copas, arbustos, nubes y
  cabezas son esferas con normales suaves), hay **sombras de nubes** cruzando
  el suelo (dos capas de manchas que van cada una por su lado: solo hay
  sombra donde coinciden), **hierba** que se mece y **se aparta del avatar**
  al pasar (vertex shader, instanciada a rodales en una rejilla fija del
  mundo alrededor del avatar), copas que se mecen, nubes en el cielo, una
  **bandada de pájaros** aleteando en círculos por encima, tone mapping ACES
  y una viñeta cálida en CSS. La cámara arranca cerca y baja, para que
  siempre se vea el horizonte con sus nubes. El **relieve** son colinas
  suaves: una suma de senos escrita dos veces, en JS (para colocar piezas y
  avatares) y en GLSL (para desplazar suelo, marcos y plazas en el vertex
  shader y sacar su normal), y que nunca da más de medio metro de desnivel
  en una parcela.
- **El avatar**: cuerpo redondo del color elegido, cabeza, pelo y ojos. Anda
  **tocando el suelo**, con el **joystick** de abajo a la izquierda (solo en
  pantallas táctiles) o con WASD / flechas, todo relativo a la cámara, que va
  con él en tercera persona.
- **La cámara**: con **un dedo** (o el ratón) se gira alrededor del avatar y
  se cambia el ángulo con que se ve el mundo; pellizcar o la rueda acercan.
  Con **dos dedos** se lleva el mapa a donde se quiera, **salvo si se posan
  en horizontal**, uno al lado del otro: entonces siguen girando y cambiando
  el ángulo, como antes. El modo se decide por la inclinación de la línea
  que une los dos dedos al posar el segundo (hasta 35 grados de la
  horizontal es girar) y no cambia hasta soltar, así un gesto no se
  convierte en otro a mitad de camino. El mapa nunca se aleja más de 120 m
  del avatar y vuelve a centrarlo en cuanto se anda: se puede mirar
  alrededor sin perderse.
- **Presencia**: cada 1,5 s el cliente manda su posición a `POST
  /api/presencia` y recibe a quien esté a menos de 400 m. Los demás se
  interpolan hacia su última posición conocida, así que se les ve andar y no
  saltar. Es presencia **por sondeo**: sin infraestructura nueva (el servidor
  es Next.js standalone) y suficiente para un mundo con decenas de personas.
  WebSockets es el paso siguiente si se llena.
- **Parcelas**: ponte en un solar libre y pulsa «Reclamar». Una por jugador,
  de momento (`MAX_PARCELAS_POR_JUGADOR`): el mundo se llena de vecinos, no
  de un solo constructor. Se puede abandonar, y vuelve a ser un solar.
  Cada parcela reclamada lleva un marco en el suelo del color de su dueño
  (derivado de su id, sin preguntarle a nadie); la tuya, en azul.
- **Construir**: en tu parcela, «Construir» abre la paleta con una treintena
  de piezas: cuatro casas, tienda, torre, árboles (roble, pino, palmera…),
  arbustos, flores, setas, calabazas, rocas, troncos, hoguera, camino, puente,
  valla, cartel, banco, mesa, silla, farola, fuente y bandera. Toca el suelo
  para colocar una pieza (se pega a medio metro; caminos, vallas y puentes a
  una rejilla de 4 m para que casen) y **arrastra una pieza** con el dedo o
  el ratón para llevarla donde quieras (a pasos de 10 cm; la cámara se queda
  quieta mientras). Tocarla la selecciona: sale un anillo y una barra con
  flechas de medio metro, girar, borrar y soltar. La recién colocada queda
  seleccionada, para ajustarla al momento. Las piezas van en un **panel** a
  la derecha por pestañas (Casas, Naturaleza, Jardín, Suelo) con miniaturas
  grandes; en el móvil es una hoja abajo que se pliega al elegir, para ver
  el mundo. Casas, árboles, rocas y la fuente son **sólidos**: el avatar no
  los atraviesa (se le empuja fuera por el radio y resbala por el borde), así
  que ya no desaparece dentro de una casa. Tope de 150
  piezas por parcela. Una pieza guardada es `{t, x, y, r, c}`: tipo, metros
  dentro de la parcela (1 decimal), giro y color — 40 bytes que no dependen
  de dónde esté la parcela.
- **Modelos**: casi todas las piezas son modelos glTF de
  [Kenney](https://kenney.nl) (Nature Kit, City Kit Suburban y Furniture Kit,
  licencia CC0), en `public/modelos/` con sus miniaturas en
  `public/miniaturas/`; 27 modelos, 780 KB en total. Al cargar cada uno se
  funden sus mallas: las de color liso hornean el color en el vértice y van
  en UNA geometría con el material toon de siempre; las que traen un atlas
  van en otra con la textura. Luego se escala para que el lado mayor en
  planta mida lo que dice `ancho` en el catálogo (`src/lib/piezas.js`) y se
  deja el origen en el centro, a ras de suelo. Las cuatro piezas restantes
  (torre, farola, fuente, bandera) son geometría generada.
- **Render de las piezas**: cada tipo son dos geometrías, la que se tiñe y la
  fija, y cada una un **`InstancedMesh`**: un draw call por tipo y parte sean
  3 piezas o 3.000. El tinte va por instancia (`instanceColor`) multiplicado
  al color de vértice, que en las partes teñibles es solo la luz sobre
  blanco. Al cambiar cualquier parcela se rehacen todas las instancias del
  mundo cargado (13×13 parcelas): son cientos o pocos miles, y es más barato
  que llevar la cuenta de qué instancia era de qué parcela.
- **Datos**: `GET /api/mundo` devuelve las parcelas de la caja de índices que
  el cliente tiene a la vista y, con `desde`, solo las cambiadas desde el
  sondeo anterior (delta, con `ETag`). `POST /api/parcela` reclama, guarda
  las piezas (entero, con retardo de 900 ms: un POST por ráfaga de toques) o
  abandona. Almacén JSON en `DATA_DIR` (`src/lib/mundo.js`), escritura
  atómica, volumen persistente en Coolify. Cuando crezca, SQLite.
- **Identidad**: un id anónimo por dispositivo, con nombre y color, en
  `localStorage` (`src/lib/jugador.js`). **No es una cuenta** y se puede
  falsificar; las cuentas son el siguiente paso, esto es la mecánica de juego
  que las necesita.
- **Despliegue**: Dockerfile multi-stage → Next.js `standalone`, en Coolify.

## Desarrollo

```bash
npm install
npm run dev
```

Parámetros de URL para reproducir una vista: `/?x=24&y=12&d=26&pol=58&az=180`
(posición del avatar en metros, distancia de la cámara, inclinación y rumbo
en grados). Sin ellos, apareces donde dejaste el avatar o en la plaza.

## Banco visual

Un cambio en el visor se juzga mirando capturas, no desplegando a producción.

```bash
npx playwright install chromium   # una vez
npm run dev                       # en otra terminal, con el almacén de semilla
npm run vistas                    # captura y compara
```

Deja `capturas/index.html`: cada vista con su referencia al lado, el
porcentaje de píxeles que han cambiado y, si han cambiado, una imagen que los
señala en magenta. El banco entra ya presentado (perfil fijo «Banco») y mira
la plaza y la casa de muestra, así que un `.data/` con parcelas de pruebas
encima cambia las capturas: bórralo y reinicia `npm run dev` antes.

```bash
npm run vistas -- --base                  # acepta lo capturado como referencia
npm run vistas -- --solo casa-de-muestra  # una sola vista
```

`npm run prueba` es la otra mitad: dos jugadores de verdad en dos pestañas
(Ana y Bea) que se presentan, andan, se ven, reclaman un solar, construyen y
comprueban que el otro lo ve y que el servidor lo guardó. Deja capturas de
cada paso en `OUT` (por defecto, el directorio actual).

Las vistas están en `scripts/vistas.config.mjs`. Si aparece un fallo nuevo,
añade la vista que lo enseña antes de arreglarlo. Si ya tienes un Chromium
instalado, `CHROMIUM_BIN=/ruta/a/chrome npm run vistas` evita que Playwright
se baje otro.

## Hoja de ruta

1. ✅ Mundo, avatar, presencia por sondeo, parcelas y construcción con piezas
2. Cuentas de usuario (la propiedad de las parcelas de verdad), moderación
3. WebSockets para la presencia, chat entre avatares
4. Más piezas, piezas apilables (plantas), interiores

## Historia

Este repositorio empezó como un mapa 3D del mundo real (OpenStreetMap) que se
coloreaba escaneando zonas con la cámara. El visor de teselas, los escaneos y
su banco visual están en el historial de git hasta el commit «La manzana que
escaneas es tuya»; de ahí se conserva la forma de dibujar (Three.js, low-poly
con el sol horneado en el vértice, sin luces) y la de trabajar (banco visual,
almacén JSON con deltas).
