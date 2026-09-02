import { NextResponse } from 'next/server';
import { setAdornos } from '../../../lib/store';
import { CELL_RE } from '../../../lib/geo';
import { RE_JUGADOR } from '../../../lib/adornos';
import { creaLimite, ipDe } from '../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

// El cliente guarda con retardo (un POST por ráfaga de toques, no por toque),
// así que 60/min por IP da de sobra para decorar y frena a un script.
const limited = creaLimite(60);

// POST {cell, jugador, adornos: [{t, x, y}, …]} → sustituye los adornos de la
// celda. La lectura va con las celdas en GET /api/scans (campo `d`): un solo
// sondeo trae colores y adornos, y el delta por `desde` sirve para los dos.
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
  const jugador = body?.jugador;
  if (typeof jugador !== 'string' || !RE_JUGADOR.test(jugador)) {
    return NextResponse.json({ error: 'bad_jugador' }, { status: 400 });
  }
  const motivo = setAdornos(cell, jugador, body?.adornos);
  if (motivo === 'bad_adornos') return NextResponse.json({ error: motivo }, { status: 400 });
  // 409: la celda no es decorable POR ESTE jugador (sin escanear, o de otro)
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  return NextResponse.json({ ok: true });
}
