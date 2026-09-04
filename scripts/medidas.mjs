// Qué mide cada pieza ya colocada en el mundo (npm run medidas).
//
// El catálogo (src/lib/piezas.js) escala cada modelo por su lado mayor EN
// PLANTA, así que la ALTURA sale de rebote: un modelo alto y estrecho —una
// silla, una maceta, una flor— se va de tamaño sin que se vea en el número.
// Y la altura es justo lo que se compara con el avatar (1,8 m) al mirar el
// mundo. Esto lee la caja de cada .glb y dice qué mide de verdad.
//
// No hace falta three: un .glb es una cabecera, un trozo JSON con la escena y
// otro binario. La caja de cada malla ya viene en el JSON (los accesores
// llevan min/max), así que basta con recorrer los nodos aplicando su
// transformación.
import fs from 'node:fs';
import path from 'node:path';
import { PIEZAS } from '../src/lib/piezas.js';

const ALTO_AVATAR = 1.8; // el de src/components/Mundo.js, para comparar

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// a×b, 4×4 por columnas (como las guarda glTF)
function multiplica(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let f = 0; f < 4; f++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + f] * b[c * 4 + k];
      o[c * 4 + f] = s;
    }
  }
  return o;
}

// la matriz de un nodo: o viene hecha, o son traslación, giro (cuaternión) y
// escala
function matrizDe(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  return [
    (1 - (y * y2 + z * z2)) * s[0], (x * y2 + w * z2) * s[0], (x * z2 - w * y2) * s[0], 0,
    (x * y2 - w * z2) * s[1], (1 - (x * x2 + z * z2)) * s[1], (y * z2 + w * x2) * s[1], 0,
    (x * z2 + w * y2) * s[2], (y * z2 - w * x2) * s[2], (1 - (x * x2 + y * y2)) * s[2], 0,
    tx, ty, tz, 1,
  ];
}

function mide(archivo) {
  const buf = fs.readFileSync(archivo);
  const largo = buf.readUInt32LE(12); // el primer trozo es el JSON
  const gltf = JSON.parse(buf.subarray(20, 20 + largo).toString('utf8'));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visita = (i, padre) => {
    const n = gltf.nodes[i];
    const m = multiplica(padre, matrizDe(n));
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (!acc?.min) continue;
        // las 8 esquinas de la caja, llevadas al espacio del modelo
        for (let e = 0; e < 8; e++) {
          const p = [e & 1 ? acc.max[0] : acc.min[0], e & 2 ? acc.max[1] : acc.min[1], e & 4 ? acc.max[2] : acc.min[2]];
          for (let k = 0; k < 3; k++) {
            const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
          }
        }
      }
    }
    for (const h of n.children || []) visita(h, m);
  };
  for (const r of gltf.scenes[gltf.scene ?? 0].nodes) visita(r, IDENT);
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

const dir = path.join(process.cwd(), 'public/modelos');
console.log('pieza               ancho   ancho × fondo × ALTO      vs. avatar');
for (const [tipo, def] of Object.entries(PIEZAS)) {
  if (!def.glb) continue; // las generadas se miden en su propio código
  const t = mide(path.join(dir, def.glb + '.glb'));
  const esc = def.ancho / Math.max(t.x, t.z, 0.001);
  const alto = t.y * esc;
  console.log(
    tipo.padEnd(20) +
      String(def.ancho).padStart(5) +
      '   ' +
      ((t.x * esc).toFixed(1) + ' × ' + (t.z * esc).toFixed(1) + ' × ' + alto.toFixed(1) + ' m').padEnd(24) +
      (alto / ALTO_AVATAR).toFixed(1) + '×'
  );
}
