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
  hierba, es un rascado que hierve al andar). La mata son **pocas hojas y
  anchas, con la punta roma**, y el filo lo **suaviza la GPU** con
  `alphaToCoverage`: el `alphaTest` recorta a tijera y el MSAA del lienzo no
  lo arregla, porque el multisample solo ve los bordes de la geometría y el de
  una hoja está dentro de un quad; pasando la alfa a la máscara de cobertura
  del propio MSAA el borde sale suave sin ordenar transparencias ni un pase
  más. Con la fórmula que trae three (un smoothstep de `alphaTest` a
  `alphaTest + fwidth`) no vale: reparte el medio tono por TODA la hoja cuando
  la hoja mide cuatro píxeles y encima la adelgaza, así que escarchaba las
  puntas de blanco. La de aquí convierte la alfa en **distancia al borde en
  píxeles** y la recorta, y la hoja conserva su grosor. Y ninguna fórmula
  salva una hoja que baja del píxel: por eso son pocas y gordas, y por eso la
  textura va **un punto más oscura** de lo que pide el ojo, que al suavizar,
  el píxel del filo se mezcla con el suelo —más claro— y la mata entera sube
  de valor. Sin MSAA en el lienzo no se activa nada de esto. Cada mata lleva
  además **su verde y su silueta**: el color sale de un hash de dónde está,
  como las copas, y a la mitad se les da la vuelta a la textura, porque el
  giro por instancia no disimula que una mata girada 180° sigue siendo el
  mismo dibujo. Copas que se mecen (el viento
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
  sale a escamas; y cada onda **se apaga cuando su fase avanza más de un
  píxel** —y los escalones de la cresta y del destello se ensanchan con
  `fwidth`—, que es lo que quita el moiré de la orilla lejana; **arena y limo**
  donde el cauce manda y no por altura absoluta; un **horizonte con relieve de
  verdad** —una corona de terreno aparte, de 200 a 1.500 m, que sigue al avatar
  y lleva su propia altura de decenas de metros, con **arboledas de bajo
  detalle** sembradas por hash encima, y con su propia **perspectiva aérea**,
  que se acerca al cielo con la distancia sin llegar nunca y se despeja con la
  ALTURA, porque la calima está tumbada en el suelo (más abajo, en la hoja de
  ruta, el porqué de cada número)—; el **velo del sol** calentando la mitad suroeste
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
- **Hablar**: con el botón 💬 se abre el **chat**, un panel como el de
  cualquier mensajería: la conversación en burbujas —lo de los demás a la
  izquierda con su nombre y su color, lo tuyo a la derecha—, la hora de cada
  mensaje, y abajo la caja de escribir con los **gestos** (👋 😄 ❤️ 🎉 🙏 😮),
  una **foto** 📷 y un **audio** 🎤 que se graba manteniendo pulsado. Lo que
  dices sale ADEMÁS en una **burbuja sobre tu cabeza** y lo lee quien esté
  cerca: el chat es dónde se lee lo hablado, la burbuja es quién lo ha dicho y
  desde dónde, y las dos cosas hacen falta —un chat sin burbujas es una sala
  de chat con un mundo de fondo, y una burbuja sin chat se lleva lo dicho a
  los nueve segundos—. El panel va **anclado a un lado** (a la izquierda en
  escritorio, a lo ancho en el móvil) y no en el centro: abierto es grande, y
  en medio tapaba justo lo que se está mirando, que es el avatar y la persona
  a la que se le habla. Con el chat abierto se esconde el joystick: se está
  escribiendo, no andando. Un gesto no es solo un emoji que sube: **mueve el
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
  **corro**, más abajo. Lo que se lee en el chat de «Cerca» **vive en tu
  navegador** y solo desde que entraste: el servidor sigue sin guardar una
  conversación, y quien llegue después no lee lo de antes. Al **silenciar** a
  alguien, lo que dijo antes se va también del chat: silenciar es dejar de
  verle, no dejar de verle a partir de ahora.
- **Fotos y audios** (`src/lib/adjuntos.js`): en el chat se puede mandar una
  foto o un mensaje de voz, y van por donde va todo lo demás —montados en el
  sondeo de presencia, sin ruta, sin subida aparte y sin almacén de ficheros—.
  Como **data URL**, que es lo que un JSON lleva sin más: un 33 % más gordo
  que el binario, y a cambio no hay nada que limpiar cuando la conversación se
  acaba. La foto **se reduce en tu navegador** antes de salir (lado mayor a
  720 px y JPEG a 0,72, apretando más si no cabe en 220 KB): un móvil hace
  fotos de 4 MB y en el chat se ven a 220 px, así que subirla entera es
  regalarle megas a todo el mundo. El audio se graba con `MediaRecorder` a 24
  kbps, con tope de 30 s —un mensaje de voz, no un pódcast— y sale al soltar
  el micrófono; cancelar lo tira sin que salga del navegador.
  Lo importante es **cómo llega a los demás**: el mensaje lleva solo la FICHA
  del adjunto (id, tipo, segundos) y quien lo quiere lo **pide por id** en su
  siguiente sondeo. Si el adjunto viajara dentro de cada sondeo, un vecino con
  la burbuja viva se lo tragaría seis veces (la burbuja dura 9 s y el sondeo va
  cada 1,5), y en un corro de ocho cada foto serían cuarenta y ocho descargas;
  pedido por id, es una por persona. Viven en la **memoria** del servidor diez
  minutos (los de un corro se van con el corro, y los que se caen del hilo con
  su línea), con un tope global de 48 MB en el que los viejos se caen solos: un
  servidor de una instancia no puede dejar que una tarde de fotos se lo coma. Y
  **solo llegan a quien puede leerlos**: el id es la llave y solo lo tiene
  quien recibió el mensaje, y un adjunto dicho DENTRO de un corro no se le
  sirve a nadie de fuera aunque tenga el id. Los tipos que se aceptan son una
  lista cerrada (JPEG y WebP, y WebM/MP4/OGG para el audio), comprobada con una
  expresión regular sobre el data URL entero.
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
  nadie. **El globo se toca y abre el chat**, que es donde se lee la
  conversación entera y donde se escribe: el globo enseña las últimas líneas
  en el sitio en el que están pasando, y el chat es la conversación. Mientras
  el chat está abierto el globo se esconde, que serían las mismas líneas dos
  veces. Quien pasa por al lado y no está dentro ve un **globo
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
- **Construir**: en tu parcela, «Construir» abre la paleta con **56 piezas**
  en cinco pestañas: casas (nueve del City Kit, más torre, tienda, caseta y
  cobertizo), naturaleza (árboles, arbustos, flores, setas, calabazas, rocas,
  troncos), jardín (banco, mesa, silla, maceta, farola, fuente, hoguera,
  cartel, bandera, tendedero, arenero, buzón, barbacoa), **suelo** (camino,
  puente, valla, losa, patio, patio grande y parterre) y **calle** (recta,
  curva, cruce, cruce en T, paso de cebra, fin de calle, entrada, semáforo,
  señal y contenedor). El suelo era el hueco
  grande del catálogo: eran tres piezas y ninguna dibujaba una forma, así que
  un patio de 12 × 12 salían nueve toques a la rejilla de 4 m y el 6 % del
  presupuesto de la parcela; con `patio grande` es un toque y una pieza. Toca el suelo
  para colocar una pieza (se pega a medio metro; caminos, vallas y puentes a
  una rejilla de 4 m para que casen, y la calle a una de 8) y **arrastra una pieza** con el dedo o
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
  [Kenney](https://kenney.nl) (Nature Kit, City Kit Suburban, City Kit Roads
  y Furniture Kit, licencia CC0), en `public/modelos/` con sus miniaturas en
  `public/miniaturas/`; 42 modelos, 1,3 MB en total. **Cada kit con atlas va
  en su carpeta** (`modelos/calles/` es el de las calles), porque TODOS los
  kits de Kenney llaman a su atlas `Textures/colormap.png` aunque sean
  imágenes distintas: el visor comparte material por la RUTA de la imagen, y
  con el nombre a secas las calles se pintaban con la textura de las casas.
  Es lo que hay que mirar al meter un kit nuevo. Se cargan **todos al
  arrancar** (un `Promise.all` sobre el catálogo), así que cada modelo nuevo
  es descarga en la primera visita de todo el mundo: pasar de 27 a 42 subió
  de 780 KB a 1,3 MB. El día que el catálogo crezca otro tanto, lo que toca
  es cargar por pestaña y no antes de abrir la paleta. Las **otras 14 piezas
  son geometría generada** (torre, farola, fuente, bandera, caseta,
  cobertizo, tendedero, arenero, buzón, barbacoa, losa, patio, patio grande y
  parterre): 0 bytes de descarga, y son las que se pueden teñir enteras. Al cargar cada uno se
  funden sus mallas: las de color liso hornean el color en el vértice y van
  en UNA geometría con el material toon de siempre; las que traen un atlas
  van en otra con la textura. Luego se escala para que el lado mayor en
  planta mida lo que dice `ancho` en el catálogo (`src/lib/piezas.js`) y se
  deja el origen en el centro, a ras de suelo. Al que viene mirando al otro
  lado (la señal de stop enseñaba el dorso) se le da el `giro` del catálogo,
  en cuartos de vuelta, al cargarlo.
- **La calle**, y por qué a 8 m: el City Kit Roads son baldosas de 1×1 unidad
  de kit, y las casas del City Kit están escaladas a ~7,7 m por unidad. A esa
  misma escala una calzada mide 7,7 m, que es lo que mide una calle
  residencial de verdad; se redondea a **8** porque es el único paso que
  divide la parcela justo (48 / 8 = 6). Ponerla a los 4 m de la rejilla de
  siempre habría dejado las rayas del paso de cebra y el bordillo a mitad de
  escala que la puerta de al lado. Por eso `rejilla` en el catálogo ya no es
  una bandera sino el PASO EN METROS: 4 los caminos y las vallas de siempre,
  8 la calle.
- **Cómo se sienta una losa grande**: una pieza de suelo tiene la cara que se
  ve en su BASE —el asfalto va a ras y lo que sobresale es el bordillo—, así
  que los 12 cm de hundido que llevan las demás piezas no le valen. El
  terreno cae hasta 5,6 cm por metro, o sea hasta 20 de desnivel bajo una
  calle de 8 m: hundida por el centro, la mitad de arriba queda por debajo
  del suelo y la calzada aparece **cortada en diagonal**, justo por donde
  parte la malla del terreno. De 8 m en adelante la pieza se apoya en el
  punto más alto de su huella (nueve muestras: en una loma la cima cae en
  mitad de un lado tantas veces como en una esquina). Por debajo de 8 no se
  toca: el camino son losas SUELTAS de 4 m y que el terreno les entre por una
  esquina es lo que hace que se lean como puestas EN la hierba. Le pasaba ya
  al patio grande, que mide 12 m, y la hierba tenía el mismo fallo por otro
  lado: el margen en el que no se siembra estaba fijado a 2,3 m —media
  anchura del camino— así que crecía por dentro del patio y de la calzada;
  ahora sale de lo que mide la pieza.
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

Y las herramientas, todas con la app servida:

```bash
npm run vistas        # banco visual: las 10 vistas de escritorio, contra su referencia
npm run movil         # la misma casa desde un teléfono, de cerca: lo que el banco no ve
npm run medidas       # lo que mide cada pieza de verdad, en avatares de 1,8 m
npm run miniaturas    # regenera public/miniaturas/*.png con el motor
npm run atlas         # le quita el tramado a los atlas de color de Kenney
npm run prueba        # integración: dos jugadoras en dos pestañas
npm run prueba-chat   # el chat: texto, fotos y audios, dentro y fuera de un corro
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
persona mide lo que mide al lado de una puerta, un banco o una valla. Y otra,
`horizonte`, que existe solo para juzgar el **horizonte**: campo abierto, la
cámara casi horizontal (`pol` 83) y nada delante. Se añadió ANTES de tocar el
horizonte, que es la regla: si aparece un fallo nuevo, primero la vista que lo
enseña.

De las nueve vistas, solo tres tienen el horizonte en cuadro (`horizonte`,
`a-ras-de-suelo` y `a-escala`): hace falta `pol` ≥ 65,4° para que el
cielo entre siquiera, y en las otras seis el suelo llena el encuadre entero.

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
3. ✅ El **chat**: un panel de mensajería de verdad (burbujas a un lado y a
   otro, la hora, y fotos y audios) sobre lo que ya había, sin ruta ni almacén
   nuevos y sin que nada se guarde
4. **Cuentas de usuario** ← lo siguiente. Hoy el id es del dispositivo y se
   puede falsificar, y de ahí cuelga todo lo demás: la propiedad de una parcela
   es «quien tenga ese localStorage», bloquear a alguien cuesta lo que vaciarlo
   y volver, y un reporte señala a un id que puede no volver a existir. Es lo
   que convierte silenciar y bloquear en moderación de verdad.
5. WebSockets para la presencia (hablar y los gestos ya van por el sondeo, que
   para eso sobra; lo que se nota es el retardo al ver andar a los demás)
6. Más piezas, piezas apilables (plantas), interiores

### Lo que dejó apuntado la auditoría visual

Hay una auditoría de calidad visual hecha sobre este código (11 dimensiones,
101 hallazgos juzgados, 12 refutados). Lo que se ha aplicado está en los
commits —las manchas de contacto bajo las piezas, el asiento por huella, la
densidad de la hierba, la cúpula al final de los opacos y el atlas
deduplicado ya están—; lo que queda, por si alguien lo retoma, más o menos
por orden de lo que daría:

- **Rejilla visible** al colocar piezas de rejilla (una textura en `texObra`,
  cero draw calls): es el «casar dos tramos de valla», que es el problema
  real. Ahora hacen falta DOS pasos, 4 m y 8, porque la calle va a 8: el paso
  de cada pieza lo dice `pasoRejilla(t)` en `src/lib/piezas.js`.
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

### Lo que queda de la segunda auditoría visual

Una segunda pasada por las siete vistas (septiembre de 2026). Lo que salió
arreglado —las hileras de hierba y las manchas de la losa— está en el commit
`b405be2`, y los dos primeros puntos —**el horizonte vacío**, que era el más
caro, y **el moiré del agua**— están hechos (las dos secciones siguientes
cuentan cómo). Esto es lo que se miró y NO se ha tocado, por orden de lo que
daría. Nada de esto está prototipado, así que el coste es estimación, no medida.

- **El naranja del kit manda demasiado.** Vallas, troncos y bancos comparten un
  naranja muy saturado que domina cada encuadre verde. El mecanismo para
  remapearlo ya existe (`PALETA_KIT` y `acercaVerde` en `Mundo.js`, que es lo
  que ya lleva los verdes menta del Nature Kit al verde hierba), así que son
  horas. Pero es GUSTO, no defecto: puede que se quiera así, y por eso no se
  tocó.
- **Las losas del `camino` no contrastan sobre el paseo.** Puestas sobre
  pavimento son casi del mismo tono y desaparecen; sobre hierba se leen bien.
  Un punto más oscuras. Minutos.
- **Los modelos se cargan todos al arrancar.** Un `Promise.all` sobre el
  catálogo entero: 42 modelos, 1,3 MB en la primera visita de cualquiera. Con
  27 eran 780 KB. Lo que toca cuando el catálogo crezca otra vez es cargar por
  pestaña, y no antes de abrir la paleta.

Y una hipótesis que se miró y **se descartó**, apuntada para que nadie la
«arregle» otro día: parecía que los árboles del fondo no proyectaban sombra en
`a-ras-de-suelo`. No es un fallo. El sol es bajo y del suroeste y esa cámara
mira al norte, así que las sombras caen DETRÁS de los árboles y las tapan ellos
mismos. La caja de sombras son 150 m con 2.048 px (7,3 cm por téxel), de sobra
para esa vista.

### El horizonte, ya con relieve

El primer punto de esa auditoría —«el horizonte está vacío», el más caro y el
que más daba— está hecho. Lo que se metió, y por qué así:

- **El diagnóstico no era «falta suelo».** Suelo hay 768 m. Lo que pasa es que
  con la cámara casi horizontal el mundo entero de 100 a 300 m —justo el trecho
  en el que la niebla hace su trabajo— cabe en DIECIOCHO píxeles de alto, y de
  310 m en adelante el suelo ya está clavado en el color exacto de la calima:
  un píxel de esa banda vale treinta metros de mundo. El degradado de distancia
  no se puede ver, y lo que queda es el canto de un disco. Lo único que ocupa
  pantalla a lo lejos es lo que tiene **altura**: una loma de 58 m a 800 m
  levanta 52 px sobre el horizonte, y una arboleda de 20 m a 500 m, 29.
- **Una corona de terreno aparte** (las constantes `HOR_*` de `Mundo.js`), de
  200 a 1.500 m, que sigue al avatar y lleva su propia altura: cinco ondas de
  220 a 1.500 m de largo y 58 m de amplitud, que valen CERO hasta los 560 m
  —la esquina del plano de suelo está a 543— y se levantan del todo a los
  1.000. Así el relieve lejano no es «el mismo terreno más ondulado», que es lo
  que la auditoría descartaba de entrada (media parcela de desnivel es el techo
  para que una casa no flote), sino otra cosa que solo existe donde no se anda.
  Solo levanta lo que pasa de un umbral: sin ese corte el horizonte entero
  ondula como una sábana tendida y se lee como un patrón, y una loma se cuenta
  porque a los lados no hay nada.
- **Arboledas de bajo detalle** sembradas por hash entre 380 y 1.150 m: tres
  siluetas —fronda, mixta y pinar—, bultos y conos de ciento y pico triángulos,
  unas setecientas, en tres llamadas de dibujo. Son las que MÁS rompen la raya,
  porque se apoyan justo en la línea del horizonte. Tres siluetas y no una: con
  una sola, el giro y la escala por instancia no bastan —la conífera asomaba
  siempre lo mismo por encima de la masa y el horizonte salía con una
  empalizada de picas a la misma altura—. Y las coníferas, anchas de base: el
  primer intento fueron conos de 4 m de radio y 19 de alto, y a 600 m no se
  leían como árboles sino como ANTENAS.
- **La calima del horizonte no es la niebla del mundo.** La niebla satura a
  325 m, así que una loma a 800 m con la niebla de serie sería del color exacto
  del cielo, o sea invisible. Esta hace dos cosas: se acerca al cielo con la
  distancia sin llegar nunca (del 62 % al 92 %), que es lo que deja leer tres o
  cuatro planos cada uno más pálido que el de delante; y se despeja con la
  ALTURA sobre el llano, porque la calima está tumbada en el suelo, así que el
  pie de la loma se disuelve y la cresta asoma. Lo segundo es además lo que
  casa la corona con el borde del plano de suelo **sin dejar una raya**: a ras
  de llano da calima pura, que es el mismo color al que satura la niebla
  (`NIEBLA` y `CIELO_CALIMA` son el mismo).
- **Y se disuelve contra el CIELO, no contra un color fijo.** Con un color
  fijo, una arboleda de 30 m a 450 m llega a 41 px sobre el horizonte, donde el
  cielo ya casi no tiene calima y es azul: la silueta salía MÁS CLARA que el
  fondo y el horizonte se leía como una hilera de agujas de hielo. Ahora lo
  lejano se funde con el degradado de la cúpula en esa misma dirección.
- **Fuera las dos crestas pintadas en la cúpula**, que eran el parche de la
  primera auditoría para ese mismo hueco. Con relieve de verdad detrás, una
  raya pintada encima sale POR DELANTE de una loma que está a 800 m: un segundo
  horizonte por detrás del primero. Y de todas formas no llegaban: el armónico
  3 tarda 1.505 px en dar una ondulación y el encuadre mide 1.000, así que en
  pantalla era literalmente una recta con ±10 px de deriva.
- **La cúpula pasa de 1.000 a 2.600 m de radio.** No se ve distinta —su shader
  va por dirección, no por geometría— pero se pinta la ÚLTIMA de las opacas y
  con test de profundidad, así que a 1.000 m se comía las lomas de 1.500. Con
  2.600 sigue holgadamente dentro de `camera.far` (3.000).
- **El campo sembrado llega a 250 m** en vez de a 190, para que entre lo que se
  siembra y las arboledas no quede una franja de pradera pelada. De paso, el
  corte se lleva a donde la niebla ya solo deja el 35 % del color, así que el
  pop del borde del sembrado —que era un defecto de antes— se nota menos.
- **Vista nueva del banco, `horizonte`**, añadida ANTES de tocar nada.

Lo que cuesta: unos 37.000 triángulos de corona y unos 90.000 de arboledas, en
cuatro llamadas de dibujo, sin sombras y sin la niebla del mundo. Medido con
Chromium por software (SwiftShader, que castiga la geometría mucho más que una
GPU de verdad, así que esto es un techo y no una medida) el fotograma pasa de
415 a 492 ms: un 19 %.

Y dos cosas que conviene saber antes de tocarlo:

- **A las lomas no se llega nunca.** La corona sigue al avatar, así que una
  loma se levanta a los 1.000 m y se va desinflando según se anda hacia ella,
  hasta valer cero a los 560. El desinflado no se ve —al encogerse, la calima
  se la come sola, porque la calima va por altura, así que se disuelve en vez
  de hundirse— pero el paisaje del fondo es un fondo, no un sitio. Con un mundo
  infinito y llano por diseño no hay otra: el relieve tiene que valer cero
  donde se construye.
- **La corona va CONTINUA, no a saltos de parcela como el suelo.** El suelo
  salta de 48 en 48 m para que la trama de parcelas no resbale; a 800 m, un
  salto de 48 m mueve una silueta 43 píxeles. Y las arboledas se resiembran
  cada 12 m andados, no en cada `pintaMundo`, que corre en cada `pointermove`
  de un arrastre.

### El rizado del agua, sin moiré

El segundo punto de esa auditoría también está hecho. La hipótesis apuntada era
que faltaba desorden —«el mismo tipo de fallo que tenían las hileras de
hierba»—, y **no era eso**: el desorden estaba bien. Era **aliasing**, que es lo
que la palabra moiré decía literalmente.

- **Lo que se veía.** Ampliando la orilla lejana en `rio-y-paseo`, un enrejado
  regular de rombos con celdas de un píxel y medio. Ese tamaño es la pista: no
  hay nada en el shader que mida píxel y medio, así que el dibujo no venía del
  agua sino del BATIDO entre las ondas y la rejilla de la pantalla. Las ondas
  del rizado miden de 1,4 a 2,6 m; cuando una de ellas baja del par de píxeles,
  lo que aparece en su sitio es la interferencia, no la onda.
- **Cada onda se apaga por Nyquist, y por separado.** Se mide cuánta fase
  avanza cada onda EN UN PÍXEL (`fwidth` de las coordenadas del cauce) y se
  apaga entre 0,9 y 2,6 radianes por píxel, o sea de siete a dos píxeles y
  medio de longitud de onda. Por separado y no en bloque porque es lo natural:
  la corta se va primero y la larga aguanta, así que el río no pierde el rizado
  de golpe sino por escalas.
- **Y los cortes duros se ensanchan con `fwidth`**, igual que la junta de las
  losas de la plaza. Son tres —la banda de la cresta, el destello y sobre todo
  el brillo especular, que es un `step()` sobre una potencia 60, lo más fino de
  toda la escena y lo único del agua que no llevaba NINGUNA atenuación—. Un
  escalón mete armónicos muy por encima de su fundamental, así que apagar solo
  las ondas no bastaba: con el corte puesto en π radianes por píxel todavía
  quedaba enrejado. De cerca siguen siendo cortes duros, que es lo que hace que
  el rizado se lea a bandas de dibujo animado.
- **Fuera el apagado por metros.** Había un `det` que bajaba el rizado con la
  distancia (de 50 a 170 m) hasta un suelo del 30 %. Era la misma idea a ojo, y
  fallaba por los dos lados: no llegaba a apagarse nunca —de ahí que el moiré
  siguiera ahí— y al alejar la cámara volvía, porque los metros no saben
  cuántos píxeles mide una onda. Lo de ahora sale solo con la resolución, el
  campo de visión y el ángulo con que se mire el agua.

Medido sobre el recorte de la orilla lejana de `rio-y-paseo`, la energía de
alta frecuencia (media de |píxel − media 3×3|) baja de **3,02 a 0,46**; en el
agua cercana se queda en **1,93 frente a 2,11**, o sea que conserva el 91 % del
detalle. Que es justo lo que se buscaba: quitar lo que no se puede dibujar sin
tocar lo que sí.

Del banco se mueve solo `rio-y-paseo` (0,30 %); las demás salen idénticas. Y se
añadió la vista **`rio-lejos`** —el río alejándose trescientos metros— porque
en `rio-y-paseo` el tramo lejano ocupa una esquina y un tramado ahí se cuela
por debajo del umbral. Se añadió DESPUÉS de arreglarlo, no antes: sirve para
que no vuelva.

### El tramado de las paredes, que era el atlas

Un aviso desde un iPhone: «se ve como un tramado en las paredes de las casas y
en los árboles». Y era verdad, desde el primer día, solo que hasta que alguien
no se pone a un palmo de una casa **en un móvil** no se ve.

- **Lo que era.** `public/modelos/Textures/colormap.png`, el atlas del City Kit
  y el Nature Kit, es un PNG **indexado de 256 colores**, y sus casillas no son
  colores planos: son degradados verticales. Un degradado no cabe liso en una
  paleta de 256 entradas, así que quien lo exportó lo guardó **tramado**:
  píxeles alternos entre dos tonos vecinos, con el patrón desplazado fila a
  fila, que es lo que dibuja la diagonal. 75 de sus 256 franjas están así; las
  otras 181 son planas y nunca dieron problema.
- **Por qué solo de cerca y solo en el móvil.** De lejos los mipmaps promedian
  el tramado y sale exactamente el color liso que se pretendía —por eso el
  banco visual no lo veía, y sigue sin verlo: las diez vistas se mueven un
  0,00 % con el arreglo puesto—. De cerca y a densidad 3, un téxel llega a
  medir un píxel de pantalla y el tramado se ve tal cual.
- **Lo que NO era**, que costó descartarlo y por eso queda escrito: no son las
  sombras (apagadas sigue igual), no es el filtrado del atlas (con
  `NearestFilter` y sin mipmaps sale idéntico: el tramado está en los téxeles,
  no en cómo se interpolan), no es la rampa toon ni la luz (sin iluminación
  ninguna sigue) y no es la compresión de la captura del móvil (la hierba, que
  es shader puro y no pasa por el atlas, sale perfectamente lisa en esa misma
  imagen). Con un color plano en vez del atlas, desaparece del todo: estaba en
  la textura.
- **El arreglo, `npm run atlas`.** El atlas son **16 franjas verticales de 32
  px** —medido, no supuesto: el guion detecta los bordes y se planta si un
  atlas nuevo no tiene esa forma—, cada una un degradado vertical. Dentro de
  una franja, una fila debería ser de un color; lo que varía es el tramado. Así
  que cada fila de cada franja se sustituye por su media: el degradado queda
  igual, el tramado desaparece y **nunca se promedia cruzando un borde**, que
  es lo que habría teñido una casilla con la de al lado. Solo se toca la fila
  si su variación es pequeña (12/255): en las 4 filas del atlas que llevan
  dibujo de verdad no se entra. El cambio máximo sobre el original es de 8/255
  y el medio, 0,24. Es idempotente, y el atlas de las calles —que es RGBA y no
  está tramado— se queda como está.
- **Cómo se juzga, porque el banco no puede.** Las diez vistas son de
  escritorio a densidad 1: ahí este defecto no existe. Para eso está
  **`npm run movil`**, que captura la casa de muestra desde el suelo con el
  encuadre y la densidad de un teléfono y mide lo fino que queda la pared (cada
  píxel contra la media móvil de nueve de su fila, que quita el degradado
  legítimo de la niebla y deja solo lo que no debería estar). Con el atlas
  tramado da **0,18**; con el atlas limpio, **0,0013**, y avisa por encima de
  0,05. Se comprobó que salta: con el atlas viejo puesto, salta.
- Y las **miniaturas** lo llevaban también (el tejado del bungaló pasa de 1,06
  a 0,53 con la misma medida), así que se regeneraron las 56.

### La fuga de luz en la pared en sombra

Otro aviso desde un iPhone: «se ve muy mal en las paredes, hay la sombra, pero
está como con poca resolución». Y la pregunta que venía detrás —¿no se arregla
con más resolución?— tenía la respuesta al revés: con más resolución sale PEOR.

- **Lo que es.** En la pared que está de espaldas al sol se cuela una franja
  diagonal de luz, del ancho de un par de téxeles del mapa de sombras. De lejos
  parece un rayado; de cerca es una banda de pared que se libra de la sombra.
- **Cómo se sabe que son las sombras.** Con `sol.castShadow = false` desaparece
  entero y solo queda el bandeado horizontal del degradado del atlas, que es
  legítimo. Y sin apagar nada: el patrón **cambia de dirección y de paso en cada
  superficie** (medido sobre la captura del aviso, 0° en la pared entre
  ventanas, 135° en el cristal, 165° en la planta baja y 105° en el tejado, con
  pasos de 13 a 18 px). Una textura no puede hacer eso —las UV de Kenney son
  islas de un téxel, no pueden dibujar un patrón a lo ancho de una cara—; algo
  que vive en el espacio de la LUZ, sí.
- **Por qué se ve, si esa pared está de espaldas al sol.** Por la rampa toon. El
  escalón de media luz va de t = 0,44 a 0,56, o sea de N·L = −0,12 a +0,12: una
  cara casi de canto al sol NO está a oscuras, sigue recibiendo el escalón
  intermedio. Así que la máscara de sombra pinta ahí, y la fuga se nota.
- **De dónde sale.** Al pintar el mapa de sombras, three le da la vuelta al
  `side` por defecto: de un material `FrontSide` dibuja las TRASERAS. Eso mete
  en el mapa la propia pared de espaldas al sol, a su misma profundidad — se
  compara consigo misma, y una banda se escapa del test.
- **Lo que NO lo arregla**, todo medido en la misma vista (la casa de muestra
  por su lado en sombra, `?x=78&y=86&d=8&pol=82&az=45`, a densidad 3):
  - **4096 dejando `normalBias` en 1,5 téxeles: PEOR.** El sesgo está escrito en
    téxeles, así que al doblar el mapa se queda a la MITAD en metros (0,11 →
    0,055), y lo que cierra la fuga son los metros, no los téxeles.
  - **Caja de 100 m con el mismo 1,5 téxeles: peor**, por lo mismo (0,073 m), y
    encima pierde alcance.
  - **Sesgo a 3 téxeles (0,22 m): la cierra, pero aplana al avatar** — la cabeza
    deja de sombrear la barbilla, que es justo lo que protege el comentario del
    `normalBias`.
  - **4096 con el sesgo igual EN METROS: la cierra**, y sin efecto medible. Es
    la opción cara: 16,8 millones de téxeles de pasada de profundidad cada
    0,25 m que anda el avatar, en el mismo teléfono donde se vio el defecto.
- **El arreglo, una línea: `matAtlas.shadowSide = THREE.FrontSide`.** Al mapa
  solo van las caras que miran al sol. Quien sombrea la pared de detrás pasa a
  ser el lado ILUMINADO de la casa, metros por delante, y sale uniforme. No
  toca el sesgo ni la memoria, y el autosombreado del avatar —que va con
  `matFijo`, no con el atlas— se queda exactamente como estaba.
- **Lo que cuesta.** La pared ILUMINADA gana algo de rayado: `npm run movil`
  pasa de 0,0013 a **0,0091**, cinco veces por debajo del umbral de 0,05 y
  veinte por debajo del tramado que sí se veía a simple vista. En el banco se
  mueven cuatro vistas y ninguna más de 0,34 % (`a-escala`), y todo el
  movimiento cae DENTRO de la casa: los marcos de las ventanas y la línea del
  alero. Ninguna pieza perdió su sombra.
- **Pide geometría cerrada.** Con solo las caras a la luz, una pieza de una sola
  cara o abierta dejaría de proyectar sombra desde ciertos ángulos. Los kits de
  Kenney son sólidos cerrados; el día que entre una pieza que no lo sea, es aquí
  donde va a aparecer.

### Si se mete otro kit

Lo aprendido metiendo el City Kit Roads, que es lo que va a doler la próxima vez:

- **Cada kit con atlas, en su carpeta** bajo `public/modelos/`. TODOS los kits
  de Kenney llaman a su atlas `Textures/colormap.png` aunque sean imágenes
  distintas, y `cargaModelo` comparte material por la RUTA de la imagen justo
  por eso. Con el nombre a secas, el segundo kit se pinta con el atlas del
  primero.
- **Y `npm run atlas` nada más meterlo**, antes de mirar nada: si su
  `colormap.png` es indexado, viene tramado y eso solo se ve de cerca en un
  móvil (la sección de arriba cuenta la historia entera). El guion lo dice y lo
  arregla, o avisa si el atlas no va a franjas de 32 y entonces hay que
  mirarlo a mano.
- **La escala del City Kit es ~7,7 m por unidad**, que es a lo que están sus
  casas. Una baldosa de 1×1 unidad son 7,7 m de calzada; se redondeó a 8 porque
  divide la parcela justo (48 / 8 = 6).
- **El `ancho` de una pieza pequeña sale de la ALTURA que debe tener**, no de
  su planta: un semáforo son 3,5 m y un stop, 2,5. `npm run medidas` lo dice.
- **Si un modelo viene mirando al otro lado**, `giro` en el catálogo son
  cuartos de vuelta que se le dan al cargarlo. La señal de stop enseñaba el
  dorso.
- **Al añadir una pestaña, comprobar que cabe**: el panel de escritorio son 320
  px fijos y con cinco pestañas la fila pedía 390. Ahora se pliegan
  (`flex-wrap`), así que una sexta baja sola, pero conviene mirarlo.

Kits mirados y descartados de momento, todos CC0 salvo donde se dice: Kenney
[City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) (tiendas y
edificios altos, la variedad de silueta que aún falta),
[Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit) (160 piezas,
precioso pero es OTRO mundo al lado de un chalet suburbano),
[Graveyard](https://kenney.nl/assets/graveyard-kit),
[Mini Forest](https://kenney.nl/assets/mini-forest) y
[Car Kit](https://kenney.nl/assets/car-kit). Fuera de Kenney,
[KayKit City Builder Bits](https://kaylousberg.itch.io/city-builder-bits) (CC0,
más carácter; el parque con la fuente es de pago) y
[Poly Pizza](https://poly.pizza/) (10.600 modelos sueltos, GLB directo, mezcla
CC0 y CC-BY: hay que mirar modelo a modelo y atribuir los CC-BY).
[Quaternius](https://quaternius.com/) tiene packs estupendos —Downtown City
MegaKit, Modular Streets— pero **ya no es CC0**: su licencia no permite
redistribuir los assets como assets, y este repo es público y sirve los `.glb`
sueltos, así que es zona gris.

### Cabos sueltos

- **El coste del horizonte no está medido en hardware real.** Lo único medido
  es con Chromium por software (SwiftShader, que castiga la geometría mucho más
  que una GPU), y ahí el fotograma pasa de 415 a 492 ms. Eso es un TECHO, no
  una medida: falta abrir la web en un móvil y ver si se resiente. Si se
  resiente, las palancas por orden de lo que ahorran son bajar `HOR_ARB_R1`,
  subir el umbral de densidad de arboledas (`masa` en `siembraHorizonte`, y
  entonces recalcular que `HOR_ARB_MAX` siga sobrando) y bajar el teselado de
  la corona.
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
