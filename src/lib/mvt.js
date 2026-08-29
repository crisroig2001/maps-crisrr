// Descarga y descodificación de teselas vectoriales de OpenFreeMap.
// Solo cliente. Devuelve datos en coordenadas locales de tesela (0..extent);
// la conversión a metros de escena la hace el visor.
//
// La tesela llega ENTERA (medido en 14/8290/6118, BCN: 1.264 KB) y el
// navegador la paga toda aunque solo se lea una capa. Así que leer `place`,
// `transportation_name` y `landuse` no cuesta ni un byte de red: son 64 KB
// que ya estaban en el .pbf y hasta ahora se tiraban.
import Protobuf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
let templatePromise = null;

// La URL de las teselas está VERSIONADA (p. ej. /planet/20260823_.../{z}/{x}/{y}.pbf):
// hay que leerla del TileJSON, la ruta sin versión devuelve vacío.
function tileTemplate() {
  if (!templatePromise) {
    templatePromise = fetch(TILEJSON_URL)
      .then((r) => r.json())
      .then((tj) => {
        if (!tj?.tiles?.[0]) throw new Error('TileJSON sin tiles');
        return tj.tiles[0];
      })
      .catch((e) => {
        templatePromise = null; // reintentable
        throw e;
      });
  }
  return templatePromise;
}

// clasificación estándar de anillos MVT (área con y hacia abajo:
// positiva = exterior, negativa = agujero)
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const p1 = ring[i];
    const p2 = ring[j];
    sum += (p2.x - p1.x) * (p1.y + p2.y);
  }
  return sum;
}

function classifyRings(rings) {
  const polygons = [];
  let polygon = null;
  for (const ring of rings) {
    const area = signedArea(ring);
    if (area === 0) continue;
    if (area > 0) {
      if (polygon) polygons.push(polygon);
      polygon = [ring];
    } else if (polygon) {
      polygon.push(ring);
    }
  }
  if (polygon) polygons.push(polygon);
  return polygons;
}

const CLASES_ROTULADAS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

// clases de `place` que se rotulan, con la distancia de cámara (m) hasta la
// que se enseñan. `neighbourhood` se descarta: en BCN son 24 por tesela y
// tapan el mapa.
const PESO_PLACE = { city: 26000, town: 12000, village: 4200, suburb: 3400, quarter: 1500 };

function eachFeature(layer, fn) {
  if (!layer) return;
  for (let i = 0; i < layer.length; i++) fn(layer.feature(i));
}

export async function loadTileData(z, x, y) {
  const template = await tileTemplate();
  const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (!res.ok) throw new Error('tile ' + res.status);
  const buf = await res.arrayBuffer();
  const tile = new VectorTile(new Protobuf(buf));
  const L = tile.layers;

  const out = {
    extent: L.building?.extent || L.transportation?.extent || 4096,
    buildings: [],
    water: [],
    green: [],
    sand: [],
    roads: [],
    waterways: [],
    runways: [],
    landuse: [],
    roadNames: [],
    places: [],
  };

  eachFeature(L.building, (f) => {
    if (f.type !== 3) return;
    const p = f.properties || {};
    if (p.hide_3d) return;
    const polys = classifyRings(f.loadGeometry());
    if (!polys.length) return;
    out.buildings.push({
      polys,
      h: Number(p.render_height) || 0,
      minH: Number(p.render_min_height) || 0,
      colour: typeof p.colour === 'string' ? p.colour : null,
    });
  });

  eachFeature(L.water, (f) => {
    if (f.type === 3) out.water.push(...classifyRings(f.loadGeometry()));
  });

  const greenClasses = new Set(['grass', 'wood', 'forest', 'park', 'grassland', 'meadow', 'orchard', 'scrub', 'wetland']);
  eachFeature(L.landcover, (f) => {
    if (f.type !== 3) return;
    const cls = f.properties?.class;
    if (greenClasses.has(cls)) out.green.push(...classifyRings(f.loadGeometry()));
    else if (cls === 'sand' || cls === 'beach') out.sand.push(...classifyRings(f.loadGeometry()));
  });
  eachFeature(L.park, (f) => {
    if (f.type === 3) out.green.push(...classifyRings(f.loadGeometry()));
  });

  // usos del suelo: tiñen el gris plano del fondo (colegios, deporte,
  // industria…). El estilo concreto lo decide el visor.
  eachFeature(L.landuse, (f) => {
    if (f.type !== 3) return;
    const cls = f.properties?.class;
    if (!cls) return;
    for (const rings of classifyRings(f.loadGeometry())) out.landuse.push({ rings, cls });
  });

  eachFeature(L.transportation, (f) => {
    if (f.type !== 2) return;
    const cls = f.properties?.class || 'minor';
    out.roads.push({ lines: f.loadGeometry(), cls });
  });

  // nombres de calle: SOLO vías principales. Con `minor` y `path` la tesela de
  // BCN pasa de 37 nombres a 250 y el mapa se vuelve ilegible.
  eachFeature(L.transportation_name, (f) => {
    if (f.type !== 2) return;
    const p = f.properties || {};
    if (!p.name || !CLASES_ROTULADAS.has(p.class)) return;
    out.roadNames.push({ name: String(p.name), lines: f.loadGeometry() });
  });

  // topónimos (ciudad, distrito, barrio). `rank` bajo = más importante.
  eachFeature(L.place, (f) => {
    if (f.type !== 1) return;
    const p = f.properties || {};
    const peso = PESO_PLACE[p.class];
    if (!p.name || peso === undefined) return;
    const pt = f.loadGeometry()?.[0]?.[0];
    if (!pt) return;
    out.places.push({
      name: String(p.name),
      cls: p.class,
      peso,
      rank: Number(p.rank) || 50,
      x: pt.x,
      y: pt.y,
    });
  });

  eachFeature(L.waterway, (f) => {
    if (f.type === 2) out.waterways.push(...f.loadGeometry());
  });

  eachFeature(L.aeroway, (f) => {
    if (f.type === 2 && f.properties?.class === 'runway') out.runways.push(...f.loadGeometry());
  });

  return out;
}
