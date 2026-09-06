// Lo que se manda en el chat además de texto: una FOTO o un AUDIO.
//
// Viajan como lo que se dice —montados en el sondeo de presencia, sin ruta ni
// infraestructura nuevas— y con la misma regla: viven en la MEMORIA del
// servidor un rato y se van. Ni disco, ni registro. Una foto que ya no está
// en ningún chat no ha dejado rastro en ningún sitio.
//
// Van como data URL (base64), que es lo que un JSON puede llevar sin más. Es
// un 33 % más gordo que el binario, pero a cambio no hay subida aparte, ni
// almacén de ficheros, ni URL que sobreviva a la conversación. Con el tope de
// abajo, una foto de 720 px a calidad 0,72 y un audio de 30 s a 24 kbps caben
// de sobra.
//
// Cómo llega a los demás: el mensaje lleva solo la FICHA del adjunto (id,
// tipo, segundos), y quien lo quiere lo PIDE por id en su siguiente sondeo
// (`trae: [id]`). Si viajara el adjunto entero dentro de cada sondeo, un
// vecino con la burbuja viva lo recibiría seis veces (la burbuja dura 9 s y
// el sondeo va cada 1,5), y en un corro de ocho, cada foto serían cuarenta y
// ocho descargas. Pedido por id, es una por persona.
//
// Estas constantes las comparten cliente y servidor, así que aquí no hay
// dependencias.

// Tope del data URL, en caracteres (≈ bytes). Una foto de 720 px de lado a
// calidad 0,72 sale entre 60 y 130 KB; un audio de 30 s en Opus a 24 kbps,
// unos 90 KB. Lo que pase de aquí el cliente lo recomprime, y si aun así no
// cabe, no se manda.
export const ADJUNTO_MAX = 220_000;

// Lo que un adjunto vive en la memoria del servidor desde que se dijo. Un
// hilo de corro guarda 14 líneas y una burbuja dura 9 s: diez minutos es
// tiempo de sobra para que lo lea quien esté, y poco para que se acumule.
export const ADJUNTO_MS = 10 * 60_000;

// Tope global de memoria para adjuntos (bytes). Al llegar, se caen los más
// viejos: un servidor con una instancia no puede dejar que una tarde de fotos
// se lo coma.
export const ADJUNTOS_MAX_BYTES = 48 * 1024 * 1024;

// Lo que puede durar un audio. Un mensaje de voz, no un pódcast.
export const AUDIO_MAX_S = 30;

// Lado mayor al que el cliente reduce una foto antes de mandarla. En el chat
// se ve a 220 px de ancho y ampliada a la pantalla del móvil: 720 sobra.
export const FOTO_LADO = 720;

// Entre dos adjuntos del mismo jugador tiene que pasar esto: es lo que frena
// a un script que suelte fotos en bucle sin molestar a nadie de verdad.
export const ADJUNTO_CADA_MS = 1500;

// Los tipos que se aceptan, y nada más. JPEG y WebP son lo que sale de un
// canvas; WebM/Opus lo que graba Chrome y Firefox, MP4/AAC lo que graba
// Safari, y OGG por si acaso.
const RE_FOTO = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const RE_AUDIO = /^data:audio\/(webm|mp4|ogg|mpeg|aac|x-m4a)(;codecs=[a-z0-9.,-]+)?;base64,[A-Za-z0-9+/]+=*$/;

// La ficha que viaja con el mensaje: sin el dato. Lo que ve quien recibe el
// mensaje antes de pedir el adjunto.
export function fichaAdjunto(a) {
  return a ? { id: a.id, k: a.k, s: a.s } : undefined;
}

// Lo que pone la burbuja (y el hilo) cuando el mensaje es un adjunto sin
// texto: hay que decir algo sobre la cabeza, y «📷 Foto» dice lo que es.
export function etiquetaAdjunto(a) {
  if (!a) return null;
  if (a.k === 'foto') return '📷 Foto';
  return '🎤 Audio ' + duracion(a.s);
}

export function duracion(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

// Un adjunto que viene del navegador: del tipo que toca, del tamaño que toca
// y con la duración acotada. Devuelve {k, d, s} o null.
export function limpiaAdjunto(a) {
  if (!a || typeof a !== 'object') return null;
  const d = a.d;
  if (typeof d !== 'string' || d.length > ADJUNTO_MAX || d.length < 64) return null;
  if (a.k === 'foto') {
    if (!RE_FOTO.test(d)) return null;
    return { k: 'foto', d, s: 0 };
  }
  if (a.k === 'audio') {
    if (!RE_AUDIO.test(d)) return null;
    const s = Number(a.s);
    if (!Number.isFinite(s) || s <= 0 || s > AUDIO_MAX_S + 1) return null;
    return { k: 'audio', d, s: Math.round(s * 10) / 10 };
  }
  return null;
}

export const RE_ADJUNTO_ID = /^[a-z0-9]{10,20}$/;
