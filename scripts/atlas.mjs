// Le quita el TRAMADO a los atlas de color de Kenney (npm run atlas).
//
// El problema, y por qué se ve solo de cerca y solo en un móvil:
//
// `public/modelos/Textures/colormap.png` es un PNG INDEXADO de 256 colores, y
// sus casillas no son colores planos: son degradados verticales. Un degradado
// con una paleta de 256 entradas no se puede guardar liso, así que quien lo
// exportó lo guardó TRAMADO — píxeles alternos entre dos tonos vecinos, con el
// patrón desplazado fila a fila, que es lo que hace la diagonal—. De lejos no
// se nota: los mipmaps promedian el tramado y sale el color liso que se
// pretendía. De cerca, y sobre todo en un móvil de densidad 3, un téxel llega
// a medir un píxel de pantalla y el tramado se ve tal cual, como un rayado
// finísimo en las paredes de las casas y en los árboles.
//
// Se descartó lo demás antes de llegar aquí, y conviene que conste: NO son las
// sombras (apagadas sigue), NO es el filtrado del atlas (con `NearestFilter` y
// sin mipmaps sale idéntico), NO es la rampa toon ni la luz (sin iluminación
// ninguna sigue) y NO es la compresión de la captura (la hierba, que es shader
// puro y no pasa por el atlas, sale perfectamente lisa en la misma imagen).
// Con un color plano en vez del atlas, desaparece del todo.
//
// Lo que hace este guion:
//
// El atlas son 16 FRANJAS VERTICALES de 32 px, cada una un degradado vertical
// (los bordes están medidos, no supuestos: `bordesDeFranja` los detecta y
// avisa si un atlas no tiene esa forma). Dentro de una franja, una fila
// debería ser de un solo color; lo que varía es el tramado. Así que cada fila
// de cada franja se sustituye por su MEDIA: el degradado vertical queda
// exactamente igual, el tramado desaparece y no se contamina nada con la
// franja de al lado, porque nunca se promedia cruzando un borde.
//
// Y solo se toca la fila si su variación es pequeña (UMBRAL): si una fila
// tuviera dibujo de verdad —un marco, una raya pintada— se queda como está. En
// el atlas del City Kit el peor rango dentro de una fila es 16 y casi todas
// valen 0, así que de dibujo real no hay nada; el umbral está para que meter
// otro kit no estropee su textura en silencio.
//
// El atlas de las calles (`modelos/calles/`) es RGBA y NO está tramado: su
// variación dentro de fila es cero en las 24.576 filas. Se le pasa igual, no
// cambia nada, y así el día que entre un kit nuevo basta con volver a correrlo.
//
// Es idempotente: una vez quitado el tramado, la variación es 0 y no hay nada
// que hacer. Sin dependencias: PNG a mano con zlib, que es lo único que hace
// falta para leer indexado/RGB/RGBA y escribir color real.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Ancho de la franja, en píxeles del atlas. Medido: los bordes verticales del
// colormap del City Kit caen en 32, 64, 96 … 480, sin una sola excepción.
const FRANJA = 32;
// Hasta cuánto puede variar una fila dentro de su franja para considerarla
// tramado y promediarla. El tramado alterna entre dos entradas VECINAS de la
// paleta, así que su rango es pequeño; un dibujo de verdad salta mucho más.
const UMBRAL = 12;

const ATLAS = ['public/modelos/Textures/colormap.png', 'public/modelos/calles/Textures/colormap.png'];

// --- PNG a mano ---------------------------------------------------------
// Solo lo que hace falta para estos ficheros: 8 bits por muestra y sin
// entrelazar. Cualquier otra cosa se rechaza en vez de salir mal.
function troceaPNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
  const trozos = [];
  let i = 8;
  while (i < buf.length) {
    const ln = buf.readUInt32BE(i);
    trozos.push({ tipo: buf.toString('latin1', i + 4, i + 8), datos: buf.subarray(i + 8, i + 8 + ln) });
    i += 12 + ln;
  }
  return trozos;
}

function leePNG(ruta) {
  const trozos = troceaPNG(fs.readFileSync(ruta));
  const ihdr = trozos.find((t) => t.tipo === 'IHDR').datos;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const bits = ihdr[8];
  const color = ihdr[9];
  const entrelazado = ihdr[12];
  if (bits !== 8 || entrelazado) throw new Error(`${ruta}: ${bits} bits / entrelazado ${entrelazado}, no soportado`);
  const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!canales) throw new Error(`${ruta}: tipo de color ${color} desconocido`);
  const plte = trozos.find((t) => t.tipo === 'PLTE')?.datos || null;
  if (color === 3 && !plte) throw new Error(`${ruta}: indexado sin paleta`);
  const cruda = zlib.inflateSync(Buffer.concat(trozos.filter((t) => t.tipo === 'IDAT').map((t) => t.datos)));

  // deshacer los filtros por línea (los cinco del formato)
  const paso = w * canales;
  const lineas = [];
  let prev = Buffer.alloc(paso);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = cruda[p++];
    const l = Buffer.from(cruda.subarray(p, p + paso));
    p += paso;
    for (let x = 0; x < paso; x++) {
      const a = x >= canales ? l[x - canales] : 0;
      const b = prev[x];
      const c = x >= canales ? prev[x - canales] : 0;
      if (f === 1) l[x] = (l[x] + a) & 255;
      else if (f === 2) l[x] = (l[x] + b) & 255;
      else if (f === 3) l[x] = (l[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        l[x] = (l[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    lineas.push(l);
    prev = l;
  }

  // todo a RGB, que es lo único con lo que trabaja el resto
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (color === 3) {
        const k = lineas[y][x] * 3;
        rgb[o] = plte[k];
        rgb[o + 1] = plte[k + 1];
        rgb[o + 2] = plte[k + 2];
      } else if (color === 0 || color === 4) {
        rgb[o] = rgb[o + 1] = rgb[o + 2] = lineas[y][x * canales];
      } else {
        rgb[o] = lineas[y][x * canales];
        rgb[o + 1] = lineas[y][x * canales + 1];
        rgb[o + 2] = lineas[y][x * canales + 2];
      }
    }
  }
  return { w, h, rgb, color, canales };
}

function escribePNG(ruta, w, h, rgb) {
  const paso = w * 3;
  const cruda = Buffer.alloc((paso + 1) * h);
  for (let y = 0; y < h; y++) {
    cruda[y * (paso + 1)] = 0; // sin filtro: el contenido son bandas planas y comprime igual
    rgb.copy(cruda, y * (paso + 1) + 1, y * paso, (y + 1) * paso);
  }
  const trozo = (tipo, datos) => {
    const t = Buffer.from(tipo, 'latin1');
    const ln = Buffer.alloc(4);
    ln.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([t, datos])) : crc32(Buffer.concat([t, datos])));
    return Buffer.concat([ln, t, datos, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // color real
  fs.writeFileSync(
    ruta,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      trozo('IHDR', ihdr),
      trozo('IDAT', zlib.deflateSync(cruda, { level: 9 })),
      trozo('IEND', Buffer.alloc(0)),
    ])
  );
}

// zlib.crc32 es de Node 22.2; para versiones anteriores, a mano
let tablaCRC = null;
function crc32(buf) {
  if (!tablaCRC) {
    tablaCRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tablaCRC[n] = c;
    }
  }
  let c = ~0;
  for (const b of buf) c = tablaCRC[(c ^ b) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

// Dónde están los bordes de franja de verdad. Se comprueban en vez de darlos
// por supuestos: si un atlas nuevo no va a 32, el guion lo dice y no lo toca.
function bordesDeFranja(w, h, rgb) {
  const en = (x, y, k) => rgb[(y * w + x) * 3 + k];
  const bordes = [];
  for (let x = 1; x < w; x++) {
    let d = 0;
    for (let y = 0; y < h; y += 7) for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(en(x, y, k) - en(x - 1, y, k)));
    if (d > 12) bordes.push(x);
  }
  return bordes;
}

// --- quitar el tramado --------------------------------------------------
let algunProblema = false;
for (const rel of ATLAS) {
  const ruta = path.resolve(rel);
  if (!fs.existsSync(ruta)) {
    console.log(rel.padEnd(44) + 'no está, se salta');
    continue;
  }
  const { w, h, rgb, color } = leePNG(ruta);
  const bordes = bordesDeFranja(w, h, rgb);
  const aFranja = bordes.every((x) => x % FRANJA === 0);
  if (!aFranja) {
    console.log(rel.padEnd(44) + `bordes fuera de la rejilla de ${FRANJA}: ${bordes.filter((x) => x % FRANJA).join(', ')} — NO se toca`);
    algunProblema = true;
    continue;
  }
  let filas = 0;
  let saltadas = 0;
  let mayor = 0;
  for (let f = 0; f < w / FRANJA; f++) {
    const x0 = f * FRANJA;
    for (let y = 0; y < h; y++) {
      const medias = [0, 0, 0];
      let rango = 0;
      for (let k = 0; k < 3; k++) {
        let min = 255;
        let max = 0;
        let suma = 0;
        for (let x = x0; x < x0 + FRANJA; x++) {
          const v = rgb[(y * w + x) * 3 + k];
          suma += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        medias[k] = Math.round(suma / FRANJA);
        rango = Math.max(rango, max - min);
      }
      if (rango === 0) continue; // ya está lisa
      if (rango > UMBRAL) {
        saltadas++; // hay dibujo de verdad: no es tramado
        continue;
      }
      for (let x = x0; x < x0 + FRANJA; x++) {
        for (let k = 0; k < 3; k++) {
          const o = (y * w + x) * 3 + k;
          mayor = Math.max(mayor, Math.abs(rgb[o] - medias[k]));
          rgb[o] = medias[k];
        }
      }
      filas++;
    }
  }
  if (!filas) {
    console.log(rel.padEnd(44) + 'ya estaba limpio' + (color === 3 ? ' (indexado)' : ''));
    continue;
  }
  escribePNG(ruta, w, h, rgb);
  const kb = (fs.statSync(ruta).size / 1024).toFixed(1);
  console.log(rel.padEnd(44) + `${filas} filas alisadas, ${saltadas} con dibujo respetadas, mayor cambio ${mayor}/255 → ${kb} KB`);
}
if (algunProblema) process.exitCode = 1;
