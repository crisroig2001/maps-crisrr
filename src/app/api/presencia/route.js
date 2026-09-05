import { NextResponse } from 'next/server';
import { presencia } from '../../../lib/mundo';
import { RE_JUGADOR } from '../../../lib/piezas';
import { creaLimite, ipDe } from '../../../lib/ratelimit';

export const dynamic = 'force-dynamic';

// El cliente manda su posición cada ~1,5 s → 40/min, y por el mismo POST van
// lo que dice, los gestos y el corro (invitar, aceptar, llamar…), cada uno
// con su sondeo adelantado: una conversación movida sube de 40 a 60 largos.
// El tope es por IP, así que dos personas de la misma casa comparten cupo: a
// 90 se quedaban sin sitio entre las dos. 150 sigue frenando a un script y
// deja pasar a una familia.
const limited = creaLimite(150);

// POST {jugador, nombre, color, x, y, r, m: lo que dice, e: gesto,
//       reporta: a quién, corro: {a: acción, q: a quién o a qué corro}}
//   → {cerca: [{id, n, c, x, y, r, m, k: su corro, h: habla aparte}], conectados,
//      corro: el tuyo, invita: quién quiere hablar contigo,
//      llaman: quién llama a tu puerta, corros: los que se ven, corroR: qué tal}
// Todo lo social viaja por aquí y no por rutas propias: la presencia vive en
// memoria y en Next cada ruta puede acabar con SU copia del módulo, así que
// solo es de fiar en la ruta que la escribe (ver el reporte en lib/mundo.js).
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
