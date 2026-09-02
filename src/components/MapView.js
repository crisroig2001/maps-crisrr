'use client';

// El visor: teselas vectoriales de OpenFreeMap descodificadas en el navegador,
// suelo (calles/parques/agua) pintado en un canvas por tesela y edificios
// extruidos en UNA geometría fusionada por tesela (9 draw calls de edificios).
// Sin luces: el sombreado por cara va horneado en los colores de vértice
// (MeshBasicMaterial) — look cartoon plano y coste mínimo en móvil.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { loadTileData } from '../lib/mvt';
import { colorFachada, cartoniza } from '../lib/colorCam';
import { TIPOS, MAX_ADORNOS } from '../lib/adornos';
import { idJugador } from '../lib/jugador';
import { WORLD, Z_TILE, Z_CELL, lonLatToMerc, lonLatToTile, mercToLonLat, tileToMerc, cellKey } from '../lib/geo';

const N_TILE = 2 ** Z_TILE;
const N_CELL = 2 ** Z_CELL;
const CELLS_POR_TESELA = N_CELL / N_TILE; // 16

// paleta pastel (escaneado) + acentos ocasionales; gris = pendiente
const PALETA = [0xf3e2c7, 0xecd2ae, 0xe8c9a0, 0xf0d9b5, 0xcfdcea, 0xd6e6cf, 0xeed3cd, 0xf1e0bd].map(
  (h) => new THREE.Color(h)
);
const ACENTOS = [0xde7a58, 0x5f92bd, 0x6faa80, 0xd9a441, 0xb98ac9].map((h) => new THREE.Color(h));
const BLANCO = new THREE.Color(0xffffff);
const TEJADOS = PALETA.map((c) => c.clone().lerp(BLANCO, 0.28));
const TEJADOS_AC = ACENTOS.map((c) => c.clone().lerp(BLANCO, 0.3));
const GRIS_PARED = new THREE.Color(0xb7bdc5);
const GRIS_TEJADO = new THREE.Color(0xcbcfd4);
const VERDES_ARBOL = [0x5f9e63, 0x6faa6b, 0x7db473, 0x679c58].map((h) => new THREE.Color(h));
const TRONCO = new THREE.Color(0x8a6b4f);
// adornos (lo que los usuarios colocan en su manzana)
const COL_MADERA = new THREE.Color(0x9a6b45);
const COL_PIEDRA = new THREE.Color(0xc4beb0);
const COL_AGUA = new THREE.Color(0x8ec3e0);
const COL_POSTE = new THREE.Color(0x6b7480);
const COL_LUZ = new THREE.Color(0xffe08a);
const COL_BANDERA = new THREE.Color(0xde5a4a);
const COL_MASTIL = new THREE.Color(0xe9e4d8);
// instancias por tipo de adorno en el mundo cargado (5x5 teselas). Más allá
// se dejan de pintar: 2.000 farolas en pantalla ya no son un mapa.
const MAX_INSTANCIAS = 2000;
const PLANTA_M = 3; // metros por planta/ventana (escala de la textura de fachada)

// --- el sol ---
// Dirección HACIA el sol en el plano (este, norte). La comparten el sombreado
// de las fachadas y las sombras del suelo, así que moverla gira las dos cosas a
// la vez y siguen cuadrando. 55° cae a la derecha en la vista de partida
// (az=38): deja una cara clara y otra oscura de las dos que se ven, y tira las
// sombras hacia el espectador en vez de esconderlas detrás de los edificios.
const SOL_AZ = (55 * Math.PI) / 180;
const SOL_E = Math.sin(SOL_AZ);
const SOL_N = Math.cos(SOL_AZ);
// cuánto se oscurece la fachada que da la espalda al sol (1 = nada)
const LUZ_SOMBRA = 0.66;
// Sombras de contacto proyectadas en el suelo: metros de sombra por metro de
// altura (sol a ~63° sobre el horizonte), tope de altura para que la sombra no
// se salga de la manzana, y opacidad.
const SOMBRA_LARGO = 0.5;
const SOMBRA_ALTO_MAX = 40;
const SOMBRA_ALFA = 0.2;

// La capa `building` trae un campo `colour` con el color REAL etiquetado en
// OSM y hasta ahora se ignoraba. Viene crudo ('#a52a2a', 'tan'…), así que se
// pasteliza al rango del mapa: un edificio rojo sangre rompería el cartoon.
const cacheOsmCol = new Map();
function colorOsm(v) {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (cacheOsmCol.has(t)) return cacheOsmCol.get(t);
  let par = null;
  // solo hex o nombre CSS conocido: cualquier otra cosa haría que THREE.Color
  // llenase la consola de avisos y devolviera negro
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t) || Object.hasOwn(THREE.Color.NAMES, t)) {
    const c = new THREE.Color(t);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(0.5, hsl.s), Math.min(0.8, Math.max(0.58, hsl.l)));
    par = { pared: c, tejado: c.clone().lerp(BLANCO, 0.28) };
  }
  cacheOsmCol.set(t, par); // el null también se cachea: no se revalida
  return par;
}
// Cielo en degradado. El de abajo es el color con el que la niebla funde el
// mundo, así que TIENE que ser el mismo que el del horizonte: si el cielo
// aclara hacia abajo y la niebla no, aparece una costura justo donde el mapa
// se acaba, que es lo que la niebla estaba tapando.
// Anillo de contexto: teselas z11 pintadas SOLO como suelo, sin edificios. Una
// z11 cubre 8x8 teselas z14 — 14,7 km de lado — y pesa 119 KB, contra los ~13 MB
// que costarían esas 64 teselas z14. Es lo que permite que haya horizonte de
// verdad en vez de un plano de color liso, y que la cámara pueda alejarse.
const Z_CTX = 11;
const RADIO_CTX_M = 9000; // cubre de sobra hasta donde la niebla lo apaga
const MAX_CTX = 9; // tope de descargas, por si el target cae en una esquina
const S_CTX = 512; // la mitad de resolución que el suelo de detalle: está lejos

const CIELO_CENIT = 0x9ecbe8;
const CIELO_HORIZONTE = 0xe3f1f8;
const SUELO_BASE = 0xd8dcd2; // el mismo gris con que arranca el canvas de cada tesela
// Niebla. Con el anillo de contexto el mundo ya no se acaba en el bloque de
// detalle, así que la niebla deja de tener que tapar un corte y pasa a hacer
// dos cosas distintas:
//   NIEBLA_ENTRADA — dónde EMPIEZA a empañar, atado al borde del DETALLE: así
//     suaviza el escalón donde las calles finas dejan paso al suelo de contexto.
//   NIEBLA_BORDE — dónde satura, atado al borde del CONTEXTO, que ahora es lo
//     último que hay antes del plano liso del horizonte.
// Ambas son distancias MÁS ALLÁ del target, en metros, no fracciones: es más
// fácil razonar sobre "a partir de dónde se empaña" que sobre un porcentaje.
// El contexto es suelo grueso (28 m por píxel): si se ve demasiado nítido no
// parece mundo lejano, parece una mancha plana compitiendo con el detalle.
// Empañarlo pronto es lo que lo convierte en horizonte.
const NIEBLA_DESDE_M = 1900; // ~el borde del bloque de detalle (2.753 m)
const NIEBLA_HASTA_M = 5000; // aquí ya es todo cielo

// usos del suelo: tonos MUY suaves, solo para que el fondo deje de ser un gris
// plano. Si tiñen demasiado le comen el protagonismo a los edificios.
// un tramo más corto que esto no da para escribir el nombre encima
const LARGO_MIN_CALLE = 110; // metros
// Los nombres de calle viven DENTRO de la escena 3D, tumbados sobre el asfalto
// como pintura vial, con test de profundidad: los edificios los tapan solos, sin
// heurística ninguna. Los topónimos siguen siendo overlay HTML, que es lo
// correcto — un nombre de barrio debe flotar por encima de todo.
// Tumbado, el texto se escorza: a la inclinación de partida (47°) pierde un
// tercio de altura en pantalla. Por eso va más grande de lo que parecería —
// 11 m se leían peor que el overlay de antes, que era el listón a igualar.
const ALTO_TEXTO_M = 17;
const ROTULO_Y = 0.6; // un pelo por encima del suelo, para no pelearse con él
// Tumbado, el texto se va poniendo de canto y deja de leerse mucho antes de que
// la oclusión importe. Por eso sigue habiendo desvanecido por inclinación —
// pero ahora es por legibilidad, no para esconder un defecto, así que puede
// llegar mucho más lejos que antes (que se apagaba del todo a 68°).
const CALLE_FADE_INI = 1.15; // 66°
const CALLE_FADE_FIN = 1.36; // 78°, por encima del tope de la cámara (77°)
const MAX_ROTULOS = 26; // más que esto y el mapa deja de leerse
const DIST_CALLE = 1700; // los nombres de calle solo con la cámara cerca
const TAM_SITIO = { city: 17, town: 15, village: 13, suburb: 13, quarter: 11.5 };

const COLOR_USO = {
  residential: '#e2ded6', suburb: '#e2ded6', neighbourhood: '#e2ded6',
  commercial: '#ecdcd4', retail: '#eedbd2',
  industrial: '#dcd9de', railway: '#dcd9de', quarry: '#ded9d2',
  school: '#e7e1cd', college: '#e7e1cd', university: '#e7e1cd',
  kindergarten: '#e7e1cd', library: '#e7e1cd',
  hospital: '#eedad6',
  pitch: '#cfe3c2', playground: '#d5e5c8', stadium: '#cfe3c2', track: '#cfe3c2',
  cemetery: '#d2dcc8', military: '#dfe0d0',
};

// PRNG determinista (mulberry32): los árboles de una tesela salen siempre igual
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- tejados a cuatro aguas ---
// OpenMapTiles no trae la forma del tejado (la capa `building` solo da
// render_height, render_min_height y colour), así que se deduce de la huella.
// Solo para edificios PEQUEÑOS: en el Eixample los tejados planos son los de
// verdad, y una manzana entera a cuatro aguas quedaría de casita de juguete.
// Y tampoco a los cobertizos: por debajo de 40 m² (una caseta de 6×6) la huella
// mide 3-4 px en la textura y el faldón no llega a verse, pero son el 58% de
// los candidatos y la MITAD de las aristas de tejado. Medido en las 9 teselas
// de la vista de partida: los faldones cuestan +27 MB sin este suelo y +9,8 MB
// con él, y la vista `barrio-de-casas` solo pierde 0,3 puntos de diferencia.
const TEJ_AREA_MIN = 40;
const TEJ_AREA_MAX = 420; // m² de huella
const TEJ_ALTO_MAX = 16; // m: por encima de esto es un bloque, no una casa
const TEJ_LADOS_MAX = 14; // un contorno más enrevesado que esto no inseta bien
const TEJ_AREA_MIN_REL = 0.35; // si el anillo insetado encoge más, se deja plano
const LUZ_TEJADO = 0.84; // los faldones contrastan menos que las fachadas: miran arriba

function areaAnillo(ring) {
  let a2 = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a2 += ring[j].e * ring[i].n - ring[i].e * ring[j].n;
  }
  return a2 / 2;
}

function dentroDe(rings, e, n) {
  let dentro = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.n > n !== b.n > n && e < a.e + ((n - a.n) / (b.n - a.n)) * (b.e - a.e)) dentro = !dentro;
    }
  }
  return dentro;
}

// anchos de calle en metros por clase de OpenMapTiles
const ANCHO_VIA = {
  motorway: 20, motorway_link: 10, trunk: 17, trunk_link: 9, primary: 13, primary_link: 8,
  secondary: 11, secondary_link: 7, tertiary: 9, tertiary_link: 6, minor: 7, service: 4,
  raceway: 7, busway: 7,
};
const VIA_SENDA = new Set(['path', 'track', 'cycleway', 'footway', 'pedestrian', 'steps', 'bridleway']);
const VIA_RAIL = new Set(['rail', 'transit']);

function quitaCierre(ring) {
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (ring.length > 1 && a.x === b.x && a.y === b.y) return ring.slice(0, -1);
  return ring;
}

export default function MapView() {
  const canvasRef = useRef(null);
  const buscaRef = useRef(null);
  const engineRef = useRef(null);
  const rotulosRef = useRef(null);
  const toastT = useRef(null);
  const [status, setStatus] = useState({ pct: null, total: 0, global: 0, adornos: 0 });
  const [cargando, setCargando] = useState(0);
  const [toast, setToast] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [sinGL, setSinGL] = useState(false);
  // instalación PWA: 'prompt' (Android/desktop con beforeinstallprompt),
  // 'ios' (Safari iOS: no hay prompt, se enseñan instrucciones), '' (nada que ofrecer)
  const [instala, setInstala] = useState('');
  const [iosOpen, setIosOpen] = useState(false);
  const instalaEvRef = useRef(null);
  // cámara del escaneo: null | 'listo' | 'capturando'
  const [cam, setCam] = useState(null);
  // modo decorar: null, o {cell, n} con la manzana en edición y sus adornos
  const [edicion, setEdicion] = useState(null);
  const [herr, setHerr] = useState('arbol');
  const [prog, setProg] = useState(0);
  // color dominante que va emergiendo durante la captura (se enseña en vivo)
  const [colorVivo, setColorVivo] = useState(null);
  const camVideoRef = useRef(null);
  const camStreamRef = useRef(null);
  const camCartonRef = useRef(null);

  function avisa(msg) {
    setToast(msg);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(''), 3200);
  }

  useEffect(() => {
    // ya instalada (abierta desde el icono) → no ofrecer nada
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if (standalone) return undefined;

    const onPrompt = (e) => {
      e.preventDefault();
      instalaEvRef.current = e;
      setInstala('prompt');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const onDone = () => {
      instalaEvRef.current = null;
      setInstala('');
      avisa('¡Instalada! Ya la tienes en tu pantalla de inicio 🎉');
    };
    window.addEventListener('appinstalled', onDone);

    // Safari de iOS no dispara beforeinstallprompt: se detecta y se guía a mano
    const ua = window.navigator.userAgent;
    const esIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
    if (esIos) setInstala('ios');

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onDone);
    };
  }, []);

  async function onInstalar() {
    if (instala === 'ios') {
      setInfoOpen(false); // las dos hojas comparten sitio
      setIosOpen((v) => !v);
      return;
    }
    const ev = instalaEvRef.current;
    if (!ev) return;
    instalaEvRef.current = null; // un prompt solo se puede usar una vez
    setInstala('');
    try {
      ev.prompt();
      await ev.userChoice;
    } catch {}
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

    // --- origen geográfico ---
    const params = new URLSearchParams(window.location.search);
    const lat = Math.max(-85, Math.min(85, parseFloat(params.get('lat')) || 41.3874));
    const lng = Math.max(-180, Math.min(180, parseFloat(params.get('lng')) || 2.1686));
    const origen = lonLatToMerc(lng, lat);
    const k = Math.cos((lat * Math.PI) / 180); // Mercator → metros reales
    const teselaM = (WORLD / N_TILE) * k;

    // Se cargan 3x3 teselas, así que el mundo con edificios ACABA a 1,5
    // teselas del centro (1.835 m/tesela a lat 41° → 2.753 m). La niebla fija
    // de antes empezaba a 3.600 m, o sea 850 m MÁS ALLÁ del borde: no lo
    // tapaba y el mundo se veía cortado con un tajo recto.
    const radioMundo = teselaM * 1.5;

    const scene = new THREE.Scene();
    // Cielo en degradado en vez de un color liso. Va como textura
    // EQUIRECTANGULAR, no como imagen de fondo plana: así el degradado está
    // anclado al mundo y el horizonte se queda donde debe al inclinar la
    // cámara, en vez de resbalar con la pantalla. Son 4×256 píxeles y un solo
    // draw call.
    const texCielo = (() => {
      const cv = document.createElement('canvas');
      cv.width = 4;
      cv.height = 256;
      const c = cv.getContext('2d');
      const grad = c.createLinearGradient(0, 0, 0, 256);
      const hex = (v) => '#' + v.toString(16).padStart(6, '0');
      grad.addColorStop(0, hex(CIELO_CENIT)); // arriba del canvas = cenit
      grad.addColorStop(0.5, hex(CIELO_HORIZONTE));
      grad.addColorStop(1, hex(CIELO_HORIZONTE)); // bajo el horizonte, liso
      c.fillStyle = grad;
      c.fillRect(0, 0, 4, 256);
      const tex = new THREE.CanvasTexture(cv);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    scene.background = texCielo;
    // La niebla va del color del HORIZONTE, no del cenit: es contra el
    // horizonte contra lo que se recorta el borde del mundo.
    // near/far de verdad los pone ajustaNiebla() en cada frame: dependen de lo
    // lejos que esté la cámara, no son constantes.
    scene.fog = new THREE.Fog(CIELO_HORIZONTE, 1, 2);

    // Suelo del horizonte: el respaldo LISO que queda detrás del anillo de
    // contexto, para que aún más allá no haya vacío. Va más abajo que el
    // contexto (y = -8) porque a esa distancia el escalón no se ve, y separarlos
    // así evita que se peleen por la profundidad al rasar la cámara.
    const horizonte = new THREE.Mesh(
      new THREE.PlaneGeometry(teselaM * 24, teselaM * 24),
      new THREE.MeshBasicMaterial({ color: SUELO_BASE })
    );
    horizonte.rotation.x = -Math.PI / 2;
    horizonte.position.y = -8; // bajo el contexto (-1), que va bajo el detalle (0)
    scene.add(horizonte);

    // El plano cercano sube de 2 a 5 m para recuperar precisión de profundidad:
    // el lejano se va a 30 km y con near=2 los planos de suelo se peleaban.
    // minDistance es 90 m, así que a 5 m no se recorta nada que se vea.
    const camera = new THREE.PerspectiveCamera(50, 1, 5, 30000);
    camera.position.set(280, 430, 360);
    // Cámara reproducible desde la URL: ?d=630&pol=47&az=38 (distancia en
    // metros, inclinación y rumbo en grados; 0° de inclinación = cenital).
    // Sin estos parámetros no cambia nada. Existe para que el banco visual
    // (npm run vistas) pueda capturar siempre EL MISMO encuadre.
    const dCam = parseFloat(params.get('d'));
    const polCam = parseFloat(params.get('pol'));
    const azCam = parseFloat(params.get('az'));
    if (dCam > 0 && Number.isFinite(polCam) && Number.isFinite(azCam)) {
      const pol = Math.max(0.01, Math.min(76, polCam)) * (Math.PI / 180);
      const az = azCam * (Math.PI / 180);
      const r = dCam * Math.sin(pol);
      camera.position.set(r * Math.sin(az), dCam * Math.cos(pol), r * Math.cos(az));
    }

    const controls = new MapControls(camera, canvas);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = false;
    controls.minDistance = 90;
    // Ya no la limita el bloque de detalle sino el contexto, que llega mucho
    // más lejos. Antes eran ~3.850 m, un tope puesto para no mirar al vacío.
    controls.maxDistance = 7000;
    controls.maxPolarAngle = 1.34;

    // --- gestos de dos dedos, estilo Apple Maps ---
    // MapControls con dos dedos solo hace zoom + desplazar, y su zoom va SIEMPRE
    // hacia el target: pellizques donde pellizques, se acerca al centro de la
    // pantalla. Aquí se hace a mano para que las cuatro cosas pasen a la vez y
    // TODAS pivoten sobre el punto que tienes entre los dedos:
    //   separar/juntar  -> zoom sobre ese punto
    //   girar en círculo -> el mapa gira sobre ese punto
    //   subir/bajar      -> inclinación 3D
    //   mover en horizontal -> desplazar
    // El vertical se lo queda la inclinación, así que desplazar arriba y abajo
    // es cosa de UN dedo (igual que en Apple Maps). Con dos no se puede tener
    // las dos cosas: el mismo movimiento no puede significar dos gestos.
    const INCLINA_POR_PX = 0.0035; // rad por píxel de arrastre vertical
    const dedos = new Map();
    let gesto = null;
    const ndc = new THREE.Vector2();
    const rayo = new THREE.Raycaster();
    const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pSuelo = new THREE.Vector3();
    const pSuelo2 = new THREE.Vector3();
    const offCam = new THREE.Vector3();
    const esfCam = new THREE.Spherical();

    // Punto del suelo (y=0) bajo un píxel de pantalla. Si el rayo se va al
    // cielo no hay intersección: se cae al target, que es lo más razonable.
    function sueloEn(sx, sy, out) {
      // Dos cosas que solo hace el renderizador al pintar, y aquí la cámara se
      // mueve varias veces dentro del mismo gesto:
      //  - re-apuntarla al target. Sin esto conserva la orientación de antes de
      //    girar, el rayo sale hacia otro lado y el mapa se iba ~580 m de
      //    deriva por cada giro (justo el desplazamiento horizontal de cámara).
      //  - recalcular su matriz de mundo. Sin esto el segundo raycast devuelve
      //    el MISMO punto que el primero, el ancla no corrige nada y el zoom
      //    sigue yendo al centro de la pantalla en vez de al punto pellizcado.
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      ndc.set((sx / vpW) * 2 - 1, -(sy / vpH) * 2 + 1);
      rayo.setFromCamera(ndc, camera);
      if (rayo.ray.intersectPlane(planoSuelo, out)) return out;
      return out.copy(controls.target);
    }

    function giraSobre(px, pz, a) {
      const co = Math.cos(a);
      const si = Math.sin(a);
      for (const v of [camera.position, controls.target]) {
        const x = v.x - px;
        const z = v.z - pz;
        v.x = px + x * co - z * si;
        v.z = pz + x * si + z * co;
      }
    }

    function estadoDedos() {
      const [a, b] = [...dedos.values()];
      return {
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        ang: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }

    function onDedoBaja(e) {
      if (e.pointerType !== 'touch') return;
      dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dedos.size === 2) {
        // MapControls se aparta: si no, los dos harían lo suyo a la vez
        controls.enabled = false;
        gesto = estadoDedos();
      }
    }

    function onDedoMueve(e) {
      if (e.pointerType !== 'touch' || !dedos.has(e.pointerId)) return;
      dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dedos.size !== 2 || !gesto) return;
      e.preventDefault();
      const ahora = estadoDedos();

      // el punto del mundo que hay bajo los dedos ANTES de tocar nada: es el
      // que tiene que quedarse quieto pase lo que pase
      sueloEn(gesto.mx, gesto.my, pSuelo);

      // 1. inclinación, del movimiento vertical (dedos arriba = tumbar cámara)
      const dInc = (gesto.my - ahora.my) * INCLINA_POR_PX;
      if (dInc) {
        offCam.copy(camera.position).sub(controls.target);
        esfCam.setFromVector3(offCam);
        esfCam.phi = Math.max(0.02, Math.min(controls.maxPolarAngle, esfCam.phi + dInc));
        offCam.setFromSpherical(esfCam);
        camera.position.copy(controls.target).add(offCam);
      }

      // 2. giro, sobre el punto de entre los dedos
      let dAng = ahora.ang - gesto.ang;
      if (dAng > Math.PI) dAng -= 2 * Math.PI;
      if (dAng < -Math.PI) dAng += 2 * Math.PI;
      if (dAng) giraSobre(pSuelo.x, pSuelo.z, -dAng);

      // 3. zoom: separar los dedos acerca
      if (gesto.dist > 8 && ahora.dist > 8) {
        offCam.copy(camera.position).sub(controls.target);
        const d = offCam.length();
        const nd = Math.max(
          controls.minDistance,
          Math.min(controls.maxDistance, d / (ahora.dist / gesto.dist))
        );
        offCam.multiplyScalar(nd / d);
        camera.position.copy(controls.target).add(offCam);
      }

      // 4. Y ahora el ancla: se mira dónde ha quedado ese punto del mundo y se
      // mueve todo para devolverlo bajo los dedos. Esto hace tres cosas de una:
      // el zoom va al punto pellizcado, el giro y la inclinación pivotan sobre
      // él, y el movimiento horizontal arrastra el mapa. Se usa la Y ANTERIOR a
      // propósito: el vertical ya se ha gastado en inclinar.
      sueloEn(ahora.mx, gesto.my, pSuelo2);
      camera.position.x += pSuelo.x - pSuelo2.x;
      camera.position.z += pSuelo.z - pSuelo2.z;
      controls.target.x += pSuelo.x - pSuelo2.x;
      controls.target.z += pSuelo.z - pSuelo2.z;

      gesto = ahora;
    }

    function onDedoSube(e) {
      if (e.pointerType !== 'touch') return;
      dedos.delete(e.pointerId);
      if (dedos.size < 2) gesto = null;
      // con un dedo suelto se queda MapControls fuera hasta levantar los dos:
      // devolverle el control a media maniobra da un salto feo
      if (dedos.size === 0) controls.enabled = true;
    }

    canvas.addEventListener('pointerdown', onDedoBaja);
    canvas.addEventListener('pointermove', onDedoMueve, { passive: false });
    canvas.addEventListener('pointerup', onDedoSube);
    canvas.addEventListener('pointercancel', onDedoSube);

    // Las dos distancias cambian con el zoom, así que la niebla se recalcula
    // por frame: empieza donde acaba el detalle y satura donde acaba el contexto.
    function ajustaNiebla() {
      const d = camera.position.distanceTo(controls.target);
      const far = d + NIEBLA_HASTA_M;
      scene.fog.far = far;
      scene.fog.near = d + NIEBLA_DESDE_M;
      // el horizonte sigue al target: así nunca se le ve el canto al panear
      horizonte.position.x = controls.target.x;
      horizonte.position.z = controls.target.z;
      return { d, near: scene.fog.near, far };
    }

    const matEdificios = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

    // textura de VENTANAS de las fachadas: una celda = una ventana de una
    // planta (PLANTA_M × PLANTA_M). Multiplica al color de vértice, así cada
    // edificio conserva su color y gana el detalle — todo procedural, cero
    // descarga extra.
    const texVent = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 64, 64);
      c.fillStyle = 'rgba(64, 80, 102, 0.22)'; // el cristal, suave (cartoon)
      c.fillRect(17, 16, 30, 32);
      c.fillStyle = 'rgba(255, 255, 255, 0.55)'; // reflejo superior
      c.fillRect(17, 16, 30, 7);
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      return tex;
    })();
    // Oclusión del arranque de la fachada. Comparte la UV de las ventanas
    // (v = altura en plantas) pero NO repite: al recortarse en v=1 el oscurecido
    // termina a los PLANTA_M metros en vez de estirarse hasta el remate. Antes
    // esto era un color de vértice y, como el color interpola lineal de un
    // extremo al otro de la pared, en una torre de 60 m se veía como un
    // degradado vertical raro en vez de como una sombra a ras de acera. De
    // regalo: un cuerpo que arranca en alto (minH>0) nace ya con v>1, así que no
    // se le pinta pie — que es justo lo correcto, no toca el suelo.
    const texAo = (() => {
      const cv = document.createElement('canvas');
      cv.width = 1;
      cv.height = 64;
      const c = cv.getContext('2d');
      // v=0 (el suelo) es la fila de ABAJO del canvas: flipY viene de serie
      const grad = c.createLinearGradient(0, 64, 0, 0);
      grad.addColorStop(0, '#8c8c8c');
      grad.addColorStop(0.6, '#e6e6e6');
      grad.addColorStop(1, '#ffffff');
      c.fillStyle = grad;
      c.fillRect(0, 0, 1, 64);
      // sin colorSpace: three lee el canal R como dato, no como color
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      return tex;
    })();
    const matParedes = new THREE.MeshBasicMaterial({
      vertexColors: true,
      // Las paredes se ven SIEMPRE por fuera: un edificio es un volumen cerrado
      // y la cámara no entra dentro. Descartando la mitad trasera, la GPU se
      // ahorra sombrearla — medido, 30% más de frames en la vista tumbada, que
      // es donde la fachada llena la pantalla.
      //
      // Va BackSide, no FrontSide, y el motivo es sutil: classifyRings entrega
      // los anillos con el criterio de las teselas MVT, que tienen la Y hacia
      // ABAJO, y aEscena la invierte al pasar a coordenadas de escena. Eso da la
      // vuelta al sentido de giro, así que la cara geométricamente "frontal"
      // acaba siendo la de DENTRO. Con FrontSide los edificios salían huecos: se
      // veía el interior de la pared del fondo.
      //
      // Los TEJADOS no pueden llevar descarte: comparten material con los
      // árboles, y las cruces de tronco son planos sueltos que deben verse por
      // las dos caras.
      side: THREE.BackSide,
      map: texVent,
      aoMap: texAo, // channel 0: reaprovecha la `uv` que ya está ahí
    });

    // --- estado del mundo ---
    const tiles = new Map(); // "x/y" → entrada
    const scans = new Map(); // celda → color de fachada '#rrggbb' o null
    const decos = new Map(); // celda → {o: dueño, d: [{t, x, y}, …]}
    const jugador = idJugador();
    let vivo = true;
    let enCarga = 0;

    // window.__mapaListo: lo lee el banco visual para saber cuándo capturar.
    // Sin esto habría que dormir a ojo y las capturas salen a medio construir.
    // enCarga solo baja al terminar construyeEdificios(), así que en 0 la vista
    // está completa: suelo, edificios y árboles.
    window.__mapaListo = false;
    // Diagnóstico: búferes de GPU por tesela VIVA. Sin esto, «han subido los
    // búferes» se confunde con la retención normal (la app conserva un 5x5
    // aunque solo cargue un 3x3) y se dan por buenas fugas que no existen.
    window.__teselas = () => tiles.size;
    function carga(delta) {
      enCarga += delta;
      window.__mapaListo = enCarga === 0;
      setCargando(enCarga);
    }

    // --- adornos: lo que los usuarios colocan en su manzana ---
    // Cada tipo es UNA geometría low-poly con el sombreado del sol horneado en
    // el color de vértice (como edificios y árboles) y UN InstancedMesh para
    // todo el mundo cargado: cinco draw calls sean 3 adornos o 3.000. Comparten
    // el material de los tejados, así que llevan la misma niebla y el mismo
    // look que el resto del mapa sin ninguna textura más.
    const cellM = (WORLD / N_CELL) * k; // metros de lado de una celda z18

    // nx: componente este de la normal; nn: componente norte
    function luzDe(nx, nn) {
      const luz = 0.5 + 0.5 * (nx * SOL_E + nn * SOL_N);
      return LUZ_SOMBRA + (1 - LUZ_SOMBRA) * luz;
    }
    // caja alineada a los ejes (x: este, z: sur), con tapa y sin fondo
    function caja(pos, col, x0, y0, z0, x1, y1, z1, color) {
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
    // prisma regular de n lados centrado en el origen, con tapa; r1 permite
    // que el remate sea más estrecho que la base (tronco de cono)
    function prisma(pos, col, n, r, y0, y1, color, r1 = r) {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const s = luzDe(Math.cos(am), Math.sin(am));
        const x0 = Math.cos(a0) * r;
        const z0 = -Math.sin(a0) * r;
        const x1 = Math.cos(a1) * r;
        const z1 = -Math.sin(a1) * r;
        const X0 = Math.cos(a0) * r1;
        const Z0 = -Math.sin(a0) * r1;
        const X1 = Math.cos(a1) * r1;
        const Z1 = -Math.sin(a1) * r1;
        pos.push(x0, y0, z0, x1, y0, z1, X1, y1, Z1, x0, y0, z0, X1, y1, Z1, X0, y1, Z0);
        for (let q = 0; q < 6; q++) col.push(color.r * s, color.g * s, color.b * s);
        pos.push(0, y1, 0, X0, y1, Z0, X1, y1, Z1);
        for (let q = 0; q < 3; q++) col.push(color.r, color.g, color.b);
      }
    }
    // copa octaédrica, la misma que la de los árboles de los parques
    function copa(pos, col, hC, r, verde) {
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
      const top = [0, hC + r * 1.15, 0];
      const bot = [0, hC - r * 0.85, 0];
      for (let i = 0; i < 4; i++) {
        const a = eq[i];
        const b = eq[(i + 1) % 4];
        const pa = [a[0], hC, -a[1]];
        const pb = [b[0], hC, -b[1]];
        cara(top, pa, pb, i % 2 ? 0.97 : 1.1);
        cara(bot, pb, pa, i % 2 ? 0.72 : 0.8);
      }
    }
    function geometriaAdorno(tipo) {
      const pos = [];
      const col = [];
      if (tipo === 'arbol') {
        caja(pos, col, -0.22, 0, -0.22, 0.22, 3.2, 0.22, TRONCO);
        copa(pos, col, 4.8, 2.3, VERDES_ARBOL[1]);
      } else if (tipo === 'farola') {
        caja(pos, col, -0.14, 0, -0.14, 0.14, 5.4, 0.14, COL_POSTE);
        caja(pos, col, -0.5, 5.2, -0.5, 0.5, 6.0, 0.5, COL_LUZ);
      } else if (tipo === 'banco') {
        caja(pos, col, -0.95, 0, -0.28, -0.75, 0.45, 0.28, COL_POSTE);
        caja(pos, col, 0.75, 0, -0.28, 0.95, 0.45, 0.28, COL_POSTE);
        caja(pos, col, -1, 0.45, -0.3, 1, 0.62, 0.3, COL_MADERA); // asiento
        caja(pos, col, -1, 0.62, 0.18, 1, 1.15, 0.3, COL_MADERA); // respaldo
      } else if (tipo === 'fuente') {
        prisma(pos, col, 8, 3.2, 0, 0.9, COL_PIEDRA);
        prisma(pos, col, 8, 2.9, 0.9, 1.0, COL_AGUA); // lámina de agua
        prisma(pos, col, 6, 0.45, 1.0, 2.6, COL_PIEDRA);
        prisma(pos, col, 8, 1.3, 2.6, 2.9, COL_PIEDRA);
        prisma(pos, col, 8, 1.1, 2.9, 3.0, COL_AGUA);
      } else if (tipo === 'bandera') {
        caja(pos, col, -0.1, 0, -0.1, 0.1, 7.5, 0.1, COL_MASTIL);
        // el paño es un triángulo suelto: se ve por las dos caras (DoubleSide)
        pos.push(0.1, 7.4, 0, 0.1, 6.2, 0, 2.6, 6.8, 0);
        for (let q = 0; q < 3; q++) col.push(COL_BANDERA.r, COL_BANDERA.g, COL_BANDERA.b);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return geo;
    }
    const mallasAdorno = {};
    const grupoAdornos = new THREE.Group();
    scene.add(grupoAdornos);
    for (const t of Object.keys(TIPOS)) {
      const m = new THREE.InstancedMesh(geometriaAdorno(t), matEdificios, MAX_INSTANCIAS);
      m.count = 0;
      // la esfera envolvente sería la de la geometría base, en el origen:
      // con ella, en cuanto el origen sale de pantalla se descartan TODAS las
      // instancias, estén donde estén
      m.frustumCulled = false;
      mallasAdorno[t] = m;
      grupoAdornos.add(m);
    }
    const mtxI = new THREE.Matrix4();
    const posI = new THREE.Vector3();
    const rotI = new THREE.Quaternion();
    const escI = new THREE.Vector3();
    const ejeY = new THREE.Vector3(0, 1, 0);
    let nAdornos = 0;

    // Esquina noroeste de una celda en coordenadas de escena. Los adornos se
    // guardan como fracción de la celda, así que esto es lo único que hace
    // falta para plantarlos.
    function esquinaCelda(cx, cy) {
      const base = tileToMerc(Z_CELL, cx, cy);
      return { e0: (base.mx - origen.mx) * k, n0: (base.my - origen.my) * k };
    }

    // Rehace TODAS las instancias. Es una pasada por los adornos cargados
    // (unos cientos, como mucho unos miles): más barato que llevar la cuenta
    // de qué instancia era de qué celda cuando una cambia.
    function pintaAdornos() {
      const cont = {};
      for (const t in mallasAdorno) cont[t] = 0;
      let total = 0;
      for (const [key, dc] of decos) {
        if (!dc.d?.length) continue;
        const p = key.split('/');
        const cx = Number(p[1]);
        const cy = Number(p[2]);
        // sin su tesela no hay suelo bajo el adorno: se espera a que cargue
        const entry = tiles.get(Math.floor(cx / CELLS_POR_TESELA) + '/' + Math.floor(cy / CELLS_POR_TESELA));
        if (!entry?.data) continue;
        const { e0, n0 } = esquinaCelda(cx, cy);
        for (const a of dc.d) {
          const m = mallasAdorno[a.t];
          if (!m || cont[a.t] >= MAX_INSTANCIAS) continue;
          // giro y tamaño deterministas por posición: variedad sin guardar nada
          const h = ((Math.round(a.x * 1000) * 73856093) ^ (Math.round(a.y * 1000) * 19349663)) >>> 0;
          posI.set(e0 + a.x * cellM, 0, -(n0 - a.y * cellM));
          const giro = a.t === 'banco' ? (h % 4) * (Math.PI / 2) : (h % 360) * (Math.PI / 180);
          rotI.setFromAxisAngle(ejeY, giro);
          const sc = a.t === 'fuente' ? 1 : 0.9 + (h % 21) * 0.01;
          escI.set(sc, sc, sc);
          mtxI.compose(posI, rotI, escI);
          m.setMatrixAt(cont[a.t]++, mtxI);
          total++;
        }
      }
      for (const t in mallasAdorno) {
        mallasAdorno[t].count = cont[t];
        mallasAdorno[t].instanceMatrix.needsUpdate = true;
      }
      if (total !== nAdornos) {
        nAdornos = total;
        setStatus((st) => ({ ...st, adornos: total }));
      }
    }

    // --- modo decorar ---
    // Se decora la manzana que está en el centro de la vista, si es tuya. Un
    // toque en el suelo coloca la herramienta elegida (o borra el adorno más
    // cercano). El guardado va con retardo: un POST por ráfaga, no por toque.
    let edicion = null; // {key, e0, n0}
    let avisaEdicion = null; // callback a React
    let herramienta = 'arbol';
    let guardadoT = null;
    const texMarco = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(47, 111, 237, 0.13)';
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = 'rgba(47, 111, 237, 0.92)';
      c.lineWidth = 9;
      c.setLineDash([24, 14]);
      c.strokeRect(5, 5, 246, 246);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    // El marco va a 40 cm del suelo y con test de profundidad: en la calle se
    // ve, y donde hay un edificio lo tapan sus paredes — que es justo lo que
    // dice «esta manzana», sin pintar por encima de los tejados.
    const marco = new THREE.Mesh(
      new THREE.PlaneGeometry(cellM, cellM),
      new THREE.MeshBasicMaterial({ map: texMarco, transparent: true, depthWrite: false })
    );
    marco.rotation.x = -Math.PI / 2;
    marco.renderOrder = 1;
    marco.visible = false;
    scene.add(marco);

    async function guardaAdornos(key) {
      const dc = decos.get(key);
      if (!dc) return;
      ultimoHasta = null; // el POST cambia el servidor: el próximo sondeo, completo
      try {
        const r = await fetch('/api/adornos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cell: key, jugador, adornos: dc.d }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          avisaEdicion?.({ error: j.error || 'red' });
        }
      } catch {
        avisaEdicion?.({ error: 'red' });
      }
    }
    function programaGuardado(key) {
      clearTimeout(guardadoT);
      guardadoT = setTimeout(() => {
        guardadoT = null;
        guardaAdornos(key);
      }, 900);
    }
    function vaciaGuardado() {
      if (!guardadoT || !edicion) return;
      clearTimeout(guardadoT);
      guardadoT = null;
      guardaAdornos(edicion.key);
    }

    function colocaEn(sx, sy) {
      const ed = edicion;
      if (!ed) return;
      sueloEn(sx, sy, pSuelo);
      const fx = (pSuelo.x - ed.e0) / cellM;
      const fy = (ed.n0 + pSuelo.z) / cellM; // z de escena = -norte
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
        avisaEdicion?.({ fuera: true });
        return;
      }
      const dc = decos.get(ed.key);
      const lista = dc?.d ? dc.d.slice() : [];
      if (herramienta === 'borrar') {
        let mejor = -1;
        let md = Infinity;
        for (let i = 0; i < lista.length; i++) {
          const d = Math.hypot((lista[i].x - fx) * cellM, (lista[i].y - fy) * cellM);
          if (d < md) {
            md = d;
            mejor = i;
          }
        }
        if (mejor < 0 || md > 6) return; // nada a menos de 6 m del toque
        lista.splice(mejor, 1);
      } else {
        if (lista.length >= MAX_ADORNOS) {
          avisaEdicion?.({ lleno: true });
          return;
        }
        lista.push({ t: herramienta, x: Math.round(fx * 1000) / 1000, y: Math.round(fy * 1000) / 1000 });
      }
      decos.set(ed.key, { o: dc?.o || jugador, d: lista });
      pintaAdornos();
      avisaEdicion?.({ n: lista.length });
      programaGuardado(ed.key);
    }

    // Un toque es bajar y subir el MISMO puntero, solo, sin moverse apenas.
    // Arrastrar mueve el mapa (MapControls) y no coloca nada.
    let toque = null;
    let punteros = 0;
    function onToqueBaja(e) {
      if (e.isPrimary) punteros = 0; // un primario nuevo es una secuencia nueva
      punteros++;
      toque = punteros === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    }
    function onToqueSube(e) {
      punteros = Math.max(0, punteros - 1);
      const tq = toque;
      toque = null;
      if (!tq || !edicion || punteros !== 0) return;
      if (Math.hypot(e.clientX - tq.x, e.clientY - tq.y) > 8 || performance.now() - tq.t > 600) return;
      colocaEn(e.clientX, e.clientY);
    }
    function onToqueCancela() {
      punteros = Math.max(0, punteros - 1);
      toque = null;
    }
    canvas.addEventListener('pointerdown', onToqueBaja);
    canvas.addEventListener('pointerup', onToqueSube);
    canvas.addEventListener('pointercancel', onToqueCancela);

    // --- conversiones ---
    function sceneToMerc(e, n) {
      return { mx: e / k + origen.mx, my: n / k + origen.my };
    }
    function teselaDelTarget() {
      const m = sceneToMerc(controls.target.x, -controls.target.z);
      return {
        x: Math.floor((m.mx / WORLD + 0.5) * N_TILE),
        y: Math.floor((0.5 - m.my / WORLD) * N_TILE),
      };
    }
    function celdaDelTarget() {
      const m = sceneToMerc(controls.target.x, -controls.target.z);
      return {
        cx: Math.floor((m.mx / WORLD + 0.5) * N_CELL),
        cy: Math.floor((0.5 - m.my / WORLD) * N_CELL),
      };
    }

    // Encoge un anillo hacia el sólido del edificio. Los edificios pegados
    // comparten la pared en el MISMO plano y, de cerca, la GPU no sabe cuál va
    // delante (z-fighting: cuadraditos/triángulos que bailan); separados unos
    // cm dejan de ser coplanares y a la distancia mínima de cámara no se ve.
    // Un agujero (patio) se mueve al revés: también hacia el sólido.
    // ⚠ epsMax varía POR POLÍGONO (hash): OSM trae miles de polígonos
    // SUPERPUESTOS (partes de edificio sobre su contorno) que se mueven en la
    // MISMA dirección — con un eps fijo seguirían coplanares tras encoger.
    function encoge(ring, esAgujero, epsMax) {
      let a2 = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a2 += ring[j].e * ring[i].n - ring[i].e * ring[j].n;
      }
      const s = (a2 >= 0 ? 1 : -1) * (esAgujero ? -1 : 1);
      const out = new Array(ring.length);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const a = ring[(i - 1 + ring.length) % ring.length];
        const c = ring[(i + 1) % ring.length];
        // bisectriz de las normales interiores de las dos aristas del vértice
        const l1 = Math.hypot(p.e - a.e, p.n - a.n) || 1;
        const l2 = Math.hypot(c.e - p.e, c.n - p.n) || 1;
        let de = (-(p.n - a.n) / l1 - (c.n - p.n) / l2) * s;
        let dn = ((p.e - a.e) / l1 + (c.e - p.e) / l2) * s;
        const l = Math.hypot(de, dn);
        if (l < 0.001) {
          out[i] = p;
          continue;
        }
        const eps = Math.min(epsMax, 0.2 * Math.min(l1, l2));
        out[i] = { e: p.e + (de / l) * eps, n: p.n + (dn / l) * eps };
      }
      return out;
    }

    // --- preparación de una tesela descodificada ---
    function prepara(x, y, data) {
      const base = tileToMerc(Z_TILE, x, y);
      const escala = WORLD / N_TILE / data.extent;
      const aEscena = (p) => ({
        e: (base.mx + p.x * escala - origen.mx) * k,
        n: (base.my - p.y * escala - origen.my) * k,
      });
      const bldgs = [];
      // OJO: en z14 OpenMapTiles FUSIONA edificios en features multipolígono
      // (una feature = cientos de edificios repartidos por la tesela), así que
      // la celda, el color y la altura van POR POLÍGONO, no por feature.
      for (const b of data.buildings) {
        for (const rings of b.polys) {
          const crudos = [];
          for (const ring of rings) {
            const r = quitaCierre(ring).map(aEscena);
            if (r.length >= 3) crudos.push(r);
          }
          if (!crudos.length) continue;
          const outer = crudos[0];
          let ce = 0;
          let cn = 0;
          let area = 0;
          for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
            ce += outer[i].e;
            cn += outer[i].n;
            area += (outer[j].e - outer[i].e) * (outer[j].n + outer[i].n);
          }
          ce /= outer.length;
          cn /= outer.length;
          area = Math.abs(area / 2);
          const m = sceneToMerc(ce, cn);
          // Las teselas MVT traen en su margen (buffer) COPIAS de los edificios
          // del borde de la vecina: dibujadas las dos, cada cara existe dos
          // veces en el mismo sitio y parpadea (z-fighting). Cada edificio lo
          // dibuja SOLO la tesela dueña de su centroide.
          const tx = Math.floor((m.mx / WORLD + 0.5) * N_TILE);
          const ty = Math.floor((0.5 - m.my / WORLD) * N_TILE);
          if (tx !== x || ty !== y) continue;
          const hash = (Math.abs((Math.round(m.mx) * 73856093) ^ (Math.round(m.my) * 19349663)) >>> 0) || 1;
          const cx = Math.floor((m.mx / WORLD + 0.5) * N_CELL);
          const cy = Math.floor((0.5 - m.my / WORLD) * N_CELL);
          const eps = 0.05 + (hash % 40) * 0.005; // 5–25 cm, distinto por polígono
          const anillos = crudos.map((r, i) => encoge(r, i > 0, eps));
          let h = b.h;
          if (!(h > 0)) h = Math.min(24, 5 + Math.sqrt(area) * 0.3) + (hash % 7);
          // dos polígonos superpuestos con la MISMA altura real (medido: 6.312
          // pares en una tesela de BCN) → tejados coplanares: se les da unos cm
          // de diferencia, invisibles en un mapa cartoon
          h += (hash % 89) * 0.007;
          bldgs.push({
            polys: [anillos],
            minH: b.minH || 0,
            h,
            hash,
            area, // la usa el tejado para decidir si es una casa o un bloque
            cell: cellKey(cx, cy),
            colour: b.colour,
          });
        }
      }
      // zonas verdes en coordenadas de escena (para plantar árboles)
      const verdes = [];
      for (const rings of data.green) {
        const rs = [];
        for (const ring of rings) {
          const r = quitaCierre(ring).map(aEscena);
          if (r.length >= 3) rs.push(r);
        }
        if (rs.length) verdes.push(rs);
      }
      // --- rótulos ---
      // Mismo truco que con los edificios: el margen de la tesela trae COPIAS
      // de lo que hay al otro lado del borde, así que cada rótulo lo pone solo
      // la tesela dueña de su punto. Si no, «Gràcia» sale por duplicado.
      const suya = (e, n) => {
        const m = sceneToMerc(e, n);
        return (
          Math.floor((m.mx / WORLD + 0.5) * N_TILE) === x &&
          Math.floor((0.5 - m.my / WORLD) * N_TILE) === y
        );
      };

      const places = [];
      for (const pl of data.places) {
        const q = aEscena({ x: pl.x, y: pl.y });
        if (!suya(q.e, q.n)) continue;
        places.push({ tipo: 'sitio', name: pl.name, cls: pl.cls, peso: pl.peso, rank: pl.rank, e: q.e, n: q.n });
      }

      // Un nombre de calle llega troceado en muchos tramos. Se rotula UNO: el
      // tramo recto más largo, que es el que mejor aguanta el texto encima.
      const porNombre = new Map();
      for (const rn of data.roadNames) {
        for (const line of rn.lines) {
          for (let i = 1; i < line.length; i++) {
            const a = aEscena(line[i - 1]);
            const b = aEscena(line[i]);
            const largo = Math.hypot(b.e - a.e, b.n - a.n);
            const prev = porNombre.get(rn.name);
            if (prev && prev.largo >= largo) continue;
            porNombre.set(rn.name, { a, b, largo });
          }
        }
      }
      const calles = [];
      for (const [name, t] of porNombre) {
        if (t.largo < LARGO_MIN_CALLE) continue; // tramo corto: no cabe el rótulo
        const e = (t.a.e + t.b.e) / 2;
        const n = (t.a.n + t.b.n) / 2;
        if (!suya(e, n)) continue;
        calles.push({ tipo: 'calle', name, e, n, a: t.a, b: t.b, largo: t.largo });
      }

      // celdas con edificio (para el % de la vista)
      const celdas = new Set(bldgs.map((b) => b.cell));
      return { bldgs, celdas, verdes, rotulos: places.concat(calles) };
    }

    // --- suelo: canvas por tesela ---
    function pintaSuelo(x, y, data) {
      const S = 1024;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const ctx = cv.getContext('2d');
      const ext = data.extent;
      const px = (v) => (v / ext) * S;
      const pxPorM = S / teselaM;

      ctx.fillStyle = '#' + SUELO_BASE.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, S, S);

      const poligono = (rings) => {
        ctx.beginPath();
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i];
            if (i === 0) ctx.moveTo(px(p.x), px(p.y));
            else ctx.lineTo(px(p.x), px(p.y));
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
      };
      const linea = (pts) => {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (i === 0) ctx.moveTo(px(p.x), px(p.y));
          else ctx.lineTo(px(p.x), px(p.y));
        }
        ctx.stroke();
      };

      // usos del suelo primero: el verde, la arena y el agua mandan por encima
      for (const lu of data.landuse) {
        const col = COLOR_USO[lu.cls];
        if (!col) continue;
        ctx.fillStyle = col;
        poligono(lu.rings);
      }

      ctx.fillStyle = '#bcd8a5';
      data.green.forEach(poligono);
      ctx.fillStyle = '#eee1b8';
      data.sand.forEach(poligono);
      ctx.fillStyle = '#8ec3e0';
      data.water.forEach(poligono);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#8ec3e0';
      ctx.lineWidth = Math.max(2, 7 * pxPorM);
      data.waterways.forEach(linea);
      ctx.strokeStyle = '#c9ced4';
      ctx.lineWidth = 45 * pxPorM;
      data.runways.forEach(linea);

      // vías: anchas primero
      const orden = [...data.roads].sort(
        (a, b) => (ANCHO_VIA[b.cls] || 5) - (ANCHO_VIA[a.cls] || 5)
      );
      // bordillos: TODAS las carcasas antes que los rellenos — si no, el
      // bordillo de una calle cruzaría el asfalto de la anterior
      ctx.strokeStyle = '#a7aeb7';
      for (const r of orden) {
        if (VIA_RAIL.has(r.cls) || VIA_SENDA.has(r.cls)) continue;
        ctx.lineWidth = Math.max(2, (ANCHO_VIA[r.cls] || 6) * pxPorM) + Math.max(1.6, 2.4 * pxPorM);
        r.lines.forEach(linea);
      }
      for (const r of orden) {
        if (VIA_RAIL.has(r.cls)) {
          ctx.strokeStyle = '#a9afb8';
          ctx.lineWidth = Math.max(1.2, 2 * pxPorM);
        } else if (VIA_SENDA.has(r.cls)) {
          ctx.strokeStyle = '#d9d3c2';
          ctx.lineWidth = Math.max(1.4, 2.5 * pxPorM);
        } else {
          ctx.strokeStyle = '#c2c8cf';
          ctx.lineWidth = Math.max(2, (ANCHO_VIA[r.cls] || 6) * pxPorM);
        }
        r.lines.forEach(linea);
      }

      // Sombras de contacto: la huella de cada edificio, corrida en sentido
      // contrario al sol y alargada según su altura. Van aquí, en el canvas del
      // suelo, y no en geometría: no cuestan ni un vértice ni un draw call. Es
      // lo que asienta los edificios en el mundo — sin ellas se leen como
      // pegatinas pegadas sobre el plano.
      //
      // Se pintan en una capa aparte y se componen de UNA pasada por dos
      // razones: donde dos huellas se solapan no se oscurece el doble (y el
      // margen de la tesela trae copias de los edificios de las vecinas, que
      // son justo las que hacen falta para que la sombra no se corte en la
      // costura), y el desenfoque sale de un solo filtro en vez de uno por
      // edificio.
      // La capa va a MEDIA resolución: sale difuminada y al 20%, así que el
      // detalle fino no llega a verse y se ahorra un cuarto del tiempo (34 →
      // 26 ms por tesela). Agruparlas en un Path2D por altura, que parecía lo
      // obvio, resultó 10× MÁS lento (34 → 372 ms): un camino con 158.000
      // aristas obliga al rasterizador a considerarlas todas en cada línea de
      // barrido, mientras que un relleno pequeño solo toca su caja.
      // Para situarse: construyeEdificios cuesta ~8 s por tesela, o sea que
      // todo esto es el 0,3% — no merece más optimización.
      const SS = S / 2;
      const pxs = (v) => (v / ext) * SS;
      const pxsPorM = SS / teselaM;
      const sombraCv = document.createElement('canvas');
      sombraCv.width = sombraCv.height = SS;
      const sctx = sombraCv.getContext('2d');
      sctx.fillStyle = '#000';
      for (const b of data.buildings) {
        const alto = Math.min(b.h > 0 ? b.h : 10, SOMBRA_ALTO_MAX);
        const d = alto * SOMBRA_LARGO * pxsPorM;
        const ox = -SOL_E * d;
        const oy = SOL_N * d; // el canvas crece hacia el sur: la n va al revés
        for (const rings of b.polys) {
          sctx.beginPath();
          for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
              const p = ring[i];
              if (i === 0) sctx.moveTo(pxs(p.x) + ox, pxs(p.y) + oy);
              else sctx.lineTo(pxs(p.x) + ox, pxs(p.y) + oy);
            }
            sctx.closePath();
          }
          sctx.fill('evenodd');
        }
      }
      ctx.save();
      ctx.globalAlpha = SOMBRA_ALFA;
      // el desenfoque se mide en METROS para que no dependa de S; si el
      // navegador no soporta ctx.filter la sombra sale de canto en vez de
      // difuminada, que es una degradación aceptable
      ctx.filter = 'blur(' + Math.max(1, 2.5 * pxPorM).toFixed(1) + 'px)';
      ctx.drawImage(sombraCv, 0, 0, S, S);
      ctx.restore();

      // celdas: velo gris en las PENDIENTES, tinte cálido en las escaneadas
      const cs = S / CELLS_POR_TESELA;
      for (let i = 0; i < CELLS_POR_TESELA; i++) {
        for (let j = 0; j < CELLS_POR_TESELA; j++) {
          const key = cellKey(x * CELLS_POR_TESELA + i, y * CELLS_POR_TESELA + j);
          if (scans.has(key)) {
            const cc = scans.get(key);
            let borde;
            if (cc) {
              // con color de cámara, el velo y el marco llevan ese mismo tono;
              // el marco más OSCURO, o sobre campo claro no contrasta
              const r = parseInt(cc.slice(1, 3), 16);
              const g = parseInt(cc.slice(3, 5), 16);
              const bl = parseInt(cc.slice(5, 7), 16);
              ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ',0.16)';
              borde =
                'rgba(' + Math.round(r * 0.66) + ',' + Math.round(g * 0.66) + ',' + Math.round(bl * 0.66) + ',0.75)';
            } else {
              ctx.fillStyle = 'rgba(243, 195, 110, 0.10)';
              borde = 'rgba(216, 169, 92, 0.45)';
            }
            ctx.fillRect(i * cs, j * cs, cs, cs);
            // MARCO de celda escaneada: en el campo no hay edificios que
            // pintar, así que sin esto un escaneo rural no se ve por ningún
            // lado (pasó: una masía en Girona, escaneada y "no veo nada")
            ctx.strokeStyle = borde;
            // a 64 px por celda (z18) un marco de 4 px comería el 6% del lado
            ctx.lineWidth = 2;
            ctx.strokeRect(i * cs + 1, j * cs + 1, cs - 2, cs - 2);
          } else {
            ctx.fillStyle = 'rgba(108, 115, 124, 0.24)';
            ctx.fillRect(i * cs, j * cs, cs, cs);
          }
        }
      }

      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    }

    function centroTesela(x, y) {
      const base = tileToMerc(Z_TILE, x, y);
      const half = WORLD / N_TILE / 2;
      return {
        e: (base.mx + half - origen.mx) * k,
        n: (base.my - half - origen.my) * k,
      };
    }

    // --- edificios: una geometría fusionada por tesela ---
    const tick = () => new Promise((r) => setTimeout(r, 0));

    // colores derivados de un color de cámara, cacheados por celda+variante
    const cacheCamCol = new Map();
    // `estado` es lo que devuelve scans.get(celda): undefined = sin escanear,
    // null = escaneada sin color de cámara, '#rrggbb' = con color. Se pasa a
    // mano (en vez de leerlo aquí) para poder preguntar por el color ANTERIOR
    // al repintar una celda.
    function coloresDe(b, estado) {
      if (estado === undefined) return { pared: GRIS_PARED, tejado: GRIS_TEJADO };
      const cam = estado;
      if (cam) {
        // el color REAL capturado en esa celda, con una pizca de variedad por
        // edificio para que la manzana no salga plana
        const v = b.hash % 5;
        const ck = cam + v;
        let par = cacheCamCol.get(ck);
        if (!par) {
          const base = new THREE.Color(cam);
          par = {
            pared: base.clone().lerp(BLANCO, v * 0.05),
            tejado: base.clone().lerp(BLANCO, 0.28 + v * 0.04),
          };
          cacheCamCol.set(ck, par);
        }
        return par;
      }
      // sin color de cámara, el de OSM es dato real y gana a la paleta inventada
      const osm = colorOsm(b.colour);
      if (osm) return osm;
      if (b.hash % 1000 < 180) {
        const i = b.hash % ACENTOS.length;
        return { pared: ACENTOS[i], tejado: TEJADOS_AC[i] };
      }
      const i = b.hash % PALETA.length;
      return { pared: PALETA[i], tejado: TEJADOS[i] };
    }

    // g = {posT, colT} tejados (material liso) + {posP, colP, uvP} paredes
    // (material con ventanas; la UV va en PLANTAS: u = metros/PLANTA_M)
    function meteEdificio(g, b) {
      const { pared, tejado } = coloresDe(b, scans.get(b.cell));
      for (const anillos of b.polys) {
        const outer = anillos[0];
        const holes = anillos.slice(1);

        // ¿Casa con tejado o bloque con azotea? Un edificio con patio queda
        // fuera: insetar un anillo con agujeros es pedir problemas y además una
        // finca con patio de luces no lleva cuatro aguas.
        let cima = null;
        let hAlero = b.h;
        if (
          holes.length === 0 &&
          b.area > TEJ_AREA_MIN &&
          b.area < TEJ_AREA_MAX &&
          b.h - b.minH < TEJ_ALTO_MAX &&
          outer.length <= TEJ_LADOS_MAX
        ) {
          const lado = Math.sqrt(b.area);
          // el alero BAJA en vez de subir la cumbrera: así el edificio conserva
          // la altura que dice el dato y no crece 3 m por la cara
          const alzado = Math.min(3.4, lado * 0.3) * (0.8 + (b.hash % 5) * 0.1);
          if (b.h - alzado > b.minH + 2.2) {
            const candidato = encoge(outer, false, Math.min(2.6, lado * 0.24));
            // Un contorno estrecho o en L puede autointersecarse al insetar y
            // salir hecho un nudo. El área lo delata: si se desploma o cambia
            // de signo, tejado plano y a otra cosa.
            const a0 = areaAnillo(outer);
            const a1 = areaAnillo(candidato);
            if (a0 !== 0 && a1 / a0 > TEJ_AREA_MIN_REL) {
              cima = candidato;
              hAlero = b.h - alzado;
            }
          }
        }

        // tejado: la tapa va a b.h siempre — plana sobre el contorno, o pequeña
        // y encaramada sobre el anillo insetado si lleva faldones
        const tapa = cima || outer;
        const contour = tapa.map((p) => new THREE.Vector2(p.e, p.n));
        const holesV = holes.map((hr) => hr.map((p) => new THREE.Vector2(p.e, p.n)));
        let faces = [];
        try {
          faces = THREE.ShapeUtils.triangulateShape(contour, cima ? [] : holesV);
        } catch {
          /* polígono degenerado */
        }
        const all = cima ? tapa : outer.concat(...holes);
        for (const f of faces) {
          for (const idx of f) {
            const p = all[idx];
            g.posT.push(p.e, b.h, -p.n);
            g.colT.push(tejado.r, tejado.g, tejado.b);
          }
        }

        // faldones: del alero (contorno, hAlero) a la cumbrera (inset, b.h).
        // Llevan el mismo sol que las fachadas pero con menos rango: miran
        // hacia arriba, así que ninguno llega a quedarse tan oscuro.
        if (cima) {
          for (let i = 0; i < outer.length; i++) {
            const a = outer[i];
            const c = outer[(i + 1) % outer.length];
            const a2 = cima[i];
            const c2 = cima[(i + 1) % cima.length];
            const dx = c.e - a.e;
            const dy = c.n - a.n;
            const len = Math.hypot(dx, dy);
            if (len < 0.05) continue;
            const luz = 0.5 + 0.5 * ((dy / len) * SOL_E + (-dx / len) * SOL_N);
            const s = LUZ_TEJADO + (1 - LUZ_TEJADO) * luz;
            const r = tejado.r * s;
            const g2 = tejado.g * s;
            const bl = tejado.b * s;
            g.posT.push(a.e, hAlero, -a.n, c.e, hAlero, -c.n, c2.e, b.h, -c2.n);
            g.posT.push(a.e, hAlero, -a.n, c2.e, b.h, -c2.n, a2.e, b.h, -a2.n);
            for (let q = 0; q < 6; q++) g.colT.push(r, g2, bl);
          }
        }
        // Paredes (exterior + agujeros), con el sombreado del sol horneado en
        // el color de vértice. El pie oscuro ya no va aquí: lo pone texAo.
        // Acaban en el ALERO: lo que va de ahí a b.h ya lo cubren los faldones,
        // y sin faldones el alero ES b.h.
        const v0 = b.minH / PLANTA_M;
        const v1 = hAlero / PLANTA_M;
        for (const ring of anillos) {
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const c = ring[(i + 1) % ring.length];
            const dx = c.e - a.e;
            const dy = c.n - a.n;
            const len = Math.hypot(dx, dy);
            if (len < 0.05) continue;
            // Normal exterior de la cara (los anillos vienen con el exterior a
            // izquierdas y los patios a derechas, así que esto apunta bien en
            // los dos). El producto con el sol va CON SIGNO: antes llevaba un
            // Math.abs, o sea que la cara norte y la sur salían igual de claras
            // — había contraste entre orientaciones, pero no sol, y por eso la
            // ciudad se leía plana.
            const nx = dy / len;
            const ny = -dx / len;
            const luz = 0.5 + 0.5 * (nx * SOL_E + ny * SOL_N);
            const sombra = LUZ_SOMBRA + (1 - LUZ_SOMBRA) * luz;
            const r = pared.r * sombra;
            const g2 = pared.g * sombra;
            const bl = pared.b * sombra;
            const u1 = len / PLANTA_M;
            g.posP.push(a.e, b.minH, -a.n, c.e, b.minH, -c.n, c.e, hAlero, -c.n);
            g.posP.push(a.e, b.minH, -a.n, c.e, hAlero, -c.n, a.e, hAlero, -a.n);
            g.uvP.push(0, v0, u1, v0, u1, v1, 0, v0, u1, v1, 0, v1);
            g.colP.push(r, g2, bl, r, g2, bl, r, g2, bl);
            g.colP.push(r, g2, bl, r, g2, bl, r, g2, bl);
          }
        }
      }
    }

    // árbol low-poly (~36 vértices): cruz de tronco + copa octaédrica
    function meteArbol(pos, col, e, n, rnd) {
      const hT = 2 + rnd() * 1.4;
      const r = 1.5 + rnd() * 1.2;
      const hC = hT + r * 1.1;
      const verde = VERDES_ARBOL[(rnd() * VERDES_ARBOL.length) | 0];
      const w = 0.3;
      const hTope = hT + r * 0.5;
      const quad = (ax, az, bx, bz) => {
        pos.push(e + ax, 0, -(n + az), e + bx, 0, -(n + bz), e + bx, hTope, -(n + bz));
        pos.push(e + ax, 0, -(n + az), e + bx, hTope, -(n + bz), e + ax, hTope, -(n + az));
        for (let q = 0; q < 6; q++) col.push(TRONCO.r, TRONCO.g, TRONCO.b);
      };
      quad(-w, 0, w, 0);
      quad(0, -w, 0, w);
      const eq = [
        [e + r, n],
        [e, n + r],
        [e - r, n],
        [e, n - r],
      ];
      const cara = (p1, p2, p3, s) => {
        pos.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
        for (let q = 0; q < 3; q++) col.push(verde.r * s, verde.g * s, verde.b * s);
      };
      const top = [e, hC + r * 1.15, -n];
      const bot = [e, hC - r * 0.85, -n];
      for (let i = 0; i < 4; i++) {
        const a = eq[i];
        const b = eq[(i + 1) % 4];
        const pa = [a[0], hC, -a[1]];
        const pb = [b[0], hC, -b[1]];
        cara(top, pa, pb, i % 2 ? 0.97 : 1.1);
        cara(bot, pb, pa, i % 2 ? 0.72 : 0.8);
      }
    }

    async function construyeEdificios(entry) {
      const token = ++entry.token;
      const g = { posT: [], colT: [], posP: [], colP: [], uvP: [] };
      // Dónde empieza el color de cada edificio dentro de los buffers. Con esto,
      // un escaneo solo tiene que reescribir su tramo en vez de re-triangular la
      // tesela entera. Son dos enteros por edificio (~190 KB por tesela).
      const offT = new Int32Array(entry.bldgs.length + 1);
      const offP = new Int32Array(entry.bldgs.length + 1);
      let n = 0;
      for (const b of entry.bldgs) {
        offT[n] = g.colT.length;
        offP[n] = g.colP.length;
        meteEdificio(g, b);
        if (++n % 500 === 0) {
          await tick();
          if (!vivo || token !== entry.token) return;
        }
      }
      // los árboles van DESPUÉS en el mismo buffer de tejados; estas marcas de
      // fin dejan claro dónde acaban los edificios, para no pintarlos a ellos
      offT[entry.bldgs.length] = g.colT.length;
      offP[entry.bldgs.length] = g.colP.length;

      // árboles en las zonas verdes, deterministas por tesela (comparten la
      // geometría de tejados: material liso). Muestreo por rechazo con tope.
      const rnd = prng((entry.x * 73856093) ^ (entry.y * 19349663));
      let nArb = 0;
      for (const rings of entry.verdes || []) {
        if (nArb >= 320) break;
        const outer = rings[0];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        let area = 0;
        for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
          const p = outer[i];
          x0 = Math.min(x0, p.e);
          y0 = Math.min(y0, p.n);
          x1 = Math.max(x1, p.e);
          y1 = Math.max(y1, p.n);
          area += (outer[j].e - p.e) * (outer[j].n + p.n);
        }
        area = Math.abs(area / 2);
        if (area < 300) continue;
        let quiere = Math.min(80, Math.round(area / 900));
        let intentos = quiere * 6;
        while (quiere > 0 && intentos-- > 0 && nArb < 320) {
          const e = x0 + rnd() * (x1 - x0);
          const nn = y0 + rnd() * (y1 - y0);
          if (!dentroDe(rings, e, nn)) continue;
          meteArbol(g.posT, g.colT, e, nn, rnd);
          quiere--;
          nArb++;
        }
      }
      if (!vivo || token !== entry.token) return;
      const geoT = new THREE.BufferGeometry();
      geoT.setAttribute('position', new THREE.Float32BufferAttribute(g.posT, 3));
      geoT.setAttribute('color', new THREE.Float32BufferAttribute(g.colT, 3));
      const geoP = new THREE.BufferGeometry();
      geoP.setAttribute('position', new THREE.Float32BufferAttribute(g.posP, 3));
      geoP.setAttribute('color', new THREE.Float32BufferAttribute(g.colP, 3));
      geoP.setAttribute('uv', new THREE.Float32BufferAttribute(g.uvP, 2));
      if (entry.mesh) {
        entry.group.remove(entry.mesh);
        entry.mesh.geometry.dispose();
      }
      if (entry.meshP) {
        entry.group.remove(entry.meshP);
        entry.meshP.geometry.dispose();
      }
      entry.offT = offT;
      entry.offP = offP;
      entry.mesh = new THREE.Mesh(geoT, matEdificios);
      entry.meshP = new THREE.Mesh(geoP, matParedes);
      entry.group.add(entry.mesh);
      entry.group.add(entry.meshP);
    }

    function reconstruyeSuelo(entry) {
      const tex = pintaSuelo(entry.x, entry.y, entry.data);
      entry.suelo.material.map.dispose();
      entry.suelo.material.map = tex;
      entry.suelo.material.needsUpdate = true;
    }

    // --- rótulos: superposición HTML proyectada ---
    // No se pintan en la textura del suelo por dos razones: a 1024 px para
    // 1.835 m de tesela saldrían borrosos en cuanto te acercas, y al girar la
    // cámara quedarían boca abajo. Un <div> proyectado cada frame sale nítido
    // a cualquier zoom, siempre legible, y no cuesta ni un draw call.
    let candidatos = [];
    function recogeRotulos() {
      const vistos = new Map();
      for (const entry of tiles.values()) {
        for (const r of entry.rotulos || []) {
          const prev = vistos.get(r.name);
          if (prev) {
            if (prev.tipo !== r.tipo) continue; // un sitio le gana a una calle homónima
            if (r.tipo === 'sitio' ? r.rank >= prev.rank : r.largo <= prev.largo) continue;
          }
          vistos.set(r.name, r);
        }
      }
      // el orden ES la prioridad: al chocar dos rótulos, sobrevive el primero
      candidatos = [...vistos.values()].sort((a, b) => {
        if (a.tipo !== b.tipo) return a.tipo === 'sitio' ? -1 : 1;
        return a.tipo === 'sitio' ? a.rank - b.rank : b.largo - a.largo;
      });
    }

    const pv = new THREE.Vector3();
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    const puestas = [];
    const nodos = [];

    // Una textura por nombre de calle, cacheada: los mismos nombres vuelven
    // frame tras frame y rehacer el canvas sería tirar trabajo.
    const texRotulo = new Map();
    function texturaDe(nombre) {
      let t = texRotulo.get(nombre);
      if (t) return t;
      const cv = document.createElement('canvas');
      const fuente = 44;
      const medidor = cv.getContext('2d');
      medidor.font = '800 ' + fuente + 'px Nunito, system-ui, sans-serif';
      const ancho = Math.ceil(medidor.measureText(nombre).width) + 28;
      cv.width = ancho;
      cv.height = Math.ceil(fuente * 1.5);
      const c = cv.getContext('2d');
      c.font = '800 ' + fuente + 'px Nunito, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      // halo blanco: el texto tiene que leerse sobre asfalto, sobre parque y
      // sobre la trama de un tejado
      c.lineWidth = 9;
      c.strokeStyle = 'rgba(255,255,255,0.98)';
      c.lineJoin = 'round';
      c.strokeText(nombre, cv.width / 2, cv.height / 2);
      c.fillStyle = '#333b47';
      c.fillText(nombre, cv.width / 2, cv.height / 2);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      t = { tex, prop: cv.width / cv.height };
      texRotulo.set(nombre, t);
      return t;
    }

    // Plano ya tumbado: así la malla solo necesita girar sobre el eje vertical.
    const geoRotulo = new THREE.PlaneGeometry(1, 1);
    geoRotulo.rotateX(-Math.PI / 2);
    const mallasCalle = [];
    const grupoRotulos = new THREE.Group();
    scene.add(grupoRotulos);
    function mallaRotulo(i) {
      let m = mallasCalle[i];
      if (!m) {
        m = new THREE.Mesh(
          geoRotulo,
          new THREE.MeshBasicMaterial({
            transparent: true,
            // sin escribir profundidad: el rótulo no debe tapar a otro rótulo
            depthWrite: false,
            fog: true,
          })
        );
        m.renderOrder = 2;
        mallasCalle[i] = m;
        grupoRotulos.add(m);
      }
      return m;
    }

    function pintaEtiquetas(niebla) {
      const cont = rotulosRef.current;
      if (!cont) return;
      puestas.length = 0;

      // cuánto se ven los nombres de calle según lo tumbada que esté la cámara
      const pol = controls.getPolarAngle();
      const visCalle =
        1 - Math.max(0, Math.min(1, (pol - CALLE_FADE_INI) / (CALLE_FADE_FIN - CALLE_FADE_INI)));

      for (const r of candidatos) {
        if (puestas.length >= MAX_ROTULOS) break;
        const esCalle = r.tipo === 'calle';
        // los topónimos SÍ deben flotar por encima de todo (así lo hacen todos
        // los mapas); esto es solo para los de calle
        if (esCalle && visCalle <= 0.02) continue;
        // regla de zoom: la ciudad se ve siempre, el barrio solo de cerca
        if (niebla.d > (esCalle ? DIST_CALLE : r.peso)) continue;

        // Un rótulo de calle NO se clava en el punto medio del tramo: al
        // acercarte, ese punto se va de pantalla y la calle que tienes debajo
        // se queda sin nombre. Se desliza al punto del tramo más cercano a lo
        // que estás mirando, sin llegar a los extremos (ahí el texto se
        // saldría de la calle).
        let ex = r.e;
        let nx = r.n;
        if (esCalle) {
          const dx = r.b.e - r.a.e;
          const dn = r.b.n - r.a.n;
          const l2 = dx * dx + dn * dn;
          if (l2 > 0) {
            const t = ((controls.target.x - r.a.e) * dx + (-controls.target.z - r.a.n) * dn) / l2;
            const tc = Math.max(0.15, Math.min(0.85, t));
            ex = r.a.e + dx * tc;
            nx = r.a.n + dn * tc;
          }
        }

        pv.set(ex, 0, -nx);
        const dist = pv.distanceTo(camera.position);
        // se desvanece con la MISMA niebla que el mundo: si el suelo de debajo
        // ya está fundido con el cielo, su nombre no puede seguir ahí flotando
        let op = 1 - Math.max(0, Math.min(1, (dist - niebla.near) / (niebla.far - niebla.near)));
        if (esCalle) op *= visCalle;
        if (op < 0.18) continue;

        pv.project(camera);
        if (pv.z > 1) continue; // detrás de la cámara
        const sx = (pv.x * 0.5 + 0.5) * vpW;
        const sy = (-pv.y * 0.5 + 0.5) * vpH;

        let ang = 0;
        let voltea = false;
        let aw;
        let ah;
        const fuente = esCalle ? 11 : TAM_SITIO[r.cls] || 12;

        if (esCalle) {
          // La malla vive en el MUNDO, así que su tamaño en pantalla se mide
          // proyectando sus dos extremos. Con el margen en píxeles de antes
          // (pensado para un <div>) los nombres largos salían cortados por el
          // borde: el ancla cabía, el texto no.
          const t = texturaDe(r.name);
          const dx = r.b.e - r.a.e;
          const dn = r.b.n - r.a.n;
          const l = Math.hypot(dx, dn) || 1;
          const medio = (ALTO_TEXTO_M * t.prop) / 2;
          pa.set(ex - (dx / l) * medio, ROTULO_Y, -(nx - (dn / l) * medio)).project(camera);
          pb.set(ex + (dx / l) * medio, ROTULO_Y, -(nx + (dn / l) * medio)).project(camera);
          const ax = (pa.x * 0.5 + 0.5) * vpW;
          const ay = (-pa.y * 0.5 + 0.5) * vpH;
          const bx = (pb.x * 0.5 + 0.5) * vpW;
          const by = (-pb.y * 0.5 + 0.5) * vpH;
          // los DOS extremos tienen que caber, no solo el ancla
          const m = 8;
          if (
            Math.min(ax, bx) < m || Math.max(ax, bx) > vpW - m ||
            Math.min(ay, by) < m || Math.max(ay, by) > vpH - m
          ) continue;
          ang = Math.atan2(by - ay, bx - ax);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) {
            ang += Math.PI;
            voltea = true;
          }
          // caja de colisión medida, no estimada
          aw = Math.abs(bx - ax) + 10;
          ah = Math.abs(by - ay) + Math.hypot(bx - ax, by - ay) / t.prop + 6;
        } else {
          // el ancla tiene que caber ENTERA: medio rótulo cortado por el borde
          // parece un fallo, no un mapa
          if (sx < 40 || sx > vpW - 40 || sy < 14 || sy > vpH - 14) continue;
          aw = r.name.length * fuente * 0.56 + 12;
          ah = fuente * 1.6;
        }
        let choca = false;
        for (const q of puestas) {
          if (Math.abs(sx - q.sx) < (aw + q.aw) / 2 && Math.abs(sy - q.sy) < (ah + q.ah) / 2) {
            choca = true;
            break;
          }
        }
        if (choca) continue;
        puestas.push({ sx, sy, aw, ah, ang, op, fuente, r, ex, nx, voltea });
      }

      // Los de CALLE van a la escena 3D, tumbados sobre el asfalto. El test de
      // profundidad hace el trabajo: si hay un edificio entre la cámara y el
      // rótulo, el rótulo no se dibuja. Sin heurísticas ni rejillas.
      let nMalla = 0;
      for (const q of puestas) {
        if (q.r.tipo !== 'calle') continue;
        const m = mallaRotulo(nMalla++);
        const t = texturaDe(q.r.name);
        if (m.material.map !== t.tex) {
          m.material.map = t.tex;
          m.material.needsUpdate = true;
        }
        m.material.opacity = q.op;
        // giro sobre el eje vertical para seguir a la calle EN EL MUNDO (no en
        // pantalla: la malla vive en el mundo, la perspectiva ya la aplica la
        // cámara sola)
        let th = Math.atan2(q.r.b.n - q.r.a.n, q.r.b.e - q.r.a.e);
        if (q.voltea) th += Math.PI;
        m.rotation.y = th;
        m.position.set(q.ex, ROTULO_Y, -q.nx);
        m.scale.set(ALTO_TEXTO_M * t.prop, 1, ALTO_TEXTO_M);
        m.visible = true;
      }
      for (let i = nMalla; i < mallasCalle.length; i++) mallasCalle[i].visible = false;

      // los <div> se reciclan: crear y destruir nodos cada frame sería un
      // machaque del GC con el mapa en movimiento
      const sitios = puestas.filter((q) => q.r.tipo === 'sitio');
      for (let i = 0; i < sitios.length; i++) {
        const q = sitios[i];
        let el = nodos[i];
        if (!el) {
          el = document.createElement('div');
          cont.appendChild(el);
          nodos[i] = el;
        }
        if (el._txt !== q.r.name) {
          el.textContent = q.r.name;
          el._txt = q.r.name;
        }
        const cls = 'rotulo r-' + (q.r.tipo === 'sitio' ? q.r.cls : 'calle');
        if (el._cls !== cls) {
          el.className = cls;
          el._cls = cls;
        }
        el.style.fontSize = q.fuente + 'px';
        el.style.opacity = q.op.toFixed(2);
        el.style.transform =
          'translate3d(' + Math.round(q.sx) + 'px,' + Math.round(q.sy) + 'px,0)' +
          ' translate(-50%,-50%) rotate(' + q.ang.toFixed(3) + 'rad)';
        if (el._on !== true) {
          el.style.display = '';
          el._on = true;
        }
      }
      for (let i = sitios.length; i < nodos.length; i++) {
        if (nodos[i]._on !== false) {
          nodos[i].style.display = 'none';
          nodos[i]._on = false;
        }
      }
    }

    // --- anillo de contexto (z11: suelo lejano, sin edificios) ---
    const N_CTX = 2 ** Z_CTX;
    const ladoCtx = (WORLD / N_CTX) * k; // metros de lado de una tesela z11
    const contexto = new Map();

    // Pintado simplificado a propósito: ni edificios, ni sombras, ni velos por
    // celda. A 3 km o más eso no se distingue, y cada cosa que se quita es
    // trabajo que no se hace 9 veces.
    function pintaContexto(data) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = S_CTX;
      const ctx = cv.getContext('2d');
      const ext = data.extent;
      const px = (v) => (v / ext) * S_CTX;
      const pxPorM = S_CTX / ladoCtx;

      ctx.fillStyle = '#' + SUELO_BASE.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, S_CTX, S_CTX);

      const poligono = (rings) => {
        ctx.beginPath();
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i];
            if (i === 0) ctx.moveTo(px(p.x), px(p.y));
            else ctx.lineTo(px(p.x), px(p.y));
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
      };
      const linea = (pts) => {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (i === 0) ctx.moveTo(px(p.x), px(p.y));
          else ctx.lineTo(px(p.x), px(p.y));
        }
        ctx.stroke();
      };

      for (const lu of data.landuse) {
        const col = COLOR_USO[lu.cls];
        if (!col) continue;
        ctx.fillStyle = col;
        poligono(lu.rings);
      }
      ctx.fillStyle = '#bcd8a5';
      data.green.forEach(poligono);
      ctx.fillStyle = '#eee1b8';
      data.sand.forEach(poligono);
      ctx.fillStyle = '#8ec3e0';
      data.water.forEach(poligono);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#8ec3e0';
      ctx.lineWidth = Math.max(1, 7 * pxPorM);
      data.waterways.forEach(linea);
      // las vías se pintan con un mínimo de 1 px: a esta escala un ancho real
      // de 13 m serían 0,45 px y la red desaparecería
      ctx.strokeStyle = '#c2c8cf';
      for (const r of data.roads) {
        if (VIA_RAIL.has(r.cls) || VIA_SENDA.has(r.cls)) continue;
        ctx.lineWidth = Math.max(1, (ANCHO_VIA[r.cls] || 6) * pxPorM);
        r.lines.forEach(linea);
      }

      // Mismo velo gris que las celdas sin escanear del bloque de detalle. Sin
      // esto el contexto sale MÁS claro que lo de cerca y el escalón entre los
      // dos se marca justo donde se intenta disimular.
      ctx.fillStyle = 'rgba(108, 115, 124, 0.24)';
      ctx.fillRect(0, 0, S_CTX, S_CTX);

      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      return tex;
    }

    async function cargaContexto(x, y) {
      const key = x + '/' + y;
      const entry = { x, y };
      contexto.set(key, entry);
      try {
        const data = await loadTileData(Z_CTX, x, y);
        if (!vivo || contexto.get(key) !== entry) return;
        const base = tileToMerc(Z_CTX, x, y);
        const half = WORLD / N_CTX / 2;
        const plano = new THREE.Mesh(
          new THREE.PlaneGeometry(ladoCtx, ladoCtx),
          new THREE.MeshBasicMaterial({ map: pintaContexto(data) })
        );
        plano.rotation.x = -Math.PI / 2;
        plano.position.set(
          (base.mx + half - origen.mx) * k,
          -1, // bajo el suelo de detalle (y=0), sobre el horizonte liso (y=-8)
          -(base.my - half - origen.my) * k
        );
        entry.plano = plano;
        scene.add(plano);
      } catch (e) {
        contexto.delete(key); // que lo reintente el siguiente asegura()
        console.warn('contexto', key, e?.message);
      }
    }

    function liberaContexto(key) {
      const entry = contexto.get(key);
      if (!entry) return;
      contexto.delete(key);
      if (entry.plano) {
        scene.remove(entry.plano);
        entry.plano.geometry.dispose();
        entry.plano.material.map?.dispose();
        entry.plano.material.dispose();
      }
    }

    function aseguraContexto() {
      const m = sceneToMerc(controls.target.x, -controls.target.z);
      const rMerc = RADIO_CTX_M / k; // el radio en metros Mercator, no reales
      const aX = (mx) => Math.floor((mx / WORLD + 0.5) * N_CTX);
      const aY = (my) => Math.floor((0.5 - my / WORLD) * N_CTX);
      const x0 = aX(m.mx - rMerc);
      const x1 = aX(m.mx + rMerc);
      const y0 = aY(m.my + rMerc);
      const y1 = aY(m.my - rMerc);
      const quiero = new Set();
      for (let x = x0; x <= x1 && quiero.size < MAX_CTX; x++) {
        for (let y = y0; y <= y1 && quiero.size < MAX_CTX; y++) {
          quiero.add(x + '/' + y);
          if (!contexto.has(x + '/' + y)) cargaContexto(x, y);
        }
      }
      for (const key of [...contexto.keys()]) if (!quiero.has(key)) liberaContexto(key);
    }

    // --- ciclo de teselas ---
    async function cargaTesela(x, y, intentos = 0) {
      const key = x + '/' + y;
      const entry = { x, y, token: 0, intentos, group: new THREE.Group() };
      tiles.set(key, entry);
      carga(1);
      try {
        const data = await loadTileData(Z_TILE, x, y);
        // Identidad, no presencia de la clave. Si mientras esperábamos la red
        // se paneó fuera (liberaTesela borró la clave) y se volvió (cargaTesela
        // creó OTRA entrada con la misma clave), `tiles.has(key)` sería true y
        // seguiríamos construyendo sobre una entrada ya huérfana: su grupo
        // acabaría en la escena sin que nadie pueda liberarlo nunca.
        // OJO: el agujero es real por construcción, pero NO está medido — no se
        // ha conseguido disparar ni con 5 s de retardo por tesela (ver #3).
        if (!vivo || tiles.get(key) !== entry) return;
        entry.data = data;
        const prep = prepara(x, y, data);
        entry.bldgs = prep.bldgs;
        entry.celdas = prep.celdas;
        entry.verdes = prep.verdes;
        entry.rotulos = prep.rotulos;
        recogeRotulos();

        const c = centroTesela(x, y);
        const plano = new THREE.Mesh(
          new THREE.PlaneGeometry(teselaM, teselaM),
          new THREE.MeshBasicMaterial({ map: pintaSuelo(x, y, data) })
        );
        plano.rotation.x = -Math.PI / 2;
        plano.position.set(c.e, 0, -c.n);
        entry.suelo = plano;
        entry.group.add(plano);
        scene.add(entry.group);
        actualizaEstado();
        pintaAdornos(); // los de esta tesela esperaban a tener suelo
        await construyeEdificios(entry);
      } catch (e) {
        entry.error = Date.now();
        entry.intentos = intentos + 1;
        console.warn('tesela', key, e?.message);
      } finally {
        carga(-1);
      }
    }

    function liberaTesela(key) {
      const entry = tiles.get(key);
      if (!entry) return;
      tiles.delete(key);
      entry.token++;
      recogeRotulos();
      pintaAdornos();
      scene.remove(entry.group);
      if (entry.mesh) entry.mesh.geometry.dispose();
      if (entry.meshP) entry.meshP.geometry.dispose();
      if (entry.suelo) {
        entry.suelo.geometry.dispose();
        entry.suelo.material.map?.dispose();
        entry.suelo.material.dispose();
      }
    }

    let teselaActual = null;
    function asegura(force) {
      const t = teselaDelTarget();
      if (!force && teselaActual && t.x === teselaActual.x && t.y === teselaActual.y) return;
      teselaActual = t;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = t.x + dx;
          const y = t.y + dy;
          const key = x + '/' + y;
          if (!tiles.has(key)) cargaTesela(x, y);
        }
      }
      for (const key of [...tiles.keys()]) {
        const [x, y] = key.split('/').map(Number);
        if (Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) > 2) liberaTesela(key);
      }
      aseguraContexto();
    }

    // Reintento de las teselas que fallaron. Va SEPARADO de asegura() porque
    // aquel sale por la primera línea si el target no ha cambiado de tesela: si
    // te quedabas quieto, una tesela caída no se reintentaba jamás. Y avisa,
    // que antes el fallo solo salía por la consola: en pantalla, una tesela sin
    // cargar y una zona vacía de verdad son idénticas.
    let avisadoFallo = false;
    function reintenta() {
      const t = teselaActual;
      if (!t) return;
      let fallando = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = t.x + dx;
          const y = t.y + dy;
          const e = tiles.get(x + '/' + y);
          if (!e?.error) continue;
          fallando++;
          // 1 s, 2, 4, 8, 16, y a partir de ahí cada 30
          const espera = Math.min(30000, 1000 * 2 ** Math.min(e.intentos, 5));
          if (Date.now() - e.error > espera) {
            const n = e.intentos;
            liberaTesela(x + '/' + y);
            cargaTesela(x, y, n);
          }
        }
      }
      if (fallando && !avisadoFallo) {
        avisadoFallo = true;
        avisa('Hay zonas del mapa que no han cargado. Reintentando…');
      } else if (!fallando && avisadoFallo) {
        avisadoFallo = false;
      }
    }

    function actualizaEstado() {
      const total = new Set();
      let hechas = 0;
      for (const entry of tiles.values()) {
        if (!entry.celdas) continue;
        for (const c of entry.celdas) {
          if (!total.has(c)) {
            total.add(c);
            if (scans.has(c)) hechas++;
          }
        }
      }
      setStatus({
        pct: total.size ? Math.round((hechas / total.size) * 100) : null,
        total: total.size,
        global: scans.size,
        adornos: nAdornos,
      });
    }

    // Al escanear NO cambia la geometría, solo el color. El sombreado del sol va
    // horneado en el color de vértice, así que basta con escalar lo que ya hay
    // por (color nuevo / color viejo): se conserva la cara clara y la oscura sin
    // recalcular nada. Ninguno de los colores de la app tiene un canal a cero,
    // pero se guarda por si acaso.
    function escalaColor(arr, ini, fin, de, a) {
      const fr = de.r > 0.001 ? a.r / de.r : 0;
      const fg = de.g > 0.001 ? a.g / de.g : 0;
      const fb = de.b > 0.001 ? a.b / de.b : 0;
      for (let i = ini; i < fin; i += 3) {
        arr[i] *= fr;
        arr[i + 1] *= fg;
        arr[i + 2] *= fb;
      }
    }

    // cambios: Map celda -> estado ANTERIOR. Devuelve false si esta tesela aún
    // no tiene geometría hecha (entonces no hay nada que repintar).
    function repintaCeldas(entry, cambios) {
      const colT = entry.mesh?.geometry.getAttribute('color');
      const colP = entry.meshP?.geometry.getAttribute('color');
      if (!colT || !colP || !entry.offT) return false;
      let tocados = 0;
      for (let i = 0; i < entry.bldgs.length; i++) {
        const b = entry.bldgs[i];
        if (!cambios.has(b.cell)) continue;
        const antes = coloresDe(b, cambios.get(b.cell));
        const ahora = coloresDe(b, scans.get(b.cell));
        escalaColor(colT.array, entry.offT[i], entry.offT[i + 1], antes.tejado, ahora.tejado);
        escalaColor(colP.array, entry.offP[i], entry.offP[i + 1], antes.pared, ahora.pared);
        tocados++;
      }
      if (tocados) {
        colT.needsUpdate = true;
        colP.needsUpdate = true;
      }
      return true;
    }

    // Agrupa por tesela ANTES de tocar nada: cuatro celdas de la misma tesela
    // eran cuatro reconstrucciones completas.
    function aplicaCambios(cambios) {
      const porTesela = new Map();
      for (const [c, antes] of cambios) {
        const p = c.split('/');
        const key =
          Math.floor(Number(p[1]) / CELLS_POR_TESELA) + '/' + Math.floor(Number(p[2]) / CELLS_POR_TESELA);
        if (!porTesela.has(key)) porTesela.set(key, new Map());
        porTesela.get(key).set(c, antes);
      }
      for (const [key, cs] of porTesela) {
        const entry = tiles.get(key);
        if (!entry?.data) continue;
        reconstruyeSuelo(entry);
        if (!repintaCeldas(entry, cs)) construyeEdificios(entry);
      }
    }

    // --- escaneos compartidos ---
    // Se pide SOLO la caja de celdas que hay cargada, y a partir del segundo
    // sondeo solo lo cambiado desde el anterior. Antes se pedía el planeta
    // entero cada 25 s.
    let ultimoHasta = null;
    let ultimaCaja = '';
    function cajaDeCeldas() {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const key of tiles.keys()) {
        const [x, y] = key.split('/').map(Number);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      if (!Number.isFinite(x0)) return null;
      return {
        cx0: x0 * CELLS_POR_TESELA,
        cy0: y0 * CELLS_POR_TESELA,
        cx1: (x1 + 1) * CELLS_POR_TESELA - 1,
        cy1: (y1 + 1) * CELLS_POR_TESELA - 1,
      };
    }

    async function traeScans() {
      try {
        const caja = cajaDeCeldas();
        const q = new URLSearchParams();
        let clave = 'todo';
        if (caja) {
          for (const k of ['cx0', 'cy0', 'cx1', 'cy1']) q.set(k, String(caja[k]));
          clave = q.toString();
        }
        // el delta solo vale si la caja NO ha cambiado: si crece, lo de la
        // zona nueva es viejo y un `desde` se lo saltaría
        if (ultimoHasta != null && clave === ultimaCaja) q.set('desde', String(ultimoHasta));
        ultimaCaja = clave;

        const r = await fetch('/api/scans?' + q.toString());
        if (r.status === 304) return;
        const j = await r.json();
        if (typeof j.hasta === 'number') ultimoHasta = j.hasta;
        const cambios = new Map();
        let adornosCambiados = false;
        for (const it of j.cells || []) {
          // compat: la respuesta vieja era un array de strings
          const c = typeof it === 'string' ? it : it.k;
          const col = typeof it === 'string' ? null : it.c || null;
          if (!scans.has(c) || (col && scans.get(c) !== col)) {
            if (!cambios.has(c)) cambios.set(c, scans.get(c)); // el estado de ANTES
            scans.set(c, col);
          }
          // dueño y adornos. La manzana en edición NO se toca: lo local aún
          // no se ha guardado y el servidor la devolvería como estaba.
          if (typeof it !== 'string' && c !== edicion?.key) {
            const d = it.d || [];
            const o = it.o || null;
            const prev = decos.get(c);
            if (!prev || prev.o !== o || JSON.stringify(prev.d) !== JSON.stringify(d)) {
              decos.set(c, { o, d });
              if (prev?.d?.length || d.length) adornosCambiados = true;
            }
          }
        }
        if (cambios.size) {
          aplicaCambios(cambios);
          actualizaEstado();
        }
        if (adornosCambiados) pintaAdornos();
      } catch {
        /* sin red: se reintenta en el siguiente sondeo */
      }
    }

    engineRef.current = {
      // Mueve la vista a un lon/lat sin recargar la página. Devuelve false si
      // el salto es tan grande que hay que recargar de verdad: todas las
      // coordenadas de escena son (mercator - origen) × cos(lat del origen),
      // así que lejos se rompen dos cosas — la escala en metros deja de valer
      // para esa latitud, y los float32 de la geometría pierden precisión.
      iraA(latDest, lngDest) {
        if (Math.abs(latDest - lat) > 0.5) return false;
        const m = lonLatToMerc(lngDest, latDest);
        const e = (m.mx - origen.mx) * k;
        const n = (m.my - origen.my) * k;
        if (Math.hypot(e, n) > 60000) return false;
        // la cámara se mueve con el target: se conserva zoom, inclinación y rumbo
        const dx = e - controls.target.x;
        const dz = -n - controls.target.z;
        controls.target.x += dx;
        controls.target.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
        controls.update();
        asegura(true);
        return true;
      },
      // lon/lat y cámara actuales, para que la URL siga a la vista
      vistaActual() {
        const m = sceneToMerc(controls.target.x, -controls.target.z);
        const ll = mercToLonLat(m.mx, m.my);
        const d = camera.position.distanceTo(controls.target);
        return {
          lat: ll.lat,
          lng: ll.lon,
          d: Math.round(d),
          pol: Math.round(controls.getPolarAngle() * (180 / Math.PI)),
          az: Math.round(((controls.getAzimuthalAngle() * (180 / Math.PI)) % 360 + 360) % 360),
        };
      },
      celdaCentro() {
        const { cx, cy } = celdaDelTarget();
        return cellKey(cx, cy);
      },
      centroEscaneado() {
        const { cx, cy } = celdaDelTarget();
        return scans.has(cellKey(cx, cy));
      },
      scanHere(color) {
        const { cx, cy } = celdaDelTarget();
        const key = cellKey(cx, cy);
        if (scans.has(key)) return { already: true };
        const antes = scans.get(key);
        scans.set(key, color || null);
        decos.set(key, { o: jugador, d: [] }); // quien escanea se la queda
        aplicaCambios(new Map([[key, antes]]));
        actualizaEstado();
        ultimoHasta = null; // el POST cambia el servidor: el próximo sondeo, completo
        fetch('/api/scans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(color ? { cell: key, color, jugador } : { cell: key, jugador }),
        }).catch(() => {});
        return { already: false };
      },
      // ¿Se puede decorar esta celda? Escaneada y sin dueño, o del jugador.
      estadoCelda(key) {
        const dc = decos.get(key);
        return { escaneada: scans.has(key), dueno: dc?.o || null, n: dc?.d?.length || 0, yo: jugador };
      },
      // Entra (key) o sale (null) del modo decorar. Devuelve cuántos adornos
      // tiene ya la manzana. Al salir se guarda lo que quedara pendiente.
      editaCelda(key, cb) {
        vaciaGuardado();
        if (!key) {
          edicion = null;
          avisaEdicion = null;
          marco.visible = false;
          return 0;
        }
        const p = key.split('/');
        const { e0, n0 } = esquinaCelda(Number(p[1]), Number(p[2]));
        edicion = { key, e0, n0 };
        avisaEdicion = cb;
        marco.position.set(e0 + cellM / 2, 0.4, -(n0 - cellM / 2));
        marco.visible = true;
        return decos.get(key)?.d?.length || 0;
      },
      herramienta(t) {
        herramienta = t;
      },
    };

    // --- arranque + bucle ---
    let vpW = 1;
    let vpH = 1;
    function medir() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      vpW = w;
      vpH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', medir);
    medir();

    let raf = 0;
    let ultimoCheck = 0;
    // La URL sigue a la vista, así se puede compartir lo que estás mirando.
    // Antes ?lat=&lng= solo servía al cargar: mires donde mires, el enlace que
    // copiabas apuntaba al punto de partida.
    let ultimaUrl = 0;
    let urlPrevia = '';
    function siguesLaUrl(t) {
      if (t - ultimaUrl < 1500) return;
      ultimaUrl = t;
      const v = engineRef.current?.vistaActual();
      if (!v) return;
      const q =
        '/?lat=' + v.lat.toFixed(5) + '&lng=' + v.lng.toFixed(5) +
        '&d=' + v.d + '&pol=' + v.pol + '&az=' + v.az;
      if (q === urlPrevia) return;
      urlPrevia = q;
      try {
        window.history.replaceState(null, '', q);
      } catch {
        /* algunos navegadores limitan la frecuencia; no es crítico */
      }
    }
    function bucle(t) {
      raf = requestAnimationFrame(bucle);
      controls.update();
      const niebla = ajustaNiebla();
      if (t - ultimoCheck > 700) {
        ultimoCheck = t;
        asegura(false);
        reintenta();
      }
      siguesLaUrl(t);
      renderer.render(scene, camera);
      pintaEtiquetas(niebla);
    }

    (async () => {
      await traeScans();
      if (!vivo) return;
      asegura(true);
      raf = requestAnimationFrame(bucle);
    })();

    const poll = setInterval(traeScans, 25000);

    return () => {
      vivo = false;
      clearInterval(poll);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', medir);
      for (const key of [...tiles.keys()]) liberaTesela(key);
      for (const key of [...contexto.keys()]) liberaContexto(key);
      for (const el of nodos) el.remove();
      nodos.length = 0;
      for (const m of mallasCalle) m.material.dispose();
      mallasCalle.length = 0;
      geoRotulo.dispose();
      for (const t of texRotulo.values()) t.tex.dispose();
      texRotulo.clear();
      canvas.removeEventListener('pointerdown', onDedoBaja);
      canvas.removeEventListener('pointermove', onDedoMueve);
      canvas.removeEventListener('pointerup', onDedoSube);
      canvas.removeEventListener('pointercancel', onDedoSube);
      canvas.removeEventListener('pointerdown', onToqueBaja);
      canvas.removeEventListener('pointerup', onToqueSube);
      canvas.removeEventListener('pointercancel', onToqueCancela);
      vaciaGuardado(); // lo pendiente sale igual: el fetch sobrevive al visor
      for (const t in mallasAdorno) {
        mallasAdorno[t].geometry.dispose();
        mallasAdorno[t].dispose();
      }
      marco.geometry.dispose();
      marco.material.dispose();
      texMarco.dispose();
      controls.dispose();
      horizonte.geometry.dispose();
      horizonte.material.dispose();
      matEdificios.dispose();
      matParedes.dispose();
      texVent.dispose();
      texAo.dispose();
      texCielo.dispose();
      renderer.dispose();
      engineRef.current = null;
    };
  }, []);

  // Recargar la página para moverse destruía el contexto WebGL y volvía a
  // bajar ~8 MB de teselas. Solo se recarga si el salto es tan grande que las
  // coordenadas de escena dejan de valer (otra latitud, u otro continente).
  function vaA(latDest, lngDest, mensaje) {
    if (engineRef.current?.iraA(latDest, lngDest)) {
      if (mensaje) avisa(mensaje);
      return;
    }
    window.location.href = '/?lat=' + latDest.toFixed(5) + '&lng=' + lngDest.toFixed(5);
  }

  async function onBuscar(e) {
    e.preventDefault();
    const q = buscaRef.current?.value?.trim();
    if (!q) return;
    avisa('Buscando «' + q + '»…');
    try {
      const r = await fetch(
        'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q)
      );
      const j = await r.json();
      if (j?.[0]) {
        vaA(Number(j[0].lat), Number(j[0].lon), 'Aquí está «' + q + '»');
      } else {
        avisa('No se ha encontrado ese lugar');
      }
    } catch {
      avisa('No se pudo buscar (¿sin conexión?)');
    }
  }

  function onGps() {
    if (!navigator.geolocation) {
      avisa('Tu navegador no da la ubicación');
      return;
    }
    avisa('Obteniendo tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => vaA(p.coords.latitude, p.coords.longitude, 'Aquí estás'),
      () => avisa('No se pudo obtener tu ubicación'),
      { timeout: 8000 }
    );
  }

  useEffect(() => {
    // el <video> solo existe con el visor abierto: se le engancha el stream aquí
    if (cam && camVideoRef.current && camStreamRef.current) {
      camVideoRef.current.srcObject = camStreamRef.current;
    }
    // «modo cartón» en directo: una ventanita donde el mundo real se ve ya
    // pastelizado con la paleta del mapa, fotograma a fotograma. Es la
    // respuesta honesta a "ver cómo se detecta el entorno en tiempo real":
    // enseña EXACTAMENTE lo que el escáner está viendo y cómo lo traduce.
    if (!cam) return;
    const cv = camCartonRef.current;
    const video = camVideoRef.current;
    if (!cv || !video) return;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const reloj = setInterval(() => {
      if (video.readyState < 2) return;
      try {
        ctx.drawImage(video, 0, 0, cv.width, cv.height);
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        cartoniza(img.data);
        ctx.putImageData(img, 0, 0);
      } catch {
        /* fotograma aún no listo */
      }
    }, 120);
    return () => clearInterval(reloj);
  }, [cam]);

  useEffect(() => () => camStreamRef.current?.getTracks().forEach((t) => t.stop()), []);

  function cierraCamara() {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null; // el bucle de captura lo lee para abortar
    setCam(null);
    setProg(0);
    setColorVivo(null);
  }

  // Toda la gracia del mapa es que lo de color lo pintó alguien que ESTUVO
  // ahí. Sin comprobarlo, desde el sofá se puede colorear Tokio — y eso no se
  // puede deshacer, porque el primer escaneo de una celda manda para siempre.
  function posicionActual() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('sin_gps'));
      // El `timeout` de la propia API NO es de fiar: medido en Chromium con el
      // permiso sin conceder ni denegar, no llama a ninguna de las dos
      // funciones — ni siquiera al cabo de 27 s. Sin este reloj propio el botón
      // se queda en «Comprobando dónde estás…» para siempre y parece roto.
      const reloj = setTimeout(() => rej(new Error('timeout')), 13000);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(reloj);
          res(p);
        },
        (e) => {
          clearTimeout(reloj);
          rej(e);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  async function onScan() {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.centroEscaneado()) {
      avisa('El centro de la vista ya está escaneado — muévete a una zona gris');
      return;
    }

    let pos;
    try {
      avisa('Comprobando dónde estás…');
      pos = await posicionActual();
    } catch {
      avisa('Para escanear una zona hay que estar en ella: activa la ubicación');
      return;
    }
    // Una celda son 115 m de lado (una manzana). Un GPS urbano da 10-50 m; por
    // encima del lado de la celda el punto podría caer en la manzana de al
    // lado y se estaría marcando una zona en la que no estás.
    if (pos.coords.accuracy > 120) {
      avisa('La señal del GPS es poco precisa ahora mismo — inténtalo en un rato');
      return;
    }
    const t = lonLatToTile(pos.coords.longitude, pos.coords.latitude, Z_CELL);
    if (cellKey(t.x, t.y) !== eng.celdaCentro()) {
      avisa('Esta zona no es donde estás. Pulsa el botón de ubicación y escanea lo que tienes delante');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      camStreamRef.current = stream;
      setCam('listo');
    } catch {
      // sin cámara o permiso denegado: se escanea igual, con la paleta estándar
      const r = eng.scanHere(null);
      if (r && !r.already) avisa('Sin cámara: zona escaneada con los colores estándar 🎨');
    }
  }

  // Decorar: la manzana del centro de la vista, si la escaneaste tú (o si no
  // tiene dueño: las de la semilla, o las escaneadas por un cliente viejo).
  function onDecorar() {
    const eng = engineRef.current;
    if (!eng) return;
    const key = eng.celdaCentro();
    const st = eng.estadoCelda(key);
    if (!st.escaneada) {
      avisa('Primero escanea esta manzana: el mundo se decora donde se ha estado');
      return;
    }
    if (st.dueno && st.dueno !== st.yo) {
      avisa('Esta manzana la escaneó otra persona: solo la decora quien la escaneó');
      return;
    }
    const n = eng.editaCelda(key, (ev) => {
      if (ev.fuera) avisa('Toca dentro de la manzana marcada');
      else if (ev.lleno) avisa('Esta manzana ya tiene ' + MAX_ADORNOS + ' adornos: borra alguno para poner otro');
      else if (ev.error === 'ajena') avisa('Esta manzana ya tiene dueño: no se ha guardado');
      else if (ev.error) avisa('No se pudo guardar (¿sin conexión?)');
      else if (typeof ev.n === 'number') setEdicion((e) => (e ? { ...e, n: ev.n } : e));
    });
    eng.herramienta(herr);
    setInfoOpen(false);
    setIosOpen(false);
    setEdicion({ cell: key, n });
  }
  function terminaDecorar() {
    engineRef.current?.editaCelda(null);
    setEdicion(null);
  }
  function eligeHerr(t) {
    setHerr(t);
    engineRef.current?.herramienta(t);
  }

  async function capturaCam() {
    const video = camVideoRef.current;
    if (!video || cam !== 'listo') return;
    setCam('capturando');
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 48;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const px = [];
    const t0 = Date.now();
    const DURA = 3200;
    while (Date.now() - t0 < DURA) {
      if (!camStreamRef.current) return; // cancelado con la ✕
      try {
        ctx.drawImage(video, 0, 0, 64, 48);
        // banda central: fachadas, sin el cielo de arriba ni el suelo de abajo
        const d = ctx.getImageData(4, 12, 56, 26).data;
        for (let i = 0; i < d.length; i += 16) px.push(d[i], d[i + 1], d[i + 2]);
        // el color dominante se recalcula en vivo: se VE emerger mientras barres
        setColorVivo(colorFachada(px));
      } catch {
        /* fotograma aún no listo */
      }
      setProg(Math.min(1, (Date.now() - t0) / DURA));
      await new Promise((r) => setTimeout(r, 250));
    }
    cierraCamara();
    const color = colorFachada(px);
    const r = engineRef.current?.scanHere(color);
    if (!r) return;
    if (r.already) avisa('El centro de la vista ya está escaneado');
    else if (color)
      avisa(
        <>
          ¡Zona escaneada! Color capturado
          <span className="muestra" style={{ background: color }} /> — queda marcada en el
          mapa para todo el mundo
        </>
      );
    else avisa('Poca luz para captar el color — zona escaneada con la paleta estándar');
  }

  if (sinGL) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 20, textAlign: 'center', color: '#2b3440', fontWeight: 700 }}>
        Este navegador no soporta WebGL, que es lo que dibuja el mapa 3D.
      </div>
    );
  }

  return (
    <>
      <canvas id="lienzo" ref={canvasRef} />
      <div id="rotulos" ref={rotulosRef} aria-hidden="true" />

      <form className="ui busca glass" onSubmit={onBuscar} role="search">
        <input ref={buscaRef} type="search" placeholder="Busca un lugar del mundo…" aria-label="Buscar un lugar" />
        <button type="submit" aria-label="Buscar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-4.6-4.6" />
          </svg>
        </button>
      </form>

      <button
        className="ui btn-cuad b-info"
        aria-label="Cómo funciona"
        onClick={() => {
          setIosOpen(false); // las dos hojas comparten sitio
          setInfoOpen((v) => !v);
        }}
      >
        i
      </button>
      <button className="ui btn-cuad b-gps" aria-label="Ir a mi ubicación" onClick={onGps}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
      {instala && (
        <button className="ui btn-cuad b-inst" aria-label="Instalar la app" title="Instalar la app" onClick={onInstalar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v11" />
            <path d="M7.5 9.5 12 14l4.5-4.5" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </button>
      )}

      {iosOpen && (
        <div className="ui hoja glass">
          <h2>Instalar en tu iPhone</h2>
          <p>Safari no tiene botón de instalar, pero se hace en dos toques:</p>
          <p>
            <b>1.</b> Toca el botón <b>Compartir</b> de abajo (el cuadrado con la flecha ↑).
          </p>
          <p>
            <b>2.</b> Elige <b>«Añadir a pantalla de inicio»</b> y confirma.
          </p>
          <p>Te quedará el icono de crisrr maps como una app más.</p>
        </div>
      )}

      {infoOpen && (
        <div className="ui hoja glass">
          <h2>Cómo funciona</h2>
          <p>
            <b>Todo se dibuja en tu GPU.</b> El servidor solo manda datos vectoriales ligeros
            (calles y plantas de edificios de OpenStreetMap); tu móvil los extruye y los pinta,
            como hacen Google o Apple Maps.
          </p>
          <p>
            <b>Lo de color ya lo escaneó alguien.</b> Lo gris está pendiente: pulsa
            «Escanear esta zona» sobre una zona gris y se coloreará para todo el mundo.
            Solo puedes escanear la zona <b>en la que estás</b>: el mapa se colorea
            andando, no desde el sofá.
          </p>
          <p>
            <b>La cámara pinta el mapa.</b> Al escanear, la cámara captura el color
            dominante de las fachadas y esa zona se colorea con su color REAL para
            todo el mundo. Más adelante: formas y detalles.
          </p>
          <p>
            <b>La manzana que escaneas es tuya.</b> Pulsa «Decorar» sobre ella y coloca
            árboles, farolas, bancos, fuentes o tu bandera. Lo verá todo el mundo: el mapa
            es un solo mundo que se va construyendo entre todos.
          </p>
        </div>
      )}

      <div className="ui estado glass">
        <div className="tit">Esta vista</div>
        <div className="pct">
          {status.pct == null ? '—' : status.pct + '%'} <small>renderizada</small>
        </div>
        <div className="barra">
          <i style={{ width: (status.pct || 0) + '%' }} />
        </div>
        <div className="chip">
          <s className="c1" /> Escaneado por usuarios
        </div>
        <div className="chip">
          <s className="c2" /> Pendiente de escanear
        </div>
        <div className="meta">
          {status.global} celdas escaneadas en el mundo
          {status.adornos > 0 && <> · {status.adornos} adornos a la vista</>}
        </div>
      </div>

      {!edicion && (
        <div className="ui acciones">
          <button className="escanear" onClick={onScan}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8a2 2 0 0 1 2-2h1.5l1.4-2h8.2l1.4 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="12" cy="13" r="3.6" />
            </svg>
            Escanear esta zona
          </button>
          <button className="escanear decorar" onClick={onDecorar} aria-label="Decorar tu manzana">
            🎨 Decorar
          </button>
        </div>
      )}

      {edicion && (
        <>
          <div className="ui deco-cab glass">
            <b>Decorando tu manzana</b>
            <span>
              {edicion.n}/{MAX_ADORNOS} · toca el suelo para colocar
            </span>
          </div>
          <div className="ui paleta glass" role="toolbar" aria-label="Adornos">
            {Object.entries(TIPOS).map(([t, d]) => (
              <button
                key={t}
                className={'herr' + (herr === t ? ' on' : '')}
                onClick={() => eligeHerr(t)}
                aria-label={d.nombre}
                aria-pressed={herr === t}
              >
                <span>{d.icono}</span>
                <small>{d.nombre}</small>
              </button>
            ))}
            <button
              className={'herr' + (herr === 'borrar' ? ' on' : '')}
              onClick={() => eligeHerr('borrar')}
              aria-label="Borrar"
              aria-pressed={herr === 'borrar'}
            >
              <span>🧹</span>
              <small>Borrar</small>
            </button>
            <button className="listo" onClick={terminaDecorar}>
              Listo
            </button>
          </div>
        </>
      )}

      {cargando > 0 && (
        <div className="ui carga glass">
          <span className="punto" /> cargando el mapa…
        </div>
      )}

      {cam && (
        <div className="ui camara">
          <video ref={camVideoRef} autoPlay playsInline muted />
          <div className="cam-pip">
            <canvas ref={camCartonRef} width={96} height={72} />
            <span>modo cartón</span>
          </div>
          <button className="cam-x" aria-label="Cancelar" onClick={cierraCamara}>
            ✕
          </button>
          <div className="cam-pie">
            {cam === 'listo' ? (
              <>
                <p>Apunta a las fachadas de la zona: capturaremos su color real para el mapa.</p>
                <button className="cam-btn" onClick={capturaCam}>
                  📷 Capturar el color
                </button>
              </>
            ) : (
              <>
                <p>
                  Recorre despacio las fachadas…
                  {colorVivo && <span className="cam-vivo" style={{ background: colorVivo }} />}
                </p>
                <div className="cam-barra">
                  <i style={{ width: prog * 100 + '%' }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={'ui toast glass' + (toast ? ' on' : '')}>{toast}</div>

      <div className="ui attr glass">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        {' · '}
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>
      </div>
    </>
  );
}
