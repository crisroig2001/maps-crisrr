'use client';

// El mundo: colinas suaves e infinitas divididas en parcelas, avatares que
// andan por ellas y parcelas que cada jugador construye con piezas. Look de
// tarde de verano, con la misma receta que las demos de referencia: un sol
// (luz direccional cálida con sombras proyectadas), un cielo (luz hemisférica
// fría desde arriba y verdosa desde abajo) y materiales TOON con rampa, así
// que la luz cae a escalones y la sombra sale azulada sin pintar nada a mano.
// Encima, sombras de nubes que cruzan el suelo y hierba que se mece. El
// relieve lo pone el vertex shader con la misma función de altura que usa el
// JS para colocar cosas encima. Las piezas van INSTANCIADAS: un draw call por
// tipo de pieza sean 3 o 3.000.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARCELA_M, parcelaDe, claveParcela, parseParcela, centroParcela } from '../lib/parcela';
import { PIEZAS, CATEGORIAS, COLORES, MAX_PIEZAS, MAX_NOMBRE } from '../lib/piezas';
import { perfil, guardaPerfil } from '../lib/jugador';
import { tipoParcela, conSuelo, cauce, distRio, rioEsteX as rioEsteXEnEscena, rioSurY as rioSurYEnEscena, GLSL_CAUCE, RIO_ANCHO, NIVEL_AGUA, LECHO, BANDA_AGUA } from '../lib/paisaje';
const LECHO_G = LECHO.toFixed(1);

const L = PARCELA_M;

// --- el sol y el look ---
// Sol de tarde, bajo y del suroeste (x: este, z: sur). Las sombras caen hacia
// el noreste. El color de la luz es cálido y el del cielo frío: es lo que
// hace que lo iluminado salga dorado y la sombra azulada, como en un cuadro.
const SOL = new THREE.Vector3(-0.5, 0.72, 0.55).normalize();
const SOL_COLOR = 0xffe3bd;
const SOL_FUERZA = 2.9;
const CIELO_LUZ = 0xa9c6ff; // luz hemisférica: desde arriba
const SUELO_LUZ = 0x7f8f6e; // ... y rebotada desde la hierba
const HEMI_FUERZA = 1.55;
// El cielo, como en la referencia: azul intenso en lo alto, celeste pálido
// en el horizonte, cúmulos cremosos pintados sobre él y una calima
// blanquecina a ras de horizonte. La niebla NO tiñe de un color: a lo lejos
// las cosas pierden saturación y se aclaran (se mezcla en HSV), así el
// verde lejano sigue siendo verde, solo más pálido.
const CIELO_CENIT = 0x248fd5;
const CIELO_HORIZONTE = 0xcaf0fe;
const CIELO_CALIMA = 0xd8eeff;
const CIELO_NUBES = 0xffe5c4;
const NIEBLA = 0xd8eeff;
const NIEBLA_DESDE = 60;
const NIEBLA_HASTA = 380;
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
const VELOCIDAD = 3.8; // m/s del avatar
const CADENCIA = 12.5; // rad/s de la zancada: con VELOCIDAD da un paso de ~0,95 m

// --- terreno: colinas suaves, la MISMA función en JS y en GLSL ---
// Amplitud pequeña y ondas largas: una parcela de 48 m nunca tiene más de
// medio metro de desnivel, que es lo que aguanta una casa sin flotar.
const ONDAS = [
  [1.0, 0.021, 0.013, 0.0],
  [0.7, 0.009, -0.027, 1.3],
  [0.35, 0.047, 0.041, 2.1],
];
// Las colinas van 1,2 m por encima de cero: así ningún valle baja del nivel
// del agua y los ríos son los únicos sitios con agua. Junto al río, el
// terreno se mezcla con el lecho según el factor de cauce.
function alturaEn(x, y) {
  let h = 1.2;
  for (const [a, kx, ky, f] of ONDAS) h += a * Math.sin(x * kx + y * ky + f);
  const c = cauce(x, y);
  return c > 0 ? h + (LECHO - h) * c : h;
}
// p = xz del mundo (z = -norte). dAltura da la pendiente (dh/dx, dh/dz) para
// sacar la normal del terreno en el shader, que es lo que la luz necesita.
const GLSL_ALTURA = GLSL_CAUCE + `
float altura(vec2 p) {
  float y = -p.y;
  float h = 1.2 + 1.0 * sin(p.x * 0.021 + y * 0.013) + 0.7 * sin(p.x * 0.009 - y * 0.027 + 1.3) + 0.35 * sin(p.x * 0.047 + y * 0.041 + 2.1);
  return mix(h, ${LECHO_G}, cauce(p.x, y));
}
// pendiente por diferencias finitas (con el cauce ya no sale analítica)
vec2 dAltura(vec2 p) {
  float e = 0.6;
  float dx = (altura(p + vec2(e, 0.0)) - altura(p - vec2(e, 0.0))) / (2.0 * e);
  float dz = (altura(p + vec2(0.0, e)) - altura(p - vec2(0.0, e))) / (2.0 * e);
  return vec2(dx, dz);
}`;
const uTiempo = { value: 0 };
const uNubes = { value: null }; // textura de sombras de nubes (se crea en el efecto)
const uAvatar = { value: new THREE.Vector3() }; // dónde está el avatar: la hierba se aparta

// ruido de valor 2D: para variar el verde del suelo sin textura
const GLSL_RUIDO = `
float hash21(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float ruido(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}`;
const GLSL_HSV = `
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}`;
// La niebla de la referencia: con la distancia el color pierde saturación
// y sube de valor hacia el tono del horizonte, en vez de fundirse a un
// color plano. Se aplica donde three aplica la suya (ya en espacio de
// pantalla, después del tone mapping), así que sustituye a ese trozo.
// Antes, un revelado ligero (la referencia lo hace con una LUT): un poco
// más de saturación y de contraste, que el tone mapping se come.
const GLSL_NIEBLA = `
  {
    vec3 gc = gl_FragColor.rgb;
    float gl = dot(gc, vec3(0.2125, 0.7154, 0.0721));
    gc = mix(vec3(gl), gc, 1.18);
    gc = (gc - 0.5) * 1.06 + 0.5;
    gl_FragColor.rgb = clamp(gc, 0.0, 1.0);
  }
#ifdef USE_FOG
  float nieblaF = smoothstep(fogNear, fogFar, vFogDepth);
  vec3 nHSV = rgb2hsv(gl_FragColor.rgb);
  nHSV.z = mix(nHSV.z, 0.88, nieblaF);
  nHSV.y = mix(nHSV.y, 0.12, nieblaF);
  gl_FragColor.rgb = mix(hsv2rgb(nHSV), fogColor, nieblaF * nieblaF * 0.5);
#endif`;
function parcheaNiebla(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n' + GLSL_HSV).replace('#include <fog_fragment>', GLSL_NIEBLA);
}
// para los materiales que no llevan otro parche
function conNiebla(mat) {
  mat.onBeforeCompile = (sh) => parcheaNiebla(sh);
  mat.customProgramCacheKey = () => 'niebla';
  return mat;
}

// Parchea un material para que el vertex shader suba cada vértice a la
// altura del terreno bajo su posición de MUNDO (sirve con instancias).
//   normales: la normal pasa a ser la de la colina (suelo, plazas)
//   tinta: el suelo se aclara en lo alto y se oscurece en lo bajo
//   nubes: sombras de nubes cruzando (suelo y hierba): dos capas de manchas
//          que van cada una por su lado, y solo donde coinciden hay sombra
//   viento: hierba: se mece con el tiempo, más cuanto más arriba del tallo,
//          y se aparta del avatar cuando pasa
//   cesped: el verde del suelo se calcula aquí con ruido a varias escalas
//          (dos verdes a manchas grandes, calvas más claras y matas más
//          oscuras), como el terreno de la referencia
function conAltura(mat, { tinta = false, viento = false, normales = false, nubes = false, cesped = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tiempo = uTiempo;
    sh.uniforms.tNubes = uNubes;
    sh.uniforms.uAvatar = uAvatar;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_ALTURA + '\nuniform float tiempo;\nuniform vec3 uAvatar;\nvarying float vAltura;\nvarying vec2 vMundoXZ;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        ${
          normales
            ? `#ifdef USE_INSTANCING
                 vec4 wposN = modelMatrix * instanceMatrix * vec4(position, 1.0);
               #else
                 vec4 wposN = modelMatrix * vec4(position, 1.0);
               #endif
               vec2 dN = dAltura(wposN.xz);
               objectNormal = normalize(vec3(-dN.x, 1.0, -dN.y));`
            : ''
        }`
      )
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
        vMundoXZ = wpos.xz;
        ${
          viento
            ? `transformed.x += sin(tiempo * 1.6 + wpos.x * 0.35 + wpos.z * 0.21) * 0.16 * position.y;
               transformed.z += cos(tiempo * 1.3 + wpos.x * 0.17 - wpos.z * 0.3) * 0.08 * position.y;
               vec2 dAv = wpos.xz - uAvatar.xz;
               float lAv = length(dAv);
               transformed.xz += (dAv / max(lAv, 0.001)) * (1.0 - smoothstep(0.15, 1.0, lAv)) * 0.45 * position.y;`
            : ''
        }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float tiempo;\nuniform sampler2D tNubes;\nvarying float vAltura;\nvarying vec2 vMundoXZ;' + (cesped ? GLSL_RUIDO : ''))
      // la hierba es de doble cara y three le da la vuelta a la normal en
      // la cara trasera: la mitad de cada mata salía a oscuras. La normal
      // se queda mirando arriba, se vea por donde se vea.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + (viento ? '\nnormal = normalize(vNormal);' : ''))
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${
          cesped
            ? `float rA = ruido(vMundoXZ * 0.03);
               float rB = ruido(vMundoXZ * 0.11 + 7.3);
               float rC = ruido(vMundoXZ * 0.35 + 3.1);
               float rD = ruido(vMundoXZ * 0.19 + 11.0);
               vec3 cesped = mix(vec3(0.27, 0.55, 0.15), vec3(0.36, 0.60, 0.17), rA);
               cesped = mix(cesped, vec3(0.47, 0.70, 0.22), smoothstep(0.55, 0.8, rC) * smoothstep(0.35, 0.7, rB));
               cesped = mix(cesped, vec3(0.20, 0.45, 0.13), smoothstep(0.6, 0.85, rD) * 0.6);
               diffuseColor.rgb *= cesped;`
            : ''
        }
        ${tinta ? 'diffuseColor.rgb *= mix(vec3(0.86, 0.93, 0.8), vec3(1.06, 1.04, 0.92), clamp((vAltura - 0.2) / 3.0, 0.0, 1.0)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.72, 0.55), clamp((-0.2 - vAltura) / 2.0, 0.0, 1.0));' : ''}
        ${
          nubes
            ? `float nb1 = texture2D(tNubes, vMundoXZ / 380.0 + vec2(tiempo * 0.0035, tiempo * 0.0018)).r;
               float nb2 = texture2D(tNubes, vMundoXZ / 260.0 + vec2(19.3 - tiempo * 0.0021, tiempo * 0.0029)).r;
               diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.15, 0.85, nb1 * nb2));`
            : ''
        }`
      );
    parcheaNiebla(sh);
  };
  mat.customProgramCacheKey = () => 'altura' + (tinta ? 't' : '') + (viento ? 'v' : '') + (normales ? 'n' : '') + (nubes ? 'c' : '') + (cesped ? 'g' : '');
  return mat;
}
// Las copas se mecen: un vaivén lento proporcional a la altura sobre el
// suelo, en el espacio de la pieza (así gira con ella).
function conViento(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tiempo = uTiempo;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float tiempo;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wv = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 wv = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float alto = smoothstep(1.5, 6.0, position.y);
        transformed.x += sin(tiempo * 1.1 + wv.x * 0.2 + wv.z * 0.15) * 0.18 * alto;
        transformed.z += cos(tiempo * 0.9 + wv.x * 0.12 - wv.z * 0.2) * 0.12 * alto;`
      );
    parcheaNiebla(sh);
  };
  mat.customProgramCacheKey = () => 'viento';
  return mat;
}

// --- geometría low-poly con normales ---
// Cada vértice lleva su color (albedo) y su normal; la luz la ponen las
// luces de la escena y la rampa toon, no el JS. Las cajas y prismas llevan
// la normal de la cara (planos duros); las esferas, la de la esfera (suave).
function nuevaGeo() {
  return { pos: [], col: [], nor: [] };
}
function vert(g, color, nx, ny, nz) {
  g.col.push(color.r, color.g, color.b);
  g.nor.push(nx, ny, nz);
}
// caja alineada a los ejes (x: este, z: sur), con tapa y sin fondo
function caja(g, x0, y0, z0, x1, y1, z1, color) {
  const { pos } = g;
  const lado = (ax, az, bx, bz, nx, nz) => {
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    for (let q = 0; q < 6; q++) vert(g, color, nx, 0, nz);
  };
  lado(x0, z1, x1, z1, 0, 1); // sur
  lado(x1, z1, x1, z0, 1, 0); // este
  lado(x1, z0, x0, z0, 0, -1); // norte
  lado(x0, z0, x0, z1, -1, 0); // oeste
  pos.push(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z0, x1, y1, z1, x0, y1, z1);
  for (let q = 0; q < 6; q++) vert(g, color, 0, 1, 0);
}
// prisma regular de n lados con tapa; r1 permite que el remate sea más
// estrecho que la base (r1 = 0 es un cono)
function prisma(g, n, r, y0, y1, color, r1 = r, cx = 0, cz = 0) {
  const { pos } = g;
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
    for (let q = 0; q < 6; q++) vert(g, color, nx, ny, nz);
    if (r1 > 0) {
      pos.push(cx, y1, cz, X0, y1, Z0, X1, y1, Z1);
      for (let q = 0; q < 3; q++) vert(g, color, 0, 1, 0);
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
    vert(g, color, n[i], n[i + 1], n[i + 2]);
  }
}
// tejado a cuatro aguas sobre un rectángulo: alero en y0, cumbrera (paralela
// a x, de -cr a cr) en y1
function tejado(g, x0, z0, x1, z1, y0, y1, cr, color) {
  const { pos } = g;
  const tri = (a, b, c, nx, nz) => {
    pos.push(...a, ...b, ...c);
    for (let q = 0; q < 3; q++) vert(g, color, nx * 0.7, 0.7, nz * 0.7);
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
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
  return geo;
}

// Las piezas SIN modelo glTF (torre, farola, fuente, bandera) son dos
// geometrías generadas: la que se TIÑE del color elegido (el color de
// vértice es blanco: solo la luz) y la fija. Origen en el suelo, centrada,
// con el «frente» hacia el sur (+z) con giro 0.
const CON_VIENTO = new Set(['bandera']);
function geometriaPieza(tipo) {
  const T = nuevaGeo(); // tinte
  const F = nuevaGeo(); // fijo
  if (tipo === 'torre') {
    prisma(T, 12, 2.3, 0, 9, BLANCO);
    prisma(F, 12, 2.8, 9, 9.3, PIEDRA_C);
    prisma(F, 12, 2.8, 9.3, 13.5, TEJA, 0);
    caja(F, -0.5, 0, 2.15, 0.5, 2.1, 2.45, MADERA);
    caja(F, -0.45, 4, 2.2, 0.45, 5, 2.4, CRISTAL);
    caja(F, -0.45, 6.6, 2.2, 0.45, 7.6, 2.4, CRISTAL);
  } else if (tipo === 'farola') {
    prisma(F, 6, 0.16, 0, 5.4, POSTE, 0.12);
    esfera(F, 0, 5.6, 0, 0.55, LUZ, 0.9, 8);
  } else if (tipo === 'fuente') {
    prisma(F, 12, 3.2, 0, 0.9, PIEDRA_C);
    prisma(F, 12, 2.9, 0.9, 1.0, AGUA);
    prisma(F, 8, 0.45, 1.0, 2.6, PIEDRA_C);
    prisma(F, 12, 1.3, 2.6, 2.9, PIEDRA_C);
    prisma(F, 12, 1.1, 2.9, 3.0, AGUA);
  } else if (tipo === 'bandera') {
    prisma(F, 6, 0.1, 0, 7.5, MASTIL, 0.07);
    T.pos.push(0.1, 7.4, 0, 0.1, 6.2, 0, 2.6, 6.8, 0);
    for (let q = 0; q < 3; q++) vert(T, BLANCO, 0, 0, 1);
  }
  return { tinte: aGeo(T), fijo: aGeo(F) };
}

// El avatar: cuerpo redondo del color del jugador, cabeza, pelo y ojos
// mirando al frente (+z). Las piernas van aparte para poder moverlas.
//
// Mide ALTO_AVATAR de la planta al pelo. Las piezas están a escala de verdad
// (las casas miden de 6,4 a 8,8 m de alto, los árboles de 8 a 10, la puerta
// de una casa 2), así que un avatar de 2,8 m las encogía: parecían casitas de
// juguete. Las proporciones del muñeco no cambian —sigue siendo cabezón, de
// dibujo—, solo su tamaño. Todo lo que va con él (el salto al andar, la
// altura a la que mira la cámara, el rótulo del nombre, el radio con que
// choca) sale de aquí.
const ALTO_AVATAR = 1.8;
function geometriaAvatar(color) {
  const g = nuevaGeo();
  esfera(g, 0, 0.96, 0, 0.24, color, 1.4); // cuerpo
  esfera(g, -0.32, 0.96, 0, 0.1, color, 1.9); // brazos
  esfera(g, 0.32, 0.96, 0, 0.1, color, 1.9);
  esfera(g, 0, 1.5, 0, 0.27, PIEL); // cabeza
  esfera(g, 0, 1.6, -0.04, 0.28, PELO, 0.75); // pelo
  esfera(g, -0.1, 1.51, 0.23, 0.04, OJO, 1, 6); // ojos
  esfera(g, 0.1, 1.51, 0.23, 0.04, OJO, 1, 6);
  return aGeo(g);
}
function geometriaPierna() {
  const g = nuevaGeo();
  esfera(g, 0, -0.29, 0, 0.12, PANTALON, 2.6, 6);
  return aGeo(g);
}
// una nube: varias esferas aplastadas, blancas arriba y lavanda abajo
function geometriaNube(rnd) {
  const g = nuevaGeo();
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

// Los verdes del Nature Kit tiran a menta y turquesa; el mundo de la
// referencia es todo verde hierba, con el follaje en la familia del suelo.
// Así que los verdes azulados del follaje se llevan a ese tono (los demás
// colores, tal cual).
function acercaVerde(c) {
  const hsl = {};
  c.getHSL(hsl);
  if (hsl.h > 0.36 && hsl.h < 0.52 && hsl.s > 0.2) c.setHSL(hsl.h - 0.11, hsl.s * 0.9, hsl.l * 0.98);
  return c;
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
  const [cat, setCat] = useState('casas');
  // el panel de piezas: en pantalla estrecha es una hoja abajo que se pliega
  const [panelAbierto, setPanelAbierto] = useState(true);
  const [estrecho, setEstrecho] = useState(false);
  const [tinte, setTinte] = useState(2);
  const [cargando, setCargando] = useState(true);
  const [tactil, setTactil] = useState(false);
  const joyRef = useRef(null);
  const joyKnobRef = useRef(null);

  function avisa(msg) {
    setToast({ msg, on: true });
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast((t) => ({ ...t, on: false })), 3200);
  }

  useEffect(() => {
    const p = perfil();
    setYo({ ...p });
    setColorElegido(p.color);
    try {
      setTactil(window.matchMedia('(pointer: coarse)').matches);
    } catch {}
    const mide = () => setEstrecho(window.innerWidth < 720);
    mide();
    window.addEventListener('resize', mide);
    return () => window.removeEventListener('resize', mide);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  // --- joystick táctil: se arrastra el pomo y el avatar anda hacia allí ---
  function joyPos(e) {
    const base = joyRef.current;
    if (!base) return { x: 0, y: 0 };
    const r = base.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / (R * 0.75);
    let dy = (e.clientY - (r.top + R)) / (R * 0.75);
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    return { x: dx, y: dy };
  }
  function joyAplica(v) {
    const knob = joyKnobRef.current;
    if (knob) knob.style.transform = 'translate(' + (v.x * 34).toFixed(1) + 'px,' + (v.y * 34).toFixed(1) + 'px)';
    engineRef.current?.joystick(v.x, -v.y); // arriba en pantalla = adelante
  }
  function onJoyDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    joyAplica(joyPos(e));
  }
  function onJoyMove(e) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    joyAplica(joyPos(e));
  }
  function onJoyUp(e) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    joyAplica({ x: 0, y: 0 });
  }

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    const params = new URLSearchParams(window.location.search);
    const jugador = perfil();

    // --- escena, cielo y niebla ---
    const scene = new THREE.Scene();
    // Una cúpula que va con la cámara, pintada en el shader como la de la
    // referencia: degradado de horizonte a cenit, una banda de cúmulos
    // (textura de una franja, pintada aquí) que gira muy despacio, y la
    // calima blanquecina a ras de horizonte. Sin tone mapping: el cielo
    // sale con los colores que se le dan.
    const texNubesCielo = (() => {
      const W = 1024;
      const H = 256;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = '#000';
      c.fillRect(0, 0, W, H);
      const rnd = prng(5);
      // cada cúmulo: un montón de bolas solapadas sobre una base a ras del
      // horizonte; primero las sombras grises (más abajo), luego el blanco
      const cumulos = [];
      for (let i = 0; i < 9; i++) {
        const x = rnd() * W;
        const ancho = 70 + rnd() * 150;
        const alto = 40 + rnd() * 70;
        const bolas = [];
        const n = 10 + Math.floor(rnd() * 10);
        for (let j = 0; j < n; j++) {
          const u = (rnd() - 0.5) * 2;
          const r = 14 + rnd() * 26;
          bolas.push({ x: x + u * ancho * 0.5, y: H - 8 - Math.abs(rnd() * alto * (1 - u * u * 0.6)), r });
        }
        cumulos.push(bolas);
      }
      const pinta = (color, dy, esc) => {
        for (const bolas of cumulos) {
          for (const b of bolas) {
            for (const ox of [0, W, -W]) {
              const g = c.createRadialGradient(b.x + ox, b.y + dy, b.r * esc * 0.7, b.x + ox, b.y + dy, b.r * esc);
              g.addColorStop(0, color);
              g.addColorStop(1, 'rgba(0,0,0,0)');
              c.fillStyle = g;
              c.beginPath();
              c.arc(b.x + ox, b.y + dy, b.r * esc, 0, Math.PI * 2);
              c.fill();
            }
          }
        }
      };
      pinta('rgba(140,140,140,1)', 6, 1.08);
      pinta('rgba(255,255,255,1)', 0, 1);
      // la base de todos los cúmulos se funde con la calima del horizonte
      const base = c.createLinearGradient(0, H - 26, 0, H);
      base.addColorStop(0, 'rgba(255,255,255,0)');
      base.addColorStop(1, 'rgba(255,255,255,0.75)');
      c.fillStyle = base;
      c.fillRect(0, H - 26, W, 26);
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      return tex;
    })();
    const matCielo = new THREE.ShaderMaterial({
      uniforms: {
        tiempo: uTiempo,
        tNubes: { value: texNubesCielo },
        cCenit: { value: new THREE.Color(CIELO_CENIT) },
        cHorizonte: { value: new THREE.Color(CIELO_HORIZONTE) },
        cCalima: { value: new THREE.Color(CIELO_CALIMA) },
        cNubes: { value: new THREE.Color(CIELO_NUBES) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position; // la esfera está centrada en la cámara: la posición ES la dirección
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float tiempo;
        uniform sampler2D tNubes;
        uniform vec3 cCenit;
        uniform vec3 cHorizonte;
        uniform vec3 cCalima;
        uniform vec3 cNubes;
        varying vec3 vDir;
        float ajusta(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }
        void main() {
          vec3 d = normalize(vDir);
          float t = ajusta(d.y, -0.2, 0.35);
          t = t < 0.5 ? 2.0 * t * t : -1.0 + (4.0 - 2.0 * t) * t;
          vec3 color = mix(cHorizonte, cCenit, t);
          // los cúmulos: la franja va del horizonte a unos 18 grados, y gira
          float v = ajusta(d.y, -0.03, 0.32);
          float u = atan(d.z, d.x) / 6.2831853 * 2.0 + tiempo * 0.0012;
          u += sin(v * 7.0 + tiempo * 0.03) * 0.004;
          float limites = smoothstep(0.0, 0.03, v) * smoothstep(1.0, 0.97, v);
          float nubes = texture2D(tNubes, vec2(u, v)).r * limites;
          float e = 1.0 - nubes;
          nubes = 1.0 - e * e * e;
          color = mix(color, cNubes, nubes);
          color = mix(color, cCalima, ajusta(d.y, 0.06, -0.04));
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const cielo = new THREE.Mesh(new THREE.SphereGeometry(1000, 40, 20), matCielo);
    cielo.frustumCulled = false;
    cielo.renderOrder = -1000;
    scene.add(cielo);
    scene.fog = new THREE.Fog(NIEBLA, NIEBLA_DESDE, NIEBLA_HASTA);

    // --- luces: el sol y el cielo ---
    scene.add(new THREE.HemisphereLight(CIELO_LUZ, SUELO_LUZ, HEMI_FUERZA));
    // El sol sigue al avatar: su cámara de sombras es una caja de 150 m
    // alrededor de él, con 2048 px → 7 cm por téxel, y sombras nítidas.
    const sol = new THREE.DirectionalLight(SOL_COLOR, SOL_FUERZA);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    Object.assign(sol.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 20, far: 420 });
    sol.shadow.bias = -0.0003;
    sol.shadow.normalBias = 0.5;
    scene.add(sol);
    scene.add(sol.target);
    function sigueElSol(x, h, y) {
      sol.target.position.set(x, h, -y);
      sol.position.copy(sol.target.position).addScaledVector(SOL, 200);
    }

    // --- rampa toon: la luz cae a escalones ---
    // Como las rampas pintadas de la referencia: casi todo son DOS tonos con
    // un corte duro justo donde la cara deja de mirar al sol (t = 0,5 es la
    // cara de canto), y un tercer escalón, apenas más claro, en lo que mira
    // al sol de frente. La sombra no es negra: el cielo (luz hemisférica)
    // la rellena de azul.
    const rampa = (() => {
      const n = 64;
      const d = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const v = t < 0.53 ? 0.16 : t < 0.9 ? 0.86 : 1.0;
        d[i] = Math.round(v * 255);
      }
      const tex = new THREE.DataTexture(d, n, 1, THREE.RedFormat);
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    })();

    // --- sombras de nubes: una textura de manchas blandas que cruza el suelo ---
    const texNubes = (() => {
      const S = 256;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, S, S);
      const rnd = prng(23);
      for (let i = 0; i < 12; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 40 + rnd() * 60;
        for (const [ox, oy] of [
          [0, 0],
          [S, 0],
          [-S, 0],
          [0, S],
          [0, -S],
        ]) {
          const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, 'rgba(0,0,0,0.85)');
          g.addColorStop(0.5, 'rgba(0,0,0,0.45)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
          c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    })();
    uNubes.value = texNubes;

    // --- suelo: colinas de hierba con la trama de parcelas, que siguen al avatar ---
    // Una textura de UNA parcela repetida; el relieve lo pone el shader. El
    // plano se mueve a saltos de una parcela para que la trama no resbale.
    const texSuelo = (() => {
      const S = 256;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d');
      // blanca: el color lo pone el shader (cesped); aquí solo unas motas
      // y la línea de la parcela
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, S, S);
      const rnd = prng(7);
      for (let i = 0; i < 120; i++) {
        c.fillStyle = i % 3 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.0)';
        const x = rnd() * S;
        const y = rnd() * S;
        c.beginPath();
        c.ellipse(x, y, 2 + rnd() * 5, 1.2 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = 'rgba(60, 90, 50, 0.3)';
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
    const suelo = new THREE.Mesh(
      geoSuelo,
      conAltura(new THREE.MeshToonMaterial({ map: texSuelo, gradientMap: rampa }), { tinta: true, normales: true, nubes: true, cesped: true })
    );
    suelo.frustumCulled = false;
    suelo.receiveShadow = true;
    scene.add(suelo);

    // --- el agua de los ríos: un plano a NIVEL_AGUA que sigue al avatar ---
    // El terreno se hunde bajo el río (cauce), así que el plano solo se ve
    // donde el suelo queda por debajo: en los ríos. Unas olas pequeñas en el
    // vertex shader para que no sea una lámina muerta.
    const matAgua = new THREE.MeshToonMaterial({ color: 0x6db9e6, gradientMap: rampa, transparent: true, opacity: 0.86 });
    matAgua.onBeforeCompile = (sh) => {
      sh.uniforms.tiempo = uTiempo;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float tiempo;\n' + GLSL_CAUCE)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wpa = modelMatrix * vec4(transformed, 1.0);
          transformed.y += sin(tiempo * 1.4 + wpa.x * 0.35 + wpa.z * 0.2) * 0.07 + sin(tiempo * 0.9 - wpa.z * 0.5) * 0.05;
          // fuera de la banda del río, el agua se hunde: no hay lagos en los valles
          if (distRioG(wpa.x, -wpa.z) > ${BANDA_AGUA.toFixed(1)}) transformed.y -= 60.0;`
        );
      parcheaNiebla(sh);
    };
    matAgua.customProgramCacheKey = () => 'agua';
    const geoAgua = new THREE.PlaneGeometry(SUELO_M, SUELO_M, 96, 96);
    geoAgua.rotateX(-Math.PI / 2);
    const agua = new THREE.Mesh(geoAgua, matAgua);
    agua.position.y = NIVEL_AGUA;
    agua.frustumCulled = false;
    agua.receiveShadow = true;
    scene.add(agua);

    // --- cámara: tercera persona alrededor del avatar ---
    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 3000);
    const controls = new MapControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = true; // con dos dedos se arrastra el mapa (ver GESTOS)
    controls.screenSpacePanning = false; // arrastrar mueve por el suelo, no por el aire
    controls.minDistance = 4;
    controls.maxDistance = 140;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.45;
    // El ratón no arrastra el mapa: ninguno de sus botones va a PAN
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    // Un dedo mueve el mapa; de los dos dedos se encarga `apuntaDedo`, así que
    // a la cámara se le da para ese caso un valor que no es ninguno de los
    // TOUCH.* de three y que por tanto ignora.
    const DOS_DEDOS_APARTE = -1;
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: DOS_DEDOS_APARTE };

    // --- materiales: toon con rampa, el color de vértice como albedo ---
    const matFijo = conNiebla(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: rampa, side: THREE.DoubleSide }));
    const matFijoViento = conViento(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: rampa, side: THREE.DoubleSide }));
    // el tinte por instancia se multiplica al color de vértice
    const matTinte = conNiebla(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: rampa, side: THREE.DoubleSide }));
    const matTinteViento = conViento(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: rampa, side: THREE.DoubleSide }));

    // --- piezas instanciadas: cada pieza son una o varias PARTES, y cada
    // parte un InstancedMesh (un draw call por parte sean 3 piezas o 3.000)
    const mallas = {}; // tipo → {partes: [{mesh, tinte}]}
    const grupoPiezas = new THREE.Group();
    scene.add(grupoPiezas);
    function creaInstancias(t, partes) {
      const par = { partes: [] };
      for (const p of partes) {
        const m = new THREE.InstancedMesh(p.geo, p.mat, MAX_INST);
        m.count = 0;
        m.frustumCulled = false; // la esfera envolvente sería la del origen
        m.castShadow = true;
        m.receiveShadow = true;
        if (p.tinte) m.setColorAt(0, BLANCO); // hace falta tocarlo una vez para que exista
        m.userData.tipo = t;
        grupoPiezas.add(m);
        par.partes.push({ mesh: m, tinte: !!p.tinte });
      }
      mallas[t] = par;
    }
    for (const t of Object.keys(PIEZAS)) {
      if (PIEZAS[t].glb) continue;
      const g = geometriaPieza(t);
      const viento = CON_VIENTO.has(t);
      const partes = [];
      if (g.fijo) partes.push({ geo: g.fijo, mat: viento ? matFijoViento : matFijo });
      if (g.tinte) partes.push({ geo: g.tinte, mat: viento ? matTinteViento : matTinte, tinte: true });
      creaInstancias(t, partes);
    }

    // --- modelos glTF (Kenney, CC0) ---
    // Los del Nature y Furniture Kit traen varios materiales de color liso:
    // se hornea el color en el vértice y se funde todo en UNA geometría con
    // el material toon de siempre. Los del City Kit traen un atlas: una
    // geometría con UV y un material toon con esa textura. Luego se escala
    // para que el lado mayor en planta mida `ancho` metros y se deja el
    // origen en el centro de la planta, a ras de suelo.
    const cargador = new GLTFLoader();
    async function cargaModelo(def) {
      const gltf = await cargador.loadAsync('/modelos/' + def.glb + '.glb');
      const raiz = gltf.scene;
      raiz.updateMatrixWorld(true);
      const lisas = [];
      const conTextura = new Map(); // textura → [geometrías]
      raiz.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const base = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        const grupos = base.groups.length ? base.groups : [{ start: 0, count: base.getAttribute('position').count, materialIndex: 0 }];
        for (const gr of grupos) {
          const m = mats[gr.materialIndex] || mats[0];
          const g = new THREE.BufferGeometry();
          for (const nombre of ['position', 'normal', 'uv']) {
            const at = base.getAttribute(nombre);
            if (!at) continue;
            g.setAttribute(nombre, new THREE.BufferAttribute(at.array.slice(gr.start * at.itemSize, (gr.start + gr.count) * at.itemSize), at.itemSize));
          }
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          g.applyMatrix4(o.matrixWorld);
          if (m.map) {
            const lista = conTextura.get(m.map) || [];
            lista.push(g);
            conTextura.set(m.map, lista);
          } else {
            const n = g.getAttribute('position').count;
            const col = new Float32Array(n * 3);
            // Kenney exporta los colores de material en sRGB aunque glTF los
            // pide lineales: sin esta conversión todo sale lavado y pálido
            const c = acercaVerde((m.color || BLANCO).clone()).convertSRGBToLinear();
            for (let i = 0; i < n; i++) {
              col[i * 3] = c.r;
              col[i * 3 + 1] = c.g;
              col[i * 3 + 2] = c.b;
            }
            g.setAttribute('color', new THREE.BufferAttribute(col, 3));
            g.deleteAttribute('uv');
            lisas.push(g);
          }
        }
      });
      const partes = [];
      if (lisas.length) partes.push({ geo: mergeGeometries(lisas, false), mat: matFijo });
      for (const [tex, gs] of conTextura) {
        tex.colorSpace = THREE.SRGBColorSpace;
        partes.push({ geo: mergeGeometries(gs, false), mat: conNiebla(new THREE.MeshToonMaterial({ map: tex, gradientMap: rampa })) });
      }
      const caja = new THREE.Box3();
      for (const p of partes) {
        p.geo.computeBoundingBox();
        caja.union(p.geo.boundingBox);
      }
      const tam = new THREE.Vector3();
      caja.getSize(tam);
      const esc = def.ancho / Math.max(tam.x, tam.z, 0.001);
      const cx = (caja.min.x + caja.max.x) / 2;
      const cz = (caja.min.z + caja.max.z) / 2;
      for (const p of partes) {
        p.geo.translate(-cx, -caja.min.y, -cz);
        p.geo.scale(esc, esc, esc);
        p.geo.computeBoundingSphere();
      }
      return partes;
    }
    let modelosListos = false;
    Promise.all(
      Object.entries(PIEZAS)
        .filter(([, d]) => d.glb)
        .map(([t, d]) =>
          cargaModelo(d)
            .then((partes) => {
              if (vivo) creaInstancias(t, partes);
            })
            .catch((e) => console.warn('modelo', t, e?.message))
        )
    ).then(() => {
      modelosListos = true;
      if (!vivo) return;
      pintaMundo();
      compruebaListo();
    });

    const coloresTinte = COLORES.map((h) => new THREE.Color(h));

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
        c.fillStyle = i % 3 === 0 ? '#6fae5a' : i % 3 === 1 ? '#84c268' : '#98d276';
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
      // normal hacia ARRIBA en todos los vértices: una mata se ilumina como
      // el trozo de suelo en el que está, no como una pared (que de canto
      // saldría negra)
      const nor = [];
      for (let i = 0; i < pos.length; i += 3) nor.push(0, 1, 0);
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setIndex(ia.concat(ib));
      a.dispose();
      b.dispose();
      return geo;
    })();
    // la hierba recibe sombra (de árboles y casas) pero no la proyecta: son
    // miles de planos y su sombra no se echa de menos
    const matHierba = conAltura(
      new THREE.MeshToonMaterial({ map: texHierba, alphaTest: 0.5, side: THREE.DoubleSide, gradientMap: rampa }),
      { viento: true, nubes: true }
    );
    const hierba = new THREE.InstancedMesh(geoHierba, matHierba, MAX_HIERBA);
    hierba.count = 0;
    hierba.frustumCulled = false;
    hierba.receiveShadow = true;
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

    // --- pájaros: una bandada que da vueltas por encima, aleteando ---
    // Cada pájaro es una V de dos triángulos; el aleteo lo pone el vertex
    // shader (las puntas de las alas suben y bajan). Van instanciados y su
    // vuelo se calcula en JS: un círculo lento cuyo centro deriva alrededor
    // del avatar, cada uno a su radio y su altura.
    const N_PAJAROS = 11;
    const geoPajaro = (() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1.0, 0, 0.1, 0, 0, -0.3, 0, 0, 0.35, 1.0, 0, 0.1, 0, 0, 0.35, 0, 0, -0.3], 3));
      g.computeVertexNormals();
      return g;
    })();
    const matPajaro = new THREE.MeshBasicMaterial({ color: 0x2b3440, side: THREE.DoubleSide });
    matPajaro.onBeforeCompile = (sh) => {
      sh.uniforms.tiempo = uTiempo;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float tiempo;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 wp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        transformed.y += sin(tiempo * 9.0 + wp.x * 0.5 + wp.z * 0.3) * abs(position.x) * 0.6;`
      );
      parcheaNiebla(sh);
    };
    matPajaro.customProgramCacheKey = () => 'pajaro';
    const pajaros = new THREE.InstancedMesh(geoPajaro, matPajaro, N_PAJAROS);
    pajaros.frustumCulled = false;
    scene.add(pajaros);
    const rndPajaros = prng(17);
    const vuelo = [];
    for (let i = 0; i < N_PAJAROS; i++) vuelo.push({ r: 10 + rndPajaros() * 9, h: 14 + rndPajaros() * 8, f: rndPajaros() * Math.PI * 2, v: 0.28 + rndPajaros() * 0.1 });
    function vuelanLosPajaros(t) {
      const cx = yo.x + 45 * Math.sin(t * 0.021);
      const cy = yo.y + 45 * Math.cos(t * 0.017);
      for (let i = 0; i < N_PAJAROS; i++) {
        const p = vuelo[i];
        const a = t * p.v + p.f;
        const x = cx + Math.cos(a) * p.r;
        const y = cy + Math.sin(a) * p.r;
        const h = p.h + Math.sin(t * 0.6 + p.f) * 1.5;
        // velocidad tangente: hacia dónde mira (el frente es -z)
        const vx = -Math.sin(a);
        const vz = -Math.cos(a);
        posI.set(x, alturaEn(x, y) + h, -y);
        rotI.setFromAxisAngle(ejeY, Math.atan2(-vx, -vz));
        mtx.compose(posI, rotI, escI);
        pajaros.setMatrixAt(i, mtx);
      }
      pajaros.instanceMatrix.needsUpdate = true;
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
    const plazas = new THREE.InstancedMesh(
      geoParcela,
      conAltura(new THREE.MeshToonMaterial({ color: 0xdfd0b2, gradientMap: rampa }), { normales: true, nubes: true }),
      MAX_PARC
    );
    plazas.count = 0;
    plazas.frustumCulled = false;
    plazas.receiveShadow = true;
    scene.add(plazas);

    // marco de la parcela en obras
    const texObra = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const c = cv.getContext('2d');
      c.strokeStyle = 'rgba(47, 111, 237, 0.7)';
      c.lineWidth = 4;
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
    // listo = parcelas cargadas Y modelos cargados (el banco visual espera a esto)
    function compruebaListo() {
      if (window.__mundoListo || !cajaPedida || !modelosListos) return;
      window.__mundoListo = true;
      setCargando(false);
    }
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

    // Rehace TODAS las instancias: son cientos o pocos miles, y es más barato
    // que llevar la cuenta de qué instancia era de qué parcela.
    // origen[t][i] = {clave, z}: de qué parcela y qué pieza es cada instancia,
    // para poder tocarla y seleccionarla
    const origen = {};
    // lo que no se puede atravesar: [{x, y, r}] en metros del mundo
    let solidos = [];
    function pintaMundo() {
      const cont = {};
      for (const t in mallas) {
        cont[t] = 0;
        origen[t] = [];
      }
      solidos = [];
      let nMarcos = 0;
      let nPlazas = 0;
      for (const [clave, pc] of parcelas) {
        const p = parseParcela(clave);
        if (!p) continue;
        const bx = p.px * L;
        const by = p.py * L;
        const cen = centroParcela(p.px, p.py);
        if (pc.o === 'mundo') {
          if (conSuelo(tipoParcela(p.px, p.py)) && nPlazas < MAX_PARC) {
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
          if (PIEZAS[z.t]?.solido) solidos.push({ x: wx, y: wy, r: PIEZAS[z.t].solido });
          // un pelín enterrada: en pendiente, mejor que el borde bajo se hunda
          // a que el alto flote
          posI.set(wx, alturaEn(wx, wy) - 0.12, -wy);
          rotI.setFromAxisAngle(ejeY, (z.r || 0) * (Math.PI / 2));
          mtx.compose(posI, rotI, escI);
          const i = cont[z.t];
          if (i >= MAX_INST) continue;
          for (const p of par.partes) {
            p.mesh.setMatrixAt(i, mtx);
            if (p.tinte) p.mesh.setColorAt(i, coloresTinte[z.c] || coloresTinte[0]);
          }
          origen[z.t][i] = { clave, z };
          cont[z.t] = i + 1;
        }
      }
      for (const t in mallas) {
        for (const p of mallas[t].partes) {
          p.mesh.count = cont[t];
          p.mesh.instanceMatrix.needsUpdate = true;
          if (p.tinte) p.mesh.instanceColor.needsUpdate = true;
          // la esfera envolvente del InstancedMesh se calcula UNA vez y se
          // queda: si se calculó con 0 instancias, el rayo de selección no
          // acierta nunca. Se invalida para que se rehaga al siguiente toque.
          p.mesh.boundingSphere = null;
        }
      }
      pintaSeleccion();
      marcos.count = nMarcos;
      marcos.instanceMatrix.needsUpdate = true;
      if (marcos.instanceColor) marcos.instanceColor.needsUpdate = true;
      plazas.count = nPlazas;
      plazas.instanceMatrix.needsUpdate = true;
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
        for (const z of pc.d || []) if (PIEZAS[z.t]?.suelo) caminos.push([p.px * L + z.x, p.py * L + z.y]);
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
          if (conSuelo(tipoParcela(p.px, p.py))) continue;
          if (distRio(wx, wy).d < RIO_ANCHO + 2) continue;
          let tapada = false;
          for (const c of caminos) {
            if (Math.abs(c[0] - wx) < 2.3 && Math.abs(c[1] - wy) < 2.3) {
              tapada = true;
              break;
            }
          }
          if (tapada) continue;
          const s = 0.3 + h * 0.85; // como mucho, al muslo del avatar
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
      pi.position.set(-0.12, 0.64, 0);
      pd.position.set(0.12, 0.64, 0);
      for (const m of [cuerpo, pi, pd]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      grupo.add(cuerpo, pi, pd);
      return { grupo, cuerpo, pi, pd };
    }
    const avatar = creaFigura(coloresTinte[jugador.color]);
    scene.add(avatar.grupo);
    sigueElSol(0, 0, 0);
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
      const salto = o.andando ? Math.abs(Math.sin(o.fase)) * 0.06 : 0;
      f.grupo.position.set(o.x, o.h + salto, -o.y);
      f.grupo.rotation.y = o.rumbo;
      const a = o.andando ? Math.sin(o.fase) * 0.65 : 0;
      f.pi.rotation.x = a;
      f.pd.rotation.x = -a;
    }

    // Cámara inicial: al sur del avatar, mirando al norte. Reproducible desde
    // la URL (?d=&pol=&az=) para el banco visual: az es el rumbo desde el
    // avatar hacia la cámara (180 = la cámara está al sur).
    controls.target.set(yo.x, yo.h + ALTO_AVATAR * 0.5, -yo.y);
    {
      const dCam = parseFloat(params.get('d'));
      const polCam = parseFloat(params.get('pol'));
      const azCam = parseFloat(params.get('az'));
      // por defecto, cerca y baja: como en la referencia, siempre se ve el
      // horizonte con sus nubes
      const d = dCam > 0 ? dCam : 14;
      const pol = (Number.isFinite(polCam) ? Math.max(9, Math.min(83, polCam)) : 66) * (Math.PI / 180);
      const az = (Number.isFinite(azCam) ? azCam : 180) * (Math.PI / 180);
      const r = d * Math.sin(pol);
      camera.position.set(yo.x + r * Math.sin(az), yo.h + ALTO_AVATAR * 0.5 + d * Math.cos(pol), -yo.y - r * Math.cos(az));
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
        pv.set(x, h + ALTO_AVATAR + 0.3, -y);
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
    let avisaObra = null;
    let guardadoT = null;
    // La pieza seleccionada: {clave, z}. Se selecciona tocándola, y la recién
    // colocada queda seleccionada para poder ajustarla al momento.
    let seleccion = null;
    const anillo = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x2f6fed, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
    );
    anillo.rotation.x = -Math.PI / 2;
    anillo.renderOrder = 3;
    anillo.visible = false;
    scene.add(anillo);
    function pintaSeleccion() {
      const lista = obraClave ? parcelas.get(obraClave)?.d : null;
      if (!seleccion || !lista || !lista.includes(seleccion.z)) {
        seleccion = null;
        anillo.visible = false;
        return;
      }
      const p = parseParcela(seleccion.clave);
      const wx = p.px * L + seleccion.z.x;
      const wy = p.py * L + seleccion.z.y;
      const a = ((PIEZAS[seleccion.z.t]?.ancho || 3) * 0.6) + 0.4;
      anillo.position.set(wx, alturaEn(wx, wy) + 0.25, -wy);
      anillo.scale.set(a, a, 1);
      anillo.visible = true;
    }
    // A qué posición se pega una pieza: a media metro, o a la rejilla de 4 m
    // (caminos y vallas, para que casen entre sí)
    function ajusta(t, x, y) {
      if (PIEZAS[t]?.rejilla) {
        return {
          x: Math.min(L - 2, Math.max(2, Math.floor(x / 4) * 4 + 2)),
          y: Math.min(L - 2, Math.max(2, Math.floor(y / 4) * 4 + 2)),
        };
      }
      return { x: Math.min(L, Math.max(0, Math.round(x * 2) / 2)), y: Math.min(L, Math.max(0, Math.round(y * 2) / 2)) };
    }

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

    // Un toque en obras: sobre una pieza mía, la selecciona; sobre el suelo
    // con una seleccionada, la mueve ahí; sobre el suelo sin selección,
    // coloca una pieza nueva de la herramienta elegida (y la deja
    // seleccionada para ajustarla con las flechas, girarla o borrarla).
    function colocaEn(sx, sy) {
      if (!obraClave) return;
      ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
      rayo.setFromCamera(ndc, camera);
      for (const h of rayo.intersectObjects(grupoPiezas.children, false)) {
        const o = origen[h.object.userData.tipo]?.[h.instanceId];
        if (o && o.clave === obraClave) {
          seleccion = o;
          pintaSeleccion();
          avisaObra?.({ seleccion: true });
          return;
        }
      }
      const p = sueloEn(sx, sy);
      if (!p) return;
      const x = p.x - obraBase.bx;
      const y = p.y - obraBase.by;
      if (x < 0 || x > L || y < 0 || y > L) {
        avisaObra?.({ fuera: true });
        return;
      }
      const pc = parcelas.get(obraClave);
      const lista = pc?.d ? pc.d.slice() : [];
      if (seleccion && lista.includes(seleccion.z)) {
        const q = ajusta(seleccion.z.t, x, y);
        seleccion.z.x = q.x;
        seleccion.z.y = q.y;
      } else {
        if (lista.length >= MAX_PIEZAS) {
          avisaObra?.({ lleno: true });
          return;
        }
        const q = ajusta(herramienta, x, y);
        const z = { t: herramienta, x: q.x, y: q.y, r: giro, c: tinteActual };
        lista.push(z);
        seleccion = { clave: obraClave, z };
      }
      parcelas.set(obraClave, { o: pc?.o || jugador.id, d: lista });
      pintaMundo();
      avisaObra?.({ n: lista.length, seleccion: !!seleccion });
      programaGuardado(obraClave);
    }
    // Empuja la pieza seleccionada un paso en pantalla: ax derecha(+) /
    // izquierda(-), ay adelante(+) / atrás(-). «Adelante» es hacia donde mira
    // la cámara, pegado al eje del mundo más cercano.
    function empuja(ax, ay) {
      if (!seleccion || !obraClave) return;
      dirCam.subVectors(controls.target, camera.position);
      dirCam.y = 0;
      dirCam.normalize();
      let fe = dirCam.x;
      let fn = -dirCam.z;
      if (Math.abs(fe) > Math.abs(fn)) {
        fe = Math.sign(fe);
        fn = 0;
      } else {
        fn = Math.sign(fn);
        fe = 0;
      }
      const z = seleccion.z;
      const paso = PIEZAS[z.t]?.rejilla ? 4 : 0.5;
      const dx = (fe * ay + fn * ax) * paso;
      const dy = (fn * ay - fe * ax) * paso;
      z.x = Math.min(L, Math.max(0, Math.round((z.x + dx) * 10) / 10));
      z.y = Math.min(L, Math.max(0, Math.round((z.y + dy) * 10) / 10));
      pintaMundo();
      programaGuardado(obraClave);
    }

    // Un toque es bajar y subir el mismo puntero, solo, sin moverse apenas:
    // arrastrar gira la cámara y no coloca ni mueve nada. En obras, bajar
    // sobre una pieza propia y arrastrar la LLEVA con el dedo (o el ratón),
    // a pasos de 10 cm; la cámara se queda quieta mientras tanto.
    let toque = null;
    let punteros = 0;
    let arrastre = null; // {z, ox, oy, movido}
    function piezaBajo(sx, sy) {
      ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
      rayo.setFromCamera(ndc, camera);
      for (const h of rayo.intersectObjects(grupoPiezas.children, false)) {
        const o = origen[h.object.userData.tipo]?.[h.instanceId];
        if (o && o.clave === obraClave) return o;
      }
      return null;
    }
    function onBaja(e) {
      if (e.isPrimary) punteros = 0;
      punteros++;
      toque = punteros === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
      if (obraClave && punteros === 1) {
        const o = piezaBajo(e.clientX, e.clientY);
        if (o) {
          const p = sueloEn(e.clientX, e.clientY);
          seleccion = o;
          pintaSeleccion();
          avisaObra?.({ seleccion: true });
          arrastre = { z: o.z, ox: p ? o.z.x - (p.x - obraBase.bx) : 0, oy: p ? o.z.y - (p.y - obraBase.by) : 0, movido: false };
          controls.enabled = false;
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {}
        }
      }
    }
    function onMueve(e) {
      if (!arrastre || !obraClave) return;
      const p = sueloEn(e.clientX, e.clientY);
      if (!p) return;
      const z = arrastre.z;
      const x = p.x - obraBase.bx + arrastre.ox;
      const y = p.y - obraBase.by + arrastre.oy;
      const q = PIEZAS[z.t]?.rejilla ? ajusta(z.t, x, y) : { x: Math.min(L, Math.max(0, Math.round(x * 10) / 10)), y: Math.min(L, Math.max(0, Math.round(y * 10) / 10)) };
      if (q.x === z.x && q.y === z.y) return;
      z.x = q.x;
      z.y = q.y;
      arrastre.movido = true;
      pintaMundo();
    }
    function acabaArrastre() {
      if (!arrastre) return false;
      const movido = arrastre.movido;
      arrastre = null;
      controls.enabled = true;
      if (movido && obraClave) programaGuardado(obraClave);
      return movido;
    }
    function onSube(e) {
      punteros = Math.max(0, punteros - 1);
      const tq = toque;
      toque = null;
      if (acabaArrastre()) return; // se ha arrastrado: no es un toque
      if (!tq || punteros !== 0) return;
      if (Math.hypot(e.clientX - tq.x, e.clientY - tq.y) > 12 || performance.now() - tq.t > 900) return;
      if (obraClave) colocaEn(e.clientX, e.clientY);
      else {
        const p = sueloEn(e.clientX, e.clientY);
        if (p) yo.destino = p;
      }
    }
    function onCancela() {
      punteros = Math.max(0, punteros - 1);
      toque = null;
      acabaArrastre();
    }
    canvas.addEventListener('pointerdown', onBaja);
    canvas.addEventListener('pointermove', onMueve);
    canvas.addEventListener('pointerup', onSube);
    canvas.addEventListener('pointercancel', onCancela);

    // --- GESTOS, como en los mapas del iPhone ---
    // Un dedo lleva el mapa a donde se quiera. Dos dedos hacen tres cosas a la
    // vez, sin modos ni esquinas: separarlos o juntarlos acerca y aleja,
    // girarlos gira el mundo, y subirlos o bajarlos a la vez cambia el ángulo
    // con que se ve (arriba, de canto; abajo, desde el cielo).
    //
    // De los dos dedos se encarga este código y no la cámara, porque
    // OrbitControls no sabe girar con el GIRO de los dedos: lo suyo es
    // arrastrarlos. Cada cosa espera a su umbral para empezar (un pellizco
    // recto no gira solo, ni un giro acerca solo), y a partir de ahí va
    // fotograma a fotograma, así que al soltarse el umbral no da tirones.
    const GIRO_MINIMO = 0.14; // rad (8°) de giro antes de que el mundo gire
    const ALTO_MINIMO = 14; // px de subida antes de cambiar el ángulo
    const ZOOM_MINIMO = 0.06; // 6% de separación antes de acercar

    const dedos = new Map(); // pointerId → {x, y}, solo dedos sobre el lienzo
    let pinza = null; // la medida del fotograma anterior, y qué ha arrancado ya
    const esfCam = new THREE.Spherical();
    const vecCam = new THREE.Vector3();

    function midePinza() {
      const [a, b] = [...dedos.values()];
      return { d: Math.hypot(b.x - a.x, b.y - a.y), g: Math.atan2(b.y - a.y, b.x - a.x), y: (a.y + b.y) / 2 };
    }
    function abrePinza() {
      if (dedos.size !== 2) {
        pinza = null;
        return;
      }
      const m = midePinza();
      pinza = { ...m, d0: m.d, g0: m.g, y0: m.y, gira: false, alza: false, zoom: false };
    }
    function apuntaDedo(e) {
      if (e.pointerType !== 'touch') return;
      if (e.type === 'pointerdown') {
        if (e.target !== canvas) return;
        dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        abrePinza();
      } else if (e.type === 'pointermove') {
        const p = dedos.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pinza && dedos.size === 2) muevePinza();
      } else {
        dedos.delete(e.pointerId);
        abrePinza();
      }
    }
    function muevePinza() {
      const m = midePinza();
      // el giro da la vuelta en ±π: se compara por el camino corto
      let dg = m.g - pinza.g;
      if (dg > Math.PI) dg -= 2 * Math.PI;
      else if (dg < -Math.PI) dg += 2 * Math.PI;
      let g0 = m.g - pinza.g0;
      if (g0 > Math.PI) g0 -= 2 * Math.PI;
      else if (g0 < -Math.PI) g0 += 2 * Math.PI;
      if (!pinza.gira && Math.abs(g0) > GIRO_MINIMO) pinza.gira = true;
      if (!pinza.alza && Math.abs(m.y - pinza.y0) > ALTO_MINIMO) pinza.alza = true;
      if (!pinza.zoom && Math.abs(Math.log(m.d / pinza.d0)) > ZOOM_MINIMO) pinza.zoom = true;

      vecCam.copy(camera.position).sub(controls.target);
      esfCam.setFromVector3(vecCam);
      // girar los dedos gira el mundo con ellos: la cámara da la vuelta al revés
      if (pinza.gira) esfCam.theta += dg;
      // subirlos pone el mundo de canto; bajarlos, visto desde el cielo
      if (pinza.alza) esfCam.phi = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle, esfCam.phi + ((pinza.y - m.y) * Math.PI) / vpH));
      // separarlos acerca, juntarlos aleja
      if (pinza.zoom) esfCam.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, esfCam.radius * (pinza.d / m.d)));
      camera.position.copy(controls.target).add(vecCam.setFromSpherical(esfCam));

      pinza.d = m.d;
      pinza.g = m.g;
      pinza.y = m.y;
    }
    window.addEventListener('pointerdown', apuntaDedo, true);
    window.addEventListener('pointermove', apuntaDedo, true);
    window.addEventListener('pointerup', apuntaDedo, true);
    window.addEventListener('pointercancel', apuntaDedo, true);

    // Lo arrastrado se mide contra el avatar: nunca se aleja más de MAX_PAN
    // metros de él, y en cuanto se anda el mapa vuelve solo a centrarlo. Así
    // se puede mirar alrededor sin perder de vista quién eres.
    const MAX_PAN = 120;
    function centraMapa(dt, andando) {
      const ox = controls.target.x - yo.x;
      const oz = controls.target.z + yo.y;
      const d = Math.hypot(ox, oz);
      if (d < 0.001) return;
      let k = d > MAX_PAN ? (d - MAX_PAN) / d : 0;
      if (andando) k = Math.max(k, 1 - Math.exp(-dt * 2.2));
      if (k <= 0) return;
      controls.target.x -= ox * k;
      controls.target.z -= oz * k;
      camera.position.x -= ox * k;
      camera.position.z -= oz * k;
    }

    // joystick táctil (lo pinta React): vector -1..1, adelante = +y
    const joy = { x: 0, y: 0 };
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
        compruebaListo();
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
      const tipo = tipoParcela(p.px, p.py);
      setDonde({
        clave,
        tipo,
        dueno: pc?.o || null,
        mia: pc?.o === jugador.id,
        libre: !pc?.o && tipo === 'residencial',
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
    window.__mundo = {
      mueve: mueveA,
      pos: () => ({ x: yo.x, y: yo.y }),
      // dónde está la cámara y cuánto se ha arrastrado el mapa (diagnóstico)
      camara: () => {
        const e = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
        return { d: e.radius, pol: e.phi, az: e.theta, ox: controls.target.x - yo.x, oz: controls.target.z + yo.y };
      },
      recentra: () => centraMapa(10, true),
      // dónde cae en pantalla un punto del mundo (diagnóstico)
      proyecta: (x, y) => {
        const v = new THREE.Vector3(x, alturaEn(x, y), -y).project(camera);
        return { sx: (v.x * 0.5 + 0.5) * vpW, sy: (-v.y * 0.5 + 0.5) * vpH };
      },
      seleccion: () => (seleccion ? { ...seleccion.z } : null),
      // qué piezas hay bajo un punto de pantalla (diagnóstico)
      bajo: (sx, sy) => {
        ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
        rayo.setFromCamera(ndc, camera);
        return rayo.intersectObjects(grupoPiezas.children, false).map((h) => ({ t: h.object.userData.tipo, i: h.instanceId, d: Math.round(h.distance * 10) / 10, o: origen[h.object.userData.tipo]?.[h.instanceId]?.clave }));
      },
    };

    engineRef.current = {
      construye(clave, cb) {
        vaciaGuardado();
        acabaArrastre();
        seleccion = null;
        anillo.visible = false;
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
      // gira la pieza seleccionada, y deja ese giro para la siguiente
      gira() {
        if (seleccion && obraClave) {
          seleccion.z.r = (seleccion.z.r + 1) % 4;
          giro = seleccion.z.r;
          pintaMundo();
          programaGuardado(obraClave);
        } else giro = (giro + 1) % 4;
        return giro;
      },
      empuja,
      borra() {
        if (!seleccion || !obraClave) return 0;
        const pc = parcelas.get(obraClave);
        const lista = (pc?.d || []).filter((z) => z !== seleccion.z);
        parcelas.set(obraClave, { o: pc?.o || jugador.id, d: lista });
        seleccion = null;
        pintaMundo();
        programaGuardado(obraClave);
        return lista.length;
      },
      suelta() {
        seleccion = null;
        anillo.visible = false;
      },
      joystick(x, y) {
        joy.x = x;
        joy.y = y;
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
      // OJO: con updateStyle=false el lienzo se queda con su tamaño en píxeles
      // FÍSICOS como tamaño CSS (un canvas es un elemento «replaced»: inset:0
      // no lo estira). En un móvil con densidad 3 salía el doble de grande
      // que la pantalla: el avatar en una esquina y los toques descolocados.
      renderer.setSize(vpW, vpH);
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
      const conJoy = Math.hypot(joy.x, joy.y) > 0.12;
      if (teclas.size || conJoy) {
        // adelante = de la cámara al avatar, sobre el suelo
        dirCam.subVectors(controls.target, camera.position);
        dirCam.y = 0;
        dirCam.normalize();
        const fe = dirCam.x;
        const fn = -dirCam.z;
        const adel = (teclas.has('w') || teclas.has('arrowup') ? 1 : 0) - (teclas.has('s') || teclas.has('arrowdown') ? 1 : 0) + joy.y;
        const lado = (teclas.has('d') || teclas.has('arrowright') ? 1 : 0) - (teclas.has('a') || teclas.has('arrowleft') ? 1 : 0) + joy.x;
        mx = fe * adel + fn * lado;
        my = fn * adel - fe * lado;
        const l0 = Math.hypot(mx, my);
        if (l0 > 1) {
          mx /= l0;
          my /= l0;
        }
        if (conJoy) yo.destino = null;
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
        // con el joystick a medias se anda más despacio
        const paso = Math.min(VELOCIDAD * dt * Math.min(1, l), yo.destino ? Math.hypot(yo.destino.x - yo.x, yo.destino.y - yo.y) : Infinity);
        const dx = (mx / l) * paso;
        const dy = (my / l) * paso;
        const x0 = yo.x;
        const y0 = yo.y;
        yo.x += dx;
        yo.y += dy;
        // sin atravesar casas, árboles ni la fuente: si se mete en un
        // sólido, se le empuja fuera por el radio (y así resbala por el borde)
        for (const so of solidos) {
          const ex = yo.x - so.x;
          const ey = yo.y - so.y;
          const d = Math.hypot(ex, ey);
          const r = so.r + 0.3;
          if (d < r && d > 0.001) {
            yo.x = so.x + (ex / d) * r;
            yo.y = so.y + (ey / d) * r;
          }
        }
        // ni por el río: se queda en la orilla (por el puente sí)
        const rio = distRio(yo.x, yo.y);
        if (!rio.puente && rio.d < RIO_ANCHO + 1) {
          if (rio.cual === 'este') {
            const cx = rioEsteXEnEscena(yo.y);
            yo.x = cx + Math.sign(yo.x - cx || 1) * (RIO_ANCHO + 1);
          } else {
            const cy = rioSurYEnEscena(yo.x);
            yo.y = cy + Math.sign(yo.y - cy || 1) * (RIO_ANCHO + 1);
          }
        }
        yo.rumbo = Math.atan2(dx, -dy); // el frente del avatar es +z (sur)
        yo.fase += dt * CADENCIA;
        // la cámara va con él
        camera.position.x += yo.x - x0;
        camera.position.z -= yo.y - y0;
        controls.target.x += yo.x - x0;
        controls.target.z -= yo.y - y0;
        if (yo.destino && Math.hypot(yo.x - x0, yo.y - y0) < paso * 0.2) yo.destino = null; // atascado: se para
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
      sigueElSol(yo.x, yo.h, yo.y);
      uAvatar.value.set(yo.x, yo.h, -yo.y);

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
          s.fase += dt * CADENCIA;
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
      agua.position.x = suelo.position.x;
      agua.position.z = suelo.position.z;
      plantaHierba();

      // nubes: van con el avatar (siempre hay cielo encima) y derivan al este
      for (const nb of nubes) {
        const ox = ((((nb.ox + uTiempo.value * nb.v + 260) % 520) + 520) % 520) - 260;
        nb.m.position.set(yo.x + ox, nb.h, -yo.y + nb.oz);
      }
      cielo.position.copy(camera.position);
      vuelanLosPajaros(uTiempo.value);

      centraMapa(dt, yo.andando);
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
      canvas.removeEventListener('pointermove', onMueve);
      canvas.removeEventListener('pointerup', onSube);
      canvas.removeEventListener('pointercancel', onCancela);
      window.removeEventListener('pointerdown', apuntaDedo, true);
      window.removeEventListener('pointermove', apuntaDedo, true);
      window.removeEventListener('pointerup', apuntaDedo, true);
      window.removeEventListener('pointercancel', apuntaDedo, true);
      for (const id of [...otros.keys()]) quitaOtro(id);
      for (const el of nodos.values()) el.remove();
      nodos.clear();
      for (const t in mallas) {
        for (const p of mallas[t].partes) {
          p.mesh.geometry.dispose();
          if (p.mesh.material !== matFijo && p.mesh.material !== matTinte && p.mesh.material !== matFijoViento && p.mesh.material !== matTinteViento) {
            p.mesh.material.map?.dispose();
            p.mesh.material.dispose();
          }
          p.mesh.dispose();
        }
      }
      for (const nb of nubes) nb.m.geometry.dispose();
      matNube.dispose();
      hierba.dispose();
      geoHierba.dispose();
      matHierba.dispose();
      texHierba.dispose();
      texNubes.dispose();
      rampa.dispose();
      matFijoViento.dispose();
      matTinteViento.dispose();
      marcos.dispose();
      marcos.material.dispose();
      plazas.dispose();
      plazas.material.dispose();
      geoParcela.dispose();
      marcoObra.material.dispose();
      anillo.geometry.dispose();
      anillo.material.dispose();
      texMarco.dispose();
      texObra.dispose();
      avatar.cuerpo.geometry.dispose();
      geoPierna.dispose();
      suelo.geometry.dispose();
      suelo.material.dispose();
      geoAgua.dispose();
      matAgua.dispose();
      texSuelo.dispose();
      cielo.geometry.dispose();
      matCielo.dispose();
      texNubesCielo.dispose();
      pajaros.dispose();
      geoPajaro.dispose();
      matPajaro.dispose();
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
    else if (err === 'no_residencial') avisa('Aquí no se puede construir: busca un solar en la zona residencial, cerca de la plaza');
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
      else {
        setObra((o) => (o ? { ...o, n: typeof ev.n === 'number' ? ev.n : o.n, sel: !!ev.seleccion } : o));
        if (ev.seleccion && estrecho) setPanelAbierto(false); // que se vea la barra de la pieza
      }
    });
    eng.herramienta(herr, tinte);
    setInfoOpen(false);
    setPanelAbierto(!estrecho);
    setObra({ clave: donde.clave, n, sel: false });
    avisa(estrecho ? 'Elige una pieza y toca el suelo para colocarla; arrástrala para moverla' : 'Toca el suelo para colocar; arrastra una pieza para moverla');
  }
  function terminaObra() {
    engineRef.current?.construye(null);
    setObra(null);
  }
  function onBorrar() {
    const n = engineRef.current?.borra();
    setObra((o) => (o ? { ...o, n: typeof n === 'number' ? n : o.n, sel: false } : o));
  }
  function onSoltar() {
    engineRef.current?.suelta();
    setObra((o) => (o ? { ...o, sel: false } : o));
  }
  // elegir una pieza de la paleta suelta la seleccionada: el siguiente toque
  // coloca una nueva (si no, movería la seleccionada)
  function eligeHerr(t) {
    setHerr(t);
    engineRef.current?.herramienta(t, tinte);
    engineRef.current?.suelta();
    setObra((o) => (o ? { ...o, sel: false } : o));
    if (estrecho) setPanelAbierto(false); // en el móvil, elegir cierra la hoja: se ve el mundo
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
            <b>Anda</b> tocando el suelo, con el joystick de abajo a la izquierda (en el móvil) o con WASD / flechas. Los gestos son los de los mapas del iPhone: <b>un dedo</b> lleva el mapa a donde quieras y <b>dos dedos</b> lo acercan al separarlos, lo giran al girarlos y cambian el ángulo con que se ve al subirlos o bajarlos. En cuanto andas, el mapa vuelve al avatar. Con ratón, arrastra para girar y usa la rueda para acercar.
          </p>
          <p>
            <b>Reclama una parcela</b> libre de la zona residencial (alrededor de la plaza, los paseos y los parques): ponte encima y pulsa «Reclamar». Es tuya para siempre (o hasta que la abandones).
          </p>
          <p>
            <b>Construye</b> en tu parcela: casas, árboles, rocas, caminos, vallas, muebles… Elige una pieza del panel y toca el suelo para colocarla. <b>Arrastra</b> una pieza para llevarla donde quieras; tócala para girarla o borrarla. Lo ve todo el mundo al momento.
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
            <span className="etiqueta glass">
              {donde.dueno && donde.dueno !== 'mundo'
                ? 'Parcela de otra persona'
                : donde.tipo === 'plaza'
                  ? 'Plaza pública'
                  : donde.tipo === 'paseo'
                    ? 'Paseo público'
                    : donde.tipo === 'parque'
                      ? 'Parque público'
                      : donde.tipo === 'rio'
                        ? 'Río: aquí no se construye'
                        : donde.tipo === 'muestra'
                          ? 'Casa de muestra'
                          : 'Campo: se construye cerca de la plaza'}
            </span>
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
          <div className={'ui panel glass' + (panelAbierto ? '' : ' plegado')}>
            <div className="panel-cab">
              <button className="actual" onClick={() => setPanelAbierto((v) => !v)} aria-expanded={panelAbierto} aria-label="Elegir pieza">
                {PIEZAS[herr]?.mini ? (
                  <i className={'mini' + (PIEZAS[herr].zoom ? ' zoom' : '')}>
                    <img src={'/miniaturas/' + herr + '.png'} alt="" />
                  </i>
                ) : (
                  <span className="emoji">{PIEZAS[herr]?.icono}</span>
                )}
                <b>{PIEZAS[herr]?.nombre}</b>
                <small>{panelAbierto ? 'Cerrar' : 'Elegir pieza ▴'}</small>
              </button>
              <button className="btn-principal listo" onClick={terminaObra}>
                Listo
              </button>
            </div>
            <div className="panel-cuerpo">
              <div className="tabs" role="tablist">
                {Object.entries(CATEGORIAS).map(([c, nombre]) => (
                  <button key={c} className={'tab' + (cat === c ? ' on' : '')} data-cat={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}>
                    {nombre}
                  </button>
                ))}
              </div>
              <div className="rejilla">
                {Object.entries(PIEZAS)
                  .filter(([, d]) => d.cat === cat)
                  .map(([t, d]) => (
                    <button key={t} className={'pieza' + (herr === t ? ' on' : '')} onClick={() => eligeHerr(t)} aria-label={d.nombre} aria-pressed={herr === t} title={d.nombre}>
                      {d.mini ? (
                        <i className={'mini' + (d.zoom ? ' zoom' : '')}>
                          <img src={'/miniaturas/' + t + '.png'} alt="" />
                        </i>
                      ) : (
                        <span className="emoji">{d.icono}</span>
                      )}
                      <small>{d.nombre}</small>
                    </button>
                  ))}
              </div>
              <div className="panel-pie">
                <div className="colores mini" style={{ display: tiñe ? 'flex' : 'none' }}>
                  {COLORES.map((c, i) => (
                    <button key={c} className={'color' + (tinte === i ? ' on' : '')} style={{ background: c }} onClick={() => eligeTinte(i)} aria-label={'Color ' + (i + 1)} />
                  ))}
                </div>
                <button className="btn-sec" onClick={() => engineRef.current?.gira()} title="Giro para la siguiente pieza">
                  ↻ Girar la siguiente
                </button>
                <button className="btn-sec peligro" onClick={onAbandonar}>
                  Abandonar parcela
                </button>
              </div>
            </div>
          </div>
          {obra.sel && !(estrecho && panelAbierto) && (
            <div className="ui sel-bar glass" role="toolbar" aria-label="Pieza seleccionada">
              <span className="pista">Arrastra la pieza, o:</span>
              <div className="cruz" role="group" aria-label="Mover la pieza">
                <button className="btn-sec" onClick={() => engineRef.current?.empuja(0, 1)} aria-label="Mover hacia delante">▲</button>
                <button className="btn-sec" onClick={() => engineRef.current?.empuja(-1, 0)} aria-label="Mover a la izquierda">◀</button>
                <button className="btn-sec" onClick={() => engineRef.current?.empuja(0, -1)} aria-label="Mover hacia atrás">▼</button>
                <button className="btn-sec" onClick={() => engineRef.current?.empuja(1, 0)} aria-label="Mover a la derecha">▶</button>
              </div>
              <button className="btn-sec" onClick={() => engineRef.current?.gira()} title="Gira la pieza">
                ↻ Girar
              </button>
              <button className="btn-sec peligro" onClick={onBorrar} aria-label="Borrar pieza">
                🗑 Borrar
              </button>
              <button className="btn-principal" onClick={onSoltar}>
                ✓ Soltar
              </button>
            </div>
          )}
        </>
      )}

      {presentado && !obra && tactil && (
        <div
          className="ui joy"
          ref={joyRef}
          onPointerDown={onJoyDown}
          onPointerMove={onJoyMove}
          onPointerUp={onJoyUp}
          onPointerCancel={onJoyUp}
          aria-label="Joystick para andar"
        >
          <div className="joy-knob" ref={joyKnobRef} />
        </div>
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
