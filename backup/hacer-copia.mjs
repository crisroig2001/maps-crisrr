#!/usr/bin/env node
// ============================================================================
// hacer-copia.mjs — copia de seguridad de lo que este proyecto tiene en el VPS
// ============================================================================
// Lee backup/config.json (qué apps y servicios de Coolify son de este repo) y deja
// en backup/:
//
//   copia.tar.gz.gpg   CIFRADO (gpg AES256). Dentro, copia/:
//     coolify/app-<nombre>.json, -envs.json, .env, -storages.json   cada app
//     coolify/svc-<nombre>.json, -envs.json, .env, -compose.yaml     cada servicio
//     supabase-<nombre>/db.sql, schema.sql, manifest.json            cada Supabase
//     storage-<nombre>/<bucket>/…  + objetos.json                    sus ficheros
//     infra/…            (solo si config.infra) GitHub App de Coolify, claves de git,
//                        inventario de Coolify y los registros DNS de Cloudflare
//   manifiesto.json    EN CLARO y sin secretos: qué hay dentro, filas por tabla,
//                      nombres de variables (no valores), sha256 del cifrado.
//
// Uso (desde la raíz del repo):
//   BACKUP_VPS_PASSPHRASE=… node backup/hacer-copia.mjs
// Necesita COOLIFY_BASE_URL + COOLIFY_TOKEN (con read:sensitive) y, con infra,
// CLOUDFLARE_API_TOKEN. Solo Node 22, gpg y tar: nada que instalar.
//
// ⚠️ Lo descifrado lleva contraseñas, claves y datos de usuarios. El directorio en
// claro se crea fuera del repo y se borra al acabar. Nunca commitearlo.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(AQUI, 'config.json'), 'utf8'));
const FRASE = process.env.BACKUP_VPS_PASSPHRASE;
for (const k of ['COOLIFY_BASE_URL', 'COOLIFY_TOKEN']) if (!process.env[k]) fallo(`Falta ${k}`);
if (!FRASE || FRASE.length < 20) fallo('Falta BACKUP_VPS_PASSPHRASE (≥ 20 caracteres). Está en el gestor de contraseñas del usuario.');
if (CFG.infra && !process.env.CLOUDFLARE_API_TOKEN) fallo('Falta CLOUDFLARE_API_TOKEN (config.infra pide los DNS)');

function fallo(m) { console.error(`✗ ${m}`); process.exit(2); }
const log = (m) => console.log(m);

async function coolify(path) {
  const r = await fetch(`${process.env.COOLIFY_BASE_URL}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Coolify ${path} -> HTTP ${r.status}`);
  return r.json();
}
const json = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n');
const toEnv = (envs) => envs.filter((e) => !e.is_preview)
  .map((e) => `${e.key}=${JSON.stringify(e.value ?? '')}`).join('\n') + '\n';
// Sin read:sensitive Coolify devuelve los valores a null. Una variable vacía de
// verdad también llega a null (p. ej. las MAILER_TEMPLATES_* sin plantilla), así que
// solo se para si faltan TODAS, o todas las que guardan secretos (sin permiso se
// esconden todas a la vez; vacías de verdad, como OPENAI_API_KEY, solo algunas).
function sinValor(envs, quien) {
  const m = envs.filter((e) => e.value == null).map((e) => e.key);
  const sec = envs.filter((e) => /PASSWORD|SECRET|_KEY$|TOKEN/i.test(e.key));
  const clave = sec.length && sec.every((e) => e.value == null) ? sec.map((e) => e.key) : [];
  if ((envs.length && m.length === envs.length) || clave.length) {
    throw new Error(`Coolify no dio el valor de ${m.length} variables de ${quien} (¿token sin read:sensitive?): ${(clave.length ? clave : m).slice(0, 5).join(', ')}`);
  }
  if (m.length) log(`  (${quien}: ${m.length} variables vacías: ${m.join(', ')})`);
}

// URL pública y service key de un Supabase de Coolify (igual que scripts/sbx).
function supabaseDe(envs) {
  const val = (re) => envs.find((e) => re.test(e.key) && e.value)?.value;
  let url = envs.filter((e) => /SERVICE_URL_.*KONG$|SUPABASE_PUBLIC_URL|SUPABASE_URL/i.test(e.key))
    .map((e) => e.value).find((v) => /^https/.test(v || ''));
  if (!url) { const f = val(/^SERVICE_FQDN_.*KONG|^SERVICE_FQDN/i); if (f) url = `https://${f.split(':')[0]}`; }
  const key = ['SERVICE_SUPABASESERVICE_KEY', 'SERVICE_SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_KEY', 'SERVICE_SERVICEROLE_KEY']
    .map((k) => envs.find((e) => e.key === k)?.value).find(Boolean);
  if (!url || !key) throw new Error('No pude sacar la URL o la service key del Supabase');
  return { url: url.replace(/\/$/, ''), key };
}

// Todos los ficheros de todos los buckets de Storage, por la API (vale con
// cualquier backend: disco o MinIO).
async function copiarStorage({ url, key }, dir) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const r = await fetch(`${url}/storage/v1/bucket`, { headers: h });
  if (!r.ok) throw new Error(`storage/bucket -> HTTP ${r.status}`);
  const buckets = await r.json();
  const res = {};
  for (const b of buckets) {
    const objetos = [];
    const recorre = async (prefijo) => {
      for (let offset = 0; ; offset += 1000) {
        const lr = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(b.id)}`, {
          method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: prefijo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        if (!lr.ok) throw new Error(`storage/list ${b.id}/${prefijo} -> HTTP ${lr.status}`);
        const page = await lr.json();
        for (const o of page) {
          const ruta = prefijo ? `${prefijo}/${o.name}` : o.name;
          if (o.id == null) await recorre(ruta);          // carpeta
          else objetos.push({ ruta, mimetype: o.metadata?.mimetype || null, bytes: o.metadata?.size ?? null, actualizado: o.updated_at });
        }
        if (page.length < 1000) break;
      }
    };
    await recorre('');
    let bytes = 0;
    for (const o of objetos) {
      const dr = await fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(b.id)}/${o.ruta.split('/').map(encodeURIComponent).join('/')}`, { headers: h });
      if (!dr.ok) throw new Error(`storage/download ${b.id}/${o.ruta} -> HTTP ${dr.status}`);
      const buf = Buffer.from(await dr.arrayBuffer());
      const f = join(dir, b.id, o.ruta);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, buf);
      o.sha256 = createHash('sha256').update(buf).digest('hex');
      bytes += buf.length;
    }
    mkdirSync(join(dir, b.id), { recursive: true });
    json(join(dir, `${b.id}.objetos.json`), { bucket: b, objetos });
    res[b.id] = { publico: !!b.public, ficheros: objetos.length, bytes };
  }
  return res;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'copia-'));
  const C = join(tmp, 'copia');
  mkdirSync(join(C, 'coolify'), { recursive: true });
  const man = {
    proyecto: CFG.proyecto,
    fecha: new Date().toISOString(),
    commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: AQUI, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    coolify_version: (await (await fetch(`${process.env.COOLIFY_BASE_URL}/api/v1/version`, { headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN}` } })).text()).trim(),
    apps: [], servicios: [], supabase: {}, storage: {}, infra: null,
    no_incluido: CFG.no_incluido || [],
  };

  try {
    // ── Apps ──
    for (const uuid of CFG.apps || []) {
      const app = await coolify(`/applications/${uuid}`);
      const envs = await coolify(`/applications/${uuid}/envs`);
      sinValor(envs, app.name);
      const st = await coolify(`/applications/${uuid}/storages`).catch(() => null);
      const p = join(C, 'coolify', `app-${app.name}`);
      json(`${p}.json`, app); json(`${p}-envs.json`, envs); writeFileSync(`${p}.env`, toEnv(envs));
      if (st) json(`${p}-storages.json`, st);
      man.apps.push({
        nombre: app.name, uuid, repo: app.git_repository, rama: app.git_branch, build_pack: app.build_pack,
        dominios: app.fqdn, puertos: app.ports_exposes, base_directory: app.base_directory,
        dockerfile: app.dockerfile_location, publish_directory: app.publish_directory,
        variables: envs.filter((e) => !e.is_preview).map((e) => e.key + (e.is_buildtime ? ' (build)' : '')),
        volumenes: (st?.persistent_storages || []).map((v) => `${v.name} → ${v.mount_path}`),
      });
      log(`· app ${app.name}: ${envs.length} variables`);
    }

    // ── Servicios (y los Supabase con su base y su Storage) ──
    for (const s of CFG.servicios || []) {
      const svc = await coolify(`/services/${s.uuid}`);
      const envs = await coolify(`/services/${s.uuid}/envs`);
      sinValor(envs, svc.name);
      const st = await coolify(`/services/${s.uuid}/storages`).catch(() => null);
      const p = join(C, 'coolify', `svc-${svc.name}`);
      json(`${p}.json`, svc); json(`${p}-envs.json`, envs); writeFileSync(`${p}.env`, toEnv(envs));
      if (svc.docker_compose_raw) writeFileSync(`${p}-compose.yaml`, svc.docker_compose_raw);
      if (st) json(`${p}-storages.json`, st);
      man.servicios.push({
        nombre: svc.name, uuid: s.uuid, tipo: svc.service_type || null,
        contenedores: (svc.applications || []).map((a) => a.name).concat((svc.databases || []).map((d) => d.name)),
        dominios: (svc.applications || []).map((a) => a.fqdn).filter(Boolean),
        variables: envs.filter((e) => !e.is_preview).map((e) => e.key),
      });
      log(`· servicio ${svc.name}: ${envs.length} variables`);

      if (s.supabase) {
        const out = join(C, `supabase-${svc.name}`);
        execFileSync(process.execPath, [join(AQUI, 'db-dump.mjs'), '--service', s.uuid, '--out', out],
          { stdio: ['ignore', 'inherit', 'inherit'], cwd: AQUI, env: process.env });
        const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
        man.supabase[svc.name] = { postgres: m.server_version, db_sql_bytes: m.db_sql_bytes,
          filas: Object.fromEntries(Object.entries(m.tables).map(([k, v]) => [k, v.rows])) };
        if (s.storage) {   // config: solo donde el servicio de Storage está encendido y tiene ficheros
          const sb = supabaseDe(envs);
          man.storage[svc.name] = await copiarStorage(sb, join(C, `storage-${svc.name}`));
          log(`· storage de ${svc.name}: ${JSON.stringify(man.storage[svc.name])}`);
        } else man.storage[svc.name] = 'no se copia: el servicio de Storage está apagado en este Supabase';
      }
    }

    // ── Lo común del VPS (solo en un repo: risk-reward-tool-v2) ──
    if (CFG.infra) {
      const I = join(C, 'infra'); mkdirSync(I, { recursive: true });
      const ghApps = await coolify('/github-apps');
      const claves = (await coolify('/security/keys')).filter((k) => k.is_git_related);
      json(join(I, 'github-apps.json'), ghApps);
      json(join(I, 'claves-git.json'), claves);
      const inv = {
        version: man.coolify_version,
        proyectos: await coolify('/projects'), servidores: await coolify('/servers'),
        apps: (await coolify('/applications')).map((a) => ({ uuid: a.uuid, nombre: a.name, repo: a.git_repository, dominios: a.fqdn })),
        servicios: (await coolify('/services')).map((s) => ({ uuid: s.uuid, nombre: s.name })),
      };
      json(join(I, 'coolify-inventario.json'), inv);
      const cf = async (p) => { const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }); const j = await r.json(); if (!j.success) throw new Error(`Cloudflare ${p}: ${JSON.stringify(j.errors)}`); return j.result; };
      const dns = {};
      for (const z of await cf('/zones?per_page=50')) {
        dns[z.name] = (await cf(`/zones/${z.id}/dns_records?per_page=500`))
          .map((r) => ({ tipo: r.type, nombre: r.name, valor: r.content, proxy: r.proxied, ttl: r.ttl, prioridad: r.priority }));
      }
      json(join(I, 'dns-cloudflare.json'), dns);
      man.infra = {
        github_apps: ghApps.filter((g) => !g.is_public).map((g) => ({ nombre: g.name, app_id: g.app_id, installation_id: g.installation_id })),
        dns: Object.fromEntries(Object.entries(dns).map(([z, rs]) => [z, rs.filter((r) => ['A', 'AAAA', 'CNAME'].includes(r.tipo)).map((r) => `${r.tipo} ${r.nombre} → ${r.valor}`)])),
      };
      log(`· infra: ${ghApps.length} GitHub apps, ${claves.length} claves de git, DNS de ${Object.keys(dns).length} zonas`);
    }

    // ── Empaquetar y cifrar ──
    json(join(C, 'manifiesto.json'), man);
    const plano = join(tmp, 'copia.tar.gz');
    execFileSync('tar', ['-C', tmp, '-czf', plano, 'copia']);
    const destino = join(AQUI, 'copia.tar.gz.gpg');
    const frase = join(tmp, 'frase'); writeFileSync(frase, FRASE, { mode: 0o600 });
    const gpgBase = ['--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback', '--passphrase-file', frase];
    execFileSync('gpg', [...gpgBase, '--symmetric', '--cipher-algo', 'AES256', '--s2k-digest-algo', 'SHA512',
      '--s2k-count', '65011712', '-o', destino, plano]);
    // Comprobar ANTES de dar la copia por buena que se descifra y que el tar está sano.
    const lista = execFileSync('sh', ['-c', `gpg ${gpgBase.map((a) => `'${a}'`).join(' ')} -d '${destino}' | tar -tzf -`], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (!lista.includes('copia/manifiesto.json')) throw new Error('La copia cifrada no se descifra bien');
    const buf = readFileSync(destino);
    man.cifrado = { archivo: 'backup/copia.tar.gz.gpg', bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
      como: 'gpg AES256 simétrico con la frase BACKUP_VPS_PASSPHRASE' };
    // GitHub avisa por encima de 50 MB y rechaza por encima de 100 MB por fichero:
    // lo grande se parte en trozos de 45 MB (copia.tar.gz.gpg.parte-aa, -ab…) y se
    // junta con: cat backup/copia.tar.gz.gpg.parte-* > copia.tar.gz.gpg
    for (const f of readdirSync(AQUI).filter((n) => n.startsWith('copia.tar.gz.gpg.parte-'))) rmSync(join(AQUI, f));
    if (buf.length > 45e6) {
      execFileSync('split', ['-b', '45000000', destino, `${destino}.parte-`]);
      rmSync(destino);
      man.cifrado.partes = readdirSync(AQUI).filter((n) => n.startsWith('copia.tar.gz.gpg.parte-')).sort();
      man.cifrado.juntar = 'cat backup/copia.tar.gz.gpg.parte-* > copia.tar.gz.gpg   (el sha256 es el del fichero juntado)';
    }
    json(join(AQUI, 'manifiesto.json'), man);
    log(`✓ backup/copia.tar.gz.gpg ${(buf.length / 1e6).toFixed(2)} MB · ${lista.trim().split('\n').length} entradas · comprobado que se descifra`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });   // nada en claro se queda en disco
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
