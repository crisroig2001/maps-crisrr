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
import { colorFachada } from '../lib/colorCam';
import { WORLD, Z_TILE, Z_CELL, lonLatToMerc, tileToMerc, cellKey } from '../lib/geo';

const N_TILE = 2 ** Z_TILE;
const N_CELL = 2 ** Z_CELL;
const CELLS_POR_TESELA = N_CELL / N_TILE; // 4

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
const PLANTA_M = 3; // metros por planta/ventana (escala de la textura de fachada)

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
const CIELO = 0xcfe8f4;
const SUELO_BASE = 0xd8dcd2; // el mismo gris con que arranca el canvas de cada tesela
// Niebla. NIEBLA_BORDE es el que TAPA el corte: la niebla satura a esa
// fracción de radioMundo pasado el target (0,88 deja margen para las vistas
// oblicuas, las peores). NIEBLA_ENTRADA solo decide dónde EMPIEZA a empañar:
// no afecta a la garantía del borde, así que se sube todo lo posible para que
// el mapa se vea nítido y solo se funda la última franja.
const NIEBLA_BORDE = 0.88;
const NIEBLA_ENTRADA = 0.62;

// usos del suelo: tonos MUY suaves, solo para que el fondo deje de ser un gris
// plano. Si tiñen demasiado le comen el protagonismo a los edificios.
// un tramo más corto que esto no da para escribir el nombre encima
const LARGO_MIN_CALLE = 110; // metros
// Los rótulos son un overlay HTML: NO pasan por el buffer de profundidad, así
// que se pintan encima de los edificios. Con la cámara tumbada, el nombre de
// una calle tapada por un bloque de pisos flota sobre los tejados. Mitigación
// hasta que los de calle vivan dentro de la escena 3D (issue #2): se
// desvanecen conforme se tumba la cámara, que es justo cuando estorban.
// La vista inicial está a 47°, así que el desvanecido empieza por encima.
const CALLE_FADE_INI = 0.96; // 55° — aquí empiezan a apagarse
const CALLE_FADE_FIN = 1.19; // 68° — aquí ya no se ven (el tope es 77°)
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
  const [status, setStatus] = useState({ pct: null, total: 0, global: 0 });
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
  const [prog, setProg] = useState(0);
  const camVideoRef = useRef(null);
  const camStreamRef = useRef(null);

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
    scene.background = new THREE.Color(CIELO);
    // near/far de verdad los pone ajustaNiebla() en cada frame: dependen de lo
    // lejos que esté la cámara, no son constantes.
    scene.fog = new THREE.Fog(CIELO, 1, 2);

    // Suelo del horizonte: un plano enorme del color base de las teselas para
    // que más allá del bloque cargado no haya VACÍO. La niebla lo funde con el
    // cielo, así que el borde del bloque deja de leerse como un corte: pasa de
    // "aquí se acaba el mundo" a "aquí ya no hay detalle".
    const horizonte = new THREE.Mesh(
      new THREE.PlaneGeometry(teselaM * 24, teselaM * 24),
      new THREE.MeshBasicMaterial({ color: SUELO_BASE })
    );
    horizonte.rotation.x = -Math.PI / 2;
    horizonte.position.y = -1; // por debajo del suelo de las teselas (y=0)
    scene.add(horizonte);

    const camera = new THREE.PerspectiveCamera(50, 1, 2, 20000);
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
    // alejarse más que esto es mirar sobre todo lo que NO está cargado
    controls.maxDistance = radioMundo * 1.4;
    controls.maxPolarAngle = 1.34;

    // La niebla tiene que saturar justo ANTES del borde del bloque, que está a
    // ~(distancia de cámara + radioMundo). Como esa distancia cambia al hacer
    // zoom, la niebla no puede ser fija: se recalcula por frame.
    const tmpV = new THREE.Vector3();
    function ajustaNiebla() {
      const d = camera.position.distanceTo(controls.target);
      const far = d + radioMundo * NIEBLA_BORDE;
      scene.fog.far = far;
      scene.fog.near = far * NIEBLA_ENTRADA;
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
    const matParedes = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      map: texVent,
    });

    // --- estado del mundo ---
    const tiles = new Map(); // "x/y" → entrada
    const scans = new Map(); // celda → color de fachada '#rrggbb' o null
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
            ctx.lineWidth = 4;
            ctx.strokeRect(i * cs + 2, j * cs + 2, cs - 4, cs - 4);
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
    function coloresDe(b) {
      if (!scans.has(b.cell)) return { pared: GRIS_PARED, tejado: GRIS_TEJADO };
      const cam = scans.get(b.cell);
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
      const { pared, tejado } = coloresDe(b);
      for (const anillos of b.polys) {
        const outer = anillos[0];
        const holes = anillos.slice(1);
        // tejado
        const contour = outer.map((p) => new THREE.Vector2(p.e, p.n));
        const holesV = holes.map((hr) => hr.map((p) => new THREE.Vector2(p.e, p.n)));
        let faces = [];
        try {
          faces = THREE.ShapeUtils.triangulateShape(contour, holesV);
        } catch {
          /* polígono degenerado */
        }
        const all = outer.concat(...holes);
        for (const f of faces) {
          for (const idx of f) {
            const p = all[idx];
            g.posT.push(p.e, b.h, -p.n);
            g.colT.push(tejado.r, tejado.g, tejado.b);
          }
        }
        // paredes (exterior + agujeros), sombreado por orientación horneado y
        // pie de fachada más oscuro (oclusión falsa: asienta el edificio)
        const v0 = b.minH / PLANTA_M;
        const v1 = b.h / PLANTA_M;
        for (const ring of anillos) {
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const c = ring[(i + 1) % ring.length];
            const dx = c.e - a.e;
            const dy = c.n - a.n;
            const len = Math.hypot(dx, dy);
            if (len < 0.05) continue;
            const nx = dy / len;
            const ny = -dx / len;
            const sombra = 0.72 + 0.28 * Math.abs(nx * 0.6 + ny * 0.8);
            const r = pared.r * sombra;
            const g2 = pared.g * sombra;
            const bl = pared.b * sombra;
            const pie = 0.86;
            const u1 = len / PLANTA_M;
            g.posP.push(a.e, b.minH, -a.n, c.e, b.minH, -c.n, c.e, b.h, -c.n);
            g.posP.push(a.e, b.minH, -a.n, c.e, b.h, -c.n, a.e, b.h, -a.n);
            g.uvP.push(0, v0, u1, v0, u1, v1, 0, v0, u1, v1, 0, v1);
            // triángulo 1: pie, pie, alto · triángulo 2: pie, alto, alto
            g.colP.push(r * pie, g2 * pie, bl * pie, r * pie, g2 * pie, bl * pie, r, g2, bl);
            g.colP.push(r * pie, g2 * pie, bl * pie, r, g2, bl, r, g2, bl);
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
      let n = 0;
      for (const b of entry.bldgs) {
        meteEdificio(g, b);
        if (++n % 500 === 0) {
          await tick();
          if (!vivo || token !== entry.token) return;
        }
      }
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
        // el ancla tiene que caber ENTERA: medio rótulo cortado por el borde
        // parece un fallo, no un mapa
        if (sx < 40 || sx > vpW - 40 || sy < 14 || sy > vpH - 14) continue;

        let ang = 0;
        if (esCalle) {
          // el ángulo se mide en PANTALLA (perspectiva y giro de cámara ya
          // aplicados), no en el mundo, o el texto no seguiría a la calle
          pa.set(r.a.e, 0, -r.a.n).project(camera);
          pb.set(r.b.e, 0, -r.b.n).project(camera);
          ang = Math.atan2(-(pb.y - pa.y) * vpH, (pb.x - pa.x) * vpW);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; // jamás del revés
        }

        const fuente = esCalle ? 11 : TAM_SITIO[r.cls] || 12;
        // caja aproximada del texto, girada: sin esto los nombres se pisan
        const bw = r.name.length * fuente * 0.56 + 12;
        const bh = fuente * 1.6;
        const co = Math.abs(Math.cos(ang));
        const si = Math.abs(Math.sin(ang));
        const aw = bw * co + bh * si;
        const ah = bw * si + bh * co;
        let choca = false;
        for (const q of puestas) {
          if (Math.abs(sx - q.sx) < (aw + q.aw) / 2 && Math.abs(sy - q.sy) < (ah + q.ah) / 2) {
            choca = true;
            break;
          }
        }
        if (choca) continue;
        puestas.push({ sx, sy, aw, ah, ang, op, fuente, r });
      }

      // los <div> se reciclan: crear y destruir nodos cada frame sería un
      // machaque del GC con el mapa en movimiento
      for (let i = 0; i < puestas.length; i++) {
        const q = puestas[i];
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
      for (let i = puestas.length; i < nodos.length; i++) {
        if (nodos[i]._on !== false) {
          nodos[i].style.display = 'none';
          nodos[i]._on = false;
        }
      }
    }

    // --- ciclo de teselas ---
    async function cargaTesela(x, y) {
      const key = x + '/' + y;
      const entry = { x, y, token: 0, group: new THREE.Group() };
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
        await construyeEdificios(entry);
      } catch (e) {
        entry.error = Date.now();
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
          const prev = tiles.get(key);
          if (prev?.error && Date.now() - prev.error > 30000) liberaTesela(key);
          if (!tiles.has(key)) cargaTesela(x, y);
        }
      }
      for (const key of [...tiles.keys()]) {
        const [x, y] = key.split('/').map(Number);
        if (Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) > 2) liberaTesela(key);
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
      });
    }

    function reconstruyeCelda(cx, cy) {
      const key = Math.floor(cx / CELLS_POR_TESELA) + '/' + Math.floor(cy / CELLS_POR_TESELA);
      const entry = tiles.get(key);
      if (!entry?.data) return;
      reconstruyeSuelo(entry);
      construyeEdificios(entry);
    }

    // --- escaneos compartidos ---
    async function traeScans() {
      try {
        const r = await fetch('/api/scans');
        const j = await r.json();
        const nuevas = [];
        for (const it of j.cells || []) {
          // compat: la respuesta vieja era un array de strings
          const c = typeof it === 'string' ? it : it.k;
          const col = typeof it === 'string' ? null : it.c || null;
          if (!scans.has(c) || (col && scans.get(c) !== col)) {
            scans.set(c, col);
            nuevas.push(c);
          }
        }
        if (nuevas.length) {
          for (const c of nuevas) {
            const [, cx, cy] = c.split('/');
            reconstruyeCelda(Number(cx), Number(cy));
          }
          actualizaEstado();
        }
      } catch {
        /* sin red: se reintenta en el siguiente sondeo */
      }
    }

    engineRef.current = {
      centroEscaneado() {
        const { cx, cy } = celdaDelTarget();
        return scans.has(cellKey(cx, cy));
      },
      scanHere(color) {
        const { cx, cy } = celdaDelTarget();
        const key = cellKey(cx, cy);
        if (scans.has(key)) return { already: true };
        scans.set(key, color || null);
        reconstruyeCelda(cx, cy);
        actualizaEstado();
        fetch('/api/scans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(color ? { cell: key, color } : { cell: key }),
        }).catch(() => {});
        return { already: false };
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
    function bucle(t) {
      raf = requestAnimationFrame(bucle);
      controls.update();
      const niebla = ajustaNiebla();
      if (t - ultimoCheck > 700) {
        ultimoCheck = t;
        asegura(false);
      }
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
      for (const el of nodos) el.remove();
      nodos.length = 0;
      controls.dispose();
      horizonte.geometry.dispose();
      horizonte.material.dispose();
      matEdificios.dispose();
      matParedes.dispose();
      texVent.dispose();
      renderer.dispose();
      engineRef.current = null;
    };
  }, []);

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
        window.location.href = '/?lat=' + j[0].lat + '&lng=' + j[0].lon;
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
      (p) => {
        window.location.href =
          '/?lat=' + p.coords.latitude.toFixed(5) + '&lng=' + p.coords.longitude.toFixed(5);
      },
      () => avisa('No se pudo obtener tu ubicación'),
      { timeout: 8000 }
    );
  }

  useEffect(() => {
    // el <video> solo existe con el visor abierto: se le engancha el stream aquí
    if (cam && camVideoRef.current && camStreamRef.current) {
      camVideoRef.current.srcObject = camStreamRef.current;
    }
  }, [cam]);

  useEffect(() => () => camStreamRef.current?.getTracks().forEach((t) => t.stop()), []);

  function cierraCamara() {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null; // el bucle de captura lo lee para abortar
    setCam(null);
    setProg(0);
  }

  async function onScan() {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.centroEscaneado()) {
      avisa('El centro de la vista ya está escaneado — muévete a una zona gris');
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
          </p>
          <p>
            <b>La cámara pinta el mapa.</b> Al escanear, la cámara captura el color
            dominante de las fachadas y esa zona se colorea con su color REAL para
            todo el mundo. Más adelante: formas y detalles.
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
        <div className="meta">{status.global} celdas escaneadas en el mundo</div>
      </div>

      <button className="ui escanear" onClick={onScan}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8a2 2 0 0 1 2-2h1.5l1.4-2h8.2l1.4 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <circle cx="12" cy="13" r="3.6" />
        </svg>
        Escanear esta zona
      </button>

      {cargando > 0 && (
        <div className="ui carga glass">
          <span className="punto" /> cargando el mapa…
        </div>
      )}

      {cam && (
        <div className="ui camara">
          <video ref={camVideoRef} autoPlay playsInline muted />
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
                <p>Recorre despacio las fachadas…</p>
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
