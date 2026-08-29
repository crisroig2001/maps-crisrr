// Genera public/icon.svg: ciudad isométrica cartoon con pin, para la PWA.
// Todo el dibujo cabe en el círculo seguro del 80% (sirve como maskable).
import fs from 'node:fs';

const W = 512;
const CX = 256;
const CY = 292; // la escena un pelín baja para dejar aire al pin
const S = 1; // escala unidades→px
const C30 = 0.866;
const S30 = 0.5;

const p = (x, y, z = 0) => [CX + (x - y) * C30 * S, CY + (x + y) * S30 * S - z * S];
const pts = (arr) => arr.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
const poly = (arr, fill) => `<polygon points="${pts(arr)}" fill="${fill}"/>`;

function sombra(hex, f) {
  // f<1 oscurece, f>1 aclara hacia blanco
  const n = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (f <= 1) {
    r *= f; g *= f; b *= f;
  } else {
    const t = f - 1;
    r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
  }
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// prisma isométrico: caras visibles = tapa, frente-izq (y=y1), frente-dcha (x=x1)
function prisma(x0, y0, x1, y1, h, color) {
  const top = [p(x0, y0, h), p(x1, y0, h), p(x1, y1, h), p(x0, y1, h)];
  const izq = [p(x0, y1, 0), p(x1, y1, 0), p(x1, y1, h), p(x0, y1, h)];
  const dch = [p(x1, y0, 0), p(x1, y1, 0), p(x1, y1, h), p(x1, y0, h)];
  return poly(izq, sombra(color, 0.86)) + poly(dch, sombra(color, 0.7)) + poly(top, sombra(color, 1.3));
}

const G = 112; // medio lado del suelo
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#bfe2f2"/>
<ellipse cx="118" cy="96" rx="44" ry="17" fill="#ffffff" opacity="0.85"/>
<ellipse cx="158" cy="88" rx="30" ry="13" fill="#ffffff" opacity="0.85"/>
`;

// suelo
svg += poly([p(-G, -G), p(G, -G), p(G, G), p(-G, G)], '#e7e0cd');
// parque (cuadrante trasero-izquierdo)
svg += poly([p(-G, -G), p(-14, -G), p(-14, -14), p(-G, -14)], '#a9d18e');
// calles en cruz
svg += poly([p(-G, -13), p(G, -13), p(G, 13), p(-G, 13)], '#b9c0c8');
svg += poly([p(-13, -G), p(13, -G), p(13, G), p(-13, G)], '#b9c0c8');
// borde inferior del suelo (grosor)
svg += poly([p(-G, G), p(G, G), p(G, G, -14), p(-G, G, -14)], '#c9c2ae');
svg += poly([p(G, -G), p(G, G), p(G, G, -14), p(G, -G, -14)], '#b3ac97');

// árbol en el parque
const [tx, ty] = p(-62, -62, 0);
svg += `<rect x="${tx - 5}" y="${ty - 26}" width="10" height="26" rx="3" fill="#8a6b4f"/>`;
svg += `<circle cx="${tx}" cy="${ty - 44}" r="26" fill="#6fae6b"/>`;
svg += `<circle cx="${tx - 18}" cy="${ty - 30}" r="17" fill="#7fbb72"/>`;

// edificios (de atrás hacia delante)
svg += prisma(20, -104, 96, -28, 148, '#f3e2c7'); // torre crema, atrás-dcha
svg += prisma(-100, 22, -28, 94, 88, '#de7a58'); // terracota, delante-izq
svg += prisma(28, 30, 100, 98, 62, '#5f92bd'); // azul, delante-dcha

// pin sobre la torre
const [px0, py0] = p(58, -66, 148); // punta: centro de la tapa de la torre
const py = py0 - 12;
svg += `<path d="M ${px0} ${py} L ${px0 - 30} ${py - 52} A 40 40 0 1 1 ${px0 + 30} ${py - 52} Z" fill="#e0564a"/>`;
svg += `<circle cx="${px0}" cy="${py - 66}" r="40" fill="#e0564a"/>`;
svg += `<circle cx="${px0}" cy="${py - 66}" r="16" fill="#ffffff"/>`;

svg += '</svg>\n';
fs.writeFileSync(new URL('../public/icon.svg', import.meta.url), svg);
console.log('icon.svg listo');
