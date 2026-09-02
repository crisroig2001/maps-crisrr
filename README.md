# crisrr world — un mundo que se construye entre todos

**https://maps.crisrr.com**

Un mundo 3D estilo cartoon, sin mapa real: un suelo infinito dividido en
parcelas por el que cada persona anda con su avatar, reclama una parcela y
construye en ella su casa, su jardín o lo que quiera. Lo que construye uno lo
ven todos. Todo el renderizado ocurre **en la GPU del dispositivo**: el
servidor solo guarda qué hay en cada parcela y quién anda cerca.

## Cómo funciona

- **El mundo**: una rejilla infinita de parcelas de 48 m sobre un suelo plano
  (`src/lib/parcela.js`). Coordenadas en metros, x al este e y al norte. La
  parcela 0/0 es la **plaza de llegada**, pública, donde aparece quien entra;
  la 1/0 es una **casa de muestra** para que se vea qué se puede hacer.
  Las dos son del «mundo»: nadie las reclama ni las cambia.
- **El look, tarde de verano**, con la misma receta que las demos de
  referencia: un **sol** (luz direccional cálida, baja y del suroeste, con
  sombras proyectadas de 2048 px que siguen al avatar), un **cielo** (luz
  hemisférica fría desde arriba y verdosa rebotada desde abajo) y materiales
  **toon con rampa**: la luz cae a escalones, con un corte duro al entrar en
  la sombra y un degradado suave hacia la luz plena, y como la luz es dorada
  y el cielo azul, lo iluminado sale cálido y la sombra azulada sin pintar
  nada a mano. Las formas son redondas (copas, arbustos, nubes y cabezas son
  esferas con normales suaves), hay **sombras de nubes** cruzando el suelo
  (una textura de manchas que se desplaza con el tiempo), **hierba** que se
  mece (vertex shader, instanciada a rodales en una rejilla fija del mundo
  alrededor del avatar), copas que se mecen, nubes en el cielo, tone mapping
  ACES y una viñeta cálida en CSS. El **relieve** son colinas suaves: una
  suma de senos escrita dos veces, en JS (para colocar piezas y avatares) y
  en GLSL (para desplazar suelo, marcos y plazas en el vertex shader y sacar
  su normal), y que nunca da más de medio metro de desnivel en una parcela.
- **El avatar**: cuerpo redondo del color elegido, cabeza, pelo y ojos; el
  mismo sombreado horneado que todo lo demás. Anda **tocando
  el suelo** (o con WASD / flechas, relativo a la cámara) y la cámara, en
  tercera persona, va con él: arrastrar gira, pellizcar acerca.
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
- **Construir**: en tu parcela, «Construir» abre la paleta: casa, torre,
  árbol, pino, arbusto, flores, camino, valla, farola, banco, fuente y
  bandera, más borrar. Cada toque en el suelo coloca una pieza; las que
  tienen tinte (casa, torre, flores, bandera) van del color elegido; «Girar»
  gira la última colocada en cuartos de vuelta; camino y valla se pegan a una
  rejilla de 4 m para que casen entre sí. Tope de 150 piezas por parcela.
  Una pieza guardada es `{t, x, y, r, c}`: tipo, metros dentro de la parcela
  (1 decimal), giro y color — 40 bytes que no dependen de dónde esté la
  parcela.
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
