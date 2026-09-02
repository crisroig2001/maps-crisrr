'use client';

// El mundo: un suelo plano e infinito dividido en parcelas, avatares que
// andan por él y parcelas que cada jugador construye con piezas. Todo el
// renderizado ocurre en la GPU del dispositivo, sin luces: el sombreado por
// cara va horneado en los colores de vértice (look cartoon plano y coste
// mínimo en móvil). Las piezas van INSTANCIADAS: un draw call por tipo de
// pieza sean 3 o 3.000.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { PARCELA_M, parcelaDe, claveParcela, parseParcela, centroParcela } from '../lib/parcela';
import { PIEZAS, COLORES, MAX_PIEZAS, MAX_NOMBRE } from '../lib/piezas';
import { perfil, guardaPerfil } from '../lib/jugador';

const L = PARCELA_M;

// --- el sol y el look ---
const SOL_AZ = (55 * Math.PI) / 180;
const SOL_E = Math.sin(SOL_AZ);
const SOL_N = Math.cos(SOL_AZ);
const LUZ_SOMBRA = 0.66; // la cara que da la espalda al sol se queda a este %
const CIELO_CENIT = 0x9ecbe8;
const CIELO_HORIZONTE = 0xe3f1f8;
const HIERBA = '#a9d68a';
const HIERBA_OSCURA = '#95c47a';
const PIEDRA = '#d9d4c7';
const NIEBLA_DESDE = 170;
const NIEBLA_HASTA = 430;
const SUELO_M = 1600; // el plano del suelo que sigue al avatar
const RADIO_PARCELAS = 6; // se piden (2r+1)² parcelas alrededor: 13×13

const BLANCO = new THREE.Color(0xffffff);
const TRONCO = new THREE.Color(0x8a6b4f);
const VERDE = new THREE.Color(0x6faa6b);
const VERDE_PINO = new THREE.Color(0x4f8f5c);
const VERDE_ARBUSTO = new THREE.Color(0x7db473);
const TEJA = new THREE.Color(0xd9705a);
const MADERA = new THREE.Color(0x9a6b45);
const PIEDRA_C = new THREE.Color(0xc4beb0);
const AGUA = new THREE.Color(0x8ec3e0);
const POSTE = new THREE.Color(0x6b7480);
const LUZ = new THREE.Color(0xffe08a);
const MASTIL = new THREE.Color(0xe9e4d8);
const ARENA = new THREE.Color(0xe6d9b8);
const CRISTAL = new THREE.Color(0xbfe0f2);
const PIEL = new THREE.Color(0xf1c9a5);
const PELO = new THREE.Color(0x4a3728);
const OJO = new THREE.Color(0x2b3440);

const MAX_INST = 3000; // instancias por parte de pieza en el mundo cargado
const VELOCIDAD = 4.6; // m/s del avatar

// --- geometría low-poly con el sol horneado ---
// nx: componente este de la normal; nn: componente norte
function luzDe(nx, nn) {
  const luz = 0.5 + 0.5 * (nx * SOL_E + nn * SOL_N);
  return LUZ_SOMBRA + (1 - LUZ_SOMBRA) * luz;
}
// caja alineada a los ejes (x: este, z: sur), con tapa y sin fondo
function caja(g, x0, y0, z0, x1, y1, z1, color) {
  const { pos, col } = g;
  const lado = (ax, az, bx, bz, nx, nn) => {
    const s = luzDe(nx, nn);
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    for (let q = 0; q < 6; q++) col.push(color.r * s, color.g * s, color.b * s);
  };
  lado(x0, z1, x1, z1, 0, -1); // sur
  lado(x1, z1, x1, z0, 1, 0); // este
  lado(x1, z0, x0, z0, 0, 1); // norte
  lado(x0, z0, x0, z1, -1, 0); // oeste
  pos.push(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z0, x1, y1, z1, x0, y1, z1);
  for (let q = 0; q < 6; q++) col.push(color.r, color.g, color.b);
}
// prisma regular de n lados con tapa; r1 permite que el remate sea más
// estrecho que la base (r1 = 0 es un cono)
function prisma(g, n, r, y0, y1, color, r1 = r, cx = 0, cz = 0) {
  const { pos, col } = g;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const s = luzDe(Math.cos(am), Math.sin(am));
    const x0 = cx + Math.cos(a0) * r;
    const z0 = cz - Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const z1 = cz - Math.sin(a1) * r;
    const X0 = cx + Math.cos(a0) * r1;
    const Z0 = cz - Math.sin(a0) * r1;
    const X1 = cx + Math.cos(a1) * r1;
    const Z1 = cz - Math.sin(a1) * r1;
    pos.push(x0, y0, z0, x1, y0, z1, X1, y1, Z1, x0, y0, z0, X1, y1, Z1, X0, y1, Z0);
    for (let q = 0; q < 6; q++) col.push(color.r * s, color.g * s, color.b * s);
    if (r1 > 0) {
      pos.push(cx, y1, cz, X0, y1, Z0, X1, y1, Z1);
      for (let q = 0; q < 3; q++) col.push(color.r, color.g, color.b);
    }
  }
}
// copa octaédrica (árbol, arbusto)
function copa(g, hC, r, verde, cx = 0, cz = 0) {
  const { pos, col } = g;
  const eq = [
    [r, 0],
    [0, r],
    [-r, 0],
    [0, -r],
  ];
  const cara = (p1, p2, p3, s) => {
    pos.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
    for (let q = 0; q < 3; q++) col.push(verde.r * s, verde.g * s, verde.b * s);
  };
  const top = [cx, hC + r * 1.15, cz];
  const bot = [cx, hC - r * 0.85, cz];
  for (let i = 0; i < 4; i++) {
    const a = eq[i];
    const b = eq[(i + 1) % 4];
    const pa = [cx + a[0], hC, cz - a[1]];
    const pb = [cx + b[0], hC, cz - b[1]];
    cara(top, pa, pb, i % 2 ? 0.97 : 1.1);
    cara(bot, pb, pa, i % 2 ? 0.72 : 0.8);
  }
}
// tejado a cuatro aguas sobre un rectángulo: alero en y0, cumbrera (paralela
// a x, de -cr a cr) en y1
function tejado(g, x0, z0, x1, z1, y0, y1, cr, color) {
  const { pos, col } = g;
  const tri = (a, b, c, nx, nn) => {
    const s = 0.84 + 0.16 * luzDe(nx, nn);
    pos.push(...a, ...b, ...c);
    for (let q = 0; q < 3; q++) col.push(color.r * s, color.g * s, color.b * s);
  };
  const A = [x0, y0, z0];
  const B = [x1, y0, z0];
  const C = [x1, y0, z1];
  const D = [x0, y0, z1];
  const P = [-cr, y1, 0];
  const Q = [cr, y1, 0];
  tri(D, C, Q, 0, -1); // faldón sur
  tri(D, Q, P, 0, -1);
  tri(B, A, P, 0, 1); // faldón norte
  tri(B, P, Q, 0, 1);
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
// suelo, centrada, con el «frente» hacia el sur (+z) con giro 0.
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
    prisma(T, 8, 2.3, 0, 9, BLANCO);
    prisma(F, 8, 2.8, 9, 9.3, PIEDRA_C);
    prisma(F, 8, 2.8, 9.3, 13.5, TEJA, 0);
    caja(F, -0.5, 0, 2.15, 0.5, 2.1, 2.45, MADERA);
    caja(F, -0.45, 4, 2.2, 0.45, 5, 2.4, CRISTAL);
    caja(F, -0.45, 6.6, 2.2, 0.45, 7.6, 2.4, CRISTAL);
  } else if (tipo === 'arbol') {
    caja(F, -0.24, 0, -0.24, 0.24, 3.2, 0.24, TRONCO);
    copa(F, 4.8, 2.3, VERDE);
  } else if (tipo === 'pino') {
    caja(F, -0.2, 0, -0.2, 0.2, 2, 0.2, TRONCO);
    prisma(F, 6, 2.4, 1.6, 4.2, VERDE_PINO, 0.4);
    prisma(F, 6, 1.9, 3.6, 6.0, VERDE_PINO, 0.3);
    prisma(F, 6, 1.3, 5.4, 7.6, VERDE_PINO, 0);
  } else if (tipo === 'arbusto') {
    copa(F, 0.9, 1.3, VERDE_ARBUSTO);
    copa(F, 0.7, 0.9, VERDE_ARBUSTO, 1.1, 0.6);
    copa(F, 0.7, 0.9, VERDE_ARBUSTO, -0.9, -0.7);
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
      caja(F, x - 0.05, 0, z - 0.05, x + 0.05, 0.55, z + 0.05, VERDE);
      caja(T, x - 0.22, 0.5, z - 0.22, x + 0.22, 0.85, z + 0.22, BLANCO);
    }
  } else if (tipo === 'camino') {
    caja(F, -2, 0, -2, 2, 0.08, 2, ARENA);
  } else if (tipo === 'valla') {
    caja(F, -2, 0, -0.1, -1.8, 1.2, 0.1, MADERA);
    caja(F, 1.8, 0, -0.1, 2, 1.2, 0.1, MADERA);
    caja(F, -2, 0.35, -0.06, 2, 0.55, 0.06, MADERA);
    caja(F, -2, 0.85, -0.06, 2, 1.05, 0.06, MADERA);
  } else if (tipo === 'farola') {
    caja(F, -0.14, 0, -0.14, 0.14, 5.4, 0.14, POSTE);
    caja(F, -0.5, 5.2, -0.5, 0.5, 6.0, 0.5, LUZ);
  } else if (tipo === 'banco') {
    caja(F, -0.95, 0, -0.28, -0.75, 0.45, 0.28, POSTE);
    caja(F, 0.75, 0, -0.28, 0.95, 0.45, 0.28, POSTE);
    caja(F, -1, 0.45, -0.3, 1, 0.62, 0.3, MADERA);
    caja(F, -1, 0.62, -0.3, 1, 1.15, -0.18, MADERA); // respaldo al norte: se sienta mirando al sur
  } else if (tipo === 'fuente') {
    prisma(F, 8, 3.2, 0, 0.9, PIEDRA_C);
    prisma(F, 8, 2.9, 0.9, 1.0, AGUA);
    prisma(F, 6, 0.45, 1.0, 2.6, PIEDRA_C);
    prisma(F, 8, 1.3, 2.6, 2.9, PIEDRA_C);
    prisma(F, 8, 1.1, 2.9, 3.0, AGUA);
  } else if (tipo === 'bandera') {
    caja(F, -0.1, 0, -0.1, 0.1, 7.5, 0.1, MASTIL);
    T.pos.push(0.1, 7.4, 0, 0.1, 6.2, 0, 2.6, 6.8, 0);
    for (let q = 0; q < 3; q++) T.col.push(1, 1, 1);
  }
  return { tinte: aGeo(T), fijo: aGeo(F) };
}

// El avatar: cuerpo del color del jugador, cabeza, pelo y ojos mirando al
// frente (+z). Las piernas van aparte para poder moverlas.
function geometriaAvatar(color) {
  const g = { pos: [], col: [] };
  caja(g, -0.45, 0.9, -0.25, 0.45, 1.9, 0.25, color); // cuerpo
  caja(g, -0.62, 1.0, -0.14, -0.46, 1.8, 0.14, color); // brazos
  caja(g, 0.46, 1.0, -0.14, 0.62, 1.8, 0.14, color);
  caja(g, -0.36, 1.9, -0.36, 0.36, 2.6, 0.36, PIEL); // cabeza
  caja(g, -0.4, 2.45, -0.4, 0.4, 2.72, 0.4, PELO); // pelo
  caja(g, -0.4, 2.0, -0.4, 0.4, 2.5, -0.3, PELO); // nuca
  caja(g, -0.2, 2.2, 0.36, -0.1, 2.32, 0.4, OJO); // ojos
  caja(g, 0.1, 2.2, 0.36, 0.2, 2.32, 0.4, OJO);
  return aGeo(g);
}
function geometriaPierna() {
  const g = { pos: [], col: [] };
  caja(g, -0.16, -0.9, -0.16, 0.16, 0, 0.16, POSTE);
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
    scene.fog = new THREE.Fog(CIELO_HORIZONTE, NIEBLA_DESDE, NIEBLA_HASTA);

    // --- suelo: hierba con la trama de parcelas, que sigue al avatar ---
    // Una textura de UNA parcela repetida. El plano se mueve a saltos de una
    // parcela para que la trama no resbale.
    const texSuelo = (() => {
      const S = 256;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d');
      c.fillStyle = HIERBA;
      c.fillRect(0, 0, S, S);
      const rnd = prng(7);
      c.fillStyle = HIERBA_OSCURA;
      for (let i = 0; i < 140; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        c.fillRect(x, y, 2 + rnd() * 3, 2 + rnd() * 3);
      }
      c.strokeStyle = 'rgba(120, 160, 100, 0.55)';
      c.lineWidth = 2;
      c.strokeRect(0, 0, S, S);
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(SUELO_M / L, SUELO_M / L);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    })();
    const suelo = new THREE.Mesh(new THREE.PlaneGeometry(SUELO_M, SUELO_M), new THREE.MeshBasicMaterial({ map: texSuelo }));
    suelo.rotation.x = -Math.PI / 2;
    scene.add(suelo);

    // --- cámara: tercera persona alrededor del avatar ---
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
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
        // hace falta tocar instanceColor una vez para que exista
        par.tinte.setColorAt(0, BLANCO);
        grupoPiezas.add(par.tinte);
      }
      mallas[t] = par;
    }
    const coloresTinte = COLORES.map((h) => new THREE.Color(h));

    // --- parcelas: marco de dueño y suelo de plaza ---
    const texMarco = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 5;
      c.strokeRect(3, 3, 250, 250);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const geoParcela = new THREE.PlaneGeometry(L, L);
    geoParcela.rotateX(-Math.PI / 2);
    const MAX_PARC = (RADIO_PARCELAS * 2 + 3) ** 2;
    const marcos = new THREE.InstancedMesh(
      geoParcela,
      new THREE.MeshBasicMaterial({ map: texMarco, transparent: true, depthWrite: false }),
      MAX_PARC
    );
    marcos.count = 0;
    marcos.frustumCulled = false;
    marcos.setColorAt(0, BLANCO);
    marcos.renderOrder = 1;
    scene.add(marcos);
    const plazas = new THREE.InstancedMesh(geoParcela, new THREE.MeshBasicMaterial({ color: PIEDRA }), MAX_PARC);
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
    const marcoObra = new THREE.Mesh(geoParcela, new THREE.MeshBasicMaterial({ map: texObra, transparent: true, depthWrite: false }));
    marcoObra.position.y = 0.15;
    marcoObra.renderOrder = 2;
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
    const ejeY = new THREE.Vector3(0, 1, 0);
    const colorMio = new THREE.Color(0x2f6fed);
    const cacheColorDueno = new Map();

    // Rehace TODAS las instancias: son cientos o pocos miles, y es más barato
    // que llevar la cuenta de qué instancia era de qué parcela.
    function pintaMundo() {
      const cont = {};
      for (const t in mallas) cont[t] = 0;
      let nMarcos = 0;
      let nPlazas = 0;
      for (const [clave, pc] of parcelas) {
        const p = parseParcela(clave);
        if (!p) continue;
        const bx = p.px * L;
        const by = p.py * L;
        const cen = centroParcela(p.px, p.py);
        if (pc.o === 'mundo') {
          if (nPlazas < MAX_PARC) {
            mtx.makeTranslation(cen.x, 0.02, -cen.y);
            plazas.setMatrixAt(nPlazas++, mtx);
          }
        } else if (pc.o && nMarcos < MAX_PARC) {
          mtx.makeTranslation(cen.x, 0.05, -cen.y);
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
          posI.set(bx + z.x, 0, -(by + z.y));
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
    }

    // --- el avatar propio ---
    const avatar = new THREE.Group();
    const cuerpo = new THREE.Mesh(geometriaAvatar(coloresTinte[jugador.color]), matFijo);
    const geoPierna = geometriaPierna();
    const piernaI = new THREE.Mesh(geoPierna, matFijo);
    const piernaD = new THREE.Mesh(geoPierna, matFijo);
    piernaI.position.set(-0.22, 0.9, 0);
    piernaD.position.set(0.22, 0.9, 0);
    avatar.add(cuerpo, piernaI, piernaD);
    scene.add(avatar);
    // posición en metros del mundo (y hacia el norte); rumbo en radianes
    const yo = { x: L / 2, y: L / 2 - 12, rumbo: 0, destino: null, fase: 0, andando: false };
    const px0 = parseFloat(params.get('x'));
    const py0 = parseFloat(params.get('y'));
    if (Number.isFinite(px0) && Number.isFinite(py0)) {
      yo.x = px0;
      yo.y = py0;
    }
    function colocaAvatar(grupo, e, pi, pd, o) {
      grupo.position.set(o.x, o.andando ? Math.abs(Math.sin(o.fase)) * 0.08 : 0, -o.y);
      grupo.rotation.y = o.rumbo;
      const a = o.andando ? Math.sin(o.fase) * 0.65 : 0;
      pi.rotation.x = a;
      pd.rotation.x = -a;
    }

    // Cámara inicial: al sur del avatar, mirando al norte. Reproducible desde
    // la URL (?d=&pol=&az=) para el banco visual: az es el rumbo desde el
    // avatar hacia la cámara (180 = la cámara está al sur).
    controls.target.set(yo.x, 1.2, -yo.y);
    {
      const dCam = parseFloat(params.get('d'));
      const polCam = parseFloat(params.get('pol'));
      const azCam = parseFloat(params.get('az'));
      const d = dCam > 0 ? dCam : 22;
      const pol = (Number.isFinite(polCam) ? Math.max(9, Math.min(83, polCam)) : 58) * (Math.PI / 180);
      const az = (Number.isFinite(azCam) ? azCam : 180) * (Math.PI / 180);
      const r = d * Math.sin(pol);
      camera.position.set(yo.x + r * Math.sin(az), 1.2 + d * Math.cos(pol), -yo.y - r * Math.cos(az));
    }

    // --- otros jugadores ---
    const otros = new Map(); // id → {grupo, pi, pd, o: {x, y, rumbo, ...}, objetivo, nombre, visto}
    const nodos = new Map(); // id → <div> del nombre
    function creaOtro(id, datos) {
      const grupo = new THREE.Group();
      const c = new THREE.Mesh(geometriaAvatar(coloresTinte[datos.c] || coloresTinte[0]), matFijo);
      const pi = new THREE.Mesh(geoPierna, matFijo);
      const pd = new THREE.Mesh(geoPierna, matFijo);
      pi.position.set(-0.22, 0.9, 0);
      pd.position.set(0.22, 0.9, 0);
      grupo.add(c, pi, pd);
      scene.add(grupo);
      const o = { grupo, cuerpo: c, pi, pd, color: datos.c, nombre: datos.n, visto: Date.now(),
        o: { x: datos.x, y: datos.y, rumbo: datos.r, fase: 0, andando: false }, objetivo: { x: datos.x, y: datos.y, rumbo: datos.r } };
      otros.set(id, o);
      return o;
    }
    function quitaOtro(id) {
      const o = otros.get(id);
      if (!o) return;
      scene.remove(o.grupo);
      o.cuerpo.geometry.dispose();
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
      const pinta = (id, nombre, x, y, propio) => {
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
        pv.set(x, 3.1, -y);
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
      if (yoP.nombre) pinta('yo', yoP.nombre, yo.x, yo.y, true);
      for (const [id, o] of otros) pinta(id, o.nombre, o.o.x, o.o.y, false);
    }

    // --- conversiones y toques ---
    const ndc = new THREE.Vector2();
    const rayo = new THREE.Raycaster();
    const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pSuelo = new THREE.Vector3();
    function sueloEn(sx, sy) {
      ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
      rayo.setFromCamera(ndc, camera);
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

    engineRef.current = {
      // ¿Puedo construir aquí? Devuelve el nº de piezas de la parcela
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
        marcoObra.position.set(c.x, 0.15, -c.y);
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
        const dx = c.x - yo.x;
        const dy = c.y - 12 - yo.y;
        yo.x += dx;
        yo.y += dy;
        yo.destino = null;
        camera.position.x += dx;
        camera.position.z -= dy;
        controls.target.x += dx;
        controls.target.z -= dy;
        actualizaDonde(false);
        traeParcelas(true);
      },
      // el avatar cambia de color al cambiar el perfil
      recolorea(c) {
        cuerpo.geometry.dispose();
        cuerpo.geometry = geometriaAvatar(coloresTinte[c] || coloresTinte[0]);
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
      colocaAvatar(avatar, null, piernaI, piernaD, yo);

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
        colocaAvatar(o.grupo, null, o.pi, o.pd, s);
      }

      // el suelo sigue al avatar a saltos de parcela: la trama no resbala
      suelo.position.x = Math.round(yo.x / L) * L;
      suelo.position.z = -Math.round(yo.y / L) * L;

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
        if (sinPos && j.yo && Number.isFinite(j.yo.x)) {
          const dx = j.yo.x - yo.x;
          const dy = j.yo.y - yo.y;
          yo.x += dx;
          yo.y += dy;
          camera.position.x += dx;
          camera.position.z -= dy;
          controls.target.x += dx;
          controls.target.z -= dy;
        }
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
      marcos.dispose();
      marcos.material.dispose();
      plazas.dispose();
      plazas.material.dispose();
      geoParcela.dispose();
      marcoObra.material.dispose();
      texMarco.dispose();
      texObra.dispose();
      cuerpo.geometry.dispose();
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

      <button
        className="ui btn-cuad b-info"
        aria-label="Cómo funciona"
        onClick={() => setInfoOpen((v) => !v)}
      >
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
