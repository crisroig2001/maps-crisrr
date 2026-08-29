# maps-crisrr — mapa 3D colaborativo estilo cartoon

**https://maps.crisrr.com**

Un mapa 3D del mundo estilo cartoon (tipo Apple/Google Maps) que se va
«coloreando» a medida que los usuarios escanean zonas. Todo el renderizado
ocurre **en la GPU del dispositivo**: el servidor no renderiza nada.

## Cómo funciona

- **Base del mundo**: teselas vectoriales de [OpenFreeMap](https://openfreemap.org)
  (datos © OpenStreetMap contributors), z14. El navegador las descodifica
  (`pbf` + `@mapbox/vector-tile`), dibuja el suelo (calles, parques, agua) en un
  canvas por tesela y **extruye los edificios** con Three.js — colores planos
  con el sombreado por cara horneado en los vértices (sin luces: rapidísimo en móvil).
- **Zonas escaneadas**: celdas z16 compartidas entre todos los usuarios
  (`/api/scans`, almacén JSON en `DATA_DIR`, volumen persistente en Coolify).
  Una celda escaneada pinta sus edificios a color pastel; el resto queda en gris
  «pendiente». El botón de escanear de momento **simula** el escaneo (la captura
  con cámara es la siguiente fase).
- **Despliegue**: Dockerfile multi-stage → Next.js `standalone`, en Coolify.

## Desarrollo

```bash
npm install
npm run dev
```

Parámetros de URL: `/?lat=41.3874&lng=2.1686`

## Hoja de ruta

1. ✅ Visor 3D cartoon con datos reales + escaneos compartidos (simulados)
2. Captura real con la cámara (vídeo guiado → reconstrucción → detalles por celda)
3. Cuentas de usuario, moderación, LOD/optimización de teselas
