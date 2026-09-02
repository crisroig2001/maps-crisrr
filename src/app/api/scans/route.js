import { NextResponse } from 'next/server';
import { getCells, addCell, ultimoCambio, totalCeldas } from '../../../lib/store';
import { CELL_RE } from '../../../lib/geo';
import { RE_COLOR } from '../../../lib/colorCam';
import { RE_JUGADOR } from '../../../lib/adornos';
import { creaLimite, ipDe } from '../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

// 30 escaneos/min por IP
const limited = creaLimite(30);

// OJO: Number(null) es 0, así que sin este guard un parámetro ausente se
// convertía en un 0 válido y "sin caja" pasaba a ser la caja 0,0,0,0 — que no
// contiene nada. La primera petición del cliente va sin caja (aún no hay
// teselas cargadas), así que el mapa arrancaba sin ningún escaneo.
const num = (v) => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req) {
  const q = req.nextUrl.searchParams;

  // Caja de celdas z18 que le interesan al cliente (lo que tiene cargado).
  // Sin ella se devolvía el planeta entero a todo el mundo cada 25 s.
  const cx0 = num(q.get('cx0'));
  const cy0 = num(q.get('cy0'));
  const cx1 = num(q.get('cx1'));
  const cy1 = num(q.get('cy1'));
  const caja =
    cx0 !== null && cy0 !== null && cx1 !== null && cy1 !== null
      ? { cx0: Math.min(cx0, cx1), cy0: Math.min(cy0, cy1), cx1: Math.max(cx0, cx1), cy1: Math.max(cy0, cy1) }
      : null;

  // Solo lo cambiado desde este instante. El cliente manda el `hasta` de la
  // respuesta anterior, así el sondeo periódico pasa a ser un delta.
  const desde = num(q.get('desde'));

  const hasta = ultimoCambio();
  // El ETag va con la caja y el corte: dos peticiones distintas no pueden
  // compartir respuesta.
  const etag = `W/"${hasta}-${totalCeldas()}-${desde || 0}-${caja ? `${caja.cx0},${caja.cy0},${caja.cx1},${caja.cy1}` : 'todo'}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const cells = getCells(caja, desde);
  return NextResponse.json(
    { cells, hasta },
    { headers: { ETag: etag, 'Cache-Control': 'no-cache' } }
  );
}

export async function POST(req) {
  if (limited(ipDe(req))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  let body = null;
  try {
    body = await req.json();
  } catch {
    /* cuerpo inválido */
  }
  const cell = body?.cell;
  if (typeof cell !== 'string' || !CELL_RE.test(cell)) {
    return NextResponse.json({ error: 'bad_cell' }, { status: 400 });
  }
  // color de fachada opcional, capturado con la cámara (validado: el cuerpo
  // viene del navegador)
  const color =
    typeof body?.color === 'string' && RE_COLOR.test(body.color.toLowerCase())
      ? body.color.toLowerCase()
      : null;
  // quien escanea se queda la manzana para decorarla (id anónimo, opcional)
  const jugador = typeof body?.jugador === 'string' && RE_JUGADOR.test(body.jugador) ? body.jugador : null;
  const added = addCell(cell, color, jugador);
  return NextResponse.json({ ok: true, added });
}
