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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe8f4);
    scene.fog = new THREE.Fog(0xcfe8f4, 3600, 13000);

    const camera = new THREE.PerspectiveCamera(50, 1, 2, 20000);
    camera.position.set(280, 430, 360);

    const controls = new MapControls(camera, canvas);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = false;
    controls.minDistance = 120;
    controls.maxDistance = 4800;
    controls.maxPolarAngle = 1.34;

    const matEdificios = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

    // --- estado del mundo ---
    const tiles = new Map(); // "x/y" → entrada
    const scans = new Map(); // celda → color de fachada '#rrggbb' o null
    let vivo = true;
    let enCarga = 0;

    function carga(delta) {
      enCarga += delta;
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
          bldgs.push({ polys: [anillos], minH: b.minH || 0, h, hash, cell: cellKey(cx, cy) });
        }
      }
      // celdas con edificio (para el % de la vista)
      const celdas = new Set(bldgs.map((b) => b.cell));
      return { bldgs, celdas };
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

      ctx.fillStyle = '#d8dcd2';
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
            // con color de cámara, el velo del suelo lleva ese mismo tono
            ctx.fillStyle = cc
              ? 'rgba(' + parseInt(cc.slice(1, 3), 16) + ',' + parseInt(cc.slice(3, 5), 16) + ',' + parseInt(cc.slice(5, 7), 16) + ',0.12)'
              : 'rgba(243, 195, 110, 0.10)';
          } else {
            ctx.fillStyle = 'rgba(108, 115, 124, 0.24)';
          }
          ctx.fillRect(i * cs, j * cs, cs, cs);
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
      if (b.hash % 1000 < 180) {
        const i = b.hash % ACENTOS.length;
        return { pared: ACENTOS[i], tejado: TEJADOS_AC[i] };
      }
      const i = b.hash % PALETA.length;
      return { pared: PALETA[i], tejado: TEJADOS[i] };
    }

    function meteEdificio(pos, col, b) {
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
            pos.push(p.e, b.h, -p.n);
            col.push(tejado.r, tejado.g, tejado.b);
          }
        }
        // paredes (exterior + agujeros), sombreado por orientación horneado
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
            const g = pared.g * sombra;
            const bl = pared.b * sombra;
            pos.push(a.e, b.minH, -a.n, c.e, b.minH, -c.n, c.e, b.h, -c.n);
            pos.push(a.e, b.minH, -a.n, c.e, b.h, -c.n, a.e, b.h, -a.n);
            for (let q = 0; q < 6; q++) col.push(r, g, bl);
          }
        }
      }
    }

    async function construyeEdificios(entry) {
      const token = ++entry.token;
      const pos = [];
      const col = [];
      let n = 0;
      for (const b of entry.bldgs) {
        meteEdificio(pos, col, b);
        if (++n % 500 === 0) {
          await tick();
          if (!vivo || token !== entry.token) return;
        }
      }
      if (!vivo || token !== entry.token) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (entry.mesh) {
        entry.group.remove(entry.mesh);
        entry.mesh.geometry.dispose();
      }
      entry.mesh = new THREE.Mesh(geo, matEdificios);
      entry.group.add(entry.mesh);
    }

    function reconstruyeSuelo(entry) {
      const tex = pintaSuelo(entry.x, entry.y, entry.data);
      entry.suelo.material.map.dispose();
      entry.suelo.material.map = tex;
      entry.suelo.material.needsUpdate = true;
    }

    // --- ciclo de teselas ---
    async function cargaTesela(x, y) {
      const key = x + '/' + y;
      const entry = { x, y, token: 0, group: new THREE.Group() };
      tiles.set(key, entry);
      carga(1);
      try {
        const data = await loadTileData(Z_TILE, x, y);
        if (!vivo || !tiles.has(key)) return;
        entry.data = data;
        const prep = prepara(x, y, data);
        entry.bldgs = prep.bldgs;
        entry.celdas = prep.celdas;

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
      scene.remove(entry.group);
      if (entry.mesh) entry.mesh.geometry.dispose();
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
    function medir() {
      const w = window.innerWidth;
      const h = window.innerHeight;
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
      if (t - ultimoCheck > 700) {
        ultimoCheck = t;
        asegura(false);
      }
      renderer.render(scene, camera);
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
      controls.dispose();
      matEdificios.dispose();
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
    else if (color) avisa('¡Zona escaneada con el color real de la fachada! 🎨');
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
