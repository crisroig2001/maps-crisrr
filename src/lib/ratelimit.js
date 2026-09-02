// Rate limit sencillo en memoria (una instancia): `max` peticiones por minuto
// y por IP. Se limpia al vuelo: sin esto el Map crecía sin techo, una entrada
// por IP, mientras viviera el proceso.
export function creaLimite(max) {
  const hits = new Map();
  let ultimaLimpieza = 0;
  return function limited(ip) {
    const now = Date.now();
    if (now - ultimaLimpieza > 60_000) {
      ultimaLimpieza = now;
      for (const [k, v] of hits) if (now - v.t > 60_000) hits.delete(k);
    }
    const h = hits.get(ip);
    if (!h || now - h.t > 60_000) {
      hits.set(ip, { t: now, n: 1 });
      return false;
    }
    h.n += 1;
    return h.n > max;
  };
}

export function ipDe(req) {
  return (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
}
