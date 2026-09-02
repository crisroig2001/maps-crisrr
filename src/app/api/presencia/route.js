import { NextResponse } from 'next/server';
import { presencia } from '../../../lib/mundo';
import { RE_JUGADOR } from '../../../lib/piezas';
import { creaLimite, ipDe } from '../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

// El cliente manda su posición cada ~1,5 s → 40/min. El tope deja margen y
// frena a un script.
const limited = creaLimite(90);

// POST {jugador, nombre, color, x, y, r} → {cerca: [{id, n, c, x, y, r}], conectados}
// Presencia por SONDEO: sencilla, sin infraestructura nueva (el servidor es
// Next.js standalone) y suficiente para ver a los vecinos moverse con un
// pelín de retraso. WebSockets es el paso siguiente si el mundo se llena.
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
  const jugador = body?.jugador;
  if (typeof jugador !== 'string' || !RE_JUGADOR.test(jugador)) {
    return NextResponse.json({ error: 'bad_jugador' }, { status: 400 });
  }
  const r = presencia(jugador, body);
  if (!r) return NextResponse.json({ error: 'bad_pos' }, { status: 400 });
  return NextResponse.json(r);
}
