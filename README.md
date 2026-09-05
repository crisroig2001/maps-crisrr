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
  mundo alrededor del avatar), copas que se mecen (el viento estaba escrito y calibrado desde hacía tiempo,
  pero solo lo llevaba la bandera), **variación por instancia** —giro de ±22° y
  escala de 0,88 a 1,12 sacados de un hash de la posición, así que un parque
  deja de ser el mismo árbol clonado once veces sin que cueste un byte—,
  **agua con profundidad**: la misma función `altura()` que levanta el terreno
  da, restada al nivel del agua, lo honda que es en cada píxel, y de ahí salen
  el color, la espuma de la orilla y sobre todo la opacidad, que puesta a cero
  en la orilla disuelve sola la arista contra el terreno; **arena y limo**
  donde el cauce manda y no por altura absoluta; una **silueta de horizonte**
  pintada en la cúpula con armónicos enteros sobre el acimut (línea de
  arbolado, no cordillera); el **velo del sol** calentando la mitad suroeste
  del horizonte —un disco no serviría: el sol está a 44° y el borde de arriba
  del encuadre no pasa de 17°—; **monte sembrado** por hash alrededor del
  avatar, que respeta el agua, lo público y la parcela de cualquiera; nubes en
  el cielo, una
  **bandada de pájaros** aleteando en círculos por encima, tone mapping ACES
  y una viñeta cálida en CSS. La cámara arranca cerca y baja, para que
  siempre se vea el horizonte con sus nubes. El **relieve** son colinas
  suaves: una suma de senos escrita dos veces, en JS (para colocar piezas y
  avatares) y en GLSL (para desplazar suelo, marcos y plazas en el vertex
  shader y sacar su normal), y que nunca da más de medio metro de desnivel
  en una parcela.
- **El avatar**: cuerpo redondo del color elegido, cabeza, pelo y ojos. Mide
  **1,8 m**, lo que mide una persona, y ese número es la vara de medir del
  mundo: las casas son de 6,4 a 8,8 m de alto, los árboles de 8 a 10 y la
  puerta de una casa 2, así que un avatar más alto las convertía en casitas de
  juguete. `npm run medidas` dice lo que mide cada pieza ya colocada y cuántas
  veces el avatar: el catálogo escala cada modelo por su lado mayor **en
  planta**, así que un modelo alto y estrecho (una silla, una maceta, una
  flor) se va de alto sin que se note en el número. Anda **tocando el suelo**,
  con el **joystick** de abajo a la izquierda (solo en pantallas táctiles) o
  con WASD / flechas, todo relativo a la cámara, que va con él en tercera
  persona. Cada vecino tiene además su **pelo** y su **piel**: de serie salen
  del id (como el color del marco de la parcela, sin preguntar nada), así que
  desde el primer día no hay dos iguales, y el índice viaja con la presencia
  para que se le vea igual en su pantalla y en la tuya. Tocando tu nombre en
  la cabecera se abre la hoja del **perfil** —nombre, ropa, pelo y piel—, que
  antes solo se podía rellenar una vez, al entrar. Los **brazos** van aparte
  del cuerpo, como las piernas: se balancean al andar y son los que hacen los
  gestos.
- **La cámara y los gestos**, los mismos que en los mapas del iPhone: **un
  dedo** lleva el mapa a donde se quiera, y **dos dedos** hacen tres cosas a
  la vez y sin modos: separarlos o juntarlos acerca y aleja, girarlos gira el
  mundo, y subirlos o bajarlos cambia el ángulo con que se ve (arriba, de
  canto; abajo, desde el cielo). Cada una espera a su umbral para empezar
  (8 grados de giro, 14 px de subida, un 6% de separación), así un pellizco
  recto no gira solo ni un giro acerca solo; a partir de ahí van fotograma a
  fotograma, y al pasar el umbral no dan tirones. De los dos dedos se encarga
  el propio código y no `OrbitControls`, que no sabe girar con el GIRO de los
  dedos (lo suyo es arrastrarlos): a la cámara se le deja el caso de un dedo
  y el de dos se le apaga. Con **ratón**, arrastrar gira y cambia el ángulo y
  la rueda acerca. El mapa nunca se aleja más de 120 m del avatar y vuelve a
  centrarlo en cuanto se anda: se puede mirar alrededor sin perderse.
- **Hablar**: con el botón 💬 sale un anillo de **gestos** (👋 😄 ❤️ 🎉 🙏 😮)
  y una caja de texto. Lo que dices sale en una **burbuja sobre tu cabeza** y
  lo lee quien esté cerca. Un gesto no es solo un emoji que sube: **mueve el
  cuerpo**, que es lo que hace que dos personas en el mismo sitio se noten.
  Saludar levanta un brazo y lo agita, la risa y la fiesta levantan los dos y
  dan un brinco, y el resto lleva los brazos al frente; qué hace cada uno lo
  dice el propio catálogo (`cuerpo` en `EMOTES`). Viaja
  **por el mismo sondeo que la presencia**, sin infraestructura nueva: el
  mensaje va montado en el POST (que se adelanta al hablar, así que se ve casi
  al momento), el servidor lo mantiene vivo en memoria los segundos que dura
  la burbuja y lo reparte a quien sondee, y cada dato lleva su instante para
  que el cliente distinga un gesto nuevo de el mismo repetido en tres sondeos.
  Un sondeo de 1,5 s sería poco para mover avatares, pero para hablar sobra.
  **No se guarda nada**: ni en disco ni en un registro; la burbuja se
  desvanece y ahí se acaba. El texto entra acotado (80 caracteres, sin
  caracteres de control) y se pinta con `textContent`, nunca como marcado.
- **Silenciar y reportar**: tocando «N personas en el mundo» se abre la hoja
  de **vecinos**, con quien anda cerca y a qué distancia. **Silenciar** es lo
  primero que protege a alguien y no necesita ni servidor ni cuentas: es tu
  decisión sobre tu pantalla, vive en tu dispositivo (`localStorage`) y a un
  silenciado dejas de verle lo que dice, sus gestos y **su nombre**, que
  también puede ser el problema (en su cabeza y en el cartel de su parcela
  pone «silenciado»). **Reportar** no expulsa a nadie: deja constancia en
  `DATA_DIR/reportes.json` para que una persona lo mire, con quién reporta, a
  quién, dónde y **qué estaba diciendo según el servidor** —no según quien
  reporta, que si no el reporte se podría inventar—. Viaja montado en el POST
  de presencia y no en una ruta propia, que es lo que se probó primero y no
  funcionaba: la presencia vive en memoria y en Next cada ruta puede acabar
  con **su copia del módulo**, así que `/api/reporte` miraba un mapa vacío y
  todos los reportes salían sin lo que la persona había dicho. Esa memoria
  solo es de fiar en la ruta que la escribe. Tope de 500, los viejos
  se caen: es una bandeja de entrada, no un archivo. La única palanca del
  moderador, mientras no haya cuentas, es la variable de entorno
  `BLOQUEADOS=id1,id2`: quien está ahí no sale en la presencia de nadie, no
  ve a nadie y no puede reclamar ni construir, y no se le dice que lo está
  (si se le dijera, lo primero que haría es volver con otro id). No es una
  expulsión de verdad —se vacía el `localStorage` y se vuelve—, pero cuesta
  algo. **Las cuentas son lo que falta** para que esto sea moderación de
  verdad.
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
- **De quién es cada casa**: sobre cada parcela reclamada flota un **cartel**
  con el nombre de su dueño y un punto del color de su marco, así que el
  cartel y el suelo dicen lo mismo. Es lo que hace que el mundo se note
  habitado **aunque no haya nadie conectado**, que es casi siempre: sin él se
  anda entre casas de nadie. El nombre viaja con la parcela (`GET /api/mundo`
  lo saca de `jugadores[dueño].n`, y `reclama` lo guarda al vuelo para que una
  casa recién hecha no diga «Alguien»); los carteles son de las parcelas a dos
  de distancia y se apagan a 130 m.
- **Me gusta**: en la parcela de otro, un botón deja un ❤️, uno por jugador y
  se puede quitar. Se ve en el cartel y **se guarda** (a diferencia de lo que
  se dice, que se desvanece): es el bucle que cierra construir cuando no
  coincides con nadie, porque al volver se te cuenta cuánta gente ha pasado
  por tu casa. Los ids de quién lo ha dado no salen del servidor: sale la
  cuenta y, para ti, si tú eras uno. Tope de `MAX_GUSTA` por parcela, que es
  lo que impide que una parcela famosa se coma el fichero. El «cuántos había
  la última vez» vive en tu dispositivo: es un aviso, no un dato del mundo.
- **Construir**: en tu parcela, «Construir» abre la paleta con **41 piezas**
  en cuatro pestañas: casas (cuatro del City Kit, más torre, tienda, caseta y
  cobertizo), naturaleza (árboles, arbustos, flores, setas, calabazas, rocas,
  troncos), jardín (banco, mesa, silla, maceta, farola, fuente, hoguera,
  cartel, bandera, tendedero, arenero, buzón, barbacoa) y **suelo** (camino,
  puente, valla, losa, patio, patio grande y parterre). El suelo era el hueco
  grande del catálogo: eran tres piezas y ninguna dibujaba una forma, así que
  un patio de 12 × 12 salían nueve toques a la rejilla de 4 m y el 6 % del
  presupuesto de la parcela; con `patio grande` es un toque y una pieza. Toca el suelo
  para colocar una pieza (se pega a medio metro; caminos, vallas y puentes a
  una rejilla de 4 m para que casen) y **arrastra una pieza** con el dedo o
  el ratón para llevarla donde quieras (a pasos de 10 cm; la cámara se queda
  quieta mientras). **Doce piezas se tiñen** del color elegido: las generadas
  pintan sobre blanco, y las de modelo llevan en el catálogo el NOMBRE del
  material que se pinta (`valla` lleva wood y woodDark, `arbusto` grass,
  `tienda` colorRed). Ahí el color de vértice guarda la relación entre tonos
  —la valla mantiene su listón claro y su poste oscuro— y el color de verdad
  lo pone `instanceColor`; con el índice 0, que es lo que lleva todo lo ya
  guardado, se pinta el color ORIGINAL, así que el día que se añade un tinte
  no se mueve nada de lo que hay. Tocarla la selecciona: sale un anillo y una barra con
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
  `public/miniaturas/`; 27 modelos, 780 KB en total. Las **otras 14 piezas
  son geometría generada** (torre, farola, fuente, bandera, caseta,
  cobertizo, tendedero, arenero, buzón, barbacoa, losa, patio, patio grande y
  parterre): 0 bytes de descarga, y son las que se pueden teñir enteras. Al cargar cada uno se
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
  atómica, volumen persistente en Coolify. Al lado, `reportes.json` con la
  bandeja del moderador. Cuando crezca, SQLite.
- **Identidad**: un id anónimo por dispositivo, con nombre y color, en
  `localStorage` (`src/lib/jugador.js`). **No es una cuenta** y se puede
  falsificar; las cuentas son el siguiente paso, esto es la mecánica de juego
  que las necesita.
- **Despliegue**: Dockerfile multi-stage → Next.js `standalone`, en Coolify
  (aplicación `maps`, uuid `pldgqjztsx5bfm2rbjnipmgh`). Empujar a `main` no
  despliega solo: se lanza con `POST $COOLIFY_BASE_URL/api/v1/deploy?uuid=…`
  y **con `&force=true`**, porque sin eso reusa la imagen cacheada, termina en
  quince segundos y deja la web como estaba. Para saber si lo desplegado es lo
  nuevo, el hash de `page-*.js` NO sirve (es una envoltura de 3 KB que casi
  nunca cambia): o se mira una respuesta de la API que solo dé el código nuevo,
  o se busca una cadena nueva en el trozo del mundo (`97.*.js`, que sale del
  mapa de trozos de `webpack-*.js`).

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
npm run vistas -- --estricto      # ... y FALLA si algo se ha movido
```

**El reloj del mundo se para para capturar.** De `uTiempo` cuelgan la hierba,
las copas, las sombras de nube, el agua, los cúmulos y los pájaros, así que
con el reloj libre dos capturas de la MISMA escena ya salían distintas: se
midió, y 6 de las 7 vistas se movían solas, una de ellas un 0,65 %. Con ese
suelo de ruido el porcentaje era un número que se aprendía a ignorar. Ahora
cada vista se pide con `?t=12`, que congela el reloj del DIBUJO (el del
movimiento sigue siendo el de verdad, que si no el avatar no andaría), y el
umbral de «igual» baja de 0,05 % a 0,01 %. Si tocas algo que dependa del
tiempo, acuérdate de que el banco lo verá.

Hay una vista, `a-escala`, que existe solo para juzgar el **tamaño**: el
avatar pegado a la casa de muestra y a su jardín, donde se ve enseguida si una
persona mide lo que mide al lado de una puerta, un banco o una valla.

Deja `capturas/index.html`: cada vista con su referencia al lado, el
porcentaje de píxeles que han cambiado y, si han cambiado, una imagen que los
señala en magenta. El banco entra ya presentado (perfil fijo «Banco») y mira
la plaza y la casa de muestra, así que un `.data/` con parcelas de pruebas
encima cambia las capturas: bórralo y reinicia `npm run dev` antes.

```bash
npm run vistas -- --base                  # acepta lo capturado como referencia
npm run vistas -- --solo casa-de-muestra  # una sola vista
```

La vista `catalogo` no mira el mundo: pide `?muestrario=1`, que pinta TODAS
las piezas en una rejilla por categorías, a escala real y por el mismo camino
de render que el mundo (mismas luces, misma rampa, mismo ACES). Es la única
forma de ver de un golpe que una pieza está mal escalada o desentona con las
demás.

```bash
npm run miniaturas              # regenera public/miniaturas/*.png
npm run miniaturas -- --solo casa
```

Las miniaturas de la paleta **las pinta el motor**, con `?miniatura=<tipo>`:
cámara ortográfica siempre desde el mismo sitio (45° de acimut, 60° de polar)
y un encuadre proporcional a la pieza pero con el margen encogiéndose —
holgado en lo pequeño y justo en lo grande—, así la escala se lee en la celda
sin que una flor de 0,8 m salga como una mota. Antes eran los previews que
reparte Kenney: tres kits, seis tamaños distintos, cuatro ni siquiera
cuadradas, y la escala INVERTIDA (una silla se dibujaba tres veces más grande
que un árbol). **Si añades una pieza, pasa esto y commitea el PNG.**

`npm run prueba` es la otra mitad: dos jugadores de verdad en dos pestañas
(Ana y Bea) que se presentan, andan, se ven, **se hablan** (Ana dice algo y
hace un gesto, y se comprueba que a Bea le llegan), **se silencian** (Bea
silencia a Ana y la reporta, y se comprueba que deja de verle el nombre y lo
que dice, y que el reporte queda guardado con lo que Ana decía), reclaman un
solar,
construyen, comprueban que el otro lo ve y que el servidor lo guardó, y Bea
entra en la parcela de Ana, ve de quién es y le da a me gusta. Deja capturas de
cada paso en `OUT` (por defecto, el directorio actual).

Reclama una parcela, así que para volver a pasarla hay que **borrar `.data/` y
reiniciar `npm run dev`**: el mundo vive en memoria y borrar el fichero no
basta; el solar sigue ocupado y la prueba se queda esperando el botón de
«Reclamar». Y lo que juzga de los gestos es el GESTO, no la postura del brazo:
el gesto se pone en cuanto llega por la red, mientras que la postura hay que
pintarla, y con render por software salen menos de dos fotogramas por segundo,
así que un saludo de segundo y medio puede pasar entero sin dibujarse.

Las vistas están en `scripts/vistas.config.mjs`. Si aparece un fallo nuevo,
añade la vista que lo enseña antes de arreglarlo. Si ya tienes un Chromium
instalado, `CHROMIUM_BIN=/ruta/a/chrome npm run vistas` evita que Playwright
se baje otro.

## Hoja de ruta

1. ✅ Mundo, avatar, presencia por sondeo, parcelas y construcción con piezas
2. ✅ Que el mundo se note habitado: el avatar a escala de persona, hablar con
   burbujas y gestos, el cartel de quién es cada casa y el me gusta, pelo y
   piel propios con perfil que se puede cambiar, y silenciar y reportar
3. **Cuentas de usuario** ← lo siguiente. Hoy el id es del dispositivo y se
   puede falsificar, y de ahí cuelga todo lo demás: la propiedad de una parcela
   es «quien tenga ese localStorage», bloquear a alguien cuesta lo que vaciarlo
   y volver, y un reporte señala a un id que puede no volver a existir. Es lo
   que convierte silenciar y bloquear en moderación de verdad.
4. WebSockets para la presencia (hablar y los gestos ya van por el sondeo, que
   para eso sobra; lo que se nota es el retardo al ver andar a los demás)
5. Más piezas, piezas apilables (plantas), interiores

### Lo que dejó apuntado la auditoría visual

Hay una auditoría de calidad visual hecha sobre este código (11 dimensiones,
101 hallazgos juzgados, 12 refutados). Lo que se ha aplicado está en los
commits; lo que queda, por si alguien lo retoma, más o menos por orden de lo
que daría:

- **Manchas de contacto bajo las piezas**, como la que ya lleva el avatar: un
  InstancedMesh de quads rellenado en el mismo bucle de `pintaMundo`, pasado
  por `conAltura` (un quad plano de 5,8 m se hunde en pendiente si se fija a
  `alturaEn` + constante).
- **Asiento por huella**: hoy `pintaMundo` muestrea UN punto y hunde 12 cm
  fijos, así que en pendiente la esquina baja de una casa de 10 m flota hasta
  26 cm. Guardar `{rx, rz}` de la caja que ya calcula `cargaModelo` y colocar
  en el mínimo de las cuatro esquinas.
- **Rejilla de 4 m visible** al colocar piezas de rejilla (una textura en
  `texObra`, cero draw calls): es el «casar dos tramos de valla», que es el
  problema real.
- **Densidad de la hierba**: medido, una mata cada 11,7 m² y un 9 % de
  cobertura, con `MAX_HIERBA` (3.000) sin tocarse nunca.
- **`MAX_INST` de 3.000 a ~400**: 33 mallas × 3.000 × 16 floats son 6,3 MB en
  CPU y otros tantos en GPU, casi todo aire.
- **La cúpula al final de los opacos**: con `renderOrder = -1000` su fragment
  (atan2, texture2D, varios smoothstep) corre en el 100 % de los píxeles y
  luego se sobrescribe.
- **Deduplicar el atlas**: las cuatro casas cargan cada una su copia de
  `colormap.png`, o sea 4 texturas y 4 materiales de la misma imagen.
- **Arrastre incremental**: `onMueve` sabe qué pieza se movió, pero llama a
  `pintaMundo()` entero en cada pointermove.
- **Extraer `src/lib/look.js`** con las constantes de dirección de arte y un
  `?look=<preset>`, para poder probar variantes con el banco.
- **Una vista del banco con el modo construir abierto** y otra a tamaño de
  móvil: hoy las ocho son de escritorio y ninguna lleva interfaz, así que
  todo lo de la paleta es invisible para `npm run vistas`.

### Cabos sueltos

- En el `mundo.json` de **producción** hay un jugador inerte `0000…0001`
  llamado «Sonda», en 900000/900000, de comprobar la API en vivo. No tiene
  parcela ni vuelve a aparecer; se quita a mano en el volumen si molesta.
- `BLOQUEADOS` se lee al arrancar: bloquear a alguien pide reiniciar el
  contenedor. Con cuentas esto debería ser un dato del mundo, no del entorno.
- Las referencias del banco visual no están en el repo (`capturas/` está en
  `.gitignore`), así que la primera `npm run vistas` en una máquina nueva las
  crea en vez de comparar.
- Un vecino con la pestaña de fondo se queda sin fotogramas y desaparece del
  mundo a los 12 s (la presencia va con el bucle de dibujo). Es defendible
  —no está—, pero si un día molesta, el sondeo tendría que ir por su cuenta.

## Historia

Este repositorio empezó como un mapa 3D del mundo real (OpenStreetMap) que se
coloreaba escaneando zonas con la cámara. El visor de teselas, los escaneos y
su banco visual están en el historial de git hasta el commit «La manzana que
escaneas es tuya»; de ahí se conserva la forma de dibujar (Three.js, low-poly
con el sol horneado en el vértice, sin luces) y la de trabajar (banco visual,
almacén JSON con deltas).
