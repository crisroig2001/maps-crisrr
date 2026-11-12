# Copia de crisrr world en el VPS — cómo restaurarla

> **Para Claude.** Primero `backup/VPS.md` (el mapa del VPS, la frase y el orden).
> Esto es solo lo de este proyecto. ⚠️ Este repo es **PÚBLICO**: la copia va cifrada,
> pero nunca commitear nada descifrado.

## Qué hay aquí

`copia.tar.gz.gpg` (cifrada) y `manifiesto.json` (en claro, sin secretos). Dentro
(`copia/`): `coolify/app-maps.*` — la app (Dockerfile, puerto 3000,
https://maps.crisrr.com, sin variables) y su volumen
(`app-maps-storages.json`: `/data`).

## ⚠️ Lo que NO está: el mundo

Las parcelas reclamadas y lo construido viven en el volumen de Coolify montado en
`/data` (`mundo.json` y `reportes.json`, `src/lib/mundo.js`). **La API de Coolify no
deja leer ficheros de un volumen**, así que esta copia no los tiene. Formas de
sacarlos, a decidir con el usuario:
- por SSH en el VPS: `docker cp $(docker ps -qf name=pldgqjztsx5bfm2rbjnipmgh):/data ./maps-data`;
- o una tarea programada temporal de Coolify en la app que vuelque `/data` (por
  ejemplo `tar czf - -C /data . | base64`) y leer su salida por la API; se borra después.

Sin ellos, el mundo vuelve vacío (la urbanización de serie y sus casas en venta salen
del código, no del volumen).

## Restaurar

1. Proyecto `maps`. App: repo `crisroig2001/maps-crisrr`, rama `main`, Dockerfile,
   puerto 3000, dominio `https://maps.crisrr.com`.
2. **Antes del primer despliegue**, el volumen persistente en `/data` (si no, cada
   despliegue borra el mundo). Si hay copia de `/data`, meterla en el volumen.
3. Desplegar. Ojo: según el `CLAUDE.md`, un despliegue a mano necesita `&force=true`
   o reusa la imagen vieja.
4. UUID nuevo en el `CLAUDE.md` (el `curl` de desplegar) y en `backup/config.json`.
