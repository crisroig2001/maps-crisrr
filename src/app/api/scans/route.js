import { NextResponse } from 'next/server';
import { getCells, addCell } from '../../../lib/store';
import { CELL_RE } from '../../../lib/geo';

export const dynamic = 'force-dynamic';

// rate limit sencillo en memoria (una instancia): 30 escaneos/min por IP
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    hits.set(ip, { t: now, n: 1 });
    return false;
  }
  h.n += 1;
  return h.n > 30;
}

export async function GET() {
  return NextResponse.json({ cells: getCells() });
}

export async function POST(req) {
  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  if (limited(ip)) {
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
  const added = addCell(cell);
  return NextResponse.json({ ok: true, added });
}
