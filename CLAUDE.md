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
- **Si se mete otro kit** — lo aprendido metiendo el City Kit Roads.
- **Cabos sueltos**.

## Comandos

```bash
npm run dev          # la app
npm run vistas       # banco visual: captura las 10 vistas y compara
npm run medidas      # qué mide cada pieza de verdad (altura vs. avatar 1,8 m)
npm run miniaturas   # regenera public/miniaturas/*.png con el MOTOR
npm run prueba       # integración: dos jugadores de verdad en dos pestañas
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
  imágenes distintas, y `cargaModelo` comparte material por la RUTA.
- **`rejilla` en `src/lib/piezas.js` es el paso EN METROS**, no una bandera: 4
  los caminos y vallas, 8 la calle. Úsalo por `pasoRejilla(t)`. `true` sigue
  valiendo y significa 4.
- **El reloj del mundo se congela con `?t=12`** para capturar. Si tocas algo que
  dependa del tiempo, el banco lo verá.
- **Solo tres vistas del banco enseñan el horizonte** (`horizonte`,
  `a-ras-de-suelo` y `a-escala`): hace falta `pol` ≥ 65,4° para que el cielo
  entre en cuadro. Si tocas la corona del horizonte y las otras seis se mueven,
  has tocado otra cosa.
- **Nada que se dibuje con un patrón fino puede llevar un `step()` pelado.**
  Ni el agua ni la hierba ni las losas: el ancho del corte lo tiene que poner
  `fwidth`, o de lejos el borde cae siempre dentro de un píxel y hierve. Y una
  onda hay que apagarla cuando su fase avanza más de un píxel, no a los tantos
  metros: los metros no saben cuántos píxeles mide una onda.
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
(es una envoltura de 3 KB que casi nunca cambia). Sigue el mapa de trozos de
`webpack-*.js` hasta el trozo del mundo y busca ahí una cadena nueva; o mira si
responde 200 un fichero estático que solo exista en ese commit.

## Estado

56 piezas en 5 pestañas (casas, naturaleza, jardín, suelo, calle). 42 modelos
glTF de Kenney (CC0), 1,3 MB, **todos cargados al arrancar** — cuando el
catálogo crezca otra vez, toca cargar por pestaña.
