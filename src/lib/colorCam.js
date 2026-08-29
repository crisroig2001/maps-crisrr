// Extrae el color de fachada dominante de los píxeles capturados por la
// cámara y lo PASTELIZA al estilo cartoon del mapa. Puro (sin DOM): lo usa el
// visor y se prueba desde Node.

function aHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function deHsl(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

const aHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

// px: array plano [r,g,b, r,g,b, …] de muestras de varios fotogramas.
// Devuelve '#rrggbb' pastel, o null si no hay muestra que valga (tapa puesta,
// oscuridad…). El tono dominante se elige por histograma PONDERADO POR
// SATURACIÓN: la media RGB a secas de una foto de calle sale marrón siempre.
export function colorFachada(px) {
  if (!px || px.length < 60) return null;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0, n: 0 }));
  let vivos = 0;
  for (let i = 0; i + 2 < px.length; i += 3) {
    const [h, s, l] = aHsl(px[i], px[i + 1], px[i + 2]);
    if (l < 0.08 || l > 0.97) continue; // negro de tapa / cielo quemado
    vivos++;
    const w = 0.05 + s; // el gris apenas vota; el color manda
    const b = bins[Math.floor(h * 12) % 12];
    b.w += w;
    b.r += px[i] * w;
    b.g += px[i + 1] * w;
    b.b += px[i + 2] * w;
    b.n++;
  }
  if (vivos < 20) return null;
  let best = bins[0];
  for (const b of bins) if (b.w > best.w) best = b;
  if (!best.n) return null;
  let [h, s, l] = aHsl(best.r / best.w, best.g / best.w, best.b / best.w);
  if (s < 0.09) {
    // fachada gris/piedra: el tono es ruido — arena cálida, no un color inventado
    h = 0.09;
    s = 0.18;
  } else {
    // pastel cartoon: ni chillón ni gris del todo, y claro para que el
    // sombreado de las paredes (×0.7) siga leyéndose
    s = Math.min(0.52, Math.max(0.24, s * 1.4));
  }
  l = Math.min(0.76, Math.max(0.6, l));
  return aHex(...deHsl(h, s, l));
}

export const RE_COLOR = /^#[0-9a-f]{6}$/;
