'use client';

// El mundo: colinas suaves e infinitas divididas en parcelas, avatares que
// andan por ellas y parcelas que cada jugador construye con piezas. Look de
// tarde de verano: luz cálida, sombras frías, formas redondas, hierba que se
// mece y nubes. Todo el renderizado ocurre en la GPU del dispositivo y SIN
// luces: el sombreado va horneado en los colores de vértice (con un sol 3D
// que da lados cálidos y lados fríos), y el relieve lo pone el vertex shader
// con la misma función de altura que usa el JS para colocar cosas encima.
// Las piezas van INSTANCIADAS: un draw call por tipo de pieza sean 3 o 3.000.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { PARCELA_M, parcelaDe, claveParcela, parseParcela, centroParcela } from '../lib/parcela';
import { PIEZAS, COLORES, MAX_PIEZAS, MAX_NOMBRE } from '../lib/piezas';
import { perfil, guardaPerfil } from '../lib/jugador';

const L = PARCELA_M;

// --- el sol y el look ---
// Sol de tarde: bajo (48°) y del suroeste. Lo que mira al sol sale cálido y
// lo que le da la espalda, frío y azulado: es lo que hace que un mundo sin
// luces parezca pintado a mano en vez de plano.
const SOL_AZ = (215 * Math.PI) / 180;
const SOL_EL = (48 * Math.PI) / 180;
const SOL = new THREE.Vector3(Math.sin(SOL_AZ) * Math.cos(SOL_EL), Math.sin(SOL_EL), Math.cos(SOL_AZ) * Math.cos(SOL_EL)).normalize();
const CALIDO = [1.06, 1.0, 0.88];
const FRIO = [0.6, 0.66, 0.84];
const CIELO_CENIT = 0x6fb4e4;
const CIELO_HORIZONTE = 0xfbe7c8;
const NIEBLA = 0xf1e2cc;
const NIEBLA_DESDE = 150;
const NIEBLA_HASTA = 420;
const SUELO_M = 16 * L; // el plano del suelo que sigue al avatar: 768 m
const RADIO_PARCELAS = 6; // se piden (2r+1)² parcelas alrededor: 13×13

const BLANCO = new THREE.Color(0xffffff);
const TRONCO = new THREE.Color(0x8d6a4a);
const VERDE = new THREE.Color(0x7dbf6a);
const VERDE_CLARO = new THREE.Color(0xa6d879);
const VERDE_PINO = new THREE.Color(0x5a9c66);
const VERDE_ARBUSTO = new THREE.Color(0x8bc973);
const TEJA = new THREE.Color(0xe07a62);
const MADERA = new THREE.Color(0xa87550);
const PIEDRA_C = new THREE.Color(0xd0c8b6);
const AGUA = new THREE.Color(0x8fcbe6);
const POSTE = new THREE.Color(0x7a828c);
const LUZ = new THREE.Color(0xffe38f);
const MASTIL = new THREE.Color(0xefe9dc);
const ARENA = new THREE.Color(0xeadcb9);
const CRISTAL = new THREE.Color(0xc6e5f3);
const PIEL = new THREE.Color(0xf3cba8);
const PELO = new THREE.Color(0x553d2c);
const OJO = new THREE.Color(0x2b3440);
const PANTALON = new THREE.Color(0x56637a);
const NUBE = new THREE.Color(0xffffff);
const NUBE_SOMBRA = new THREE.Color(0xdfe3f5);

const MAX_INST = 3000; // instancias por parte de pieza en el mundo cargado
const MAX_HIERBA = 3000;
const VELOCIDAD = 4.6; // m/s del avatar

// --- terreno: colinas suaves, la MISMA función en JS y en GLSL ---
// Amplitud pequeña y ondas largas: una parcela de 48 m nunca tiene más de
// medio metro de desnivel, que es lo que aguanta una casa sin flotar.
const ONDAS = [
  [1.0, 0.021, 0.013, 0.0],
  [0.7, 0.009, -0.027, 1.3],
  [0.35, 0.047, 0.041, 2.1],
];
function alturaEn(x, y) {
  let h = 0;
  for (const [a, kx, ky, f] of ONDAS) h += a * Math.sin(x * kx + y * ky + f);
  return h;
}
// p = xz del mundo (z = -norte)
const GLSL_ALTURA = `
float altura(vec2 p) {
  float y = -p.y;
  return 1.0 * sin(p.x * 0.021 + y * 0.013) + 0.7 * sin(p.x * 0.009 - y * 0.027 + 1.3) + 0.35 * sin(p.x * 0.047 + y * 0.041 + 2.1);
}`;
const uTiempo = { value: 0 };

// Parchea un MeshBasicMaterial para que el vertex shader suba cada vértice a
// la altura del terreno bajo su posición de MUNDO (sirve con instancias).
//   tinta: el suelo se aclara en lo alto y se oscurece en lo bajo
//   viento: hierba: se mece con el tiempo, más cuanto más arriba del tallo
function conAltura(mat, { tinta = false, viento = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tiempo = uTiempo;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_ALTURA + '\nuniform float tiempo;\nvarying float vAltura;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wpos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #else
          vec4 wpos = modelMatrix * vec4(transformed, 1.0);
        #endif
        float hh = altura(wpos.xz);
        transformed.y += hh;
        vAltura = hh;
        ${viento ? 'transformed.x += sin(tiempo * 1.6 + wpos.x * 0.35 + wpos.z * 0.21) * 0.16 * position.y;\n transformed.z += cos(tiempo * 1.3 + wpos.x * 0.17 - wpos.z * 0.3) * 0.08 * position.y;' : ''}`
      );
    if (tinta) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAltura;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= mix(vec3(0.84, 0.92, 0.78), vec3(1.07, 1.04, 0.9), clamp((vAltura + 2.0) / 4.0, 0.0, 1.0));`
        );
    }
  };
  mat.customProgramCacheKey = () => 'altura' + (tinta ? 't' : '') + (viento ? 'v' : '');
  return mat;
}

// --- geometría con el sol horneado ---
// Color de un vértice según su normal (en coordenadas de escena: z = sur).
// Cálido de cara al sol, frío de espaldas, con una transición suave: es el
// sombreado «pintado» de todo el mundo.
function tono(col, color, nx, ny, nz) {
  const d = nx * SOL.x + ny * SOL.y + nz * SOL.z;
  let t = d * 0.5 + 0.5;
  t = Math.max(0, Math.min(1, (t - 0.18) / 0.64));
  t = t * t * (3 - 2 * t);
  col.push(
    color.r * (FRIO[0] + (CALIDO[0] - FRIO[0]) * t),
    color.g * (FRIO[1] + (CALIDO[1] - FRIO[1]) * t),
    color.b * (FRIO[2] + (CALIDO[2] - FRIO[2]) * t)
  );
}
// caja alineada a los ejes (x: este, z: sur), con tapa y sin fondo
function caja(g, x0, y0, z0, x1, y1, z1, color) {
  const { pos, col } = g;
  const lado = (ax, az, bx, bz, nx, nz) => {
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    for (let q = 0; q < 6; q++) tono(col, color, nx, 0, nz);
  };
  lado(x0, z1, x1, z1, 0, 1); // sur
  lado(x1, z1, x1, z0, 1, 0); // este
  lado(x1, z0, x0, z0, 0, -1); // norte
  lado(x0, z0, x0, z1, -1, 0); // oeste
  pos.push(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z0, x1, y1, z1, x0, y1, z1);
  for (let q = 0; q < 6; q++) tono(col, color, 0, 1, 0);
}
// prisma regular de n lados con tapa; r1 permite que el remate sea más
// estrecho que la base (r1 = 0 es un cono)
function prisma(g, n, r, y0, y1, color, r1 = r, cx = 0, cz = 0) {
  const { pos, col } = g;
  const inclina = Math.atan2(r - r1, y1 - y0); // hacia arriba si se estrecha
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const nx = Math.cos(am) * Math.cos(inclina);
    const nz = -Math.sin(am) * Math.cos(inclina);
    const ny = Math.sin(inclina);
    const x0 = cx + Math.cos(a0) * r;
    const z0 = cz - Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const z1 = cz - Math.sin(a1) * r;
    const X0 = cx + Math.cos(a0) * r1;
    const Z0 = cz - Math.sin(a0) * r1;
    const X1 = cx + Math.cos(a1) * r1;
    const Z1 = cz - Math.sin(a1) * r1;
    pos.push(x0, y0, z0, x1, y0, z1, X1, y1, Z1, x0, y0, z0, X1, y1, Z1, X0, y1, Z0);
    for (let q = 0; q < 6; q++) tono(col, color, nx, ny, nz);
    if (r1 > 0) {
      pos.push(cx, y1, cz, X0, y1, Z0, X1, y1, Z1);
      for (let q = 0; q < 3; q++) tono(col, color, 0, 1, 0);
    }
  }
}
// esfera (o elipsoide, con sy) con el sombreado suave por vértice: copas de
// árbol, arbustos, nubes, cabezas. Las normales son las de la esfera, así
// que la luz recorre la forma en degradado en vez de a cortes.
const cacheEsferas = new Map();
function esfera(g, cx, cy, cz, r, color, sy = 1, detalle = 10) {
  const k = detalle;
  let base = cacheEsferas.get(k);
  if (!base) {
    base = new THREE.SphereGeometry(1, detalle, Math.round(detalle * 0.7)).toNonIndexed();
    cacheEsferas.set(k, base);
  }
  const p = base.getAttribute('position').array;
  const n = base.getAttribute('normal').array;
  for (let i = 0; i < p.length; i += 3) {
    g.pos.push(cx + p[i] * r, cy + p[i + 1] * r * sy, cz + p[i + 2] * r);
    tono(g.col, color, n[i], n[i + 1], n[i + 2]);
  }
}
// tejado a cuatro aguas sobre un rectángulo: alero en y0, cumbrera (paralela
// a x, de -cr a cr) en y1
function tejado(g, x0, z0, x1, z1, y0, y1, cr, color) {
  const { pos, col } = g;
  const tri = (a, b, c, nx, nz) => {
    pos.push(...a, ...b, ...c);
    for (let q = 0; q < 3; q++) tono(col, color, nx * 0.7, 0.7, nz * 0.7);
  };
  const A = [x0, y0, z0];
  const B = [x1, y0, z0];
  const C = [x1, y0, z1];
  const D = [x0, y0, z1];
  const P = [-cr, y1, 0];
  const Q = [cr, y1, 0];
  tri(D, C, Q, 0, 1); // faldón sur
  tri(D, Q, P, 0, 1);
  tri(B, A, P, 0, -1); // faldón norte
  tri(B, P, Q, 0, -1);
  tri(C, B, Q, 1, 0); // este
  tri(A, D, P, -1, 0); // oeste
}
function aGeo(g) {
  if (!g.pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
  return geo;
}

// Cada pieza son dos geometrías: la que se TIÑE del color elegido (con el
// color de vértice como factor de luz sobre blanco) y la fija. Origen en el
// suelo, centrada, con el «frente» hacia el sur (+z) con giro 0. `sombra` es
// el radio de la mancha de sombra suave que se pinta debajo.
const SOMBRA_DE = { casa: 6.2, torre: 4.2, arbol: 3.4, pino: 3, arbusto: 2, flores: 1.3, farola: 0.9, banco: 1.5, fuente: 4.2, bandera: 0.7 };
function geometriaPieza(tipo) {
  const T = { pos: [], col: [] }; // tinte
  const F = { pos: [], col: [] }; // fijo
  if (tipo === 'casa') {
    caja(T, -4, 0, -3, 4, 3.4, 3, BLANCO);
    tejado(F, -4.5, -3.5, 4.5, 3.5, 3.3, 5.7, 2, TEJA);
    caja(F, -0.55, 0, 2.98, 0.55, 2.2, 3.12, MADERA); // puerta
    caja(F, -3.2, 1.1, 2.98, -1.6, 2.3, 3.08, CRISTAL); // ventanas
    caja(F, 1.6, 1.1, 2.98, 3.2, 2.3, 3.08, CRISTAL);
    caja(F, 2.2, 4.2, -1.6, 3.1, 6.4, -0.7, PIEDRA_C); // chimenea
  } else if (tipo === 'torre') {
    prisma(T, 12, 2.3, 0, 9, BLANCO);
    prisma(F, 12, 2.8, 9, 9.3, PIEDRA_C);
    prisma(F, 12, 2.8, 9.3, 13.5, TEJA, 0);
    caja(F, -0.5, 0, 2.15, 0.5, 2.1, 2.45, MADERA);
    caja(F, -0.45, 4, 2.2, 0.45, 5, 2.4, CRISTAL);
    caja(F, -0.45, 6.6, 2.2, 0.45, 7.6, 2.4, CRISTAL);
  } else if (tipo === 'arbol') {
    prisma(F, 7, 0.32, 0, 3.4, TRONCO, 0.22);
    esfera(F, 0, 5.0, 0, 2.4, VERDE, 0.9);
    esfera(F, 1.3, 4.2, 0.6, 1.5, VERDE_CLARO);
    esfera(F, -1.2, 4.4, -0.7, 1.4, VERDE);
    esfera(F, 0.2, 6.3, -0.3, 1.3, VERDE_CLARO);
  } else if (tipo === 'pino') {
    prisma(F, 7, 0.26, 0, 2, TRONCO, 0.2);
    prisma(F, 9, 2.4, 1.6, 4.2, VERDE_PINO, 0.5);
    prisma(F, 9, 1.9, 3.6, 6.0, VERDE_PINO, 0.4);
    prisma(F, 9, 1.3, 5.4, 7.7, VERDE_PINO, 0);
  } else if (tipo === 'arbusto') {
    esfera(F, 0, 1.0, 0, 1.3, VERDE_ARBUSTO, 0.8);
    esfera(F, 1.1, 0.7, 0.6, 0.9, VERDE_CLARO, 0.8);
    esfera(F, -0.9, 0.7, -0.7, 0.9, VERDE_ARBUSTO, 0.8);
  } else if (tipo === 'flores') {
    const puntos = [
      [0, 0],
      [0.7, 0.3],
      [-0.6, 0.5],
      [0.3, -0.7],
      [-0.5, -0.5],
      [0.9, -0.2],
    ];
    for (const [x, z] of puntos) {
      caja(F, x - 0.04, 0, z - 0.04, x + 0.04, 0.6, z + 0.04, VERDE);
      esfera(T, x, 0.68, z, 0.24, BLANCO, 0.8, 6);
    }
  } else if (tipo === 'camino') {
    caja(F, -2, 0, -2, 2, 0.1, 2, ARENA);
  } else if (tipo === 'valla') {
    caja(F, -2, 0, -0.1, -1.8, 1.2, 0.1, MADERA);
    caja(F, 1.8, 0, -0.1, 2, 1.2, 0.1, MADERA);
    caja(F, -2, 0.35, -0.06, 2, 0.55, 0.06, MADERA);
    caja(F, -2, 0.85, -0.06, 2, 1.05, 0.06, MADERA);
  } else if (tipo === 'farola') {
    prisma(F, 6, 0.16, 0, 5.4, POSTE, 0.12);
    esfera(F, 0, 5.6, 0, 0.55, LUZ, 0.9, 8);
  } else if (tipo === 'banco') {
    caja(F, -0.95, 0, -0.28, -0.75, 0.45, 0.28, POSTE);
    caja(F, 0.75, 0, -0.28, 0.95, 0.45, 0.28, POSTE);
    caja(F, -1, 0.45, -0.3, 1, 0.62, 0.3, MADERA);
    caja(F, -1, 0.62, -0.3, 1, 1.15, -0.18, MADERA); // respaldo al norte: se sienta mirando al sur
  } else if (tipo === 'fuente') {
    prisma(F, 12, 3.2, 0, 0.9, PIEDRA_C);
    prisma(F, 12, 2.9, 0.9, 1.0, AGUA);
    prisma(F, 8, 0.45, 1.0, 2.6, PIEDRA_C);
    prisma(F, 12, 1.3, 2.6, 2.9, PIEDRA_C);
    prisma(F, 12, 1.1, 2.9, 3.0, AGUA);
  } else if (tipo === 'bandera') {
    prisma(F, 6, 0.1, 0, 7.5, MASTIL, 0.07);
    T.pos.push(0.1, 7.4, 0, 0.1, 6.2, 0, 2.6, 6.8, 0);
    for (let q = 0; q < 3; q++) tono(T.col, BLANCO, 0, 0, 1);
  }
  return { tinte: aGeo(T), fijo: aGeo(F) };
}

// El avatar: cuerpo redondo del color del jugador, cabeza, pelo y ojos
// mirando al frente (+z). Las piernas van aparte para poder moverlas.
function geometriaAvatar(color) {
  const g = { pos: [], col: [] };
  esfera(g, 0, 1.5, 0, 0.38, color, 1.4); // cuerpo
  esfera(g, -0.5, 1.5, 0, 0.15, color, 1.9); // brazos
  esfera(g, 0.5, 1.5, 0, 0.15, color, 1.9);
  esfera(g, 0, 2.35, 0, 0.42, PIEL); // cabeza
  esfera(g, 0, 2.5, -0.06, 0.44, PELO, 0.75); // pelo
  esfera(g, -0.15, 2.36, 0.36, 0.06, OJO, 1, 6); // ojos
  esfera(g, 0.15, 2.36, 0.36, 0.06, OJO, 1, 6);
  return aGeo(g);
}
function geometriaPierna() {
  const g = { pos: [], col: [] };
  esfera(g, 0, -0.45, 0, 0.19, PANTALON, 2.6, 6);
  return aGeo(g);
}
// una nube: varias esferas aplastadas, blancas arriba y lavanda abajo
function geometriaNube(rnd) {
  const g = { pos: [], col: [] };
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = 6 + rnd() * 7;
    esfera(g, (i - n / 2) * 8 + rnd() * 4, rnd() * 3, rnd() * 6 - 3, r, i % 2 ? NUBE : NUBE_SOMBRA, 0.55, 8);
  }
  return aGeo(g);
}

// color de dueño a partir del id: para pintar de quién es cada parcela sin
// preguntarle a nadie
function colorDueno(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.62);
}

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function hash2(x, y) {
  return ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) / 4294967296;
}

export default function Mundo() {
  const canvasRef = useRef(null);
  const rotulosRef = useRef(null);
  const engineRef = useRef(null);
  const toastT = useRef(null);
  const nombreRef = useRef(null);
  // {msg, on}: el texto se conserva mientras se desvanece, si no el aviso se
  // vacía antes de apagarse y queda una píldora en blanco
  const [toast, setToast] = useState({ msg: '', on: false });
  const [sinGL, setSinGL] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [yo, setYo] = useState(null); // {id, nombre, color}
  const [colorElegido, setColorElegido] = useState(0);
  const [conectados, setConectados] = useState(1);
  // dónde está el avatar: {clave, dueno, mia, libre, n}
  const [donde, setDonde] = useState(null);
  const [miParcela, setMiParcela] = useState(null);
  // modo construir: null o {clave, n}
  const [obra, setObra] = useState(null);
  const [herr, setHerr] = useState('casa');
  const [tinte, setTinte] = useState(2);
  const [cargando, setCargando] = useState(true);

  function avisa(msg) {
    setToast({ msg, on: true });
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast((t) => ({ ...t, on: false })), 3200);
  }

  useEffect(() => {
    const p = perfil();
    setYo({ ...p });
    setColorElegido(p.color);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setSinGL(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const params = new URLSearchParams(window.location.search);
    const jugador = perfil();

    // --- escena, cielo y niebla ---
    const scene = new THREE.Scene();
    const texCielo = (() => {
      const cv = document.createElement('canvas');
      cv.width = 4;
      cv.height = 256;
      const c = cv.getContext('2d');
      const grad = c.createLinearGradient(0, 0, 0, 256);
      const hex = (v) => '#' + v.toString(16).padStart(6, '0');
      grad.addColorStop(0, hex(CIELO_CENIT));
      grad.addColorStop(0.36, '#a9d3ee');
      grad.addColorStop(0.5, hex(CIELO_HORIZONTE));
      grad.addColorStop(1, hex(CIELO_HORIZONTE));
      c.fillStyle = grad;
      c.fillRect(0, 0, 4, 256);
      const tex = new THREE.CanvasTexture(cv);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    scene.background = texCielo;
    scene.fog = new THREE.Fog(NIEBLA, NIEBLA_DESDE, NIEBLA_HASTA);

    // --- suelo: colinas de hierba con la trama de parcelas, que siguen al avatar ---
    // Una textura de UNA parcela repetida; el relieve lo pone el shader. El
    // plano se mueve a saltos de una parcela para que la trama no resbale.
    const texSuelo = (() => {
      const S = 256;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d');
      c.fillStyle = '#a4d47c';
      c.fillRect(0, 0, S, S);
      const rnd = prng(7);
      for (let i = 0; i < 160; i++) {
        c.fillStyle = i % 3 ? '#96c86f' : '#b3dd86';
        const x = rnd() * S;
        const y = rnd() * S;
        c.beginPath();
        c.ellipse(x, y, 2 + rnd() * 5, 1.2 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = 'rgba(110, 150, 90, 0.4)';
      c.lineWidth = 2;
      c.strokeRect(0, 0, S, S);
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(SUELO_M / L, SUELO_M / L);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    })();
    const geoSuelo = new THREE.PlaneGeometry(SUELO_M, SUELO_M, 160, 160);
    geoSuelo.rotateX(-Math.PI / 2);
    const suelo = new THREE.Mesh(geoSuelo, conAltura(new THREE.MeshBasicMaterial({ map: texSuelo }), { tinta: true }));
    suelo.frustumCulled = false;
    scene.add(suelo);

    // --- cámara: tercera persona alrededor del avatar ---
    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 3000);
    const controls = new MapControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = false; // la cámara va donde va el avatar
    controls.minDistance = 6;
    controls.maxDistance = 140;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.45;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    // --- materiales ---
    const matFijo = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // el tinte por instancia se multiplica al color de vértice (que es la luz)
    const matTinte = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

    // --- piezas instanciadas ---
    const mallas = {}; // tipo → {tinte: InstancedMesh|null, fijo: InstancedMesh|null}
    const grupoPiezas = new THREE.Group();
    scene.add(grupoPiezas);
    for (const t of Object.keys(PIEZAS)) {
      const g = geometriaPieza(t);
      const par = { tinte: null, fijo: null };
      if (g.fijo) {
        par.fijo = new THREE.InstancedMesh(g.fijo, matFijo, MAX_INST);
        par.fijo.count = 0;
        par.fijo.frustumCulled = false; // la esfera envolvente sería la del origen
        grupoPiezas.add(par.fijo);
      }
      if (g.tinte) {
        par.tinte = new THREE.InstancedMesh(g.tinte, matTinte, MAX_INST);
        par.tinte.count = 0;
        par.tinte.frustumCulled = false;
        par.tinte.setColorAt(0, BLANCO); // hace falta tocarlo una vez para que exista
        grupoPiezas.add(par.tinte);
      }
      mallas[t] = par;
    }
    const coloresTinte = COLORES.map((h) => new THREE.Color(h));

    // --- sombras suaves: una mancha bajo cada pieza y cada avatar ---
    const texSombra = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      const g = c.createRadialGradient(64, 64, 6, 64, 64, 64);
      g.addColorStop(0, 'rgba(40, 50, 80, 0.34)');
      g.addColorStop(0.55, 'rgba(40, 50, 80, 0.18)');
      g.addColorStop(1, 'rgba(40, 50, 80, 0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(cv);
    })();
    const geoSombra = new THREE.PlaneGeometry(2, 2, 6, 6);
    geoSombra.rotateX(-Math.PI / 2);
    const matSombra = conAltura(new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, depthWrite: false }));
    const sombras = new THREE.InstancedMesh(geoSombra, matSombra, MAX_INST);
    sombras.count = 0;
    sombras.frustumCulled = false;
    sombras.renderOrder = 1;
    scene.add(sombras);
    const matSombraAvatar = new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, depthWrite: false });

    // --- hierba: matas que se mecen, alrededor del avatar ---
    const texHierba = (() => {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const c = cv.getContext('2d');
      const rnd = prng(3);
      // hojas anchas y en dos verdes, más oscuras que el suelo: sobre la
      // hierba del suelo, una brizna clara y fina desaparece
      for (let i = 0; i < 8; i++) {
        const x = 6 + i * 7 + rnd() * 3;
        const alto = 34 + rnd() * 28;
        const inclina = (rnd() - 0.5) * 22;
        c.fillStyle = i % 3 === 0 ? '#5f9e4e' : i % 3 === 1 ? '#74b45c' : '#8ccb6c';
        c.beginPath();
        c.moveTo(x - 4.5, 64);
        c.quadraticCurveTo(x + inclina * 0.4, 64 - alto * 0.55, x + inclina, 64 - alto);
        c.quadraticCurveTo(x + inclina * 0.4 + 3, 64 - alto * 0.55, x + 4.5, 64);
        c.fill();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const geoHierba = (() => {
      // dos planos cruzados; la base a y=0 y la punta a y=1 (el viento va
      // proporcional a la y)
      const a = new THREE.PlaneGeometry(1.7, 1, 1, 2);
      a.translate(0, 0.5, 0);
      const b = a.clone().rotateY(Math.PI / 2);
      const pos = [...a.getAttribute('position').array, ...b.getAttribute('position').array];
      const uv = [...a.getAttribute('uv').array, ...b.getAttribute('uv').array];
      const ia = Array.from(a.getIndex().array);
      const ib = Array.from(b.getIndex().array).map((i) => i + a.getAttribute('position').count);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(ia.concat(ib));
      a.dispose();
      b.dispose();
      return geo;
    })();
    const matHierba = conAltura(
      new THREE.MeshBasicMaterial({ map: texHierba, alphaTest: 0.5, side: THREE.DoubleSide }),
      { viento: true }
    );
    const hierba = new THREE.InstancedMesh(geoHierba, matHierba, MAX_HIERBA);
    hierba.count = 0;
    hierba.frustumCulled = false;
    scene.add(hierba);
    let hierbaCentro = null;
    const CELDA_HIERBA = 1.9;
    const RADIO_HIERBA = 56;

    // --- nubes ---
    const rndNubes = prng(11);
    const nubes = [];
    const matNube = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geometriaNube(rndNubes), matNube);
      m.frustumCulled = false;
      nubes.push({ m, ox: (rndNubes() - 0.5) * 520, oz: (rndNubes() - 0.5) * 520, h: 95 + rndNubes() * 45, v: 1.2 + rndNubes() * 1.4 });
      scene.add(m);
    }

    // --- parcelas: marco de dueño y suelo de plaza ---
    const texMarco = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 3;
      c.strokeRect(2, 2, 252, 252);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    // con segmentos: el shader los sube al terreno y el marco se ciñe a la colina
    const geoParcela = new THREE.PlaneGeometry(L, L, 12, 12);
    geoParcela.rotateX(-Math.PI / 2);
    const MAX_PARC = (RADIO_PARCELAS * 2 + 3) ** 2;
    const marcos = new THREE.InstancedMesh(
      geoParcela,
      conAltura(new THREE.MeshBasicMaterial({ map: texMarco, transparent: true, depthWrite: false })),
      MAX_PARC
    );
    marcos.count = 0;
    marcos.frustumCulled = false;
    marcos.setColorAt(0, BLANCO);
    marcos.renderOrder = 1;
    scene.add(marcos);
    const plazas = new THREE.InstancedMesh(geoParcela, conAltura(new THREE.MeshBasicMaterial({ color: 0xe9dfc8 })), MAX_PARC);
    plazas.count = 0;
    plazas.frustumCulled = false;
    scene.add(plazas);

    // marco de la parcela en obras
    const texObra = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const c = cv.getContext('2d');
      c.strokeStyle = 'rgba(47, 111, 237, 0.95)';
      c.lineWidth = 8;
      c.setLineDash([22, 12]);
      c.strokeRect(5, 5, 246, 246);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const marcoObra = new THREE.Mesh(geoParcela, conAltura(new THREE.MeshBasicMaterial({ map: texObra, transparent: true, depthWrite: false })));
    marcoObra.position.y = 0.2;
    marcoObra.renderOrder = 2;
    marcoObra.frustumCulled = false;
    marcoObra.visible = false;
    scene.add(marcoObra);

    // --- estado del mundo ---
    const parcelas = new Map(); // "px/py" → {o, d}
    let cajaPedida = null; // la caja de parcelas que tenemos cargada
    let ultimoHasta = null;
    let miParcelaClave = null;
    let vivo = true;
    window.__mundoListo = false;

    const mtx = new THREE.Matrix4();
    const posI = new THREE.Vector3();
    const rotI = new THREE.Quaternion();
    const escI = new THREE.Vector3(1, 1, 1);
    const escS = new THREE.Vector3(1, 1, 1);
    const ejeY = new THREE.Vector3(0, 1, 0);
    const colorMio = new THREE.Color(0x7fb0ff);
    const cacheColorDueno = new Map();
    const sinGiro = new THREE.Quaternion();

    // Rehace TODAS las instancias: son cientos o pocos miles, y es más barato
    // que llevar la cuenta de qué instancia era de qué parcela.
    function pintaMundo() {
      const cont = {};
      for (const t in mallas) cont[t] = 0;
      let nMarcos = 0;
      let nPlazas = 0;
      let nSombras = 0;
      for (const [clave, pc] of parcelas) {
        const p = parseParcela(clave);
        if (!p) continue;
        const bx = p.px * L;
        const by = p.py * L;
        const cen = centroParcela(p.px, p.py);
        if (pc.o === 'mundo') {
          if (nPlazas < MAX_PARC) {
            mtx.makeTranslation(cen.x, 0.04, -cen.y);
            plazas.setMatrixAt(nPlazas++, mtx);
          }
        } else if (pc.o && nMarcos < MAX_PARC) {
          mtx.makeTranslation(cen.x, 0.07, -cen.y);
          marcos.setMatrixAt(nMarcos, mtx);
          let col;
          if (pc.o === jugador.id) col = colorMio;
          else {
            col = cacheColorDueno.get(pc.o);
            if (!col) {
              col = colorDueno(pc.o);
              cacheColorDueno.set(pc.o, col);
            }
          }
          marcos.setColorAt(nMarcos++, col);
        }
        for (const z of pc.d || []) {
          const par = mallas[z.t];
          if (!par) continue;
          const wx = bx + z.x;
          const wy = by + z.y;
          // un pelín enterrada: en pendiente, mejor que el borde bajo se hunda
          // a que el alto flote
          posI.set(wx, alturaEn(wx, wy) - 0.12, -wy);
          rotI.setFromAxisAngle(ejeY, (z.r || 0) * (Math.PI / 2));
          mtx.compose(posI, rotI, escI);
          const i = cont[z.t];
          if (i >= MAX_INST) continue;
          if (par.fijo) par.fijo.setMatrixAt(i, mtx);
          if (par.tinte) {
            par.tinte.setMatrixAt(i, mtx);
            par.tinte.setColorAt(i, coloresTinte[z.c] || coloresTinte[0]);
          }
          cont[z.t] = i + 1;
          const rs = SOMBRA_DE[z.t];
          if (rs && nSombras < MAX_INST) {
            // corrida un poco al noreste: el sol viene del suroeste
            posI.set(wx + rs * 0.12, 0.1, -wy - rs * 0.1);
            escS.set(rs, 1, rs);
            mtx.compose(posI, sinGiro, escS);
            sombras.setMatrixAt(nSombras++, mtx);
          }
        }
      }
      for (const t in mallas) {
        const par = mallas[t];
        if (par.fijo) {
          par.fijo.count = cont[t];
          par.fijo.instanceMatrix.needsUpdate = true;
        }
        if (par.tinte) {
          par.tinte.count = cont[t];
          par.tinte.instanceMatrix.needsUpdate = true;
          par.tinte.instanceColor.needsUpdate = true;
        }
      }
      marcos.count = nMarcos;
      marcos.instanceMatrix.needsUpdate = true;
      if (marcos.instanceColor) marcos.instanceColor.needsUpdate = true;
      plazas.count = nPlazas;
      plazas.instanceMatrix.needsUpdate = true;
      sombras.count = nSombras;
      sombras.instanceMatrix.needsUpdate = true;
      hierbaCentro = null; // la hierba esquiva plazas y caminos: se replanta
    }

    // La hierba se planta en una rejilla fija del mundo (hash por celda), así
    // que al andar aparecen y desaparecen matas por los bordes, nunca en medio.
    // Esquiva las parcelas del «mundo» (la plaza) y las losas de camino.
    function plantaHierba() {
      const cx = Math.round(yo.x / CELDA_HIERBA);
      const cy = Math.round(yo.y / CELDA_HIERBA);
      if (hierbaCentro && Math.abs(hierbaCentro.cx - cx) < 5 && Math.abs(hierbaCentro.cy - cy) < 5) return;
      hierbaCentro = { cx, cy };
      const R = Math.round(RADIO_HIERBA / CELDA_HIERBA);
      const caminos = [];
      for (const [clave, pc] of parcelas) {
        const p = parseParcela(clave);
        if (!p) continue;
        for (const z of pc.d || []) if (z.t === 'camino') caminos.push([p.px * L + z.x, p.py * L + z.y]);
      }
      let n = 0;
      for (let i = -R; i <= R && n < MAX_HIERBA; i++) {
        for (let j = -R; j <= R && n < MAX_HIERBA; j++) {
          if (i * i + j * j > R * R) continue;
          const gx = cx + i;
          const gy = cy + j;
          const h = hash2(gx, gy);
          const wx = (gx + hash2(gx * 7, gy) - 0.5) * CELDA_HIERBA;
          const wy = (gy + hash2(gx, gy * 7) - 0.5) * CELDA_HIERBA;
          // a rodales: una onda lenta decide dónde hay más y dónde menos, si
          // no la hierba sale como un campo sembrado en filas
          const rodal = 0.32 + 0.3 * Math.sin(wx * 0.09 + wy * 0.05) * Math.sin(wy * 0.11 - wx * 0.04);
          if (h > rodal) continue;
          const p = parcelaDe(wx, wy);
          const pc = parcelas.get(claveParcela(p.px, p.py));
          if (pc?.o === 'mundo') continue;
          let tapada = false;
          for (const c of caminos) {
            if (Math.abs(c[0] - wx) < 2.3 && Math.abs(c[1] - wy) < 2.3) {
              tapada = true;
              break;
            }
          }
          if (tapada) continue;
          const s = 0.45 + h * 1.3; // como mucho a la rodilla del avatar
          posI.set(wx, 0, -wy);
          rotI.setFromAxisAngle(ejeY, h * 9);
          escS.set(s, s * (0.9 + hash2(gy, gx) * 0.7), s);
          mtx.compose(posI, rotI, escS);
          hierba.setMatrixAt(n++, mtx);
        }
      }
      hierba.count = n;
      hierba.instanceMatrix.needsUpdate = true;
    }

    // --- el avatar propio ---
    const geoPierna = geometriaPierna();
    function creaFigura(color) {
      const grupo = new THREE.Group();
      const cuerpo = new THREE.Mesh(geometriaAvatar(color), matFijo);
      const pi = new THREE.Mesh(geoPierna, matFijo);
      const pd = new THREE.Mesh(geoPierna, matFijo);
      pi.position.set(-0.19, 1.0, 0);
      pd.position.set(0.19, 1.0, 0);
      const sombra = new THREE.Mesh(geoSombra, matSombraAvatar);
      sombra.scale.set(0.9, 1, 0.9);
      sombra.position.y = 0.08;
      sombra.renderOrder = 1;
      grupo.add(cuerpo, pi, pd, sombra);
      return { grupo, cuerpo, pi, pd, sombra };
    }
    const avatar = creaFigura(coloresTinte[jugador.color]);
    scene.add(avatar.grupo);
    // posición en metros del mundo (y hacia el norte); rumbo en radianes
    const yo = { x: L / 2, y: L / 2 - 12, h: 0, rumbo: 0, destino: null, fase: 0, andando: false };
    const px0 = parseFloat(params.get('x'));
    const py0 = parseFloat(params.get('y'));
    if (Number.isFinite(px0) && Number.isFinite(py0)) {
      yo.x = px0;
      yo.y = py0;
    }
    yo.h = alturaEn(yo.x, yo.y);
    function colocaFigura(f, o) {
      const salto = o.andando ? Math.abs(Math.sin(o.fase)) * 0.09 : 0;
      f.grupo.position.set(o.x, o.h + salto, -o.y);
      f.grupo.rotation.y = o.rumbo;
      const a = o.andando ? Math.sin(o.fase) * 0.65 : 0;
      f.pi.rotation.x = a;
      f.pd.rotation.x = -a;
      f.sombra.position.y = 0.08 - salto;
    }

    // Cámara inicial: al sur del avatar, mirando al norte. Reproducible desde
    // la URL (?d=&pol=&az=) para el banco visual: az es el rumbo desde el
    // avatar hacia la cámara (180 = la cámara está al sur).
    controls.target.set(yo.x, yo.h + 1.2, -yo.y);
    {
      const dCam = parseFloat(params.get('d'));
      const polCam = parseFloat(params.get('pol'));
      const azCam = parseFloat(params.get('az'));
      const d = dCam > 0 ? dCam : 22;
      const pol = (Number.isFinite(polCam) ? Math.max(9, Math.min(83, polCam)) : 62) * (Math.PI / 180);
      const az = (Number.isFinite(azCam) ? azCam : 180) * (Math.PI / 180);
      const r = d * Math.sin(pol);
      camera.position.set(yo.x + r * Math.sin(az), yo.h + 1.2 + d * Math.cos(pol), -yo.y - r * Math.cos(az));
    }

    // --- otros jugadores ---
    const otros = new Map(); // id → {figura, o: {x, y, h, rumbo, ...}, objetivo, nombre, color, visto}
    const nodos = new Map(); // id → <div> del nombre
    function creaOtro(id, datos) {
      const figura = creaFigura(coloresTinte[datos.c] || coloresTinte[0]);
      scene.add(figura.grupo);
      const o = {
        figura,
        color: datos.c,
        nombre: datos.n,
        visto: Date.now(),
        o: { x: datos.x, y: datos.y, h: alturaEn(datos.x, datos.y), rumbo: datos.r, fase: 0, andando: false },
        objetivo: { x: datos.x, y: datos.y, rumbo: datos.r },
      };
      otros.set(id, o);
      return o;
    }
    function quitaOtro(id) {
      const o = otros.get(id);
      if (!o) return;
      scene.remove(o.figura.grupo);
      o.figura.cuerpo.geometry.dispose();
      otros.delete(id);
      const el = nodos.get(id);
      if (el) {
        el.remove();
        nodos.delete(id);
      }
    }

    // --- nombres sobre las cabezas: <div> proyectados ---
    const pv = new THREE.Vector3();
    let vpW = 1;
    let vpH = 1;
    function pintaNombres() {
      const cont = rotulosRef.current;
      if (!cont) return;
      const pinta = (id, nombre, x, y, h, propio) => {
        let el = nodos.get(id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'nombre' + (propio ? ' yo' : '');
          cont.appendChild(el);
          nodos.set(id, el);
        }
        if (el._txt !== nombre) {
          el.textContent = nombre;
          el._txt = nombre;
        }
        pv.set(x, h + 3.2, -y);
        const dist = pv.distanceTo(camera.position);
        pv.project(camera);
        if (pv.z > 1 || dist > 160 || Math.abs(pv.x) > 1.1 || Math.abs(pv.y) > 1.1) {
          el.style.display = 'none';
          return;
        }
        el.style.display = '';
        el.style.opacity = dist > 110 ? ((160 - dist) / 50).toFixed(2) : '1';
        el.style.transform =
          'translate3d(' + Math.round((pv.x * 0.5 + 0.5) * vpW) + 'px,' + Math.round((-pv.y * 0.5 + 0.5) * vpH) + 'px,0) translate(-50%,-100%)';
      };
      const yoP = perfil();
      if (yoP.nombre) pinta('yo', yoP.nombre, yo.x, yo.y, yo.h, true);
      for (const [id, o] of otros) pinta(id, o.nombre, o.o.x, o.o.y, o.o.h, false);
    }

    // --- conversiones y toques ---
    // El rayo se corta con el plano a la altura del avatar y se afina una vez
    // con la altura del punto encontrado: con colinas de ±2 m y la cámara a
    // 20 m el error que queda es de centímetros.
    const ndc = new THREE.Vector2();
    const rayo = new THREE.Raycaster();
    const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pSuelo = new THREE.Vector3();
    function sueloEn(sx, sy) {
      ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
      rayo.setFromCamera(ndc, camera);
      planoSuelo.constant = -yo.h;
      if (!rayo.ray.intersectPlane(planoSuelo, pSuelo)) return null;
      planoSuelo.constant = -alturaEn(pSuelo.x, -pSuelo.z);
      if (!rayo.ray.intersectPlane(planoSuelo, pSuelo)) return null;
      return { x: pSuelo.x, y: -pSuelo.z };
    }

    // --- modo construir ---
    let obraClave = null;
    let obraBase = null; // {bx, by}
    let herramienta = 'casa';
    let tinteActual = 2;
    let giro = 0;
    let ultimaPieza = null; // la última colocada, para poder girarla
    let avisaObra = null;
    let guardadoT = null;

    async function guardaPiezas(clave) {
      const pc = parcelas.get(clave);
      if (!pc) return;
      ultimoHasta = null;
      try {
        const r = await fetch('/api/parcela', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accion: 'piezas', parcela: clave, jugador: jugador.id, piezas: pc.d }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          avisaObra?.({ error: j.error || 'red' });
        }
      } catch {
        avisaObra?.({ error: 'red' });
      }
    }
    function programaGuardado(clave) {
      clearTimeout(guardadoT);
      guardadoT = setTimeout(() => {
        guardadoT = null;
        guardaPiezas(clave);
      }, 900);
    }
    function vaciaGuardado() {
      if (!guardadoT || !obraClave) return;
      clearTimeout(guardadoT);
      guardadoT = null;
      guardaPiezas(obraClave);
    }

    // el camino y la valla van a una rejilla de 4 m, para que casen entre sí
    const REJILLA = new Set(['camino', 'valla']);
    function colocaEn(sx, sy) {
      if (!obraClave) return;
      const p = sueloEn(sx, sy);
      if (!p) return;
      let x = p.x - obraBase.bx;
      let y = p.y - obraBase.by;
      if (x < 0 || x > L || y < 0 || y > L) {
        avisaObra?.({ fuera: true });
        return;
      }
      const pc = parcelas.get(obraClave);
      const lista = pc?.d ? pc.d.slice() : [];
      if (herramienta === 'borrar') {
        let mejor = -1;
        let md = Infinity;
        for (let i = 0; i < lista.length; i++) {
          const d = Math.hypot(lista[i].x - x, lista[i].y - y);
          if (d < md) {
            md = d;
            mejor = i;
          }
        }
        if (mejor < 0 || md > 4) return;
        lista.splice(mejor, 1);
        ultimaPieza = null;
      } else {
        if (lista.length >= MAX_PIEZAS) {
          avisaObra?.({ lleno: true });
          return;
        }
        if (REJILLA.has(herramienta)) {
          x = Math.min(L - 2, Math.max(2, Math.floor(x / 4) * 4 + 2));
          y = Math.min(L - 2, Math.max(2, Math.floor(y / 4) * 4 + 2));
        }
        const z = { t: herramienta, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: giro, c: tinteActual };
        lista.push(z);
        ultimaPieza = z;
      }
      parcelas.set(obraClave, { o: pc?.o || jugador.id, d: lista });
      pintaMundo();
      avisaObra?.({ n: lista.length });
      programaGuardado(obraClave);
    }

    // Un toque es bajar y subir el mismo puntero, solo, sin moverse apenas:
    // arrastrar gira la cámara y no coloca ni mueve nada.
    let toque = null;
    let punteros = 0;
    function onBaja(e) {
      if (e.isPrimary) punteros = 0;
      punteros++;
      toque = punteros === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    }
    function onSube(e) {
      punteros = Math.max(0, punteros - 1);
      const tq = toque;
      toque = null;
      if (!tq || punteros !== 0) return;
      if (Math.hypot(e.clientX - tq.x, e.clientY - tq.y) > 8 || performance.now() - tq.t > 600) return;
      if (obraClave) colocaEn(e.clientX, e.clientY);
      else {
        const p = sueloEn(e.clientX, e.clientY);
        if (p) yo.destino = p;
      }
    }
    function onCancela() {
      punteros = Math.max(0, punteros - 1);
      toque = null;
    }
    canvas.addEventListener('pointerdown', onBaja);
    canvas.addEventListener('pointerup', onSube);
    canvas.addEventListener('pointercancel', onCancela);

    // teclado: WASD / flechas, relativo a la cámara
    const teclas = new Set();
    function onKeyDown(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        teclas.add(k);
        yo.destino = null;
        e.preventDefault();
      }
    }
    function onKeyUp(e) {
      teclas.delete(e.key.toLowerCase());
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // --- parcelas: qué hay cargado, qué hay que pedir ---
    function cajaAlrededor() {
      const p = parcelaDe(yo.x, yo.y);
      return { px0: p.px - RADIO_PARCELAS, py0: p.py - RADIO_PARCELAS, px1: p.px + RADIO_PARCELAS, py1: p.py + RADIO_PARCELAS };
    }
    let trayendo = false;
    async function traeParcelas(forzar) {
      if (trayendo) return;
      const caja = cajaAlrededor();
      const clave = [caja.px0, caja.py0, caja.px1, caja.py1].join(',');
      const cambiaCaja = clave !== cajaPedida;
      if (!forzar && !cambiaCaja && ultimoHasta === null) return;
      trayendo = true;
      try {
        const q = new URLSearchParams();
        for (const k of ['px0', 'py0', 'px1', 'py1']) q.set(k, String(caja[k]));
        // el delta solo vale con la misma caja: si cambia, lo nuevo es viejo
        if (ultimoHasta != null && !cambiaCaja) q.set('desde', String(ultimoHasta));
        else q.set('jugador', jugador.id);
        const r = await fetch('/api/mundo?' + q.toString());
        if (r.status === 304) return;
        const j = await r.json();
        if (!vivo) return;
        if (cambiaCaja) {
          // lo que ya no está en la caja se olvida (salvo la parcela en obras)
          for (const k of [...parcelas.keys()]) {
            const p = parseParcela(k);
            if (k !== obraClave && (p.px < caja.px0 || p.px > caja.px1 || p.py < caja.py0 || p.py > caja.py1)) parcelas.delete(k);
          }
          cajaPedida = clave;
        }
        if (typeof j.hasta === 'number') ultimoHasta = j.hasta;
        let cambios = false;
        for (const it of j.parcelas || []) {
          if (it.k === obraClave) continue; // lo local aún no se ha guardado
          const prev = parcelas.get(it.k);
          if (!prev || prev.o !== it.o || JSON.stringify(prev.d) !== JSON.stringify(it.d)) {
            parcelas.set(it.k, { o: it.o, d: it.d || [] });
            cambios = true;
          }
        }
        if (j.yo) {
          miParcelaClave = j.yo.p || null;
          setMiParcela(miParcelaClave);
        }
        if (cambios || cambiaCaja) pintaMundo();
        actualizaDonde(true);
        if (!window.__mundoListo) {
          window.__mundoListo = true;
          setCargando(false);
        }
      } catch {
        /* sin red: se reintenta en el siguiente sondeo */
      } finally {
        trayendo = false;
      }
    }

    // dónde está el avatar, para el botón de abajo
    let dondeClave = null;
    function actualizaDonde(forzar) {
      const p = parcelaDe(yo.x, yo.y);
      const clave = claveParcela(p.px, p.py);
      if (!forzar && clave === dondeClave) return;
      dondeClave = clave;
      const pc = parcelas.get(clave);
      setDonde({
        clave,
        dueno: pc?.o || null,
        mia: pc?.o === jugador.id,
        libre: !pc?.o,
        n: pc?.d?.length || 0,
      });
    }

    // --- presencia ---
    let ultimaPresencia = 0;
    async function mandaPresencia() {
      const p = perfil();
      if (!p.nombre) return; // hasta que no te presentes, no sales en el mundo
      try {
        const r = await fetch('/api/presencia', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jugador: p.id, nombre: p.nombre, color: p.color, x: Math.round(yo.x * 10) / 10, y: Math.round(yo.y * 10) / 10, r: Math.round(yo.rumbo * 100) / 100 }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!vivo) return;
        const ahora = Date.now();
        const vistos = new Set();
        for (const d of j.cerca || []) {
          vistos.add(d.id);
          let o = otros.get(d.id);
          if (o && (o.color !== d.c || o.nombre !== d.n)) {
            quitaOtro(d.id);
            o = null;
          }
          if (!o) o = creaOtro(d.id, d);
          o.objetivo = { x: d.x, y: d.y, rumbo: d.r };
          o.visto = ahora;
        }
        for (const [id, o] of otros) if (!vistos.has(id) && ahora - o.visto > 9000) quitaOtro(id);
        setConectados(j.conectados || 1);
      } catch {
        /* sin red */
      }
    }

    function mueveA(x, y) {
      const dx = x - yo.x;
      const dy = y - yo.y;
      yo.x = x;
      yo.y = y;
      yo.destino = null;
      camera.position.x += dx;
      camera.position.z -= dy;
      controls.target.x += dx;
      controls.target.z -= dy;
    }

    // Diagnóstico y pruebas (npm run prueba): con render por software un
    // paseo de 30 m tarda lo que tarde, así que la prueba se teletransporta.
    window.__mundo = { mueve: mueveA, pos: () => ({ x: yo.x, y: yo.y }) };

    engineRef.current = {
      construye(clave, cb) {
        vaciaGuardado();
        if (!clave) {
          obraClave = null;
          avisaObra = null;
          marcoObra.visible = false;
          return 0;
        }
        const p = parseParcela(clave);
        obraClave = clave;
        obraBase = { bx: p.px * L, by: p.py * L };
        avisaObra = cb;
        const c = centroParcela(p.px, p.py);
        marcoObra.position.set(c.x, 0.2, -c.y);
        marcoObra.visible = true;
        return parcelas.get(clave)?.d?.length || 0;
      },
      herramienta(t, c) {
        herramienta = t;
        if (Number.isInteger(c)) tinteActual = c;
      },
      // gira la última pieza colocada, y deja ese giro para la siguiente
      gira() {
        giro = (giro + 1) % 4;
        if (ultimaPieza && obraClave) {
          ultimaPieza.r = giro;
          pintaMundo();
          programaGuardado(obraClave);
        }
        return giro;
      },
      async reclama(clave) {
        try {
          const r = await fetch('/api/parcela', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accion: 'reclama', parcela: clave, jugador: jugador.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return j.error || 'red';
          parcelas.set(clave, { o: jugador.id, d: [] });
          miParcelaClave = clave;
          setMiParcela(clave);
          ultimoHasta = null;
          pintaMundo();
          actualizaDonde(true);
          return null;
        } catch {
          return 'red';
        }
      },
      async abandona(clave) {
        try {
          const r = await fetch('/api/parcela', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accion: 'abandona', parcela: clave, jugador: jugador.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return j.error || 'red';
          parcelas.set(clave, { o: null, d: [] });
          miParcelaClave = null;
          setMiParcela(null);
          ultimoHasta = null;
          pintaMundo();
          actualizaDonde(true);
          return null;
        } catch {
          return 'red';
        }
      },
      // teletransporte a una parcela (la plaza, la tuya)
      vaA(clave) {
        const p = parseParcela(clave);
        if (!p) return;
        const c = centroParcela(p.px, p.py);
        mueveA(c.x, c.y - 12);
        actualizaDonde(false);
        traeParcelas(true);
      },
      // el avatar cambia de color al cambiar el perfil
      recolorea(c) {
        avatar.cuerpo.geometry.dispose();
        avatar.cuerpo.geometry = geometriaAvatar(coloresTinte[c] || coloresTinte[0]);
      },
      presentate() {
        mandaPresencia();
      },
    };

    // --- arranque y bucle ---
    function medir() {
      vpW = window.innerWidth;
      vpH = window.innerHeight;
      renderer.setSize(vpW, vpH, false);
      camera.aspect = vpW / vpH;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', medir);
    medir();

    const dirCam = new THREE.Vector3();
    let raf = 0;
    let tAnt = 0;
    let ultimoSondeo = 0;
    function bucle(t) {
      raf = requestAnimationFrame(bucle);
      // tope de 0,25 s: si el frame tarda más (pestaña dormida, render por
      // software), el avatar no se teletransporta pero tampoco se arrastra
      const dt = Math.min(0.25, (t - tAnt) / 1000 || 0);
      tAnt = t;
      uTiempo.value = t / 1000;

      // --- mover el avatar propio ---
      let mx = 0;
      let my = 0;
      if (teclas.size) {
        // adelante = de la cámara al avatar, sobre el suelo
        dirCam.subVectors(controls.target, camera.position);
        dirCam.y = 0;
        dirCam.normalize();
        const fe = dirCam.x;
        const fn = -dirCam.z;
        const adel = (teclas.has('w') || teclas.has('arrowup') ? 1 : 0) - (teclas.has('s') || teclas.has('arrowdown') ? 1 : 0);
        const lado = (teclas.has('d') || teclas.has('arrowright') ? 1 : 0) - (teclas.has('a') || teclas.has('arrowleft') ? 1 : 0);
        mx = fe * adel + fn * lado;
        my = fn * adel - fe * lado;
      } else if (yo.destino) {
        const dx = yo.destino.x - yo.x;
        const dy = yo.destino.y - yo.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.35) yo.destino = null;
        else {
          mx = dx / d;
          my = dy / d;
        }
      }
      const l = Math.hypot(mx, my);
      yo.andando = l > 0.01;
      if (yo.andando) {
        const paso = Math.min(VELOCIDAD * dt, yo.destino ? Math.hypot(yo.destino.x - yo.x, yo.destino.y - yo.y) : Infinity);
        const dx = (mx / l) * paso;
        const dy = (my / l) * paso;
        yo.x += dx;
        yo.y += dy;
        yo.rumbo = Math.atan2(dx, -dy); // el frente del avatar es +z (sur)
        yo.fase += dt * 11;
        // la cámara va con él
        camera.position.x += dx;
        camera.position.z -= dy;
        controls.target.x += dx;
        controls.target.z -= dy;
        actualizaDonde(false);
      } else {
        yo.fase = 0;
      }
      // sube y baja con la colina; la cámara acompaña
      const h = alturaEn(yo.x, yo.y);
      const dh = h - yo.h;
      yo.h = h;
      camera.position.y += dh;
      controls.target.y += dh;
      colocaFigura(avatar, yo);

      // --- los demás, interpolados hacia su última posición conocida ---
      for (const o of otros.values()) {
        const s = o.o;
        const dx = o.objetivo.x - s.x;
        const dy = o.objetivo.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.05) {
          const paso = Math.min(d, Math.max(VELOCIDAD * 1.2 * dt, d * dt * 2));
          s.x += (dx / d) * paso;
          s.y += (dy / d) * paso;
          s.rumbo = Math.atan2(dx, -dy);
          s.andando = true;
          s.fase += dt * 11;
        } else {
          s.andando = false;
          s.fase = 0;
          s.rumbo = o.objetivo.rumbo;
        }
        s.h = alturaEn(s.x, s.y);
        colocaFigura(o.figura, s);
      }

      // el suelo sigue al avatar a saltos de parcela: la trama no resbala
      suelo.position.x = Math.round(yo.x / L) * L;
      suelo.position.z = -Math.round(yo.y / L) * L;
      plantaHierba();

      // nubes: van con el avatar (siempre hay cielo encima) y derivan al este
      for (const nb of nubes) {
        const ox = ((((nb.ox + uTiempo.value * nb.v + 260) % 520) + 520) % 520) - 260;
        nb.m.position.set(yo.x + ox, nb.h, -yo.y + nb.oz);
      }

      controls.update();
      renderer.render(scene, camera);
      pintaNombres();

      if (t - ultimoSondeo > 1500) {
        ultimoSondeo = t;
        traeParcelas(false);
        if (t - ultimaPresencia > 1500) {
          ultimaPresencia = t;
          mandaPresencia();
        }
      }
    }

    // periódico: deltas de parcelas (lo que construyen los demás)
    const sondeo = setInterval(() => {
      ultimoHasta = ultimoHasta ?? 0;
      traeParcelas(true);
    }, 6000);

    (async () => {
      // primera carga: dónde estaba mi avatar y qué hay alrededor
      try {
        const caja = cajaAlrededor();
        const q = new URLSearchParams({ px0: caja.px0, py0: caja.py0, px1: caja.px1, py1: caja.py1, jugador: jugador.id });
        const r = await fetch('/api/mundo?' + q.toString());
        const j = await r.json();
        if (!vivo) return;
        const sinPos = !(Number.isFinite(px0) && Number.isFinite(py0));
        if (sinPos && j.yo && Number.isFinite(j.yo.x)) mueveA(j.yo.x, j.yo.y);
      } catch {
        /* se reintenta en el bucle */
      }
      await traeParcelas(true);
      raf = requestAnimationFrame(bucle);
    })();

    return () => {
      vivo = false;
      clearInterval(sondeo);
      cancelAnimationFrame(raf);
      vaciaGuardado();
      window.removeEventListener('resize', medir);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onBaja);
      canvas.removeEventListener('pointerup', onSube);
      canvas.removeEventListener('pointercancel', onCancela);
      for (const id of [...otros.keys()]) quitaOtro(id);
      for (const el of nodos.values()) el.remove();
      nodos.clear();
      for (const t in mallas) {
        for (const parte of ['fijo', 'tinte']) {
          const m = mallas[t][parte];
          if (!m) continue;
          m.geometry.dispose();
          m.dispose();
        }
      }
      for (const nb of nubes) nb.m.geometry.dispose();
      matNube.dispose();
      hierba.dispose();
      geoHierba.dispose();
      matHierba.dispose();
      texHierba.dispose();
      sombras.dispose();
      geoSombra.dispose();
      matSombra.dispose();
      matSombraAvatar.dispose();
      texSombra.dispose();
      marcos.dispose();
      marcos.material.dispose();
      plazas.dispose();
      plazas.material.dispose();
      geoParcela.dispose();
      marcoObra.material.dispose();
      texMarco.dispose();
      texObra.dispose();
      avatar.cuerpo.geometry.dispose();
      geoPierna.dispose();
      suelo.geometry.dispose();
      suelo.material.dispose();
      texSuelo.dispose();
      texCielo.dispose();
      matFijo.dispose();
      matTinte.dispose();
      controls.dispose();
      renderer.dispose();
      engineRef.current = null;
      delete window.__mundo;
    };
  }, []);

  // --- presentación (nombre y color) ---
  function onPresentar(e) {
    e.preventDefault();
    const n = nombreRef.current?.value?.trim();
    if (!n) {
      avisa('Dinos cómo te llamas para entrar');
      return;
    }
    const p = guardaPerfil(n, colorElegido);
    setYo({ ...p });
    engineRef.current?.recolorea(p.color);
    engineRef.current?.presentate();
    avisa('¡Bienvenido/a, ' + p.nombre + '! Toca el suelo para andar');
  }

  // --- parcela ---
  async function onReclamar() {
    const eng = engineRef.current;
    if (!eng || !donde) return;
    const err = await eng.reclama(donde.clave);
    if (err === 'ocupada') avisa('Alguien se te ha adelantado con esta parcela');
    else if (err === 'cupo') avisa('Ya tienes una parcela. Puedes abandonarla desde «Construir»');
    else if (err) avisa('No se pudo reclamar (¿sin conexión?)');
    else avisa('¡Parcela tuya! Pulsa «Construir» y toca el suelo para poner piezas');
  }
  function onConstruir() {
    const eng = engineRef.current;
    if (!eng || !donde?.mia) return;
    const n = eng.construye(donde.clave, (ev) => {
      if (ev.fuera) avisa('Toca dentro de tu parcela');
      else if (ev.lleno) avisa('Tu parcela ya tiene ' + MAX_PIEZAS + ' piezas: borra alguna para poner otra');
      else if (ev.error === 'ajena') avisa('Esta parcela no es tuya: no se ha guardado');
      else if (ev.error) avisa('No se pudo guardar (¿sin conexión?)');
      else if (typeof ev.n === 'number') setObra((o) => (o ? { ...o, n: ev.n } : o));
    });
    eng.herramienta(herr, tinte);
    setInfoOpen(false);
    setObra({ clave: donde.clave, n });
  }
  function terminaObra() {
    engineRef.current?.construye(null);
    setObra(null);
  }
  function eligeHerr(t) {
    setHerr(t);
    engineRef.current?.herramienta(t, tinte);
  }
  function eligeTinte(c) {
    setTinte(c);
    engineRef.current?.herramienta(herr, c);
  }
  async function onAbandonar() {
    if (!obra) return;
    if (!window.confirm('¿Abandonar tu parcela? Se borrará todo lo construido y quedará libre para otro.')) return;
    const err = await engineRef.current?.abandona(obra.clave);
    if (err) avisa('No se pudo abandonar (¿sin conexión?)');
    else {
      terminaObra();
      avisa('Parcela abandonada. Busca un solar libre y reclámalo');
    }
  }

  if (sinGL) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 20, textAlign: 'center', color: '#2b3440', fontWeight: 700 }}>
        Este navegador no soporta WebGL, que es lo que dibuja el mundo 3D.
      </div>
    );
  }

  const presentado = !!yo?.nombre;
  const tiñe = PIEZAS[herr]?.tinte;

  return (
    <>
      <canvas id="lienzo" ref={canvasRef} />
      <div id="vineta" aria-hidden="true" />
      <div id="rotulos" ref={rotulosRef} aria-hidden="true" />

      {yo && !presentado && (
        <div className="ui velo">
          <form className="hoja glass presenta" onSubmit={onPresentar}>
            <h2>Bienvenido al mundo</h2>
            <p>Un mundo que se construye entre todos: anda, reclama una parcela y levanta tu casa.</p>
            <label>
              ¿Cómo te llamas?
              <input ref={nombreRef} type="text" maxLength={MAX_NOMBRE} placeholder="Tu nombre" autoComplete="nickname" autoFocus />
            </label>
            <div className="colores" role="radiogroup" aria-label="Color de tu avatar">
              {COLORES.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className={'color' + (colorElegido === i ? ' on' : '')}
                  style={{ background: c }}
                  onClick={() => setColorElegido(i)}
                  aria-label={'Color ' + (i + 1)}
                  aria-checked={colorElegido === i}
                  role="radio"
                />
              ))}
            </div>
            <button type="submit" className="btn-principal">
              Entrar
            </button>
          </form>
        </div>
      )}

      <div className="ui cabecera glass">
        <span className="quien">
          <i style={{ background: COLORES[yo?.color ?? 0] }} />
          {yo?.nombre || '…'}
        </span>
        <span className="conectados">
          {conectados} {conectados === 1 ? 'persona' : 'personas'} en el mundo
        </span>
      </div>

      <button className="ui btn-cuad b-info" aria-label="Cómo funciona" onClick={() => setInfoOpen((v) => !v)}>
        i
      </button>
      <button className="ui btn-cuad b-plaza" aria-label="Ir a la plaza" title="Ir a la plaza" onClick={() => engineRef.current?.vaA('0/0')}>
        ⛲
      </button>
      {miParcela && (
        <button className="ui btn-cuad b-casa" aria-label="Ir a mi parcela" title="Ir a mi parcela" onClick={() => engineRef.current?.vaA(miParcela)}>
          🏠
        </button>
      )}

      {infoOpen && (
        <div className="ui hoja glass info">
          <h2>Cómo funciona</h2>
          <p>
            <b>Anda</b> tocando el suelo (o con WASD / flechas). Arrastra para girar la cámara y pellizca para acercarla.
          </p>
          <p>
            <b>Reclama una parcela</b> libre: ponte encima y pulsa «Reclamar». Es tuya para siempre (o hasta que la abandones).
          </p>
          <p>
            <b>Construye</b> en tu parcela: casa, torre, árboles, caminos, vallas… Toca el suelo para colocar cada pieza. Lo ve todo el mundo al momento.
          </p>
          <p>
            <b>Todo se dibuja en tu GPU.</b> El servidor solo guarda qué hay en cada parcela y quién anda cerca.
          </p>
        </div>
      )}

      {!obra && donde && presentado && (
        <div className="ui acciones">
          {donde.mia && (
            <button className="btn-principal" onClick={onConstruir}>
              🛠️ Construir
            </button>
          )}
          {donde.libre && !miParcela && (
            <button className="btn-principal" onClick={onReclamar}>
              📍 Reclamar esta parcela
            </button>
          )}
          {donde.libre && miParcela && <span className="etiqueta glass">Solar libre</span>}
          {!donde.libre && !donde.mia && (
            <span className="etiqueta glass">{donde.dueno === 'mundo' ? 'Plaza pública' : 'Parcela de otra persona'}</span>
          )}
        </div>
      )}

      {obra && (
        <>
          <div className="ui deco-cab glass">
            <b>Construyendo</b>
            <span>
              {obra.n}/{MAX_PIEZAS} piezas · toca el suelo para colocar
            </span>
          </div>
          <div className="ui paleta glass" role="toolbar" aria-label="Piezas">
            <div className="fila">
              {Object.entries(PIEZAS).map(([t, d]) => (
                <button key={t} className={'herr' + (herr === t ? ' on' : '')} onClick={() => eligeHerr(t)} aria-label={d.nombre} aria-pressed={herr === t}>
                  <span>{d.icono}</span>
                  <small>{d.nombre}</small>
                </button>
              ))}
              <button className={'herr' + (herr === 'borrar' ? ' on' : '')} onClick={() => eligeHerr('borrar')} aria-label="Borrar" aria-pressed={herr === 'borrar'}>
                <span>🧹</span>
                <small>Borrar</small>
              </button>
            </div>
            <div className="fila abajo">
              <div className="colores mini" style={{ visibility: tiñe ? 'visible' : 'hidden' }}>
                {COLORES.map((c, i) => (
                  <button key={c} className={'color' + (tinte === i ? ' on' : '')} style={{ background: c }} onClick={() => eligeTinte(i)} aria-label={'Color ' + (i + 1)} />
                ))}
              </div>
              <button className="btn-sec" onClick={() => engineRef.current?.gira()} title="Gira la última pieza">
                ↻ Girar
              </button>
              <button className="btn-sec peligro" onClick={onAbandonar}>
                Abandonar
              </button>
              <button className="btn-principal" onClick={terminaObra}>
                Listo
              </button>
            </div>
          </div>
        </>
      )}

      {cargando && (
        <div className="ui carga glass">
          <span className="punto" /> entrando en el mundo…
        </div>
      )}

      <div className={'ui toast glass' + (toast.on ? ' on' : '')}>{toast.msg}</div>
    </>
  );
}
