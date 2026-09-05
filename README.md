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
  despacio, una segunda capa de **cirros** más alta y más lenta y una calima
  blanquecina a ras de horizonte. El valor de la textura de cúmulos no es
  opacidad sino **cuánta luz le da** a esa parte de la nube: el borde de la
  silueta dice dónde hay nube y el valor de dentro de qué color es, así que
  el cúmulo tiene panza gris azulada y coronilla blanca en vez de ser una
  mancha de un color liso, y el que está del lado del sol se calienta entero.
  Las nubes de bulto se iluminan con esos mismos dos colores. La **niebla** no tiñe
  de un color: con la distancia todo pierde saturación y se aclara (se mezcla
  en HSV), así el verde lejano sigue siendo verde, solo más pálido; y antes
  de ella un revelado ligero (algo más de saturación y contraste, lo que la
  referencia hace con una LUT). El **verde del suelo** lo calcula el shader
  con ruido a varias escalas (dos verdes a manchas grandes, calvas más claras
  y matas más oscuras, y una octava fina de 70 cm que tira a paja y solo vive
  cerca: de lejos una mancha de ese tamaño no llega a un píxel y lo que se ve
  es el suelo hirviendo); la textura solo pone la trama de parcelas. La
  **plaza y el paseo** son losas de 2,4 m en coordenadas del mundo, con su
  junta —que se ensancha con `fwidth`, así que se suaviza sola de lejos en
  vez de centellear—, su grano y un tono por losa. Los verdes
  menta del Nature Kit se llevan al verde hierba, para que el follaje sea de
  la familia del suelo. Las formas son redondas (copas, arbustos, nubes y
  cabezas son esferas con normales suaves), hay **sombras de nubes** cruzando
  el suelo (dos capas de manchas que van cada una por su lado: solo hay
  sombra donde coinciden), **hierba** que se mece y **se aparta del avatar**
  al pasar (vertex shader, instanciada a rodales de ruido en una rejilla fija
  del mundo alrededor del avatar, y encogiéndose con la distancia a la cámara
  hasta desaparecer: a 70 m una mata ocupa dos píxeles y lo que se ve no es
  hierba, es un rascado que hierve al andar), copas que se mecen (el viento
  estaba escrito y calibrado desde hacía tiempo,
  pero solo lo llevaba la bandera), **variación por instancia** —giro de ±22°,
  escala de 0,88 a 1,12 y el VERDE de cada copa, en brillo y en matiz, sacados
  de un hash de la posición, así que un parque
  deja de ser el mismo árbol clonado once veces sin que cueste un byte—,
  **manchas de contacto** bajo cada pieza y bajo el avatar (no es la sombra
  del sol, que cae al noreste y se separa del objeto: es la oclusión de justo
  debajo, la que dice «esto se apoya aquí»), piezas **asentadas por su
  huella** —el mínimo de cuatro puntos a `solido` metros del centro, así que
  una casa de 10 m en pendiente no deja flotando la esquina baja—,
  **agua con profundidad**: la misma función `altura()` que levanta el terreno
  da, restada al nivel del agua, lo honda que es en cada píxel, y de ahí salen
  el color, la espuma de la orilla y sobre todo la opacidad, que puesta a cero
  en la orilla disuelve sola la arista contra el terreno; un **rizado** cuya
  pendiente se lee CONTRA EL SOL y a escalón, que es lo que hace que el agua
  se dibuje también mirándola desde arriba —el specular y el fresnel, que era
  lo único que movían las olas, valen los dos casi cero desde el cenit y el
  río era una lámina de plástico azul—, en coordenadas del cauce (las ondas
  bajan con la corriente) y con la fase y la fuerza desordenadas por ruido,
  que si no tres senos puros vuelven a coincidir cada pocos metros y el río
  sale a escamas; **arena y limo**
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
  en una parcela. Ojo con ese desplazamiento: se suma en espacio de OBJETO,
  así que en una instancia la escala lo multiplica y hay que dividir por ella
  antes. Sin eso la mitad de la hierba del mundo se plantaba bajo tierra —una
  mata de escala 0,4 sobre un terreno de 2,5 m acababa a 1 m— y solo se veían
  las matas a las que el azar había dado una escala cercana a 1.
- **El avatar**: cuerpo redondo del color elegido, cabeza, pelo y ojos, cada
  bola con su oclusión horneada en el color del vértice —la barbilla sobre el
  pecho, la panza, la cara de dentro del brazo—, que es lo que separa el brazo
  del cuerpo cuando los dos son del color de la ropa y la rampa toon les da el
  mismo escalón, y con brillo en los ojos, que dos puntos negros son dos
  agujeros. Mide
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
  caracteres de control) y se pinta con `textContent`, nunca como marcado. Eso
  es hablar **a quien pase**; para hablar con alguien en concreto está el
  **corro**, más abajo.
- **El corro**: hablar con alguien en concreto, y que se vea. Hasta ahora lo
  que decías lo oía todo el que pasara, y dos personas juntas no se
  distinguían de dos que se han cruzado. Un **corro** es un grupo hablando
  **en un sitio**: se dibuja en el suelo un **círculo de luz** que abarca a
  los que están dentro, con un aro a los pies de cada uno, y el círculo se
  abre y se estrecha solo, en cada fotograma, según se junta o se separa la
  gente. Desde lejos se lee «ahí hay una conversación» antes de meterse en
  ella. Lo que se dice dentro **solo lo leen los de dentro**; los de fuera ven
  un «…» sobre sus cabezas: que hablan, no lo que dicen, igual que al pasar al
  lado de dos que charlan. **Se empieza tocando a alguien** en el mundo (el
  rayo, y si falla, quien caiga más cerca en pantalla: un avatar a 30 m ocupa
  cuatro píxeles y un dedo mide más): sale su **ficha** —quién es, a cuánto
  está, y hablarle, silenciarle o reportarle— y desde ahí le pides hablar. Si
  acepta, hay corro. **Entrar tiene puerta**: quien llega toca a uno de dentro
  y **llama**, y el aviso le sale a **quien empezó el corro**, que le deja
  entrar o no (y mientras, al anfitrión le sale un «✋ quiere entrar» sobre su
  cabeza, en el mundo). El anfitrión puede dejarlo **abierto**, y entonces se
  une quien pase, que es lo que hace falta en una fiesta en la plaza; también
  puede sacar a alguien. Caben `CORRO_MAX` (8). Y un corro está en un sitio:
  si te alejas más de `CORRO_RADIO_M` (20 m) del resto **sales solo**, con un
  aviso antes a los 15, porque irse de una conversación es irse. Todo viaja
  **montado en el sondeo de presencia**, sin ruta ni infraestructura nuevas
  (`src/lib/corro.js` para las reglas compartidas, los mapas en memoria en
  `src/lib/mundo.js`), y **no se guarda nada**: un corro que se deshace no ha
  existido para nadie. El servidor manda el ESTADO (quién está dentro, quién
  espera en la puerta) y no los sucesos: los avisos salen de compararlo con lo
  que había, que es lo que aguanta un sondeo perdido sin contar dos veces lo
  mismo ni quedarse mudo.
- **El hilo del corro**: dentro de un corro lo que dices **no sale sobre tu
  cabeza**. Sale volando: una cuenta de tu color describe un arco desde tu
  cabeza hasta el **carrete**, un globo que flota sobre el centro del corro y
  que guarda lo hablado con **el nombre delante**, como en cualquier chat de
  grupo (y sin repetirlo cuando sigue hablando el mismo, que es ruido). El
  arco no es una ruta escrita: son dos traslaciones anidadas con curvas
  distintas, la de fuera con el avance y la de dentro con la caída. El
  carrete **tiene tope** —cuatro líneas y `min(300px, 62vw)` de ancho—, y
  como la cámara de serie mira de cerca y desde alto, el punto del que cuelga
  se proyecta arriba del todo: se sujeta por debajo de la barra y dentro de
  la pantalla, y cuando le toca sujetarse pierde el pico, que ya no apunta a
  nadie. Lo que no cabe se lee en **«Todo»**, una hoja normal con la
  conversación entera. Quien pasa por al lado y no está dentro ve un **globo
  mudo** sobre el grupo —tres puntos que laten y nada más—: sabe que ahí se
  está hablando, y lo que se dice es de los de dentro. El hilo lo guarda el
  **corro**, no quien habló: así los tres leen lo mismo aunque a uno se le
  pierda un sondeo, y por eso vive en la memoria del servidor (tope de
  `CORRO_LINEAS`, 14) **mientras dure el corro y se va con él**: ni disco, ni
  registro, ni nada que sobreviva a la conversación. Quien entra empieza a
  leer **desde que entra**, como en cualquier corro de verdad: nadie llega y
  se pone a leer lo de antes.
- **Silenciar y reportar**: tocando «N personas en el mundo» se abre la hoja
  de **vecinos**, con quien anda cerca y a qué distancia (y tocando a alguien
  en el mundo, su ficha, que lleva lo mismo). **Silenciar** es lo
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
  /api/presencia` y recibe a quien esté a menos de 400 m; por ahí viajan
  también lo que dices, los gestos, los reportes y el corro. Los demás se
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
hace un gesto, y se comprueba que a Bea le llegan), **hacen corro** (Ana toca
a Bea en el mundo, le pide hablar, Bea acepta, y se comprueba que las dos
tienen el corro, que se dibuja el círculo en el suelo, que Bea lee lo que Ana
dice **en el carrete** —con el nombre delante, y nada sobre las cabezas— y que
un tercero que pasa ve que habla pero no lo que dice; luego ese tercero
**llama a la puerta** y el aviso le sale a Ana, que es quien lo empezó, y le
deja entrar; y Bea se sale para comprobar que desde fuera ve el **globo mudo**
sobre el grupo y ni una letra), **se silencian** (Bea
silencia a Ana y la reporta, y se comprueba que deja de verle el nombre y lo
que dice, y que el reporte queda guardado con lo que Ana decía), reclaman un
solar,
construyen, comprueban que el otro lo ve y que el servidor lo guardó, y Bea
entra en la parcela de Ana, ve de quién es y le da a me gusta. Deja capturas de
cada paso en `OUT` (por defecto, el directorio actual).

El tercero del corro no abre una tercera pestaña, sino que sondea la API a
mano: tres mundos con sombras a la vez dejan sin fotogramas al render por
software. Y al acabar se manda lejos, que si no es él quien sale primero en la
hoja de vecinos del paso siguiente.

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
   piel propios con perfil que se puede cambiar, silenciar y reportar, y el
   **corro**: tocar a alguien para hablar solo con él, un círculo en el suelo
   que enseña quién habla con quién, una puerta que abre quien lo empezó, y el
   hilo con lo hablado volando hasta un carrete sobre el grupo
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
commits —las manchas de contacto bajo las piezas, el asiento por huella, la
densidad de la hierba, la cúpula al final de los opacos y el atlas
deduplicado ya están—; lo que queda, por si alguien lo retoma, más o menos
por orden de lo que daría:

- **Rejilla de 4 m visible** al colocar piezas de rejilla (una textura en
  `texObra`, cero draw calls): es el «casar dos tramos de valla», que es el
  problema real.
- **`MAX_INST` de 3.000 a ~400**: 33 mallas × 3.000 × 16 floats son 6,3 MB en
  CPU y otros tantos en GPU, casi todo aire. Ojo con el número: `MAX_PIEZAS`
  es 150 por parcela y se cargan 13 × 13, así que el tope no es teórico —
  bajarlo de más hace desaparecer piezas en un barrio construido, y en
  silencio. Lo que hace falta de verdad es que el búfer crezca solo.
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
