# House viewer

Static Three.js viewer with local GLB upload and a separate IFC conversion API. The original model is loaded from `models/house.glb`; viewer controls, fitting, walls toggle, auto-rotation and fullscreen remain available.

## Architecture

`viewer.html` and `scripts/app.js` are the static frontend. `server/index.js` is a deliberately local, single-process queue: it validates IFC, runs `IfcConvert` without a shell, writes `model.glb` and `metadata.json`, and exposes `/api/models` routes. It is not a multi-server queue.

## Run

Start the API with Docker (copy `.env.example` to `server/.env` and set the real static-site origin):

```sh
docker compose up --build
```

Serve the project directory with any static HTTP server, then open `viewer.html`. The frontend expects the API at `http://localhost:3001`; define `window.MODEL_API_URL` before `scripts/app.js` when deploying it elsewhere. Check conversion support at `GET /health`.

For a local Node run, install Node 22+, install `IfcConvert` from a compatible IfcOpenShell distribution, then run `npm install` and `npm start` inside `server`.

Detailed deployment instructions for Netlify + Render are in [docs/render-deploy.md](docs/render-deploy.md).

## Supported files and limits

GLB is loaded directly in the browser. IFC is uploaded to the API. A single GLTF is accepted by the picker but only works where every resource is embedded; GLTF with separate `.bin` or textures should be exported as GLB. PLA and PLN show an Archicad-to-IFC instruction.

Defaults are 200 MB, one conversion at a time, five-minute conversion timeout, and 24-hour expiry. All are configured in `server/.env`. Job directories use random IDs; filenames never determine paths. Output URLs are stable only while the local TTL lasts and are `private` cached. Add authentication and signed result URLs before storing private production models.

`metadata.json` extracts IFC entity information available in the STEP text (`GlobalId`, IFC type and name). It deliberately states that IfcConvert GLB mesh-to-`GlobalId` matching is not guaranteed; future room tools should use the IFC metadata rather than mesh names.

Each room page can upload a floorplan (JPG/PNG/WEBP), multiple render images, and one GLB room model. These assets are stored by the Render API under `MODEL_STORAGE_DIR/rooms`; set `UPLOAD_PASSWORD` on Render (the development default is `test123`) and attach a persistent disk for durable room content.

## Checks

Run `npm test` in `server`. A real conversion still requires a locally available `IfcConvert` and sample IFC; `/health` reports whether it was found.
