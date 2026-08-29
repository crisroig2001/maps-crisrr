// Descarga y descodificación de teselas vectoriales de OpenFreeMap.
// Solo cliente. Devuelve datos en coordenadas locales de tesela (0..extent);
// la conversión a metros de escena la hace el visor.
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

  eachFeature(L.transportation, (f) => {
    if (f.type !== 2) return;
    const cls = f.properties?.class || 'minor';
    out.roads.push({ lines: f.loadGeometry(), cls });
  });

  eachFeature(L.waterway, (f) => {
    if (f.type === 2) out.waterways.push(...f.loadGeometry());
  });

  eachFeature(L.aeroway, (f) => {
    if (f.type === 2 && f.properties?.class === 'runway') out.runways.push(...f.loadGeometry());
  });

  return out;
}
