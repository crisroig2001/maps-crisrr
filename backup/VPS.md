# El VPS entero: qué hay y en qué orden se levanta

> **Para Claude.** Este fichero es IGUAL en los nueve repos que viven en el VPS.
> Si el VPS se ha estropeado, empieza aquí; después sigue el `backup/LEEME.md` de
> cada proyecto. Copia hecha el **12/11/2026** (la fecha exacta de cada una, en su
> `backup/manifiesto.json`).

## Lo que hay en el VPS (Coolify 4.7.5, un servidor `localhost`, IP 152.53.64.109)

| Proyecto Coolify | Recurso | Qué es | Dominio | Su copia |
|---|---|---|---|---|
| My first project | app `rrtool` (Dockerfile, :3000) | Next.js | rrtool.app, www.rrtool.app | `risk-reward-tool-v2/backup/` |
| My first project | servicio `supabase` (15 contenedores) | Supabase de rrtool | supabase.rrtool.app | `risk-reward-tool-v2/backup/` |
| residencia | app `residencia` (Dockerfile, :3000) | Next.js | residencia.crisrr.com | `residencia-inventario/backup/` |
| residencia | servicio `supabase-residencia` (RECORTADO, 9) | Supabase + fotos | supabase.residencia.crisrr.com | `residencia-inventario/backup/` |
| juegos | app `games-web` (static, :80) | web estática | games.crisrr.com | `juegos-crisrr/backup/` |
| juegos | servicio `supabase-juegos` | Supabase | supabase.games.crisrr.com | `juegos-crisrr/backup/` |
| camcopy | app `camcopy` (Dockerfile, :80) | nginx + njs | camcopy.crisrr.com | `camcopy/backup/` |
| camcopy | servicio `camcopy-turn` | coturn (UDP 3478, 49160-49200) | — | `camcopy/backup/` |
| maps | app `maps` (Dockerfile, :3000, volumen `/data`) | Next.js | maps.crisrr.com | `maps-crisrr/backup/` |
| holodrive | app `holodrive` (Dockerfile, :8080, UDP 7464 y 3479, volumen `/data`) | relé | holodrive.crisrr.com | `holodrive/backup/` |
| neurona | app `neurona-web` (Dockerfile, :80) | web estática | ia.crisrr.com | `ia-crisrr/backup/` |
| engine | app `engine-web` (static, :80) | web estática | engine.crisrr.com | `engine-crisrr/backup/` |
| engine2 (en *engine*) | app `engine2-web` (static, :80) | web estática | engine2.crisrr.com | `engine2-crisrr/backup/` |

Lo **común a todo el VPS** (la GitHub App con la que Coolify lee los repos, su clave
privada, el inventario de Coolify y TODOS los registros DNS de Cloudflare) va solo en
la copia de **`risk-reward-tool-v2/backup/`**, carpeta `infra/`.

Los demás repos del usuario (`fiscalidad-app`, `near`, `terminal-liquidez`,
`risk-reward-tool`, `AeroGenerador`…) **no están en el VPS** (Vercel, Supabase
Cloud o nada): no tienen copia porque no hay nada que perder si el VPS cae.

## La frase de las copias

Cada `backup/copia.tar.gz.gpg` está cifrada con gpg (AES256) y la frase
**`BACKUP_VPS_PASSPHRASE`**. La misma para todos los repos. La guarda el usuario en
su gestor de contraseñas; si está bien montado, también es una variable de entorno
del entorno de Claude Code. Si no está en `env`, **pídesela** (no hay otra forma de
abrir las copias). ⚠️ No es la `BACKUP_PASSPHRASE` de las Releases nocturnas de
rrtool: esa es otra.

```bash
cd <repo>
cat backup/copia.tar.gz.gpg* > /tmp/copia.gpg      # junta los trozos si los hay (parte-aa, -ab…)
sha256sum /tmp/copia.gpg                            # = cifrado.sha256 de backup/manifiesto.json
mkdir -p /tmp/copia-<repo> && gpg --batch --pinentry-mode loopback \
  --passphrase "$BACKUP_VPS_PASSPHRASE" -d /tmp/copia.gpg | tar xz -C /tmp/copia-<repo>
```

⚠️ Lo descifrado tiene contraseñas, claves y datos de usuarios: fuera del repo
(`/tmp` o el scratchpad), nunca commitearlo, y borrarlo al acabar.

## Orden para levantarlo todo en un VPS nuevo

**0. Servidor.** Ubuntu con **≥ 8 GB de RAM, mejor 16, y con swap**. Con 8 GB y sin
swap, arrancar el tercer Supabase completo tumbó el VPS entero (sep 2026): por eso el
de residencia va recortado. Lo que necesita al usuario (Claude no tiene SSH):
- instalar Coolify: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`;
- entrar en `http://<IP>:8000`, crear el admin y un **token de API** con `root`
  (o `read`, `read:sensitive`, `write` y `deploy`);
- guardar `COOLIFY_BASE_URL` (`https://coolify.rrtool.app` cuando el DNS ya apunte,
  o `http://<IP>:8000` mientras tanto) y `COOLIFY_TOKEN` en el entorno de Claude Code.
- abrir en el cortafuegos del proveedor: 80, 443, 8000 y los UDP de camcopy-turn
  (3478 y 49160-49200, más 3478/tcp) y de holodrive (7464 y 3479).

**1. DNS** (lo hace Claude con `CLOUDFLARE_API_TOKEN`). Todos los A de abajo, a la IP
nueva, **DNS-only (nube gris)**. Desde `risk-reward-tool-v2`:
`CLOUDFLARE_ZONE=rrtool.app scripts/cf set A coolify.rrtool.app <IP>` (y
`CLOUDFLARE_ZONE=crisrr.com …` para los de crisrr.com; con varias zonas,
`CLOUDFLARE_ZONE` es obligatoria). Los CNAME de `fiscal` y `terminal` (Vercel), el
MX/TXT de Resend y el DKIM **no se tocan**. La lista completa, con los valores, está
en `infra/dns-cloudflare.json` de la copia de rrtool.

| Zona | Registros A que apuntan al VPS |
|---|---|
| rrtool.app | `rrtool.app`, `www`, `coolify`, `supabase` |
| crisrr.com | `camcopy`, `engine`, `engine2`, `games`, `supabase.games`, `holodrive`, `ia`, `maps`, `residencia`, `supabase.residencia` |

**2. La GitHub App** (sin ella Coolify no puede leer los repos privados ni desplegar
con cada push). Es `rrtool-app` (App ID 4266230, instalación 145704951). Dos maneras:
- **Reusar la de siempre** (mejor: el webhook ya apunta a `coolify.rrtool.app`):
  Coolify → *Sources* → *+ Add* → *GitHub App* → rellenar a mano con los datos de
  `infra/github-apps.json` (app_id, installation_id, client_id, client_secret,
  webhook_secret) y la clave privada de `infra/claves-git.json`. Lo hace el usuario
  en el panel; para no pasar secretos por el chat, Claude le deja el fichero
  descifrado donde pueda abrirlo (el scratchpad) y lo borra después.
- **Crear una nueva** desde ese mismo botón (Coolify la registra en GitHub sola) y
  darle acceso a los nueve repos en https://github.com/settings/installations.

**3. Proyectos**, por orden, siguiendo el `backup/LEEME.md` de cada uno:
1. `risk-reward-tool-v2` (rrtool y su Supabase: lo que más importa, hay dinero real);
2. `residencia-inventario` (datos y fotos de una persona: irrecuperables sin la copia);
3. `juegos-crisrr`;
4. `camcopy`, `maps-crisrr`, `holodrive`;
5. `ia-crisrr`, `engine-crisrr`, `engine2-crisrr` (solo código: cinco minutos cada una).

**Los Supabase, de uno en uno**: no arrancar el siguiente hasta que el anterior esté
en verde y la memoria lo aguante.

## Recetas comunes (Coolify por API)

La referencia de la API: https://coolify.io/docs/api-reference. **Los nombres de los
campos cambian entre versiones**: después de cada POST/PATCH, un GET para comprobar
que ha quedado lo que se quería. Si un endpoint no existe, el panel lo hace igual
(el usuario, con los valores que le digas).

- **Proyecto**: `POST /api/v1/projects {name}`; el servidor: `GET /api/v1/servers`.
- **App de un repo privado**: `POST /api/v1/applications/private-github-app` con
  `project_uuid`, `server_uuid`, `environment_name: "production"`, `github_app_uuid`
  (`GET /api/v1/github-apps`), y de `coolify/app-<nombre>.json` de la copia:
  `git_repository`, `git_branch`, `build_pack`, `ports_exposes`, `ports_mappings`,
  `base_directory`, `dockerfile_location`, `publish_directory`, `domains` (= `fqdn`),
  `health_check_*`; con `instant_deploy: false` hasta tener las variables.
- **Variables de una app**: `POST /api/v1/applications/<uuid>/envs/bulk` con
  `{"data":[{key, value, is_preview:false, is_literal, is_multiline, is_shown_once}]}`
  sacado de `coolify/app-<nombre>-envs.json` (respetar `is_buildtime`: las
  `NEXT_PUBLIC_*` tienen que ser de build). O en el panel, *Developer view*, pegando
  `coolify/app-<nombre>.env`.
- **Volumen persistente**: el de `coolify/app-<nombre>-storages.json` (mismo
  `mount_path`), ANTES del primer despliegue.
- **Servicio con su compose**: `POST /api/v1/services` (tipo `supabase`, o compose
  propio con `docker_compose_raw` en base64) y después
  `PATCH /api/v1/services/<uuid> {"docker_compose_raw": "<base64 de coolify/svc-<nombre>-compose.yaml>"}`
  y `PATCH /api/v1/services/<uuid>/envs/bulk` con `coolify/svc-<nombre>-envs.json`.
  Cambiar el compose no basta: parar y arrancar el servicio.
- **Desplegar**: `POST /api/v1/deploy?uuid=<uuid>` (es POST; GET responde «This
  endpoint has changed to a POST request»). Seguir el despliegue con
  `GET /api/v1/deployments/<deployment_uuid>`.

### Un Supabase desde la copia (rrtool, residencia, juegos)

1. Crear el servicio, pegar **el compose y las variables de la copia** (mismo
   `SERVICE_PASSWORD_JWT` = mismo JWT secret → la anon key del navegador, la service
   key de la app y las sesiones abiertas siguen valiendo, y la app no cambia), el
   dominio de Kong el de siempre, y arrancarlo. Esperar a que `supabase-db`,
   `supabase-auth` (crea el esquema `auth`) y, si lo lleva, `supabase-storage` (crea
   el esquema `storage`) estén sanos.
2. **La base, por HTTPS** (sin SSH, probado en un simulacro con la copia de verdad):
   ```bash
   node backup/restaurar-db.mjs --sql /tmp/copia-<repo>/copia/supabase-<svc>/db.sql \
        --url https://<dominio de kong> --key <SERVICE_SUPABASESERVICE_KEY>
   ```
   Manda el esquema en una transacción y los datos en trozos de 2 MB (Kong rechaza
   cuerpos de unos 5 MB). Se niega si la base ya tiene tablas en `public`. Si el
   usuario tiene SSH y lo prefiere, en el servidor:
   `docker exec -i $(docker ps --format '{{.Names}}' | grep -m1 supabase-db) psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < db.sql`
   (una sola transacción). Después, reiniciar el servicio (PostgREST relee el esquema).
3. **Los ficheros de Storage** (solo residencia): `node backup/subir-storage.mjs --dir
   /tmp/copia-<repo>/copia/storage-<svc> --url https://<kong> --key <service key>`
   (sube y comprueba el sha256 de cada fichero).
4. **Comprobar**: las filas de cada tabla tienen que cuadrar con
   `copia/supabase-<svc>/manifest.json` (o con `supabase` de `backup/manifiesto.json`).

### Después de restaurar (cualquier proyecto)

- En el Coolify nuevo **los UUID son otros**: cambiarlos en `backup/config.json`, en
  el `CLAUDE.md` del repo y en lo que lo cite (en rrtool, también
  `scripts/backup/dump.mjs` y los secretos de Actions del workflow de copia).
- Volver a hacer la copia (abajo) para comprobar que con los UUID nuevos sale entera.

## Rehacer las copias (cuando el usuario lo pida, o tras un cambio gordo)

En cada repo, desde su raíz, con `COOLIFY_BASE_URL`, `COOLIFY_TOKEN` (con
`read:sensitive`), `BACKUP_VPS_PASSPHRASE` y, en rrtool, `CLOUDFLARE_API_TOKEN`:

```bash
node backup/hacer-copia.mjs          # regenera copia.tar.gz.gpg (+ trozos) y manifiesto.json
```

Comprueba ella sola que lo cifrado se descifra. Los Supabase se pueden **restaurar de
prueba** antes de commitear (hace falta Docker; en el contenedor de Claude se arranca
con `dockerd &`):

```bash
mkdir -p /tmp/c && cat backup/copia.tar.gz.gpg* | gpg --batch --pinentry-mode loopback \
  --passphrase "$BACKUP_VPS_PASSPHRASE" -d | tar xz -C /tmp/c
bash backup/simulacro.sh /tmp/c/copia <servicio supabase>    # esquema y tablas idénticos (+ fotos)
```

Luego commit y push (rama de trabajo → `main`). ⚠️ **Peso en git**: cada copia
nueva suma su tamaño al historial (rrtool ~53 MB, residencia ~42 MB, el resto
kilobytes). GitHub rechaza ficheros de más de 100 MB: por eso lo que pasa de 45 MB
se parte en `parte-aa`, `parte-ab`… (lo hace el script).
