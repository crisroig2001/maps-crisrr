import { NextResponse } from 'next/server';
import { getParcelas, ultimoCambio, totalParcelas, estadoJugador } from '../../../lib/mundo';
import { RE_JUGADOR } from '../../../lib/piezas';

export const dynamic = 'force-dynamic';

// Number(null) es 0: sin este guard un parámetro ausente se convertía en un 0
// válido y «sin caja» pasaba a ser la caja 0,0,0,0.
const num = (v) => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// GET /api/mundo?px0&py0&px1&py1[&desde][&jugador]
// Las parcelas de la caja de índices que el cliente tiene a la vista; con
// `desde`, solo las cambiadas después de ese instante (el sondeo periódico es
// un delta). Con `jugador`, además dónde dejó su avatar y cuál es su parcela.
export async function GET(req) {
  const q = req.nextUrl.searchParams;
  const px0 = num(q.get('px0'));
  const py0 = num(q.get('py0'));
  const px1 = num(q.get('px1'));
  const py1 = num(q.get('py1'));
  const caja =
    px0 !== null && py0 !== null && px1 !== null && py1 !== null
      ? { px0: Math.min(px0, px1), py0: Math.min(py0, py1), px1: Math.max(px0, px1), py1: Math.max(py0, py1) }
      : null;
  // un cliente sin caja se llevaría el mundo entero
  if (!caja) return NextResponse.json({ error: 'sin_caja' }, { status: 400 });
  if (caja.px1 - caja.px0 > 40 || caja.py1 - caja.py0 > 40) {
    return NextResponse.json({ error: 'caja_grande' }, { status: 400 });
  }
  const desde = num(q.get('desde'));
  const jugador = q.get('jugador');

  const hasta = ultimoCambio();
  const etag = `W/"${hasta}-${totalParcelas()}-${desde || 0}-${caja.px0},${caja.py0},${caja.px1},${caja.py1}-${jugador || ''}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  const out = { parcelas: getParcelas(caja, desde), hasta };
  if (typeof jugador === 'string' && RE_JUGADOR.test(jugador)) out.yo = estadoJugador(jugador);
  return NextResponse.json(out, { headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
}
