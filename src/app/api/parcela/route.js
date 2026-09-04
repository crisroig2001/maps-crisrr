import { NextResponse } from 'next/server';
import { reclama, setPiezas, abandona, gusta } from '../../../lib/mundo';
import { RE_PARCELA } from '../../../lib/parcela';
import { RE_JUGADOR } from '../../../lib/piezas';
import { creaLimite, ipDe } from '../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

// El cliente guarda con retardo (un POST por ráfaga de toques, no por toque):
// 60/min por IP da de sobra para construir y frena a un script.
const limited = creaLimite(60);

// POST {accion: 'reclama' | 'piezas' | 'abandona' | 'gusta', parcela, jugador, piezas?, nombre?}
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
  const parcela = body?.parcela;
  if (typeof parcela !== 'string' || !RE_PARCELA.test(parcela)) {
    return NextResponse.json({ error: 'bad_parcela' }, { status: 400 });
  }
  const jugador = body?.jugador;
  if (typeof jugador !== 'string' || !RE_JUGADOR.test(jugador)) {
    return NextResponse.json({ error: 'bad_jugador' }, { status: 400 });
  }
  let motivo;
  if (body.accion === 'reclama') motivo = reclama(parcela, jugador, body.nombre);
  else if (body.accion === 'piezas') motivo = setPiezas(parcela, jugador, body.piezas);
  else if (body.accion === 'abandona') motivo = abandona(parcela, jugador);
  else if (body.accion === 'gusta') motivo = gusta(parcela, jugador);
  else return NextResponse.json({ error: 'bad_accion' }, { status: 400 });

  if (motivo === 'bad_piezas') return NextResponse.json({ error: motivo }, { status: 400 });
  // 409: la parcela no está disponible PARA ESTE jugador
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  return NextResponse.json({ ok: true });
}
