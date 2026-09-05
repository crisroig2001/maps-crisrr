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
import { PIEZAS, CATEGORIAS, COLORES, PELOS, PIELES, MAX_PIEZAS, MAX_NOMBRE, MAX_MENSAJE, MENSAJE_MS, EMOTES, limpiaMensaje } from '../lib/piezas';
import { perfil, guardaPerfil, gustaVisto, guardaGustaVisto, silenciados, silencia, quitaSilencio } from '../lib/jugador';
import { CORRO_MAX, CORRO_CERCA_M, CORRO_AVISO_M, CORRO_LINEAS_VISTA } from '../lib/corro';
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
const NIEBLA_HASTA = 325; // satura antes de los 384 m en que se acaba el plano del suelo
const SUELO_M = 16 * L; // el plano del suelo que sigue al avatar: 768 m
const RADIO_PARCELAS = 6; // se piden (2r+1)² parcelas alrededor: 13×13
const ANCHO_PASEO = 15; // la losa del paseo es una banda, no la parcela entera
// El sembrado del campo: fuera de lo público no había NADA, así que el mundo
// era una pradera lisa con casas sueltas. Rejilla fija del mundo, decidida por
// hash: no ocupa un byte en el servidor y sale igual en todas las pantallas.
const CELDA_CAMPO = 18;
const RADIO_CAMPO = 190;
// Lo que crece solo. Nada de casas ni de mobiliario: esto es monte.
const SIEMBRA = ['arbol', 'arbol', 'roble', 'pino', 'arbusto', 'arbusto', 'roca', 'rocas', 'tronco', 'flores', 'flores-amarillas', 'flores-moradas', 'setas'];

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
const TIERRA = new THREE.Color(0x9c7a56);
const LOSA = new THREE.Color(0xded6c4);
const METAL = new THREE.Color(0x8e97a2);
const CARBON = new THREE.Color(0x4a4a52);
const CRISTAL = new THREE.Color(0xc6e5f3);
// pelo y piel: la variedad de los vecinos. El índice viene del perfil (y de
// la presencia, para los demás); el color, de la paleta compartida.
const PELOS_3D = PELOS.map((h) => new THREE.Color(h));
const PIELES_3D = PIELES.map((h) => new THREE.Color(h));
const dePaleta = (paleta, i) => paleta[Number.isInteger(i) && i >= 0 && i < paleta.length ? i : 0];
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
  // El 0.5 de antes era un TOPE del 50 %: por lejos que estuviera algo nunca
  // acababa del color del cielo, así que a 380 m el terreno aterrizaba en
  // ~(214,231,226) contra una calima de (216,238,255) y quedaba una raya
  // horizontal de 29 niveles de azul justo donde se corta el plano. El
  // cuadrado ya evita que lo cercano se lave; el tope sobraba.
  gl_FragColor.rgb = mix(hsv2rgb(nHSV), fogColor, nieblaF * nieblaF);
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
function conAltura(mat, { tinta = false, viento = false, normales = false, nubes = false, cesped = false, pie = false, rio = false } = {}) {
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
      .replace(
        '#include <common>',
        '#include <common>\nuniform float tiempo;\nuniform sampler2D tNubes;\nvarying float vAltura;\nvarying vec2 vMundoXZ;' + (cesped || rio ? GLSL_RUIDO : '') + (tinta || rio ? GLSL_CAUCE : '')
      )
      // la hierba es de doble cara y three le da la vuelta a la normal en
      // la cara trasera: la mitad de cada mata salía a oscuras. La normal
      // se queda mirando arriba, se vea por donde se vea.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + (viento ? '\nnormal = normalize(vNormal);' : ''))
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${
          // `tipoParcela` mira `paseo` ANTES que `rio`, así que 3/0, 4/0 y
          // 5/0 salen «paseo» aunque el río las cruce: había piedra beige
          // bajando el talud y tapizando el lecho a los dos lados del puente.
          // El borde se rompe con ruido para que no sea un recorte de tijera.
          rio ? 'if (cauce(vMundoXZ.x, -vMundoXZ.y) > 0.10 + ruido(vMundoXZ * 0.5) * 0.10) discard;' : ''
        }
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
        ${
          tinta
            ? `// lo alto se aclara y lo bajo se apaga: eso se queda
               diffuseColor.rgb *= mix(vec3(0.86, 0.93, 0.8), vec3(1.06, 1.04, 0.92), clamp((vAltura - 0.2) / 3.0, 0.0, 1.0));
               // La arena iba por ALTURA ABSOLUTA (bajo y = -0,2), y como la
               // pradera baja hasta -0,85 sin que haya río, salían manchas
               // amarillentas por el campo lejos de cualquier agua: el 6,2 %
               // del terreno sin cauce. Ahora va por lo que de verdad la
               // explica: estar cerca del NIVEL DEL AGUA *y* dentro del
               // cauce. El factor de cauce no es decorativo — sin él, cada
               // hondonada de la pradera dispararía la arena igual que antes.
               float cSuelo = cauce(vMundoXZ.x, -vMundoXZ.y);
               float sob = vAltura - ${NIVEL_AGUA.toFixed(2)};
               float arena = (1.0 - smoothstep(0.0, 1.1, sob)) * smoothstep(0.02, 0.15, cSuelo);
               diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.74, 0.57), arena);
               // y el fondo del río, limo: más oscuro y menos saturado
               diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.44, 0.46, 0.36), (1.0 - smoothstep(-0.6, 0.05, sob)) * smoothstep(0.02, 0.2, cSuelo));`
            : ''
        }
        ${
          // La mata se oscurece hacia la base: sin eso, 3.000 quads con el
          // mismo tono de arriba abajo flotan un dedo sobre el suelo. Es el
          // mismo problema de contacto que las piezas, multiplicado por mil,
          // y son tres instrucciones. `vMapUv` y no `vUv`: desde r152 cada
          // mapa lleva su varying, y este material tiene `map`.
          pie ? 'diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.45, vMapUv.y));' : ''
        }
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
  mat.customProgramCacheKey = () => 'altura' + (tinta ? 't' : '') + (viento ? 'v' : '') + (normales ? 'n' : '') + (nubes ? 'c' : '') + (cesped ? 'g' : '') + (pie ? 'p' : '') + (rio ? 'r' : '');
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
function esfera(g, cx, cy, cz, r, color, sy = 1, detalle = 10, colorAbajo = null) {
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
    // con `colorAbajo`, el color va por la ALTURA de la normal: la esfera
    // sale clara arriba y en sombra abajo sin necesidad de luces
    vert(g, colorAbajo ? colorAbajo.clone().lerp(color, n[i + 1] * 0.5 + 0.5) : color, n[i], n[i + 1], n[i + 2]);
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
  } else if (tipo === 'caseta') {
    // La silueta que faltaba entre la tienda (3,2 m) y las casas (6,4 m).
    // `tejado()` llevaba desde el City Kit sin que lo llamara nadie.
    caja(T, -2.5, 0, -2, 2.5, 2.2, 2, BLANCO);
    tejado(F, -2.7, -2.2, 2.7, 2.2, 2.2, 3.5, 0.35, TEJA);
    caja(F, -0.45, 0, 1.95, 0.45, 1.75, 2.1, MADERA);
    caja(F, 1.1, 1.1, 1.95, 1.9, 1.7, 2.05, CRISTAL);
  } else if (tipo === 'cobertizo') {
    // Bajo y largo: lo contrario de las cuatro casas, que son todas bloque
    // de 8 m con tejado a dos aguas.
    caja(T, -4, 0, -1.8, 4, 2, 1.8, BLANCO);
    tejado(F, -4.2, -2, 4.2, 2, 2, 2.9, 3.4, MADERA);
    caja(F, -3.9, 0, 1.75, -2.6, 1.9, 1.85, MADERA);
    caja(F, 2.6, 0, 1.75, 3.9, 1.9, 1.85, MADERA);
  } else if (tipo === 'tendedero') {
    // La pieza con más alma del jardín y la más barata: dos postes, tres
    // tiras y unas cuantas cajas de ropa, que son las que se tiñen.
    prisma(F, 6, 0.07, 0, 1.9, MADERA, 0.06, -1.7, 0);
    prisma(F, 6, 0.07, 0, 1.9, MADERA, 0.06, 1.7, 0);
    for (const z of [-0.18, 0, 0.18]) caja(F, -1.7, 1.82, z - 0.015, 1.7, 1.85, z + 0.015, MASTIL);
    const ropa = [
      [-1.35, 0.5, -0.18],
      [-0.7, 0.62, 0],
      [-0.05, 0.46, 0.18],
      [0.6, 0.58, -0.18],
      [1.2, 0.52, 0],
    ];
    for (const [x, alto, z] of ropa) caja(T, x - 0.26, 1.82 - alto, z - 0.02, x + 0.26, 1.8, z + 0.02, BLANCO);
  } else if (tipo === 'arenero') {
    caja(F, -1.5, 0, -1.5, 1.5, 0.28, 1.5, MADERA);
    caja(F, -1.28, 0.18, -1.28, 1.28, 0.34, 1.28, ARENA);
  } else if (tipo === 'buzon') {
    prisma(F, 6, 0.07, 0, 1.05, MADERA, 0.06);
    caja(T, -0.22, 1.05, -0.16, 0.22, 1.45, 0.16, BLANCO);
    caja(F, 0.22, 1.15, -0.04, 0.34, 1.35, 0.04, TEJA);
  } else if (tipo === 'barbacoa') {
    prisma(F, 8, 0.34, 0, 0.75, METAL, 0.3);
    prisma(F, 12, 0.52, 0.75, 0.92, CARBON, 0.5);
    prisma(F, 12, 0.55, 0.92, 1.0, METAL, 0.55);
    caja(F, 0.5, 0.9, -0.05, 1.1, 0.96, 0.05, METAL);
  } else if (tipo === 'losa' || tipo === 'patio' || tipo === 'patio-g') {
    // Suelo que se DIBUJA. Hasta ahora la categoría eran tres piezas y
    // ninguna hacía una forma: un patio de 12 × 12 salían 9 toques a 4 m de
    // rejilla y el 6 % del presupuesto de la parcela. Estas son geometría
    // generada, así que se TESELAN de verdad (una losa por baldosa) en vez de
    // estirar una textura, que es lo que pasaría escalando un modelo.
    const lado = tipo === 'losa' ? 4 : tipo === 'patio' ? 8 : 12;
    const n = lado / 4;
    const b = lado / 2;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = -b + i * 4;
        const z = -b + j * 4;
        // junta de 12 cm y baldosas de altura ligeramente distinta: sin eso
        // es una lámina lisa y se lee como una pegatina
        const h = 0.1 + ((i * 3 + j * 7) % 3) * 0.012;
        caja(T, x + 0.06, 0, z + 0.06, x + 3.94, h, z + 3.94, BLANCO);
      }
    }
  } else if (tipo === 'parterre') {
    caja(F, -2, 0, -2, 2, 0.16, 2, MADERA);
    caja(F, -1.82, 0.1, -1.82, 1.82, 0.22, 1.82, TIERRA);
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
// A qué altura flota el carrete del corro sobre las cabezas. 2,6 m deja pasar
// por debajo al que anda por delante y no se sale por arriba con la cámara de
// serie, que mira desde bastante alto.
const ALTO_CARRETE = 2.6;
function geometriaAvatar(color, pelo, piel) {
  const g = nuevaGeo();
  esfera(g, 0, 0.96, 0, 0.24, color, 1.4); // cuerpo
  esfera(g, 0, 1.5, 0, 0.27, piel); // cabeza
  esfera(g, 0, 1.6, -0.04, 0.28, pelo, 0.75); // pelo
  esfera(g, -0.1, 1.51, 0.23, 0.04, OJO, 1, 6); // ojos
  esfera(g, 0.1, 1.51, 0.23, 0.04, OJO, 1, 6);
  return aGeo(g);
}
// Los brazos van aparte, como las piernas: así se mueven al andar y al
// saludar sin rehacer la geometría del cuerpo.
function geometriaBrazo(color) {
  const g = nuevaGeo();
  esfera(g, 0, -0.16, 0, 0.1, color, 1.9);
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
    // Antes el color alternaba por ÍNDICE (i % 2) y salía una salchicha a
    // franjas a lo largo, aunque el comentario dijera «blancas arriba y
    // lavanda abajo». Ahora va por la altura de la normal, que es lo que
    // decía. Y se reparten en volumen, no en fila.
    esfera(g, (i - n / 2) * 6 + rnd() * 5, rnd() * 3, rnd() * 8 - 4, r, NUBE, 0.55, 8, NUBE_SOMBRA);
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

// El color con el que se escribe el NOMBRE de alguien en el hilo del corro,
// como en cualquier chat de grupo. Sale del mismo matiz que su marco de
// parcela —así una persona es del mismo color en todo el mundo— pero mucho
// más oscuro: el pastel del marco sobre blanco no se lee.
const cacheColorNombre = new Map();
function colorNombre(id) {
  let c = cacheColorNombre.get(id);
  if (c) return c;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  c = '#' + new THREE.Color().setHSL((h % 360) / 360, 0.62, 0.34).getHexString();
  cacheColorNombre.set(id, c);
  return c;
}

// Los verdes del Nature Kit tiran a menta y turquesa; el mundo de la
// referencia es todo verde hierba, con el follaje en la familia del suelo.
// Así que los verdes azulados del follaje se llevan a ese tono (los demás
// colores, tal cual).
// Lo que hace de verdad `acercaVerde` es girar el matiz de todo lo que caiga
// entre 0,36 y 0,52, y eso tiene dos fallos gordos:
//   · `stone` está en 0,5208 y SE SALVA POR 0,0008, así que la roca, las
//     piedras del camino y el pretil del puente se quedan en #b8e2e8, un cian
//     de hielo: el color más frío de la escena, en el suelo, en un mundo de
//     tarde de verano y encima peleado con la plaza, que es beige cálido.
//   · `leafsGreen` (#29c9ab) y `grass` (#2cd8b8) acaban los dos en el MISMO
//     verde, así que de los cuatro verdes del kit sale uno y medio.
// La tabla los pone por nombre, en la familia del césped del shader (que va
// de 84° a 103° de matiz) pero separados entre sí.
// OJO: `wood` y `woodDark` NO entran. Cada uno aparece con DOS colores
// distintos en el kit (wood es #e59964 en banco/mesa/maceta y #ff8e62 en
// cartel/hoguera/puente), así que meterlos aquí QUITARÍA variedad justo
// donde la hay. Lo que no esté en la tabla sigue pasando por `acercaVerde`.
const PALETA_KIT = {
  leafsGreen: '#60c342',   // #29c9ab -> luminancia 0.646 vs 0.646
  grass: '#7ccb4c',   // #2cd8b8 -> luminancia 0.694 vs 0.695
  plant: '#60c859',   // #2ed193 -> luminancia 0.666 vs 0.666
  leafsDark: '#47a938',   // #2ba6aa -> luminancia 0.549 vs 0.550
  stone: '#e1d9c9',   // #b8e2e8 -> luminancia 0.853 vs 0.853
  stoneDark: '#bcae96',   // #9ab5ba -> luminancia 0.687 vs 0.689
};
// Se gira el MATIZ y se conserva la LUMINANCIA relativa de cada color del kit
// (0,2126 R + 0,7152 G + 0,0722 B), no su claridad HSL: un turquesa y un verde
// con la misma L se ven con brillos muy distintos, porque el turquesa suma
// verde Y azul. Igualando la claridad, el pino —que es `leafsDark` entero— se
// iba a casi negro.
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
  const dichosRef = useRef(null);
  const engineRef = useRef(null);
  const toastT = useRef(null);
  const nombreRef = useRef(null);
  const decirRef = useRef(null);
  // {msg, on}: el texto se conserva mientras se desvanece, si no el aviso se
  // vacía antes de apagarse y queda una píldora en blanco
  const [toast, setToast] = useState({ msg: '', on: false });
  const [sinGL, setSinGL] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [yo, setYo] = useState(null); // {id, nombre, color, pelo, piel}
  const [colorElegido, setColorElegido] = useState(0);
  const [peloElegido, setPeloElegido] = useState(0);
  const [pielElegido, setPielElegido] = useState(0);
  const [editando, setEditando] = useState(false); // la misma hoja, ya presentado
  const [panelVecinos, setPanelVecinos] = useState(false);
  const [vecinos, setVecinos] = useState({ cerca: [], callados: [] });
  // --- el corro: con quién estás hablando ---
  // {k, a: anfitrión, ab: abierto, m: [{id, n}]} o null si andas suelto
  const [corro, setCorro] = useState(null);
  const [invitaciones, setInvitaciones] = useState([]); // quién quiere hablar contigo
  const [llamadas, setLlamadas] = useState([]); // quién llama a la puerta de TU corro
  // la ficha de alguien a quien has tocado en el mundo: {id, nombre, dist, ...}
  const [ficha, setFicha] = useState(null);
  const [registro, setRegistro] = useState(false); // la hoja con todo lo hablado
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

  // La hoja de vecinos se refresca mientras está abierta: la gente anda, y
  // una lista de distancias congelada engaña.
  useEffect(() => {
    if (!panelVecinos) return;
    const t = setInterval(() => setVecinos(engineRef.current?.vecinos() || { cerca: [], callados: [] }), 1500);
    return () => clearInterval(t);
  }, [panelVecinos]);

  // La ficha de un vecino se refresca como la hoja de vecinos: la distancia
  // que pone cambia mientras uno de los dos anda, y una congelada engaña.
  // sin corro no hay nada que leer: la hoja se cierra sola
  useEffect(() => {
    if (!corro) setRegistro(false);
  }, [corro]);

  useEffect(() => {
    if (!ficha) return;
    const t = setInterval(() => setFicha((f) => (f ? engineRef.current?.fichaDe(f.id) || null : null)), 900);
    return () => clearInterval(t);
  }, [ficha?.id]);

  function avisa(msg) {
    setToast({ msg, on: true });
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast((t) => ({ ...t, on: false })), 3200);
  }

  useEffect(() => {
    const p = perfil();
    setYo({ ...p });
    setColorElegido(p.color);
    setPeloElegido(p.pelo);
    setPielElegido(p.piel);
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
    // El mapa de sombras se repinta BAJO DEMANDA. Quieto y orbitando —que es
    // todo el modo obra— se estaba repintando un 2048×2048 cada fotograma
    // para dar exactamente la misma imagen. Quien lo pide: que ande el avatar
    // (más de 0,25 m), que cambie el mundo, que se mueva un vecino, o que
    // haya un gesto o un salto en marcha.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    const params = new URLSearchParams(window.location.search);
    // El banco visual necesita un mundo QUIETO: de `uTiempo` cuelgan la hierba,
    // las copas, las sombras de nube, el agua, los cúmulos y los pájaros, así
    // que con el reloj libre dos capturas de la MISMA escena ya salen
    // distintas y el porcentaje de la hoja de contactos se vuelve un número
    // que se aprende a ignorar. Con `?t=12` el reloj del mundo se para en ese
    // segundo y el diff vuelve a decir la verdad. Ojo: solo congela el reloj
    // del DIBUJO; el del movimiento (`dt`) sigue siendo el de verdad, que si
    // no el avatar no andaría.
    const tFijo = parseFloat(params.get('t'));
    const RELOJ_FIJO = Number.isFinite(tFijo);
    // `?muestrario=1`: en vez del mundo, TODAS las piezas del catálogo en una
    // rejilla, por categorías y con el avatar al lado de cada fila como vara
    // de medir. Es la única forma de ver de un golpe que el pino es 5,6 veces
    // el avatar mientras la palmera es 2,6, o que un mueble del Furniture Kit
    // desentona con el Nature Kit. Va por el mismo camino que el resto
    // (`creaInstancias`), así que lo que se ve aquí es exactamente lo que se
    // ve en el mundo: mismas luces, misma rampa, mismo ACES.
    const MUESTRARIO = params.get('muestrario') === '1';
    // `?miniatura=<tipo>`: UNA pieza, cámara ortográfica fija y fondo liso,
    // para generar las miniaturas de la paleta con el MOTOR DE VERDAD. Las de
    // ahora son los previews que reparte Kenney: tres kits, tres encuadres,
    // seis tamaños distintos (y cuatro no son ni cuadradas), con el objeto
    // ocupando del 3 % al 100 % del lienzo. El resultado es que la escala
    // sale INVERTIDA —una silla se dibuja tres veces más grande que un
    // árbol— y el color no es el del mundo. La marca `zoom` del catálogo es
    // un parche booleano contra una ocupación que va del 3 % al 100 %, así
    // que no arregla nada.
    const MINIATURA = params.get('miniatura');
    const MUESTRA_PASO = 15; // la casona mide 13 m: con menos, se pisan
    const MUESTRA_COLS = 7;
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
        uSol: { value: SOL },
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
        uniform vec3 uSol;
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
          // La silueta del horizonte. Entre el suelo, que se desvanece en la
          // niebla, y la banda de cúmulos no había NADA: dos capas de lectura
          // y un hueco en medio. Esto son dos crestas pintadas en la cúpula
          // con armónicos ENTEROS sobre el acimut, que es lo que hace que
          // cierren sin costura en el meridiano.
          // Es una LÍNEA DE ARBOLADO, no una cordillera: en un mundo llano de
          // colinas de ±3 m por el que se puede andar, una sierra alpina sería
          // un telón de fondo ajeno. Muy desaturada, y la calima que viene
          // justo después le come la base, que es lo que la manda al fondo.
          float ang = d.y > -0.2 ? atan(d.z, d.x) : 0.0;
          float g = fwidth(d.y) * 1.4 + 0.0008;
          // capa lejana: apenas insinuada, más alta
          float cLejos = 0.045 + 0.014 * sin(ang * 3.0 + 0.7) + 0.007 * sin(ang * 7.0 + 2.1);
          color = mix(color, vec3(0.72, 0.80, 0.82), smoothstep(cLejos + g, cLejos - g, d.y) * 0.5);
          // capa cercana: el arbolado, con armónicos altos y poca amplitud
          float cCerca = 0.025 + 0.008 * sin(ang * 7.0 + 1.3) + 0.005 * sin(ang * 13.0 + 0.4) + 0.003 * sin(ang * 23.0);
          color = mix(color, vec3(0.66, 0.77, 0.68), smoothstep(cCerca + g, cCerca - g, d.y) * 0.75);

          // El velo del sol. NO un disco: el sol está a 44,1° de altura y el
          // borde de arriba del encuadre no pasa de 17°, así que un disco o
          // un halo radial quedan fuera de cuadro SIEMPRE. Lo que sí se ve en
          // cualquier encuadre alcanzable es el acimut: la mitad suroeste del
          // horizonte se calienta y la noreste se queda fría, que es la
          // lectura de tarde. Hasta ahora la cúpula era idéntica en las cuatro
          // direcciones y el mundo no sabía dónde tenía el sol.
          float az = dot(normalize(d.xz), normalize(uSol.xz));
          float velo = pow(max(az, 0.0), 3.0) * (1.0 - ajusta(d.y, 0.0, 0.45)) * 0.22;
          color = mix(color, vec3(1.0, 0.95, 0.86), velo);
          color = min(color, vec3(1.0)); // la cúpula no lleva tone mapping: sin esto recortaría plano
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
    const LADO_SOMBRA = 150; // lado de la caja de sombras, en metros
    // El lado de la caja manda sobre el resto: 150 m con 2048 px son 7,3 cm
    // por téxel, y el sesgo se mide en TÉXELES, no en metros a ojo.
    Object.assign(sol.shadow.camera, { left: -LADO_SOMBRA / 2, right: LADO_SOMBRA / 2, top: LADO_SOMBRA / 2, bottom: -LADO_SOMBRA / 2, near: 110, far: 290 });
    // `near/far` ceñidos: la luz está a 200 m del target y la caja, que es
    // perpendicular al rayo, abarca ±77 m de profundidad sobre suelo llano
    // (±75 / sin 44,1° × cos 44,1°). 110..290 deja margen para el relieve
    // (−0,85 a +3,25) y la pieza más alta (la torre, 13,5 m) sin recortar
    // nada. Lo que se gana: el rango pasa de 400 m a 180, así que el MISMO
    // `bias` normalizado vale menos de la mitad en metros.
    sol.shadow.bias = -0.0005; // ≈ 4,5 cm a lo largo del rayo
    // Un `normalBias` de 0,5 m corría la sombra de TODO 0,52 m al noreste
    // (0,5 × √(0,5² + 0,55²) / 0,72, que es la proyección del sol sobre el
    // suelo): peter-panning de manual. Una silla mide 0,45 y una maceta 0,4,
    // así que su sombra quedaba ENTERA separada de la pieza; y el avatar son
    // esferas de 0,24 de radio, o sea que su sombra propia —la cabeza sobre
    // el torso, el brazo sobre el costado— era imposible y el muñeco salía
    // como una calcomanía plana. Era la mitad de la sensación de «flotante».
    // Lo que hace falta de verdad es kilo y medio de téxel:
    sol.shadow.normalBias = (1.5 * LADO_SOMBRA) / 2048;
    scene.add(sol);
    scene.add(sol.target);
    // Dónde estaba el avatar la última vez que se pintó la sombra: si la caja
    // no se ha movido lo bastante, la sombra de antes vale.
    let sombraEn = null;
    function pideSombras() {
      renderer.shadowMap.needsUpdate = true;
      sombraEn = null;
    }
    function sigueElSol(x, h, y) {
      sol.target.position.set(x, h, -y);
      sol.position.copy(sol.target.position).addScaledVector(SOL, 200);
      // La caja de sombras va con el avatar, así que en cuanto anda un poco
      // el mapa ya no sirve. 0,25 m es medio paso: por debajo no se nota.
      if (!sombraEn || Math.hypot(x - sombraEn.x, y - sombraEn.y) > 0.25) {
        renderer.shadowMap.needsUpdate = true;
        sombraEn = { x, y };
      }
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
        // Cuatro escalones y con wrap. El corte de antes estaba en t = 0,53,
        // que es N·L = 0,06: JUSTO en el terminador y sin envolver, así que
        // cada esfera del mundo —el avatar son cinco, las copas son esferas,
        // la torre y la fuente son prismas de doce lados— se partía por la
        // mitad con un borde recto y duro. El 0,44 mete el wrap (la luz da la
        // vuelta un poco por detrás del canto) y la franja 0,44..0,56 es el
        // escalón de media luz que no existía, que es EL rasgo de las rampas
        // pintadas a mano.
        // El tercer corte se queda en 0,88 y no en 0,86 a propósito: el suelo
        // tiene N·L ≈ 0,70, o sea t = 0,85, y con el corte en 0,86 medio
        // terreno saltaría de escalón y todas las capturas se aclararían de
        // golpe.
        const v = t < 0.44 ? 0.18 : t < 0.56 ? 0.46 : t < 0.88 ? 0.88 : 1.0;
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
    // El agua sabe lo HONDA que es. `altura()` es la misma función que levanta
    // el terreno, así que restándola al nivel del agua sale la profundidad en
    // metros, por píxel y sin ningún pase extra ni depth buffer. De ahí sale
    // todo: el color (turquesa en la orilla, azul en el centro), la ESPUMA, y
    // sobre todo la opacidad — poniéndola a 0 en la orilla, la arista dura
    // contra el terreno se disuelve sola, que es el «depth-based softening»
    // sin buffer de profundidad. Y no hace falta salir de MeshToonMaterial:
    // `diffuseColor` se inicializa como vec4(diffuse, opacity), así que
    // escribiendo `.a` dentro de <color_fragment> hay opacidad por píxel y
    // `parcheaNiebla` sigue intacto.
    const matAgua = new THREE.MeshToonMaterial({ color: 0x6db9e6, gradientMap: rampa, transparent: true, opacity: 1 });
    matAgua.onBeforeCompile = (sh) => {
      sh.uniforms.tiempo = uTiempo;
      sh.uniforms.uSol = { value: SOL };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float tiempo;\nvarying vec2 vXZ;\n' + GLSL_CAUCE)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wpa = modelMatrix * vec4(transformed, 1.0);
          vXZ = wpa.xz;
          transformed.y += sin(tiempo * 1.4 + wpa.x * 0.35 + wpa.z * 0.2) * 0.07 + sin(tiempo * 0.9 - wpa.z * 0.5) * 0.05;
          // fuera de la banda del río, el agua se hunde: no hay lagos en los valles
          if (distRioG(wpa.x, -wpa.z) > ${BANDA_AGUA.toFixed(1)}) transformed.y -= 60.0;`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float tiempo;\nuniform vec3 uSol;\nvarying vec2 vXZ;\n' + GLSL_ALTURA)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float prof = ${NIVEL_AGUA.toFixed(2)} - altura(vXZ);
          vec3 someroC = vec3(0.42, 0.78, 0.80);
          vec3 hondoC = vec3(0.10, 0.36, 0.62);
          diffuseColor.rgb = mix(someroC, hondoC, smoothstep(0.0, 1.8, prof));
          // espuma: una banda en el primer palmo de agua, con el borde
          // rompiéndose despacio para que no sea una línea de goma
          float borde = 0.10 + 0.06 * sin(vXZ.x * 0.7 + tiempo * 0.8) + 0.05 * sin(vXZ.y * 0.9 - tiempo * 0.6);
          float espuma = smoothstep(borde + 0.16, borde, prof) * smoothstep(0.0, 0.04, prof);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.98, 1.0), espuma * 0.85);
          // el 0 en la orilla es lo que disuelve la arista contra el terreno
          diffuseColor.a = mix(0.0, 0.95, smoothstep(0.0, 1.2, prof));`
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          {
            // Olas EN EL FRAGMENT, no en el vertex: el plano tiene un vértice
            // cada 8 m y el río mide 18 m de banda, así que las olas del
            // vertex shader (lambda 15,6 y 12,6 m) van por debajo de Nyquist
            // y lo que se veía no era una ola, era aliasing en movimiento.
            // Derivada cerrada de dos senos de lambda 4-8 m, por píxel.
            float a1 = vXZ.x * 0.8 + vXZ.y * 0.45 + tiempo * 1.6;
            float a2 = vXZ.x * 0.35 - vXZ.y * 1.1 - tiempo * 1.1;
            vec3 N = normalize(vec3(-(0.05 * 0.8 * cos(a1) + 0.04 * 0.35 * cos(a2)), 1.0, -(0.05 * 0.45 * cos(a1) - 0.04 * 1.1 * cos(a2))));
            vec3 wp = vec3(vXZ.x, ${NIVEL_AGUA.toFixed(2)}, vXZ.y);
            vec3 V = normalize(cameraPosition - wp);
            vec3 H = normalize(normalize(uSol) + V);
            // el step() es lo que lo hace cartoon: un brillo con borde, no un
            // degradado de plástico
            float esp = step(0.55, pow(max(dot(N, H), 0.0), 60.0));
            // fresnel contra un color de horizonte constante: acotado a 0,6
            // porque si domina, el agua pierde sus dos bandas toon
            float F = min(0.6, 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.79, 0.92, 1.0), F * gl_FragColor.a);
            gl_FragColor.rgb += esp * 0.5 * gl_FragColor.a;
          }`
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
        par.partes.push({ mesh: m, tinte: !!p.tinte, base: p.base || null });
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
      const teñibles = []; // los materiales que el jugador puede pintar
      // `tinte` en el catálogo puede ser `true` (piezas generadas) o el NOMBRE
      // del material del .glb que se pinta (o una lista). `cargaModelo` ya
      // trocea por `groups` y agrupa por material, así que mandar uno a su
      // propia parte son cuatro líneas.
      const pintables = new Set(typeof def.tinte === 'string' ? [def.tinte] : Array.isArray(def.tinte) ? def.tinte : []);
      let baseTinte = null; // el color original, que es lo que se usa con c = 0
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
            const dePaletaKit = PALETA_KIT[m.name];
            const c = (dePaletaKit ? new THREE.Color(dePaletaKit) : acercaVerde((m.color || BLANCO).clone())).convertSRGBToLinear();
            for (let i = 0; i < n; i++) {
              col[i * 3] = c.r;
              col[i * 3 + 1] = c.g;
              col[i * 3 + 2] = c.b;
            }
            g.setAttribute('color', new THREE.BufferAttribute(col, 3));
            g.deleteAttribute('uv');
            if (pintables.has(m.name)) {
              // El color del material NO se hornea tal cual: se guarda
              // RELATIVO al primero de los teñibles, que pasa a ser blanco.
              // Así el vértice conserva la relación entre tonos (la valla
              // tiene su listón claro y su poste oscuro) y el color de verdad
              // lo pone `instanceColor`. Es lo que permite repintar la pieza
              // de arriba abajo en vez de multiplicar un pastel sobre un
              // naranja, que apenas se notaba.
              if (!baseTinte) baseTinte = c.clone();
              const rel = c.clone();
              rel.r /= Math.max(baseTinte.r, 0.001);
              rel.g /= Math.max(baseTinte.g, 0.001);
              rel.b /= Math.max(baseTinte.b, 0.001);
              for (let i = 0; i < n; i++) {
                col[i * 3] = rel.r;
                col[i * 3 + 1] = rel.g;
                col[i * 3 + 2] = rel.b;
              }
              teñibles.push(g);
            } else lisas.push(g);
          }
        }
      });
      const partes = [];
      // Las copas se mecen. `conViento` ya existía, ya estaba calibrado para
      // esto (`smoothstep(1.5, 6.0, position.y)`, que es justo la altura de un
      // árbol) y su propio comentario decía «las copas se mecen», pero
      // `CON_VIENTO` solo tenía la bandera y el bucle que lo aplicaba se
      // saltaba todo lo que tuviera `glb`. Un mundo donde la hierba ondea a
      // los pies y las copas de 8-10 m están clavadas se lee como un decorado.
      // La sombra se queda quieta, y con 0,18 m de amplitud no se echa de menos.
      if (lisas.length) partes.push({ geo: mergeGeometries(lisas, false), mat: def.viento ? matFijoViento : matFijo });
      // La parte teñible conserva su color de vértice original y el tinte se
      // MULTIPLICA encima. Es lo que hace que el cambio sea compatible: todo
      // lo que ya está guardado lleva `c` a 0 —`validaPiezas` lo fuerza— así
      // que si el vértice se pusiera a blanco, el día del cambio todas las
      // vallas del mundo se volverían color arena. Con el tinte normalizado a
      // luminancia 1, `c: 0` deja la pieza casi como estaba y los demás
      // tintes la desplazan de tono sin apagarla.
      // `base` es el color con el que vino la pieza: es lo que se pinta con
      // c = 0, que es lo que lleva TODO lo ya guardado (`validaPiezas` fuerza
      // el 0). Así el día del cambio no se mueve ni un píxel de lo que hay, y
      // el resto de la paleta sí repinta de verdad.
      if (teñibles.length) partes.push({ geo: mergeGeometries(teñibles, false), mat: def.viento ? matTinteViento : matTinte, tinte: true, base: baseTinte });
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
    // La misma paleta pero con luminancia 1: para multiplicar sobre un color
    // que ya existe (las piezas de .glb) en vez de pintar sobre blanco.
    const coloresTinteLin = COLORES.map((h) => new THREE.Color(h).convertSRGBToLinear());
    // Con qué se pinta una parte: si la pieza vino con color propio (las de
    // .glb) el índice 0 lo devuelve tal cual, y del 1 en adelante repinta.
    // Las piezas generadas no tienen base: su vértice ya es blanco.
    const tinteDe = (parte, c) => (parte.base ? (c ? coloresTinteLin[c] || parte.base : parte.base) : coloresTinte[c] || coloresTinte[0]);

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
      { viento: true, nubes: true, pie: true }
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
    // `toneMapped: false` porque la cúpula tampoco pasa por ACES: con él el
    // blanco de la nube caía a 228 mientras los cúmulos pintados de la cúpula
    // se quedaban en 255, y las dos familias de nube no casaban.
    // Opacas: las esferas se solapan DENTRO de la misma malla, así que con
    // `transparent` las circunferencias de intersección se veían como cortes
    // duros. Y con la niebla puesta (a 110 m de alto, nieblaF ≈ 0,19) no hace
    // falta desvanecido propio.
    const matNube = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geometriaNube(rndNubes), matNube);
      // Las siete estaban alineadas al mismo eje X y se veía: cada una a su
      // aire. Y sin `frustumCulled = false`, que eran 7 mallas dibujándose
      // aunque mirases al suelo; three les calcula la envolvente sola.
      m.rotation.y = rndNubes() * Math.PI * 2;
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
    // 10 y no 12: el suelo son 768 m en 160 tramos = 4,80 m por tramo, y el
    // plano se engancha a múltiplos de 48 m (que son 10 × 4,80). Con 10
    // tramos la parcela mide 48 / 10 = 4,80 y sus vértices caen EXACTAMENTE
    // sobre los del suelo, así que las dos mallas se levantan a la misma
    // altura en el vertex shader y la losa deja de hundirse o de asomar en
    // pendiente (con 12 tramos, 4,00 m, el desfase llegaba al metro largo en
    // el talud del río). Lo comparten `plazas`, `marcos` y `marcoObra`, así
    // que arregla de paso los marcos que flotaban sobre la orilla. Y encima
    // son menos vértices: 121 por parcela en vez de 169.
    const geoParcela = new THREE.PlaneGeometry(L, L, 10, 10);
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
      conAltura(new THREE.MeshToonMaterial({ color: 0xdfd0b2, gradientMap: rampa }), { normales: true, nubes: true, rio: true }),
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
    // Escala PROPIA para las piezas. `escI` NO se puede tocar: lo comparte el
    // bucle de los pájaros (`vuelanLosPajaros`), que lo da por hecho a
    // (1,1,1) y no lo escribe nunca; si `pintaMundo` lo mutara, los pájaros
    // saldrían escalados en silencio.
    const escPieza = new THREE.Vector3(1, 1, 1);
    // ... y otra para la losa del paseo, por lo mismo: `escI` no se toca.
    const escPaseo = new THREE.Vector3(1, 1, 1);
    const colorMio = new THREE.Color(0x7fb0ff);
    const cacheColorDueno = new Map();

    // Rehace TODAS las instancias: son cientos o pocos miles, y es más barato
    // que llevar la cuenta de qué instancia era de qué parcela.
    // origen[t][i] = {clave, z}: de qué parcela y qué pieza es cada instancia,
    // para poder tocarla y seleccionarla
    const origen = {};
    // lo que no se puede atravesar: [{x, y, r}] en metros del mundo
    let solidos = [];
    // Siembra el campo alrededor del avatar. Va sobre las MISMAS mallas
    // instanciadas que las piezas de los jugadores, así que no añade ni un
    // draw call: solo instancias. No entra en `solidos` (no vas a chocarte con
    // el monte) ni en `origen` (no se puede tocar ni seleccionar: no es de
    // nadie), y la comprobación de `origen` ya iba con `?.`, así que las
    // instancias sin dueño simplemente no responden al rayo.
    // Una sola pieza en el origen, para la miniatura.
    const cajaMini = new THREE.Box3();
    function pintaMiniatura(cont) {
      const par = mallas[MINIATURA];
      if (!par) return;
      posI.set(0, 0, 0);
      rotI.setFromAxisAngle(ejeY, 0);
      escPieza.set(1, 1, 1);
      mtx.compose(posI, rotI, escPieza);
      cajaMini.makeEmpty();
      for (const q of par.partes) {
        q.mesh.setMatrixAt(0, mtx);
        if (q.tinte) q.mesh.setColorAt(0, tinteDe(q, Number(params.get('c')) || 0));
        q.geo = q.geo || q.mesh.geometry;
        q.mesh.geometry.computeBoundingBox();
        cajaMini.union(q.mesh.geometry.boundingBox);
      }
      cont[MINIATURA] = 1;
    }

    // La hoja de contactos del catálogo: cada pieza en su celda, ordenadas
    // por categoría y en el orden del catálogo, todas con giro 0 y escala 1
    // para que se comparen de verdad.
    function pintaMuestrario(cont) {
      let k = 0;
      for (const cat of Object.keys(CATEGORIAS)) {
        for (const t of Object.keys(PIEZAS)) {
          if (PIEZAS[t].cat !== cat) continue;
          const par = mallas[t];
          if (!par) { k++; continue; }
          const cx = (k % MUESTRA_COLS) * MUESTRA_PASO;
          const cy = -Math.floor(k / MUESTRA_COLS) * MUESTRA_PASO;
          const i = cont[t];
          if (i < MAX_INST) {
            posI.set(cx, alturaEn(cx, cy) - 0.12, -cy);
            rotI.setFromAxisAngle(ejeY, 0);
            escPieza.set(1, 1, 1);
            mtx.compose(posI, rotI, escPieza);
            for (const q of par.partes) {
              q.mesh.setMatrixAt(i, mtx);
              if (q.tinte) q.mesh.setColorAt(i, tinteDe(q, (k * 3) % COLORES.length));
            }
            cont[t] = i + 1;
          }
          k++;
        }
      }
    }

    let campoCentro = null;
    function siembraCampo(cont) {
      if (MUESTRARIO || MINIATURA) return;
      const cx = Math.round(yo.x / CELDA_CAMPO);
      const cy = Math.round(yo.y / CELDA_CAMPO);
      campoCentro = { cx, cy };
      const n = Math.ceil(RADIO_CAMPO / CELDA_CAMPO);
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const gx = cx + i;
          const gy = cy + j;
          const h = hash2(gx * 31 + 5, gy * 17 + 11);
          // A masas y claros: una onda lenta decide dónde hay monte y dónde
          // pradera. Sin ella sale un bosque uniforme, que es tan artificial
          // como no tener nada.
          const wx = (gx + hash2(gx * 3, gy * 13) - 0.5) * CELDA_CAMPO;
          const wy = (gy + hash2(gx * 29, gy * 7) - 0.5) * CELDA_CAMPO;
          const masa = 0.3 + 0.26 * Math.sin(wx * 0.006 + 1.1) * Math.sin(wy * 0.005 - 0.4);
          if (h > masa) continue;
          if (Math.hypot(wx - yo.x, wy - yo.y) > RADIO_CAMPO) continue;
          // ni en el agua ni en su orilla, ni en lo público, ni en lo de nadie
          if (distRio(wx, wy).d < RIO_ANCHO + 6) continue;
          const p = parcelaDe(wx, wy);
          const tipo = tipoParcela(p.px, p.py);
          if (tipo !== 'campo' && tipo !== 'residencial' && tipo !== 'parque') continue;
          const pc = parcelas.get(claveParcela(p.px, p.py));
          if (pc && pc.o && pc.o !== 'mundo') continue; // la parcela de alguien se respeta
          // en lo residencial, mucho más flojo: es donde la gente construye y
          // una parcela no puede venir con un bosque puesto
          if (tipo === 'residencial' && h > masa * 0.45) continue;
          const t = SIEMBRA[Math.floor(hash2(gy * 101 + 3, gx * 61 + 9) * SIEMBRA.length) % SIEMBRA.length];
          const par = mallas[t];
          if (!par) continue;
          const i2 = cont[t];
          if (i2 >= MAX_INST) continue;
          const escala = 0.85 + hash2(gx * 71, gy * 53) * 0.3;
          posI.set(wx, alturaEn(wx, wy) - 0.12, -wy);
          rotI.setFromAxisAngle(ejeY, hash2(gx * 13, gy * 41) * Math.PI * 2);
          escPieza.set(escala, escala, escala);
          mtx.compose(posI, rotI, escPieza);
          for (const q of par.partes) {
            q.mesh.setMatrixAt(i2, mtx);
            // si no se fija, la instancia arrastra el tinte de quien ocupara
            // ese índice antes
            if (q.tinte) q.mesh.setColorAt(i2, tinteDe(q, 0));
          }
          cont[t] = i2 + 1;
        }
      }
    }

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
          const tipoP = tipoParcela(p.px, p.py);
          if (conSuelo(tipoP) && nPlazas < MAX_PARC) {
            // La plaza es una plaza y se queda entera. El PASEO no: recibía
            // una losa de piedra de 48 × 48 m, así que eran 624 m de
            // explanada beige con un camino de 4 m por el medio, las farolas
            // plantadas en piedra vacía y ni una mata de hierba. Un paseo es
            // una banda: 15 m deja las farolas de ±6 m sobre piedra y los
            // árboles de ±11 m sobre hierba, que es justo lo que se busca.
            posI.set(cen.x, 0.04, -cen.y);
            rotI.identity();
            if (tipoP === 'paseo') escPaseo.set(p.py === 0 ? 1 : ANCHO_PASEO / L, 1, p.py === 0 ? ANCHO_PASEO / L : 1);
            else escPaseo.set(1, 1, 1);
            mtx.compose(posI, rotI, escPaseo);
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
        for (const z of MUESTRARIO || MINIATURA ? [] : pc.d || []) {
          const par = mallas[z.t];
          if (!par) continue;
          const wx = bx + z.x;
          const wy = by + z.y;
          const def = PIEZAS[z.t];
          // Variación por instancia. Un parque son 7-11 árboles clonados
          // píxel a píxel, mismo ángulo y mismo tamaño, y eso es lo que hace
          // que un bosque se lea como papel pintado. El giro y la escala
          // salen de un hash de la POSICIÓN, así que son deterministas: los
          // mismos datos dan el mismo mundo en todos los clientes, sin tocar
          // el formato guardado {t,x,y,r,c} ni pedirle nada al servidor.
          // Solo la naturaleza: una casa, un banco o una mesa se colocan a
          // propósito, y torcerlos 20° se lee como descuido, no como bosque.
          // Las de rejilla y las de suelo quedan fuera por definición: tienen
          // que casar unas con otras.
          const suelta = def.cat === 'naturaleza' && !def.rejilla && !def.suelo;
          let giro = (z.r || 0) * (Math.PI / 2);
          let escala = 1;
          if (suelta) {
            const hx = Math.round(wx * 10);
            const hy = Math.round(wy * 10);
            giro += (hash2(hx, hy) - 0.5) * 0.78; // ±22°
            escala = 0.88 + hash2(hy + 7919, hx + 104729) * 0.24; // 0,88..1,12
          }
          if (def.solido) solidos.push({ x: wx, y: wy, r: def.solido * escala });
          // un pelín enterrada: en pendiente, mejor que el borde bajo se hunda
          // a que el alto flote
          posI.set(wx, alturaEn(wx, wy) - 0.12, -wy);
          rotI.setFromAxisAngle(ejeY, giro);
          escPieza.set(escala, escala, escala);
          mtx.compose(posI, rotI, escPieza);
          const i = cont[z.t];
          if (i >= MAX_INST) continue;
          for (const p of par.partes) {
            p.mesh.setMatrixAt(i, mtx);
            if (p.tinte) p.mesh.setColorAt(i, tinteDe(p, z.c | 0));
          }
          origen[z.t][i] = { clave, z };
          cont[z.t] = i + 1;
        }
      }
      // ANTES del bucle que fija los `count`: si no, las instancias del campo
      // se escriben pero no se dibujan.
      if (MINIATURA) pintaMiniatura(cont);
      else if (MUESTRARIO) pintaMuestrario(cont);
      else siembraCampo(cont);
      for (const t in mallas) {
        for (const p of mallas[t].partes) {
          p.mesh.count = cont[t];
          // Solo lo que se usa: `pintaMundo` corre en CADA pointermove del
          // arrastre, y sin esto cada uno subía las 3.000 instancias enteras
          // de las 33 mallas (192 KB × 33 = 6,3 MB por evento).
          p.mesh.instanceMatrix.clearUpdateRanges();
          p.mesh.instanceMatrix.addUpdateRange(0, cont[t] * 16);
          p.mesh.instanceMatrix.needsUpdate = true;
          if (p.tinte) {
            p.mesh.instanceColor.clearUpdateRanges();
            p.mesh.instanceColor.addUpdateRange(0, cont[t] * 3);
            p.mesh.instanceColor.needsUpdate = true;
          }
          // la esfera envolvente del InstancedMesh se calcula UNA vez y se
          // queda: si se calculó con 0 instancias, el rayo de selección no
          // acierta nunca. Se invalida para que se rehaga al siguiente toque.
          p.mesh.boundingSphere = null;
        }
      }
      pintaSeleccion();
      pideSombras(); // ha cambiado lo que hay: la sombra de antes ya no vale
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
          const tipoH = tipoParcela(p.px, p.py);
          // Antes se saltaba la parcela ENTERA, así que un paseo eran 48 m
          // pelados. Ahora solo la banda de losa: la hierba llega al bordillo.
          if (tipoH === 'plaza') continue;
          if (tipoH === 'paseo') {
            const dentro = p.py === 0 ? Math.abs(wy - (p.py * L + L / 2)) : Math.abs(wx - (p.px * L + L / 2));
            if (dentro < ANCHO_PASEO / 2 + 0.6) continue;
          }
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
    // c, p, s: los índices del perfil (ropa, pelo, piel); los mismos que
    // viajan con la presencia, así que un vecino se ve igual en su pantalla y
    // en la tuya.
    // La mancha de contacto: un degradado radial que se MULTIPLICA sobre el
    // suelo. No es una sombra —la del sol ya cae al noreste— sino la oclusión
    // de debajo del pie, que ninguna luz rellena. Sin ella, cuando la sombra
    // proyectada se va lejos el muñeco vuelve a despegarse.
    const texMancha = (() => {
      const S = 64;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, S, S);
      c.clearRect(0, 0, S, S);
      // El degradado va en el ALFA, no en el color: multiplicar con
      // `MultiplyBlending` y `opacity` a la vez no compone (three saca
      // `color * opacity` y encima le pasa el tone mapping, así que la
      // mancha salía como un cuadrado claro). Con alfa y mezcla normal el
      // resultado es el que se ve venir.
      const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(60,78,104,0.55)');
      g.addColorStop(0.45, 'rgba(60,78,104,0.34)');
      g.addColorStop(1, 'rgba(60,78,104,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const geoMancha = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const matMancha = new THREE.MeshBasicMaterial({
      map: texMancha,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
      toneMapped: false, // es oclusión, no luz: que ACES no la toque
    });

    function creaFigura(c, p, s) {
      const grupo = new THREE.Group();
      const cuerpo = new THREE.Mesh(geometriaAvatar(dePaleta(coloresTinte, c), dePaleta(PELOS_3D, p), dePaleta(PIELES_3D, s)), matFijo);
      const geoBrazo = geometriaBrazo(dePaleta(coloresTinte, c));
      const pi = new THREE.Mesh(geoPierna, matFijo);
      const pd = new THREE.Mesh(geoPierna, matFijo);
      const bi = new THREE.Mesh(geoBrazo, matFijo);
      const bd = new THREE.Mesh(geoBrazo, matFijo);
      pi.position.set(-0.12, 0.64, 0);
      pd.position.set(0.12, 0.64, 0);
      bi.position.set(-0.32, 1.14, 0);
      bd.position.set(0.32, 1.14, 0);
      for (const m of [cuerpo, pi, pd, bi, bd]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      const mancha = new THREE.Mesh(geoMancha, matMancha);
      mancha.scale.set(0.78, 1, 0.78);
      mancha.position.y = 0.02;
      mancha.renderOrder = 3; // por encima del marco de parcela y de la obra
      grupo.add(cuerpo, pi, pd, bi, bd, mancha);
      return { grupo, cuerpo, pi, pd, bi, bd, mancha };
    }
    const avatar = creaFigura(jugador.color, jugador.pelo, jugador.piel);
    // --- modo miniatura: fuera todo menos la pieza ---
    let camMini = null;
    if (MINIATURA) {
      suelo.visible = false;
      agua.visible = false;
      hierba.visible = false;
      cielo.visible = false;
      pajaros.visible = false;
      marcos.visible = false;
      plazas.visible = false;
      marcoObra.visible = false;
      for (const nb of nubes) nb.m.visible = false;
      avatar.grupo.visible = false;
      scene.fog = null;
      scene.background = new THREE.Color(0xeaf3fb);
      document.body.classList.add('miniatura');
      // Ortográfica y SIEMPRE desde el mismo sitio: es lo que hace que dos
      // miniaturas se puedan comparar. 45° de acimut y 60° de polar, que es
      // el tres cuartos de toda la vida.
      camMini = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
      const dir = new THREE.Vector3(Math.cos(Math.PI / 4), Math.tan(Math.PI / 6), Math.sin(Math.PI / 4)).normalize();
      camMini.position.copy(dir).multiplyScalar(60);
      camMini.lookAt(0, 0, 0);
    }
    scene.add(avatar.grupo);
    sigueElSol(0, 0, 0);
    // posición en metros del mundo (y hacia el norte); rumbo en radianes
    // `faseResp` desplaza la respiración de cada figura: sin ella, dos
    // vecinos parados suben y bajan a la vez y se ve la máquina. Sale del id,
    // así que es la misma en todas las pantallas.
    const faseDeId = (id) => (parseInt(String(id).slice(-4), 16) || 0) / 65535 * Math.PI * 2;
    const yo = { x: L / 2, y: L / 2 - 12, h: 0, rumbo: 0, destino: null, fase: 0, amp: 0, andando: false, faseResp: faseDeId(jugador.id) };
    const px0 = parseFloat(params.get('x'));
    const py0 = parseFloat(params.get('y'));
    if (Number.isFinite(px0) && Number.isFinite(py0)) {
      yo.x = px0;
      yo.y = py0;
    }
    yo.h = alturaEn(yo.x, yo.y);
    // Un gesto dura lo que el emoji que sube: entra rápido, se sostiene y
    // sale suave. Los brazos giran desde el hombro (que es donde está su
    // origen), así que basta con un ángulo por brazo.
    const GESTO_MS = 1500;
    // Persigue un rumbo por el camino corto, con la constante de tiempo de
    // siempre (1 - e^(-dt·k)): sirve para el avatar propio y para los vecinos.
    function giraHacia(o, objetivo, dt) {
      if (o.rumbo == null) { o.rumbo = objetivo; return; }
      let d = objetivo - o.rumbo;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      o.rumbo += d * (1 - Math.exp(-dt * 11));
    }

    function colocaFigura(f, o) {
      // `amp` va de 0 a 1 y de vuelta: es lo que hace que la zancada arranque
      // y frene en vez de aparecer y desaparecer de un fotograma a otro.
      const amp = o.amp != null ? o.amp : o.andando ? 1 : 0;
      const salto = Math.abs(Math.sin(o.fase)) * 0.06 * amp;
      const a = Math.sin(o.fase) * 0.65 * amp;
      // Respiración: quieto, el muñeco era una estatua. Sube y baja un
      // centímetro y se balancea un grado, con la fase desplazada por figura
      // para que dos vecinos parados no respiren a la vez. NO se escala
      // `f.cuerpo`: es la malla fusionada de cuerpo, cabeza, pelo y ojos, y
      // los brazos son hermanos suyos, así que un 2 % en Y estiraría el
      // cuello y despegaría los brazos.
      const quieto = 1 - amp;
      const tResp = uTiempo.value + (o.faseResp || 0);
      const resp = Math.sin(tResp * 1.9) * 0.012 * quieto;
      f.pi.rotation.x = a;
      f.pd.rotation.x = -a;
      // los brazos van al contrario que las piernas, como al andar de verdad
      let bix = -a * 0.55;
      let bdx = a * 0.55;
      let biz = 0;
      let bdz = 0;
      let brinco = 0;
      if (o.gesto) {
        const u = (performance.now() - o.gesto.t) / GESTO_MS;
        if (u >= 1) o.gesto = null;
        else {
          // k sube de golpe y baja al final: sin esto el brazo aparece y
          // desaparece de un fotograma a otro
          const k = Math.sin(Math.min(1, u * 4) * Math.PI * 0.5) * (u > 0.78 ? (1 - u) / 0.22 : 1);
          if (o.gesto.tipo === 'saluda') {
            bdx = 0;
            bdz = (2.5 + Math.sin(u * Math.PI * 7) * 0.28) * k; // el brazo derecho arriba, saludando
          } else if (o.gesto.tipo === 'salta') {
            bix = 0;
            bdx = 0;
            biz = -2.6 * k;
            bdz = 2.6 * k;
            brinco = Math.abs(Math.sin(u * Math.PI * 2)) * 0.26 * k;
          } else {
            bix = -1.5 * k; // los dos brazos al frente
            bdx = -1.5 * k;
            biz = 0.55 * k;
            bdz = -0.55 * k;
          }
        }
      }
      f.bi.rotation.set(bix, 0, biz);
      f.bd.rotation.set(bdx, 0, bdz);
      f.cuerpo.position.y = resp;
      f.bi.position.y = 1.14 + resp;
      f.bd.position.y = 1.14 + resp;
      f.grupo.rotation.z = Math.sin(tResp * 0.42) * 0.018 * quieto;
      f.grupo.position.set(o.x, o.h + salto + brinco, -o.y);
      f.grupo.rotation.y = o.rumbo;
      // la mancha se queda en el SUELO y se encoge con la altura del brinco:
      // si subiera con el grupo, el muñeco llevaría la mancha pegada al pie
      const alto = salto + brinco;
      const k = Math.max(0, 1 - alto * 2.2);
      f.mancha.position.y = 0.02 - alto;
      f.mancha.scale.set(0.78 * (0.6 + 0.4 * k), 1, 0.78 * (0.6 + 0.4 * k));
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
    // A quién has silenciado. Vive en este dispositivo y no se le dice a
    // nadie: es tu decisión sobre tu pantalla, no un castigo (eso es
    // reportar). De un silenciado no se pinta ni lo que dice, ni sus gestos,
    // ni su nombre, que también puede ser el problema.
    const callados = new Set(Object.keys(silenciados()));
    const otros = new Map(); // id → {figura, o: {x, y, h, rumbo, ...}, objetivo, nombre, color, visto}
    const nodos = new Map(); // id → <div> del nombre
    function creaOtro(id, datos) {
      const figura = creaFigura(datos.c, datos.p, datos.s);
      figura.grupo.userData.id = id; // para saber a quién se ha tocado
      scene.add(figura.grupo);
      const o = {
        figura,
        color: datos.c,
        pelo: datos.p,
        piel: datos.s,
        nombre: datos.n,
        visto: Date.now(),
        dice: null, // lo que dice ahora mismo, si dice algo
        diceT: 0, // ... y cuándo lo dijo: distingue lo nuevo de lo repetido
        gestoT: 0,
        corro: datos.k || null, // en qué corro anda, si anda en uno
        aparte: false, // habla en su corro: se ve que habla, no lo que dice
        o: { x: datos.x, y: datos.y, h: alturaEn(datos.x, datos.y), rumbo: datos.r, fase: 0, amp: 0, andando: false, faseResp: faseDeId(id) },
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
      o.figura.bi.geometry.dispose(); // los dos brazos comparten geometría
      otros.delete(id);
      const el = nodos.get(id);
      if (el) {
        el.remove();
        nodos.delete(id);
      }
    }

    // --- el corro: el círculo en el suelo ---
    // Que dos personas estén hablando tiene que VERSE en el mundo, no solo en
    // una lista: un corro se dibuja como un círculo de luz en el suelo que
    // abarca a los que están dentro, con un aro a los pies de cada uno. Desde
    // lejos se lee «ahí hay una conversación» antes de meterse en ella, y
    // desde dentro se ve quién está y quién no.
    //
    // El círculo NO tiene un sitio fijo: se calcula en cada fotograma del
    // centro y la separación de los que se ven, así que se abre cuando entra
    // alguien y se estrecha cuando el grupo se junta. Como un corro de verdad.
    let corroMio = null; // {k, a: anfitrión, ab: abierto, m: [{id, n}]}
    const corrosCerca = new Map(); // k → {a, n, ab, c} de los corros a la vista
    const llamando = new Set(); // quién llama a la puerta del mío (solo lo sabe el anfitrión)
    const grupoCorros = new THREE.Group();
    scene.add(grupoCorros);
    // Como el marco de parcela: la geometría ya viene tumbada, así el shader
    // de altura sube la Y del MUNDO y el círculo se ciñe a la colina. Si se
    // tumbara el mesh (rotation.x), el shader subiría la Y del anillo, que
    // tras girarla ya no es la vertical, y el círculo saldría escorado.
    const aroPlano = (r0, r1, n) => {
      const g = new THREE.RingGeometry(r0, r1, n, r0 > 0 ? 1 : 2);
      g.rotateX(-Math.PI / 2);
      return g;
    };
    const geoAro = aroPlano(0.88, 1, 72);
    const geoLuz = aroPlano(0, 1, 48);
    const geoPie = aroPlano(0.38, 0.58, 26);
    // El tuyo en azul (el color de lo tuyo en todo el mundo: tu marco, tu
    // nombre) y los demás en ámbar cálido, que sobre la hierba se lee y no se
    // confunde con el tuyo.
    //
    // Lo de dentro se pinta SUMANDO luz en vez de tapando: un velo de color
    // sobre la arena de la plaza la deja gris, como una mancha; sumando, el
    // suelo se aclara y el corro se lee como un claro iluminado lo mismo
    // sobre la hierba que sobre la losa.
    const matCorro = (color, opacity, luz) =>
      conAltura(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: luz ? THREE.AdditiveBlending : THREE.NormalBlending,
        })
      );
    const matAro = { mio: matCorro(0x2f6fed, 0.85), otro: matCorro(0xf59027, 0.85) };
    const matLuz = { mio: matCorro(0x6fa4ff, 0.2, true), otro: matCorro(0xffc46b, 0.2, true) };
    const corrosVista = new Map(); // k → {grupo, aro, luz, pies: Map(id → Mesh), mio}
    let firmaCorros = '';

    // Quién anda en cada corro, de los que se ven desde aquí (yo incluido).
    function genteDeCorros() {
      const m = new Map();
      const mete = (k, id) => {
        if (!k) return;
        const l = m.get(k) || m.set(k, []).get(k);
        if (!l.includes(id)) l.push(id);
      };
      if (corroMio) mete(corroMio.k, jugador.id);
      for (const [id, o] of otros) mete(o.corro, id);
      return m;
    }

    // Los aros se rehacen solo cuando cambia QUIÉN está en cada corro (entra
    // alguien, se va, aparece por el horizonte): en el fotograma normal solo
    // se mueven, que es lo barato.
    function sincronizaCorros(gente) {
      const firma = [...gente]
        .map(([k, ids]) => k + ':' + [...ids].sort().join(','))
        .sort()
        .join('|');
      if (firma === firmaCorros) return;
      firmaCorros = firma;
      for (const [k, v] of corrosVista) {
        if (gente.has(k)) continue;
        grupoCorros.remove(v.grupo);
        v.globo?.remove();
        corrosVista.delete(k);
      }
      for (const [k, ids] of gente) {
        const mio = k === corroMio?.k;
        let v = corrosVista.get(k);
        if (v && v.mio !== mio) {
          grupoCorros.remove(v.grupo);
          v.globo?.remove();
          corrosVista.delete(k);
          v = null;
        }
        if (!v) {
          const grupo = new THREE.Group();
          const aro = new THREE.Mesh(geoAro, matAro[mio ? 'mio' : 'otro']);
          const luz = new THREE.Mesh(geoLuz, matLuz[mio ? 'mio' : 'otro']);
          // sobre el marco de parcela (0,07) y la losa de plaza (0,04): si no,
          // en la plaza el círculo se pelearía con el suelo
          aro.position.y = 0.15;
          luz.position.y = 0.11;
          for (const m of [aro, luz]) {
            m.frustumCulled = false;
            // por encima de la mancha de contacto de los avatares (que va a
            // 3): los dos son transparentes y sin escribir profundidad, así
            // que el orden lo tiene que decir alguien
            m.renderOrder = 4;
          }
          grupo.add(luz, aro);
          grupoCorros.add(grupo);
          v = { grupo, aro, luz, pies: new Map(), mio, globo: null, centro: null };
          // Un corro que no es el tuyo lleva un globo MUDO sobre el grupo:
          // tres puntos y nada más. De fuera se ve que ahí se está hablando,
          // que es lo que hace falta saber; lo que se dice es de los de
          // dentro. Es la misma idea que el «…» sobre una cabeza, pero
          // colgada del grupo, que es quien tiene la conversación.
          if (!mio && rotulosRef.current) {
            const g = document.createElement('div');
            g.className = 'globo-mudo';
            for (let i = 0; i < 3; i++) g.appendChild(document.createElement('i'));
            rotulosRef.current.appendChild(g);
            v.globo = g;
          }
          corrosVista.set(k, v);
        }
        for (const [id, pie] of v.pies) {
          if (ids.includes(id)) continue;
          v.grupo.remove(pie);
          v.pies.delete(id);
        }
        for (const id of ids) {
          if (v.pies.has(id)) continue;
          const pie = new THREE.Mesh(geoPie, matAro[mio ? 'mio' : 'otro']);
          pie.position.y = 0.16; // un pelo sobre el círculo grande: donde se cruzan, no parpadean
          pie.frustumCulled = false;
          pie.renderOrder = 4;
          v.grupo.add(pie);
          v.pies.set(id, pie);
        }
      }
    }

    // --- el hilo: el carrete sobre el corro y las cuentas que vuelan ---
    // Cada frase sale de la cabeza de quien la dice, describe un arco y cae en
    // un carrete que flota sobre el centro del corro. Así se ve DE QUIÉN sale
    // cada cosa (que es lo que se perdía al juntarlo todo en un sitio) y a la
    // vez queda leído lo hablado, con el nombre delante como en cualquier
    // chat de grupo.
    //
    // Es DOM proyectado, como los rótulos y los carteles: un texto metido en
    // el 3D saldría pixelado y habría que rehacerlo en cada letra.
    let carrete = null;
    let carreteLineas = null;
    let ultimaLinea = null; // {ts, q} de lo último que ya se ha pintado
    let centroMio = null; // dónde está el centro de MI corro, para colgar el carrete

    function haceCarrete() {
      const cont = rotulosRef.current;
      if (carrete || !cont) return;
      carrete = document.createElement('div');
      carrete.className = 'carrete';
      const cab = document.createElement('div');
      cab.className = 'cab';
      carreteLineas = document.createElement('div');
      carreteLineas.className = 'lineas';
      carrete.append(cab, carreteLineas);
      carrete._cab = cab;
      cont.appendChild(carrete);
    }
    function quitaCarrete() {
      carrete?.remove();
      carrete = null;
      carreteLineas = null;
      ultimaLinea = null;
    }
    // Una línea del hilo. El nombre solo sale cuando cambia quien habla, como
    // en un chat de grupo: repetirlo en cada frase de la misma persona es
    // ruido, y aquí el sitio es oro.
    function meteLinea(l) {
      if (!carreteLineas) return;
      const previa = carreteLineas.lastElementChild;
      const el = document.createElement('div');
      el.className = 'linea entra';
      el.dataset.de = l.q;
      if (previa?.dataset.de !== l.q) {
        const b = document.createElement('b');
        b.textContent = l.q === jugador.id ? 'Tú' : l.n;
        b.style.color = l.q === jugador.id ? '#2f6fed' : colorNombre(l.q);
        el.appendChild(b);
      } else el.classList.add('sigue');
      const t = document.createElement('span');
      t.textContent = l.t; // textContent, nunca marcado: lo escribe otra persona
      el.appendChild(t);
      carreteLineas.appendChild(el);
      while (carreteLineas.children.length > CORRO_LINEAS_VISTA) carreteLineas.firstElementChild.remove();
    }

    // Dónde cae en pantalla un punto del mundo, sin tocar ningún nodo: es lo
    // que necesitan las cuentas para saber de dónde salen y adónde van.
    const pProyecta = new THREE.Vector3();
    function enPantalla(x, y, h, alto) {
      pProyecta.set(x, h + alto, -y);
      if (pProyecta.distanceTo(camera.position) > 160) return null;
      pProyecta.project(camera);
      if (pProyecta.z > 1 || Math.abs(pProyecta.x) > 1.3 || Math.abs(pProyecta.y) > 1.3) return null;
      return { sx: (pProyecta.x * 0.5 + 0.5) * vpW, sy: (-pProyecta.y * 0.5 + 0.5) * vpH };
    }

    // La cuenta: sale de la cabeza y cae en el carrete describiendo un arco.
    // El arco son DOS traslaciones anidadas con curvas distintas —la de fuera
    // lleva el avance en X a ritmo constante y la de dentro la caída en Y con
    // su propia curva—, que es lo que dobla el vuelo sin escribir una ruta.
    const VUELO_MS = 620;
    function lanzaCuenta(l, alLlegar) {
      const cont = rotulosRef.current;
      const quien = l.q === jugador.id ? yo : otros.get(l.q)?.o;
      const de = quien && cont ? enPantalla(quien.x, quien.y, quien.h, ALTO_AVATAR + 0.35) : null;
      const a = centroMio && cont ? enPantalla(centroMio.x, centroMio.y, centroMio.h, ALTO_AVATAR + ALTO_CARRETE) : null;
      // sin sitio de salida o de llegada (fuera de cámara), la línea entra sin
      // vuelo: lo que no se puede perder es lo dicho
      if (!de || !a) return alLlegar();
      const fuera = document.createElement('i');
      fuera.className = 'cuenta';
      const dentro = document.createElement('i');
      dentro.style.background = l.q === jugador.id ? '#2f6fed' : colorNombre(l.q);
      fuera.appendChild(dentro);
      fuera.style.transform = 'translate3d(' + Math.round(de.sx) + 'px,' + Math.round(de.sy) + 'px,0)';
      cont.appendChild(fuera);
      try {
        fuera.animate([{ translate: '0 0' }, { translate: Math.round(a.sx - de.sx) + 'px 0' }], { duration: VUELO_MS, easing: 'linear', fill: 'forwards' });
        dentro.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(' + Math.round(a.sy - de.sy) + 'px) scale(.55)' }], {
          duration: VUELO_MS,
          easing: 'cubic-bezier(.35,-0.35,.6,1)',
          fill: 'forwards',
        });
      } catch {
        /* sin Web Animations: la cuenta se queda quieta y desaparece igual */
      }
      setTimeout(() => {
        fuera.remove();
        alLlegar();
      }, VUELO_MS - 40);
    }

    // Lo que llega en el hilo del sondeo. El servidor manda el hilo ENTERO
    // (desde que entraste), no los sucesos: se busca por dónde iba y se pinta
    // lo que falte, que es lo que aguanta un sondeo perdido.
    function llegaHilo(h) {
      if (!carreteLineas) return;
      let desde = 0;
      if (ultimaLinea) {
        const i = h.findIndex((l) => l.ts === ultimaLinea.ts && l.q === ultimaLinea.q);
        desde = i < 0 ? 0 : i + 1; // si ya no está, se ha caído por el tope: se pinta todo
      }
      for (let i = desde; i < h.length; i++) {
        const l = h[i];
        ultimaLinea = { ts: l.ts, q: l.q };
        // solo vuela lo que acaba de decirse; al entrar en un corro con hilo,
        // lo de antes se pone de golpe y no cae una lluvia de cuentas
        if (Date.now() - l.ts < 4000) lanzaCuenta(l, () => meteLinea(l));
        else meteLinea(l);
      }
    }

    // A cuánto estás del corro: al centro de LOS DEMÁS, la misma cuenta que
    // hace el servidor para sacarte. Sirve para avisar ANTES de que pase.
    let lejosDelCorro = 0;
    let avisadoLejos = false;
    function colocaCorros(tms) {
      // Lo normal es que no haya ningún corro a la vista, y esto va en CADA
      // fotograma: antes de montar mapas y firmas se sale por la puerta de
      // atrás, que es un recorrido por los vecinos sin reservar nada.
      if (!corroMio && corrosVista.size === 0) {
        let alguno = false;
        for (const o of otros.values())
          if (o.corro) {
            alguno = true;
            break;
          }
        if (!alguno) return;
      }
      const gente = genteDeCorros();
      sincronizaCorros(gente);
      // el círculo respira despacio, como una conversación en marcha; el
      // pulso va en el material, que es compartido: una cuenta para todos
      const pulso = 0.72 + Math.sin(tms * 0.0026) * 0.16;
      matAro.mio.opacity = pulso;
      matAro.otro.opacity = pulso * 0.85;
      lejosDelCorro = 0;
      centroMio = null;
      for (const [k, ids] of gente) {
        const v = corrosVista.get(k);
        if (!v) continue;
        let sx = 0;
        let sy = 0;
        let n = 0;
        let sxOtros = 0;
        let syOtros = 0;
        let nOtros = 0;
        for (const id of ids) {
          const o = id === jugador.id ? yo : otros.get(id)?.o;
          if (!o) continue;
          sx += o.x;
          sy += o.y;
          n++;
          if (id !== jugador.id) {
            sxOtros += o.x;
            syOtros += o.y;
            nOtros++;
          }
        }
        // un corro del que no se ve a nadie (todos fuera del radio de la
        // presencia) no se pinta, pero tampoco se borra: volverá
        if (!n) {
          v.grupo.visible = false;
          v.centro = null;
          if (v.globo) v.globo.style.display = 'none';
          if (v.mio) centroMio = null;
          continue;
        }
        v.grupo.visible = true;
        const cx = sx / n;
        const cy = sy / n;
        let r = 2.4;
        for (const id of ids) {
          const o = id === jugador.id ? yo : otros.get(id)?.o;
          if (o) r = Math.max(r, Math.hypot(o.x - cx, o.y - cy) + 1.6);
        }
        v.aro.position.x = cx;
        v.aro.position.z = -cy;
        v.aro.scale.set(r, 1, r);
        v.luz.position.copy(v.aro.position);
        v.luz.position.y = 0.11;
        v.luz.scale.set(r, 1, r);
        for (const [id, pie] of v.pies) {
          const o = id === jugador.id ? yo : otros.get(id)?.o;
          pie.visible = !!o;
          if (!o) continue;
          pie.position.x = o.x;
          pie.position.z = -o.y;
        }
        v.centro = { x: cx, y: cy, h: alturaEn(cx, cy) };
        // un corro ajeno enseña el globo mientras alguien de dentro esté
        // hablando, y lo esconde en cuanto callan
        if (v.globo) {
          let hablan = false;
          for (const id of ids) {
            const o = otros.get(id);
            if (o && (o.aparte || o.dice)) {
              hablan = true;
              break;
            }
          }
          v.globo.classList.toggle('hablando', hablan);
        }
        if (v.mio) {
          centroMio = v.centro;
          if (nOtros) lejosDelCorro = Math.hypot(sxOtros / nOtros - yo.x, syOtros / nOtros - yo.y);
        }
      }
    }

    // Lo que llega del sondeo sobre el corro. El servidor manda el ESTADO
    // (quién está dentro, quién espera en la puerta), no los sucesos: los
    // avisos salen de compararlo con lo que había, que es lo que aguanta un
    // sondeo perdido sin contar dos veces lo mismo ni quedarse mudo.
    let invitaPrev = new Set();
    let llamaPrev = new Set();
    let corroPrev = '';
    const mismos = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const MOTIVOS = {
      llamando: 'Has llamado a la puerta: espera a que te dejen entrar',
      lejos: 'Tenéis que estar más cerca para eso',
      lleno: 'El corro está lleno: caben ' + CORRO_MAX,
      ya: 'Ya estáis en el mismo corro',
      no_esta: 'Esa persona ya no anda por aquí',
      no_hay: 'Ese corro ya no existe',
      no_estas: 'No estás en ningún corro',
      no_anfitrion: 'La puerta la abre quien empezó el corro',
      sin_invitacion: 'Esa invitación ya ha caducado',
      no_llama: 'Ya no llama a la puerta',
    };
    function cuentaAlLector(txt) {
      if (dichosRef.current) dichosRef.current.textContent = txt;
    }
    function llegaCorro(j, pedido) {
      const antes = corroMio;
      corroMio = j.corro || null;
      corrosCerca.clear();
      for (const c of j.corros || []) corrosCerca.set(c.k, c);
      // a un silenciado no se le contesta a la puerta: silenciar es dejar de
      // verle, y una invitación suya es justo lo que no se quiere ver
      const inv = (j.invita || []).filter((v) => !callados.has(v.de));
      const llaman = (j.llaman || []).filter((v) => !callados.has(v.de));
      llamando.clear();
      for (const v of llaman) llamando.add(v.de);

      // Solo se toca el estado de React cuando ha CAMBIADO algo: el sondeo va
      // cada 1,5 s y una lista nueva en cada uno repintaría la interfaz
      // entera cuarenta veces por minuto para nada.
      const idsInv = new Set(inv.map((v) => v.de));
      if (!mismos(idsInv, invitaPrev)) {
        for (const v of inv)
          if (!invitaPrev.has(v.de)) {
            avisa(v.n + ' quiere hablar contigo');
            cuentaAlLector(v.n + ' quiere hablar contigo');
          }
        invitaPrev = idsInv;
        setInvitaciones(inv);
      }
      const idsLlaman = new Set(llaman.map((v) => v.de));
      if (!mismos(idsLlaman, llamaPrev)) {
        for (const v of llaman)
          if (!llamaPrev.has(v.de)) {
            avisa(v.n + ' llama a la puerta del corro');
            cuentaAlLector(v.n + ' llama a la puerta del corro');
          }
        llamaPrev = idsLlaman;
        setLlamadas(llaman);
      }
      // el carrete existe mientras exista el corro, y se lleva el hilo
      if (corroMio) {
        if (!carrete || (antes && antes.k !== corroMio.k)) {
          quitaCarrete();
          haceCarrete();
        }
        if (carrete) {
          const otrosN = corroMio.m.length - 1;
          const cab = 'Corro · ' + (otrosN === 1 ? corroMio.m.find((v) => v.id !== jugador.id)?.n || 'alguien' : corroMio.m.length + ' personas');
          if (carrete._cab.textContent !== cab) carrete._cab.textContent = cab;
          llegaHilo(corroMio.h || []);
        }
      } else if (carrete) quitaCarrete();

      const ult = corroMio?.h?.[corroMio.h.length - 1];
      const fCorro = corroMio ? corroMio.k + '|' + corroMio.ab + '|' + corroMio.m.map((v) => v.id).join(',') + '|' + (corroMio.h?.length || 0) + '|' + (ult ? ult.ts : 0) : '';
      if (fCorro !== corroPrev) {
        const eranIds = antes ? antes.m.map((v) => v.id) : [];
        corroPrev = fCorro;
        setCorro(corroMio);
        if (corroMio && (!antes || antes.k !== corroMio.k)) {
          const otrosN = corroMio.m.filter((v) => v.id !== jugador.id).map((v) => v.n);
          avisa('Estáis de corro: ' + otrosN.join(', ') + '. Lo que digáis no sale de aquí');
          cuentaAlLector('Estás en un corro con ' + otrosN.join(', '));
          setChatOpen(true); // lo primero que se querrá hacer es hablar
        } else if (!corroMio && antes) {
          // el servidor no dice por qué te has salido: lo sabe el cliente,
          // que es quien ha pulsado «Salir» y quien mide cuánto te has alejado
          const porqué =
            pedido?.a === 'sale' ? 'Has salido del corro' : lejosDelCorro > CORRO_AVISO_M ? 'Te has alejado: has salido del corro' : 'Se ha acabado el corro';
          avisa(porqué);
          cuentaAlLector('Ya no estás en el corro');
        } else if (corroMio && antes) {
          for (const v of corroMio.m) if (!eranIds.includes(v.id) && v.id !== jugador.id) avisa(v.n + ' se ha unido al corro');
          for (const v of antes.m) if (!corroMio.m.some((w) => w.id === v.id)) avisa(v.n + ' ha salido del corro');
        }
      }
      // lo que salga de lo que TÚ has pedido: el servidor manda el motivo y
      // aquí se dice con palabras, que «no_anfitrion» no se lo lee nadie
      if (pedido && j.corroR) {
        if (j.corroR === 'ok') {
          if (pedido.a === 'invita') avisa('Se lo has pedido: a ver si te contesta');
          else if (pedido.a === 'echa') avisa('Le has sacado del corro');
        } else avisa(MOTIVOS[j.corroR] || 'No se ha podido');
      }
    }

    // --- sobre las cabezas: el nombre, lo que dice y los gestos ---
    // Son <div> proyectados desde el 3D en cada fotograma, no geometría: un
    // texto en el mundo saldría pixelado y habría que rehacerlo al escribir.
    const pv = new THREE.Vector3();
    let vpW = 1;
    let vpH = 1;
    // Coloca un nodo sobre un punto del mundo. Devuelve la distancia a la
    // cámara, o null si queda detrás o demasiado lejos para leerse.
    function sitúa(el, x, y, h, alto, lejos = 160) {
      pv.set(x, h + alto, -y);
      const dist = pv.distanceTo(camera.position);
      pv.project(camera);
      if (pv.z > 1 || dist > lejos || Math.abs(pv.x) > 1.1 || Math.abs(pv.y) > 1.1) {
        el.style.display = 'none';
        return null;
      }
      el.style.display = '';
      el.style.transform =
        'translate3d(' + Math.round((pv.x * 0.5 + 0.5) * vpW) + 'px,' + Math.round((-pv.y * 0.5 + 0.5) * vpH) + 'px,0) translate(-50%,-100%)';
      return dist;
    }
    // Un gesto: el emoji sube y se desvanece (eso lo hace el CSS) mientras el
    // JS lo lleva pegado a la cabeza de quien lo hizo, que puede ir andando.
    const gestos = [];
    function lanzaGesto(id, clave) {
      const cont = rotulosRef.current;
      const e = EMOTES[clave];
      if (!cont || !e) return;
      // lo primero, el cuerpo: el emoji es el adorno
      const quien = id === 'yo' ? yo : otros.get(id)?.o;
      if (quien && e.cuerpo) quien.gesto = { tipo: e.cuerpo, t: performance.now() };
      const el = document.createElement('div');
      el.className = 'gesto';
      const i = document.createElement('i');
      i.textContent = e.emoji;
      el.appendChild(i);
      cont.appendChild(el);
      const g = { id, el };
      gestos.push(g);
      setTimeout(() => {
        el.remove();
        const k = gestos.indexOf(g);
        if (k >= 0) gestos.splice(k, 1);
      }, 1700);
    }
    // --- carteles: de quién es cada parcela ---
    // El mundo se construye entre todos, pero conectados hay poca gente a la
    // vez, así que casi siempre se anda entre casas de nadie. El cartel dice
    // de quién es cada una y a cuánta gente le gusta: el trabajo de alguien se
    // ve aunque no coincidáis. Se rehacen al cambiar de parcela o al llegar
    // datos, y se colocan en cada fotograma como los nombres.
    const carteles = new Map(); // clave de parcela → <div>
    const CARTELES_RADIO = 2; // parcelas a la redonda
    const CARTEL_LEJOS = 130; // m: más allá no se lee y estorba
    const CARTEL_ALTO = 4; // m sobre el suelo: con la cámara de serie, más alto se sale por arriba
    function sincronizaCarteles() {
      const cont = rotulosRef.current;
      if (!cont) return;
      const p = parcelaDe(yo.x, yo.y);
      const quedan = new Set();
      for (let dx = -CARTELES_RADIO; dx <= CARTELES_RADIO; dx++) {
        for (let dy = -CARTELES_RADIO; dy <= CARTELES_RADIO; dy++) {
          const clave = claveParcela(p.px + dx, p.py + dy);
          const pc = parcelas.get(clave);
          if (!pc?.o || pc.o === 'mundo' || !pc.n) continue;
          quedan.add(clave);
          let el = carteles.get(clave);
          if (!el) {
            el = document.createElement('div');
            el.className = 'cartel';
            const i = document.createElement('i');
            const b = document.createElement('b');
            const g = document.createElement('span');
            g.className = 'gusta';
            el.append(i, b, g);
            el._i = i;
            el._b = b;
            el._g = g;
            cont.appendChild(el);
            carteles.set(clave, el);
          }
          const mia = pc.o === jugador.id;
          // el punto del color del marco que la parcela lleva en el suelo:
          // el cartel y el suelo dicen lo mismo
          const col = '#' + (mia ? colorMio : cacheColorDueno.get(pc.o) || colorDueno(pc.o)).getHexString();
          if (el._col !== col) {
            el._i.style.background = col;
            el._col = col;
          }
          const nombre = callados.has(pc.o) ? 'silenciado' : pc.n;
          if (el._txt !== nombre) {
            el._b.textContent = nombre;
            el._txt = nombre;
          }
          if (el._g._n !== pc.g) {
            el._g.textContent = pc.g ? '❤️ ' + pc.g : '';
            el._g.hidden = !pc.g;
            el._g._n = pc.g;
          }
          el.classList.toggle('mia', mia);
        }
      }
      for (const [clave, el] of carteles) {
        if (quedan.has(clave)) continue;
        el.remove();
        carteles.delete(clave);
      }
    }

    function pintaNombres() {
      const cont = rotulosRef.current;
      if (!cont) return;
      const pinta = (id, nombre, dice, x, y, h, propio) => {
        let el = nodos.get(id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'rotulo' + (propio ? ' yo' : '');
          const b = document.createElement('b');
          const sp = document.createElement('span');
          sp.className = 'dice';
          el.append(sp, b);
          // los dos hijos quedan a mano: esto se pinta en CADA fotograma y no
          // hay que rebuscarlos en el DOM
          el._b = b;
          el._sp = sp;
          cont.appendChild(el);
          nodos.set(id, el);
        }
        const b = el._b;
        const sp = el._sp;
        if (b.textContent !== nombre) b.textContent = nombre;
        // textContent, nunca innerHTML: lo que escribe otra persona entra
        // como TEXTO y no como marcado
        if (sp._txt !== dice) {
          sp.textContent = dice || '';
          sp.hidden = !dice;
          sp._txt = dice;
        }
        const dist = sitúa(el, x, y, h, ALTO_AVATAR + 0.3);
        if (dist === null) return;
        el.style.opacity = dist > 110 ? ((160 - dist) / 50).toFixed(2) : '1';
      };
      const yoP = perfil();
      if (yoP.nombre) pinta('yo', yoP.nombre, !corroMio && miDice && Date.now() - miDice.t < MENSAJE_MS ? miDice.txt : null, yo.x, yo.y, yo.h, true);
      for (const [id, o] of otros) {
        const callado = callados.has(id);
        // Tres burbujas distintas: lo que dice (si lo oyes), el «…» de quien
        // habla en un corro que no es el tuyo —se ve que habla, no lo que
        // dice, como al pasar al lado de dos que charlan— y el «✋» de quien
        // llama a la puerta del tuyo, que solo le sale al anfitrión.
        const llama = llamando.has(id);
        // Dentro de TU corro no hay burbuja sobre la cabeza: lo que dice vuela
        // hasta el carrete y se lee allí, con su nombre. Fuera del corro, lo
        // de siempre; y de un corro ajeno, ni el «…» —eso lo dice ahora el
        // globo mudo del grupo, que es de quien es la conversación.
        const conmigo = !!(corroMio && o.corro === corroMio.k);
        const dice = callado || conmigo ? null : llama ? '✋ quiere entrar' : o.corro ? null : o.dice;
        pinta(id, callado ? 'silenciado' : o.nombre, dice, o.o.x, o.o.y, o.o.h, false);
        const el = nodos.get(id);
        if (!el) continue;
        el.classList.toggle('callado', callado);
        el.classList.toggle('aparte', false);
        el.classList.toggle('llama', llama && !!dice);
      }
      for (const g of gestos) {
        const o = g.id === 'yo' ? yo : otros.get(g.id)?.o;
        if (!o) {
          g.el.style.display = 'none';
          continue;
        }
        sitúa(g.el, o.x, o.y, o.h, ALTO_AVATAR + 0.5);
      }
      for (const [clave, el] of carteles) {
        const q = parseParcela(clave);
        const c = centroParcela(q.px, q.py);
        sitúa(el, c.x, c.y, alturaEn(c.x, c.y), CARTEL_ALTO, CARTEL_LEJOS);
      }
      // El carrete cuelga del centro del corro y anda con él. Pero con la
      // cámara de serie, que mira desde bastante alto y de cerca, ese punto
      // se proyecta ARRIBA del todo y se metía debajo de la barra del corro:
      // se veía la cabecera y ni una línea. Así que se coloca a mano y se
      // sujeta dentro de la pantalla, por debajo de la barra y sin salirse
      // por los lados. Cuando toca sujetarlo pierde el pico, que ya no
      // apunta a nadie.
      if (carrete) {
        const p = centroMio ? enPantalla(centroMio.x, centroMio.y, centroMio.h, ALTO_AVATAR + ALTO_CARRETE) : null;
        if (!p) carrete.style.display = 'none';
        else {
          carrete.style.display = '';
          const alto = carrete.offsetHeight || 90;
          const ancho = carrete.offsetWidth || 200;
          const arriba = 124 + alto; // 124: lo que ocupan cabecera y barra del corro
          const sy = Math.max(p.sy, arriba);
          const sx = Math.min(Math.max(p.sx, ancho / 2 + 10), vpW - ancho / 2 - 10);
          carrete.classList.toggle('sujeto', sy > p.sy + 1);
          carrete.style.transform = 'translate3d(' + Math.round(sx) + 'px,' + Math.round(sy) + 'px,0) translate(-50%,-100%)';
        }
      }
      for (const v of corrosVista.values()) {
        if (!v.globo) continue;
        if (v.centro) sitúa(v.globo, v.centro.x, v.centro.y, v.centro.h, ALTO_AVATAR + 1.5, 120);
        else v.globo.style.display = 'none';
      }
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
    // El anillo se dibujaba con `depthTest: false`, así que su arco de detrás
    // se pintaba POR ENCIMA de la casa que rodea: se veía una elipse azul
    // cruzando la fachada. Con la prueba de profundidad puesta, ese arco queda
    // detrás del edificio, que es lo que dice dónde está la pieza. No
    // desaparece dentro del muro porque el radio (ancho × 0,6 + 0,4) deja
    // 1,4 m de margen por fuera de la planta de una casa de 10 m.
    // Y con `conAltura` se dobla con la colina en vez de quedarse plano a la
    // altura del centro: por eso la posición en y es un dedo sobre CERO, y la
    // altura la pone el vertex shader.
    const anillo = new THREE.Mesh(
      new THREE.RingGeometry(0.84, 1, 64),
      conAltura(new THREE.MeshBasicMaterial({ color: 0x2f6fed, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
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
      anillo.position.set(wx, 0.09, -wy);
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
      parcelas.set(obraClave, { ...pc, o: pc?.o || jugador.id, d: lista });
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
    // A quién se ha tocado. Primero el rayo, que es exacto; y si falla, quien
    // caiga más cerca en PANTALLA: un avatar a 30 m ocupa cuatro píxeles y un
    // dedo mide bastante más, así que sin esta segunda pasada tocar a alguien
    // en el móvil sería imposible. Solo cuenta a los que están cerca de
    // verdad: si no, un toque en el suelo para andar se comería a un vecino
    // lejano que pase por delante.
    const pProy = new THREE.Vector3();
    function quienBajo(sx, sy) {
      ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
      rayo.setFromCamera(ndc, camera);
      const figuras = [...otros.values()].map((o) => o.figura.grupo);
      for (const h of rayo.intersectObjects(figuras, true)) {
        let n = h.object;
        while (n && !n.userData.id) n = n.parent;
        if (n?.userData.id) return n.userData.id;
      }
      let quien = null;
      let cerca = 38;
      for (const [id, o] of otros) {
        if (Math.hypot(o.o.x - yo.x, o.o.y - yo.y) > 45) continue;
        pProy.set(o.o.x, o.o.h + ALTO_AVATAR * 0.6, -o.o.y).project(camera);
        if (pProy.z > 1) continue;
        const d = Math.hypot((pProy.x * 0.5 + 0.5) * vpW - sx, (-pProy.y * 0.5 + 0.5) * vpH - sy);
        if (d < cerca) {
          cerca = d;
          quien = id;
        }
      }
      return quien;
    }

    // Lo que hace falta para la ficha de alguien: quién es, a cuánto está y
    // qué se puede hacer con él (hablarle, llamar a su corro, silenciarle).
    function fichaDe(id) {
      const o = otros.get(id);
      if (!o) return null;
      const suyo = o.corro ? corrosCerca.get(o.corro) : null;
      return {
        id,
        nombre: o.nombre,
        color: o.color,
        dist: Math.round(Math.hypot(o.o.x - yo.x, o.o.y - yo.y)),
        callado: callados.has(id),
        corro: o.corro || null,
        abierto: !!suyo?.ab,
        cuantos: suyo?.c || 0,
        conmigo: !!(corroMio && o.corro === corroMio.k),
        anfitrion: !!(corroMio && corroMio.a === jugador.id),
        tengoCorro: !!corroMio,
        // en un corro cerrado la puerta es del anfitrión; en uno abierto,
        // invita cualquiera de dentro
        puedoInvitar: !corroMio || !!corroMio.ab || corroMio.a === jugador.id,
      };
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
        // tocar a alguien abre su ficha (hablarle, unirte a su corro,
        // silenciarle); tocar el suelo, como siempre, lleva andando allí
        const quien = quienBajo(e.clientX, e.clientY);
        if (quien) {
          setFicha(fichaDe(quien));
          setInfoOpen(false); // la ficha va donde la hoja de «cómo funciona»
          return;
        }
        const p = sueloEn(e.clientX, e.clientY);
        if (p) {
          yo.destino = p;
          setFicha(null); // te vas: la ficha de quien mirabas sobra
        }
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
        // el jugador va siempre: con él vienen los «me gusta» que ha dado y
        // cuánto gusta la suya, que es lo que se le cuenta al volver
        q.set('jugador', jugador.id);
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
          // el dueño y las piezas son lo que hay que volver a dibujar en 3D;
          // el nombre y los me gusta solo cambian el cartel, que se pinta
          // por su cuenta en cada fotograma
          if (!prev || prev.o !== it.o || JSON.stringify(prev.d) !== JSON.stringify(it.d)) cambios = true;
          parcelas.set(it.k, { o: it.o, d: it.d || [], n: it.n || null, g: it.g || 0, mg: !!it.mg });
        }
        if (j.yo) {
          miParcelaClave = j.yo.p || null;
          setMiParcela(miParcelaClave);
          cuentaGusta(j.yo.g || 0);
        }
        if (cambios || cambiaCaja) pintaMundo();
        actualizaDonde(true); // ... que además sincroniza los carteles
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
        nombre: pc?.n || null,
        mia: pc?.o === jugador.id,
        libre: !pc?.o && tipo === 'residencial',
        g: pc?.g || 0,
        mg: !!pc?.mg,
        n: pc?.d?.length || 0,
      });
      sincronizaCarteles();
    }

    // Al volver, si a tu parcela le ha gustado a más gente, se te cuenta: es
    // lo único que devuelve haber construido cuando no coincides con nadie.
    // El «cuántos había» es de este dispositivo (localStorage), no del mundo.
    let gustaPrevio = null;
    function cuentaGusta(n) {
      const antes = gustaPrevio === null ? gustaVisto() : gustaPrevio;
      gustaPrevio = n;
      if (n > antes) avisa(n === 1 ? '❤️ A alguien le gusta tu parcela' : '❤️ Le gusta tu parcela a ' + n + ' personas');
      if (n !== gustaVisto()) guardaGustaVisto(n);
    }

    // --- presencia ---
    let ultimaPresencia = 0;
    // Lo que se dice va montado en el sondeo de presencia: se manda UNA vez
    // (el servidor la mantiene viva lo que dura la burbuja) y al decir algo se
    // adelanta el sondeo, así que se ve casi al momento en vez de esperar al
    // siguiente ciclo.
    let porDecir = null;
    let porGesticular = null;
    // lo del corro (invitar, aceptar, salir…) viaja igual que lo que se dice:
    // montado en el sondeo, que se adelanta, y sin ruta propia. La presencia
    // vive en memoria y en Next cada ruta puede acabar con SU copia del
    // módulo: solo es de fiar en la ruta que la escribe.
    let porCorro = null;
    let miDice = null; // lo mío se pinta ya, sin esperar a la respuesta
    let esperaDicho = null;
    // Lo dicho sale AHORA, o en cuanto se pueda. Si se acaba de sondear se
    // espera lo que falte con un temporizador y NO con el bucle de dibujo:
    // una pestaña de fondo se queda sin fotogramas, y lo escrito se quedaba
    // en la cola sin salir nunca.
    function sacaLoDicho() {
      const falta = 600 - (performance.now() - ultimaPresencia);
      if (falta <= 0) {
        mandaPresencia();
        return;
      }
      if (!esperaDicho) {
        esperaDicho = setTimeout(() => {
          esperaDicho = null;
          mandaPresencia();
        }, falta);
      }
    }
    async function mandaPresencia(extra) {
      ultimaPresencia = performance.now();
      const p = perfil();
      if (!p.nombre) return; // hasta que no te presentes, no sales en el mundo
      const dicho = porDecir;
      const gesto = porGesticular;
      const pedido = porCorro;
      porDecir = null;
      porGesticular = null;
      porCorro = null;
      try {
        const r = await fetch('/api/presencia', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jugador: p.id, nombre: p.nombre, color: p.color, p: p.pelo, s: p.piel, x: Math.round(yo.x * 10) / 10, y: Math.round(yo.y * 10) / 10, r: Math.round(yo.rumbo * 100) / 100, m: dicho || undefined, e: gesto || undefined, corro: pedido || undefined, ...extra }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        if (!vivo) return null;
        const ahora = Date.now();
        const vistos = new Set();
        for (const d of j.cerca || []) {
          vistos.add(d.id);
          let o = otros.get(d.id);
          if (o && (o.color !== d.c || o.pelo !== d.p || o.piel !== d.s || o.nombre !== d.n)) {
            quitaOtro(d.id);
            o = null;
          }
          if (!o) o = creaOtro(d.id, d);
          o.objetivo = { x: d.x, y: d.y, rumbo: d.r };
          o.visto = ahora;
          const callado = callados.has(d.id);
          o.corro = d.k || null;
          o.aparte = !!d.h && !callado; // habla en su corro: se ve que habla, no lo que dice
          // el instante es lo que distingue «lo ha dicho ahora» de «lo mismo
          // por tercer sondeo»: sin él, un gesto se repetiría tres veces
          if ((d.mt || 0) !== o.diceT) {
            o.dice = callado ? null : d.m || null;
            o.diceT = d.mt || 0;
            if (o.dice && dichosRef.current) dichosRef.current.textContent = o.nombre + ' dice: ' + o.dice;
          }
          if (d.et && d.et !== o.gestoT) {
            o.gestoT = d.et;
            if (!callado) lanzaGesto(d.id, d.e);
          }
        }
        for (const [id, o] of otros) if (!vistos.has(id) && ahora - o.visto > 9000) quitaOtro(id);
        setConectados(j.conectados || 1);
        llegaCorro(j, pedido);
        return j;
      } catch {
        return null; // sin red
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
      // Manda la presencia AHORA. El sondeo normal va con el bucle de
      // dibujo, y una pestaña de fondo puede quedarse sin fotogramas: con dos
      // mundos abiertos a la vez (la prueba) el navegador congela la que no
      // mira nadie y quien está ahí desaparece del mundo para los demás.
      sondea: () => mandaPresencia(),
      // Qué gesto está haciendo cada cual y cómo le ha quedado el brazo. El
      // GESTO es lo que comprueba la prueba: se pone en cuanto llega por la
      // red y dura segundo y medio, sin depender de que se pinte. El ángulo
      // del brazo es solo información: con render por software hay menos de
      // dos fotogramas por segundo y la postura puede no llegar a pintarse.
      gestos: () => ({
        yo: yo.gesto?.tipo || null,
        otros: Object.fromEntries([...otros.values()].map((o) => [o.nombre, o.o.gesto?.tipo || null])),
      }),
      brazos: () => ({
        yo: Math.round(avatar.bd.rotation.z * 100) / 100,
        otros: Object.fromEntries([...otros.values()].map((o) => [o.nombre, Math.round(o.figura.bd.rotation.z * 100) / 100])),
      }),
      // dónde cae en pantalla un punto del mundo, opcionalmente a `dy` metros
      // del suelo (diagnóstico: con dy se apunta al cuerpo de un avatar y no
      // a sus pies)
      proyecta: (x, y, dy = 0) => {
        const v = new THREE.Vector3(x, alturaEn(x, y) + dy, -y).project(camera);
        return { sx: (v.x * 0.5 + 0.5) * vpW, sy: (-v.y * 0.5 + 0.5) * vpH };
      },
      seleccion: () => (seleccion ? { ...seleccion.z } : null),
      // el corro en el que andas y los que se dibujan en el suelo, para la
      // prueba de extremo a extremo
      corro: () => (corroMio ? { k: corroMio.k, anfitrion: corroMio.a, abierto: !!corroMio.ab, m: corroMio.m.map((v) => v.n) } : null),
      corros: () => [...corrosVista.keys()],
      quien: (nombre) => [...otros.entries()].find(([, o]) => o.nombre === nombre)?.[0] || null,
      // qué piezas hay bajo un punto de pantalla (diagnóstico)
      bajo: (sx, sy) => {
        ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
        rayo.setFromCamera(ndc, camera);
        return rayo.intersectObjects(grupoPiezas.children, false).map((h) => ({ t: h.object.userData.tipo, i: h.instanceId, d: Math.round(h.distance * 10) / 10, o: origen[h.object.userData.tipo]?.[h.instanceId]?.clave }));
      },
    };

    engineRef.current = {
      // Quién anda cerca (los que caben en el radio de la presencia) y a
      // quién has silenciado, para la hoja de vecinos.
      vecinos() {
        const lista = [...otros.entries()]
          .map(([id, o]) => ({
            id,
            nombre: o.nombre,
            color: o.color,
            dist: Math.round(Math.hypot(o.o.x - yo.x, o.o.y - yo.y)),
            callado: callados.has(id),
          }))
          .sort((a, b) => a.dist - b.dist);
        const guardados = silenciados();
        return {
          cerca: lista,
          // los silenciados que ahora mismo no están a la vista: si no, no
          // habría forma de volver a escuchar a alguien que se fue
          callados: Object.keys(guardados)
            .filter((id) => !otros.has(id))
            .map((id) => ({ id, nombre: guardados[id] })),
        };
      },
      silenciaA(id, nombre) {
        silencia(id, nombre);
        callados.add(id);
        const o = otros.get(id);
        if (o) o.dice = null; // lo que estuviera diciendo se va de la pantalla
        pintaNombres();
        sincronizaCarteles();
      },
      hablaCon(id) {
        quitaSilencio(id);
        callados.delete(id);
        pintaNombres();
        sincronizaCarteles();
      },
      // Reportar no hace nada automáticamente: deja constancia para que una
      // persona lo mire. Va montado en el sondeo de presencia, que es donde el
      // servidor tiene viva a esa persona y puede guardar lo que estaba
      // diciendo (según él, no según quien reporta).
      async reportaA(id) {
        const j = await mandaPresencia({ reporta: id });
        if (!j) return 'red';
        return j.reporte === 'ok' ? null : j.reporte || 'red';
      },
      // --- el corro ---
      // Una sola puerta para todo (invitar, aceptar, llamar, dejar entrar,
      // salir): lo que se pide viaja montado en el sondeo, con el mismo
      // formato que entiende el servidor, y la respuesta llega por él.
      pideCorro(acc) {
        porCorro = acc;
        sacaLoDicho();
      },
      fichaDe,
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
        parcelas.set(obraClave, { ...pc, o: pc?.o || jugador.id, d: lista });
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
            body: JSON.stringify({ accion: 'reclama', parcela: clave, jugador: jugador.id, nombre: perfil().nombre }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return j.error || 'red';
          parcelas.set(clave, { o: jugador.id, n: perfil().nombre, g: 0, mg: false, d: [] });
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
          parcelas.set(clave, { o: null, n: null, g: 0, mg: false, d: [] });
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
      // Me gusta la parcela donde estás. El corazón responde al toque y no al
      // servidor; si la petición falla, se deshace.
      async daGusta() {
        const clave = dondeClave;
        const pc = parcelas.get(clave);
        if (!pc?.o || pc.o === 'mundo' || pc.o === jugador.id) return 'propia';
        const quiero = !pc.mg;
        const aplica = (v) => {
          pc.mg = v;
          pc.g = Math.max(0, (pc.g || 0) + (v ? 1 : -1));
          sincronizaCarteles();
          actualizaDonde(true);
        };
        aplica(quiero);
        try {
          const r = await fetch('/api/parcela', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accion: 'gusta', parcela: clave, jugador: jugador.id }),
          });
          if (!r.ok) throw new Error('no');
        } catch {
          aplica(!quiero);
          return 'red';
        }
        return null;
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
      // el avatar se rehace al cambiar el perfil (ropa, pelo o piel)
      recolorea(p) {
        avatar.cuerpo.geometry.dispose();
        avatar.cuerpo.geometry = geometriaAvatar(dePaleta(coloresTinte, p.color), dePaleta(PELOS_3D, p.pelo), dePaleta(PIELES_3D, p.piel));
        avatar.bi.geometry.dispose(); // los dos brazos comparten geometría
        const geoBrazo = geometriaBrazo(dePaleta(coloresTinte, p.color));
        avatar.bi.geometry = geoBrazo;
        avatar.bd.geometry = geoBrazo;
      },
      presentate() {
        mandaPresencia();
      },
      // Decir algo: sale en la burbuja propia al momento y viaja en el
      // siguiente sondeo, que se adelanta. Si se acaba de sondear se espera
      // lo que falte en vez de disparar otro seguido: el servidor limita a 90
      // peticiones por minuto y el sondeo ya gasta 40.
      di(texto) {
        const t = limpiaMensaje(texto);
        if (!t) return;
        porDecir = t;
        miDice = { txt: t, t: Date.now() };
        sacaLoDicho();
      },
      gesto(clave) {
        if (!EMOTES[clave]) return;
        porGesticular = clave;
        lanzaGesto('yo', clave);
        sacaLoDicho();
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
      uTiempo.value = RELOJ_FIJO ? tFijo : t / 1000;

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
        // El rumbo se persigue por el camino corto en vez de escribirse: un
        // giro de 180° con el joystick era un pivote instantáneo, y es el
        // gesto más frecuente en el móvil.
        giraHacia(yo, Math.atan2(dx, -dy), dt); // el frente del avatar es +z (sur)
        yo.fase += dt * CADENCIA;
        yo.amp = Math.min(1, (yo.amp || 0) + dt * 7);
        // la cámara va con él
        camera.position.x += yo.x - x0;
        camera.position.z -= yo.y - y0;
        controls.target.x += yo.x - x0;
        controls.target.z -= yo.y - y0;
        if (yo.destino && Math.hypot(yo.x - x0, yo.y - y0) < paso * 0.2) yo.destino = null; // atascado: se para
        actualizaDonde(false);
      } else {
        // La amplitud baja sola en vez de ponerse a cero de golpe: antes la
        // pierna volvía de 37° a la vertical EN UN FOTOGRAMA al soltar la
        // tecla. La fase sigue corriendo mientras queda amplitud, para que el
        // paso termine en lugar de congelarse a medias.
        yo.amp = Math.max(0, (yo.amp || 0) - dt * 4);
        if (yo.amp > 0) yo.fase += dt * CADENCIA;
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
          giraHacia(s, Math.atan2(dx, -dy), dt);
          s.andando = true;
          s.fase += dt * CADENCIA;
          s.amp = Math.min(1, (s.amp || 0) + dt * 7);
        } else {
          s.andando = false;
          s.amp = Math.max(0, (s.amp || 0) - dt * 4);
          if (s.amp > 0) s.fase += dt * CADENCIA;
          s.rumbo = o.objetivo.rumbo;
        }
        s.h = alturaEn(s.x, s.y);
        colocaFigura(o.figura, s);
      }

      // los corros se dibujan DESPUÉS de mover a todo el mundo: el círculo
      // se calcula de dónde está cada uno ahora, así que se abre y se cierra
      // solo según se junta o se separa la gente
      colocaCorros(t);
      // y se avisa antes de que el servidor te saque: un corro que se rompe
      // sin decir nada parece un fallo, no una consecuencia de haberte ido
      if (corroMio && lejosDelCorro > CORRO_AVISO_M) {
        if (!avisadoLejos) {
          avisadoLejos = true;
          avisa('Te estás alejando del corro: vuelve o te saldrás');
        }
      } else avisadoLejos = false;

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

      // Lo que mueve BRAZOS Y PIERNAS también cambia la sombra, aunque el
      // avatar no se desplace: andar, un gesto o un brinco. Si nada de eso
      // pasa y nadie se ha movido, la sombra del fotograma anterior vale y
      // nos ahorramos repintar un 2048×2048.
      // El sembrado va con el avatar, y `pintaMundo` solo se dispara cuando
      // cambian los DATOS, así que hay que repintarlo al cruzar de celda.
      if (!MUESTRARIO && (!campoCentro || Math.abs(Math.round(yo.x / CELDA_CAMPO) - campoCentro.cx) > 0 || Math.abs(Math.round(yo.y / CELDA_CAMPO) - campoCentro.cy) > 0)) {
        if (modelosListos) pintaMundo();
      }

      if (yo.andando || yo.gesto) pideSombras();
      else for (const o of otros.values()) {
        if (o.o.andando || o.o.gesto) { pideSombras(); break; }
      }

      centraMapa(dt, yo.andando);
      controls.update();
      if (camMini) {
        // El encuadre sale del tamaño REAL de la pieza, con una ley
        // sublineal: si fuera proporcional, una flor de 0,8 m saldría como
        // una mota y la torre de 13,5 m llenaría el cuadro; y si todas
        // ocuparan lo mismo, se pierde la escala, que es justo lo que pasa
        // hoy. Así una casa se ve más grande que una silla, pero la silla
        // se sigue viendo.
        const tam = new THREE.Vector3();
        cajaMini.getSize(tam);
        // El encuadre es PROPORCIONAL a la pieza pero con el margen
        // encogiéndose: una pieza pequeña se enmarca holgada (×2,4) y una
        // grande, justa (×1,2). Así la casa se ve el doble de grande que la
        // silla en la celda —la escala se lee— pero la silla sigue siendo
        // legible en 64 px, que es lo que se perdía si el encuadre fuera
        // proporcional a secas (la flor de 0,8 m saldría como una mota).
        const alto = Math.max(tam.y, 0.2);
        const grande = Math.max(alto, Math.hypot(tam.x, tam.z));
        const margen = 2.9 * Math.pow(grande / 0.5, -0.26);
        const h = (grande * Math.max(1.15, margen)) / 2;
        camMini.left = -h;
        camMini.right = h;
        camMini.top = h;
        camMini.bottom = -h;
        // el centro de la pieza, no su base
        const cen = new THREE.Vector3();
        cajaMini.getCenter(cen);
        camMini.lookAt(cen.x, cen.y, cen.z);
        camMini.updateProjectionMatrix();
        renderer.render(scene, camMini);
        return;
      }
      renderer.render(scene, camera);
      pintaNombres();

      if (t - ultimoSondeo > 1500) {
        ultimoSondeo = t;
        traeParcelas(false);
        if (t - ultimaPresencia > 1500) mandaPresencia();
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
      clearTimeout(esperaDicho);
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
      quitaCarrete();
      for (const v of corrosVista.values()) v.globo?.remove();
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
      geoAro.dispose();
      geoLuz.dispose();
      geoPie.dispose();
      for (const m of [...Object.values(matAro), ...Object.values(matLuz)]) m.dispose();
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
      avatar.bi.geometry.dispose();
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

  // --- presentarse y cambiarse: la misma hoja ---
  // Antes solo se podía elegir nombre y color UNA vez, al entrar. Ahora la
  // misma hoja se abre desde la cabecera, así que el aspecto (y el nombre)
  // se pueden cambiar, que es lo que hace falta si el pelo y la piel de
  // serie te salen del id.
  function abreEditor() {
    const p = perfil();
    setColorElegido(p.color);
    setPeloElegido(p.pelo);
    setPielElegido(p.piel);
    setEditando(true);
  }
  function onPresentar(e) {
    e.preventDefault();
    const n = nombreRef.current?.value?.trim();
    if (!n) {
      avisa('Dinos cómo te llamas para entrar');
      return;
    }
    const eraNuevo = !yo?.nombre;
    const p = guardaPerfil(n, colorElegido, peloElegido, pielElegido);
    setYo({ ...p });
    setEditando(false);
    engineRef.current?.recolorea(p);
    engineRef.current?.presentate(); // el cambio sale ya, sin esperar al sondeo
    avisa(eraNuevo ? '¡Bienvenido/a, ' + p.nombre + '! Toca el suelo para andar' : 'Guardado: así te ven los demás');
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

  // --- vecinos: silenciar y reportar ---
  function refrescaVecinos() {
    setVecinos(engineRef.current?.vecinos() || { cerca: [], callados: [] });
  }
  function abreVecinos() {
    refrescaVecinos();
    setPanelVecinos(true);
  }
  function onSilencia(v) {
    engineRef.current?.silenciaA(v.id, v.nombre);
    refrescaVecinos();
    if (ficha?.id === v.id) refrescaFicha(v.id);
    avisa('Silenciado. No verás lo que diga ni su nombre');
  }
  function onEscucha(v) {
    engineRef.current?.hablaCon(v.id);
    refrescaVecinos();
    if (ficha?.id === v.id) refrescaFicha(v.id);
  }
  async function onReporta(v) {
    const err = await engineRef.current?.reportaA(v.id);
    if (err === 'ya') avisa('Ya lo habías reportado hace poco');
    else if (err) avisa('No se ha podido enviar el reporte');
    else avisa('Reportado. Lo mirará una persona; de momento, mejor silénciale');
  }

  // --- el corro: hablar con quien te encuentres ---
  // Todo pasa por la misma puerta del motor, que lo manda montado en el
  // sondeo de presencia; lo que salga de ello llega por el sondeo y lo
  // cuenta el aviso de abajo.
  const pideCorro = (acc) => engineRef.current?.pideCorro(acc);
  const refrescaFicha = (id) => setFicha(engineRef.current?.fichaDe(id) || null);
  function onHablar(v) {
    pideCorro({ a: 'invita', q: v.id });
    setFicha(null);
  }
  function onLlamaAlCorro(v) {
    pideCorro({ a: 'llama', q: v.corro });
    setFicha(null);
  }
  function onAcepta(v) {
    pideCorro({ a: 'acepta', q: v.de });
    setInvitaciones((l) => l.filter((x) => x.de !== v.de));
  }
  // «Ahora no» quita la tarjeta al momento: el servidor se entera en el
  // sondeo, pero quien la ha rechazado no tiene por qué seguir viéndola
  function onAhoraNo(v) {
    pideCorro({ a: 'no', q: v.de });
    setInvitaciones((l) => l.filter((x) => x.de !== v.de));
    setLlamadas((l) => l.filter((x) => x.de !== v.de));
  }
  function onAdmite(v) {
    pideCorro({ a: 'admite', q: v.de });
    setLlamadas((l) => l.filter((x) => x.de !== v.de));
  }
  function onEcha(v) {
    pideCorro({ a: 'echa', q: v.id });
    setFicha(null);
  }
  function onSaleCorro() {
    pideCorro({ a: 'sale' });
    setRegistro(false);
  }
  function onAbreCorro() {
    pideCorro({ a: 'abre', v: !corro?.ab });
  }

  async function onGusta() {
    if ((await engineRef.current?.daGusta()) === 'red') avisa('No se ha podido guardar; inténtalo otra vez');
  }

  // --- hablar ---
  function onDecir(e) {
    e.preventDefault();
    const t = decirRef.current?.value || '';
    engineRef.current?.di(t);
    if (decirRef.current) decirRef.current.value = '';
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
      {/* los rótulos van sobre el 3D y son aria-hidden: lo que dicen los demás
          se cuenta aquí, para quien no los vea */}
      <p id="dichos" ref={dichosRef} className="solo-lector" aria-live="polite" />

      {yo && (!presentado || editando) && (
        <div className="ui velo">
          <form className="hoja glass presenta" onSubmit={onPresentar}>
            <h2>{editando ? 'Así eres' : 'Bienvenido al mundo'}</h2>
            {!editando && <p>Un mundo que se construye entre todos: anda, reclama una parcela y levanta tu casa.</p>}
            <label>
              ¿Cómo te llamas?
              <input
                ref={nombreRef}
                type="text"
                maxLength={MAX_NOMBRE}
                placeholder="Tu nombre"
                autoComplete="nickname"
                defaultValue={yo.nombre || ''}
                autoFocus
              />
            </label>
            {[
              { t: 'Ropa', p: COLORES, v: colorElegido, set: setColorElegido },
              { t: 'Pelo', p: PELOS, v: peloElegido, set: setPeloElegido },
              { t: 'Piel', p: PIELES, v: pielElegido, set: setPielElegido },
            ].map((fila) => (
              <div className="pinta" key={fila.t}>
                <span>{fila.t}</span>
                <div className="colores" role="radiogroup" aria-label={fila.t + ' de tu avatar'}>
                  {fila.p.map((c, i) => (
                    <button
                      key={c}
                      type="button"
                      className={'color' + (fila.v === i ? ' on' : '')}
                      style={{ background: c }}
                      onClick={() => fila.set(i)}
                      aria-label={fila.t + ' ' + (i + 1)}
                      aria-checked={fila.v === i}
                      role="radio"
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="fila-botones">
              <button type="submit" className="btn-principal">
                {editando ? 'Guardar' : 'Entrar'}
              </button>
              {editando && (
                <button type="button" className="btn-sec" onClick={() => setEditando(false)}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {panelVecinos && (
        <div className="ui velo" onClick={() => setPanelVecinos(false)}>
          <div className="hoja glass vecinos" onClick={(e) => e.stopPropagation()}>
            <h2>Quién anda cerca</h2>
            {vecinos.cerca.length === 0 ? (
              <p>Ahora mismo no hay nadie a la vista. El mundo es grande: prueba en la plaza.</p>
            ) : (
              <ul>
                {vecinos.cerca.map((v) => (
                  <li key={v.id}>
                    <i style={{ background: COLORES[v.color ?? 0] }} />
                    <b className={v.callado ? 'callado' : ''}>{v.callado ? 'silenciado' : v.nombre}</b>
                    <small>{v.dist} m</small>
                    <button className="btn-sec" onClick={() => (v.callado ? onEscucha(v) : onSilencia(v))}>
                      {v.callado ? 'Escuchar' : 'Silenciar'}
                    </button>
                    <button className="btn-sec peligro" onClick={() => onReporta(v)}>
                      Reportar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {vecinos.callados.length > 0 && (
              <>
                <h3>Silenciados que no están cerca</h3>
                <ul>
                  {vecinos.callados.map((v) => (
                    <li key={v.id}>
                      <b className="callado">{v.nombre}</b>
                      <button className="btn-sec" onClick={() => onEscucha(v)}>
                        Escuchar
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="nota">
              <b>Silenciar</b> es solo para ti y en este dispositivo: dejas de ver lo que dice, sus gestos y su nombre.
              <b> Reportar</b> deja constancia para que una persona lo mire; no expulsa a nadie por sí solo.
            </p>
            <button className="btn-principal" onClick={() => setPanelVecinos(false)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      {registro && corro && (
        <div className="ui velo" onClick={() => setRegistro(false)}>
          <div className="hoja glass registro" onClick={(e) => e.stopPropagation()}>
            <h2>Lo hablado en el corro</h2>
            {!corro.h?.length ? (
              <p>Todavía no ha dicho nadie nada. Lo que se diga aquí solo lo leéis los {corro.m.length} del corro.</p>
            ) : (
              <ol>
                {corro.h.map((l) => (
                  <li key={l.ts + '-' + l.q}>
                    <b style={{ color: l.q === yo?.id ? 'var(--accent)' : colorNombre(l.q) }}>{l.q === yo?.id ? 'Tú' : l.n}</b>
                    <span>{l.t}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="nota">
              Esto vive en la memoria del servidor mientras dure el corro y se va con él: no se guarda en ningún sitio ni queda registro. Quien entre
              después empieza a leer desde que entra, no lo de antes.
            </p>
            <button className="btn-principal" onClick={() => setRegistro(false)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div className="ui cabecera glass">
        <button className="quien" onClick={abreEditor} disabled={!presentado} aria-label="Cambiar tu nombre y tu aspecto" title="Cambiar tu nombre y tu aspecto">
          <i style={{ background: COLORES[yo?.color ?? 0] }} />
          {yo?.nombre || '…'}
        </button>
        <button className="conectados" onClick={abreVecinos} disabled={!presentado} title="Quién anda cerca">
          {conectados} {conectados === 1 ? 'persona' : 'personas'} en el mundo
        </button>
      </div>

      <button className="ui btn-cuad b-info" aria-label="Cómo funciona" onClick={() => setInfoOpen((v) => !v)}>
        i
      </button>
      {/* En modo obra el panel de piezas los tapa por completo (mismo z-index
          y más tarde en el DOM), pero seguían en el orden de tabulación: con
          Tab se llegaba a «Ir a la plaza» y te sacaba de tu propia obra sin
          haber visto el botón. Se ocultan como ya se hacen el chat y el
          joystick. */}
      {!obra && (
        <button className="ui btn-cuad b-plaza" aria-label="Ir a la plaza" title="Ir a la plaza" onClick={() => engineRef.current?.vaA('0/0')}>
          ⛲
        </button>
      )}
      {!obra && miParcela && (
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
            <b>Habla con quien te encuentres</b> con el botón 💬: lo que digas sale en una burbuja sobre tu cabeza y lo ve quien esté cerca, y los gestos son de un toque. No se guarda nada: la burbuja se desvanece y ahí acaba.
          </p>
          <p>
            <b>Para hablar con alguien en concreto, tócale</b> en el mundo: sale su ficha y desde ahí le pides hablar. Si acepta, hacéis un <b>corro</b>: un círculo de luz en el suelo que os rodea a los dos y que ve todo el mundo, para saber que ahí hay una conversación. Lo que se diga dentro solo lo leéis los de dentro; los de fuera ven un «…» sobre vuestras cabezas, no lo que decís.
          </p>
          <p>
            <b>Y si llega alguien más</b>, toca a uno del corro y <b>llama a la puerta</b>: le sale el aviso a quien empezó el corro, que le deja entrar o no. Quien lo empezó puede dejarlo <b>abierto</b>, y entonces se une quien pase. Caben {CORRO_MAX}. Si te alejas más de {CORRO_AVISO_M} m del resto te sales solo, como cuando te vas de una conversación.
          </p>
          <p>
            <b>Todo se dibuja en tu GPU.</b> El servidor solo guarda qué hay en cada parcela y quién anda cerca.
          </p>
        </div>
      )}

      {presentado && !obra && (corro || invitaciones.length > 0 || llamadas.length > 0) && (
        <div className="ui corro-zona">
          {corro && (
            <div className="corro-cab glass">
              <i className="punto" />
              <b>Corro</b>
              <span className="gente">{corro.m.map((v) => (v.id === yo?.id ? 'tú' : v.n)).join(' · ')}</span>
              <button className="btn-sec" onClick={() => setRegistro(true)} title="Todo lo que se ha hablado desde que entraste">
                💬 Todo{corro.h?.length ? ' · ' + corro.h.length : ''}
              </button>
              {corro.a === yo?.id && (
                <button
                  className="btn-sec"
                  onClick={onAbreCorro}
                  title={corro.ab ? 'Cualquiera que pase puede unirse' : 'Para entrar hay que llamar y que tú abras'}
                >
                  {corro.ab ? '🔓 Abierto' : '🔒 Con puerta'}
                </button>
              )}
              <button className="btn-sec" onClick={onSaleCorro}>
                Salir
              </button>
            </div>
          )}
          {invitaciones.map((v) => (
            <div className="aviso glass" key={'i' + v.de}>
              <span>
                <b>{v.n}</b> quiere hablar contigo
              </span>
              <button className="btn-principal" onClick={() => onAcepta(v)}>
                Aceptar
              </button>
              <button className="btn-sec" onClick={() => onAhoraNo(v)}>
                Ahora no
              </button>
            </div>
          ))}
          {llamadas.map((v) => (
            <div className="aviso glass" key={'l' + v.de}>
              <span>
                ✋ <b>{v.n}</b> quiere entrar en el corro
              </span>
              <button className="btn-principal" onClick={() => onAdmite(v)}>
                Dejar entrar
              </button>
              <button className="btn-sec" onClick={() => onAhoraNo(v)}>
                Ahora no
              </button>
            </div>
          ))}
        </div>
      )}

      {presentado && !obra && ficha && (
        <div className="ui hoja glass ficha">
          <div className="ficha-cab">
            <i style={{ background: COLORES[ficha.color ?? 0] }} />
            <b className={ficha.callado ? 'callado' : ''}>{ficha.callado ? 'silenciado' : ficha.nombre}</b>
            <button className="cerrar" onClick={() => setFicha(null)} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <p className="nota">
            A {ficha.dist} m
            {ficha.conmigo
              ? ' · está en tu corro'
              : ficha.corro
                ? ficha.abierto
                  ? ' · en un corro abierto de ' + ficha.cuantos
                  : ' · en un corro de ' + ficha.cuantos + ', con puerta'
                : ''}
          </p>
          {/* de lejos no se le habla a nadie: el botón se apaga y se dice
              por qué, en vez de dejar que el servidor conteste que no */}
          {!ficha.conmigo && !ficha.corro && ficha.puedoInvitar && (
            <button className="btn-principal ancho" onClick={() => onHablar(ficha)} disabled={ficha.dist > CORRO_CERCA_M}>
              💬 {ficha.tengoCorro ? 'Invitar a tu corro' : 'Hablar con ' + ficha.nombre}
            </button>
          )}
          {!ficha.conmigo && !ficha.corro && !ficha.puedoInvitar && <p className="nota">Para invitar a alguien, que abra la puerta quien empezó el corro.</p>}
          {!ficha.conmigo && ficha.corro && (
            <button className="btn-principal ancho" onClick={() => onLlamaAlCorro(ficha)} disabled={ficha.dist > CORRO_CERCA_M}>
              {ficha.abierto ? '👋 Unirte a su corro' : '✋ Llamar a su corro'}
            </button>
          )}
          {!ficha.conmigo && ficha.dist > CORRO_CERCA_M && <p className="nota">Está lejos: acércate a menos de {CORRO_CERCA_M} m para hablarle.</p>}
          {ficha.conmigo && ficha.anfitrion && (
            <button className="btn-sec peligro ancho" onClick={() => onEcha(ficha)}>
              Sacarle del corro
            </button>
          )}
          <div className="fila-botones">
            <button className="btn-sec" onClick={() => (ficha.callado ? onEscucha(ficha) : onSilencia(ficha))}>{ficha.callado ? 'Escuchar' : 'Silenciar'}</button>
            <button className="btn-sec peligro" onClick={() => onReporta(ficha)}>
              Reportar
            </button>
          </div>
          <p className="nota">
            {ficha.corro && !ficha.conmigo
              ? 'Lo que hablan en su corro no lo lees: se ve que hablan, no lo que dicen.'
              : 'En un corro solo os leéis los que estáis dentro, y se ve en el suelo quién está hablando con quién.'}
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
          {donde.mia && donde.g > 0 && (
            <span className="etiqueta glass gustada" title="A cuánta gente le gusta tu parcela">
              ❤️ {donde.g}
            </span>
          )}
          {donde.libre && !miParcela && (
            <button className="btn-principal" onClick={onReclamar}>
              📍 Reclamar esta parcela
            </button>
          )}
          {donde.libre && miParcela && <span className="etiqueta glass">Solar libre</span>}
          {!donde.libre && !donde.mia && donde.dueno && donde.dueno !== 'mundo' && (
            <>
              <span className="etiqueta glass">Aquí vive {donde.nombre || 'alguien'}</span>
              <button
                className={'btn-principal gusta' + (donde.mg ? ' on' : '')}
                onClick={onGusta}
                aria-pressed={donde.mg}
                aria-label={donde.mg ? 'Quitar el me gusta' : 'Me gusta esta parcela'}
              >
                {donde.mg ? '❤️' : '🤍'} {donde.g > 0 ? donde.g : 'Me gusta'}
              </button>
            </>
          )}
          {!donde.libre && !donde.mia && !(donde.dueno && donde.dueno !== 'mundo') && (
            <span className="etiqueta glass">
              {donde.tipo === 'plaza'
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
                  <i className="mini">
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
                        <i className="mini">
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

      {presentado && !obra && (
        <div className={'ui chat' + (chatOpen ? ' abierto' : '')}>
          {chatOpen ? (
            <>
              <div className="emotes" role="group" aria-label="Gestos">
                {Object.entries(EMOTES).map(([k, e]) => (
                  <button key={k} className="emote" onClick={() => engineRef.current?.gesto(k)} title={e.nombre} aria-label={e.nombre}>
                    {e.emoji}
                  </button>
                ))}
              </div>
              {/* que se vea SIEMPRE a dónde va lo que escribes: dentro de un
                  corro, solo a los de dentro */}
              {corro && <span className="solo-corro glass">🔒 Lo que digas solo lo lee el corro</span>}
              <form className="decir" onSubmit={onDecir}>
                <input
                  ref={decirRef}
                  type="text"
                  maxLength={MAX_MENSAJE}
                  placeholder={corro ? 'Di algo al corro…' : 'Di algo…'}
                  autoComplete="off"
                  aria-label={corro ? 'Lo que dices al corro' : 'Lo que dices'}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.currentTarget.blur();
                      setChatOpen(false);
                    }
                  }}
                />
                <button type="submit" className="btn-principal" aria-label="Decir">
                  ➤
                </button>
                <button type="button" className="btn-sec" onClick={() => setChatOpen(false)} aria-label="Cerrar">
                  ✕
                </button>
              </form>
            </>
          ) : (
            <button className="btn-cuad" aria-label="Hablar y hacer gestos" title="Hablar y hacer gestos" onClick={() => setChatOpen(true)}>
              💬
            </button>
          )}
        </div>
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

      <div className={'ui toast glass' + (toast.on ? ' on' : '') + (chatOpen ? ' arriba' : '')}>{toast.msg}</div>
    </>
  );
}
