# Roomark

Static architectural project frontend with a Three.js viewer and a Node/Express API for projects, room media, notes and IFC → GLB conversion.

## Local development

Requirements: Node.js 22+, npm and a compatible `IfcConvert` binary.

```sh
cp server/.env.example server/.env
cd server
npm ci
npm start
```

In another terminal, serve the repository root. Same-origin API proxying is not provided by Python, so either set `window.ROOMARK_API_URL` before `scripts/config.js` or use Docker (recommended).

The frontend has one runtime configuration source: `scripts/config.js`. By default it uses `location.origin`. For a separately hosted API, inject this before `config.js`:

```html
<script>window.ROOMARK_API_URL = "https://api.your-domain.example";</script>
```

## Docker

```sh
cp server/.env.example server/.env
docker compose up --build
```

Open `http://localhost:8080`. Nginx serves the static frontend and proxies `/api` to the backend. Persistent local data is stored in the `ifc-models` Docker volume. `docker compose down` preserves it; `docker compose down -v` deletes it.

## Environment variables

See the documented, safe template in `server/.env.example`.

- `PORT`, `HOST`, `NODE_ENV` — HTTP process settings.
- `ALLOWED_ORIGINS` — comma-separated exact browser origins (`CORS_ORIGINS` remains a compatibility alias).
- `ALLOWED_HOSTS` — exact public API/proxy hosts accepted by the backend.
- `TRUST_PROXY_HOPS` — set to `1` only behind one trusted reverse proxy.
- `STORAGE_DRIVER` — currently only `local`.
- `MODEL_STORAGE_DIR` — persistent local results and user media.
- `TEMP_DIR` — disposable IFC conversion workspace.
- `IFC_CONVERT_PATH` — converter executable.
- `MAX_IFC_UPLOAD_MB`, `MAX_GLB_UPLOAD_MB`, `MAX_IMAGE_UPLOAD_MB` — separate disk-upload limits.
- `MAX_IMAGE_WIDTH`, `MAX_IMAGE_HEIGHT`, `MAX_IMAGE_PIXELS` — decoded-image limits.
- `CONVERSION_TIMEOUT_MS`, `MAX_CONCURRENT_CONVERSIONS`, `MAX_CONVERSION_QUEUE`, `MAX_USER_CONVERSION_JOBS` — converter and queue limits.
- `LOGIN_RATE_LIMIT_*`, `REGISTER_RATE_LIMIT_*`, `CONVERSION_RATE_LIMIT_*` — per-process abuse limits.
- `UPLOAD_PASSWORD` — required in production; never commit it.
- `SHUTDOWN_TIMEOUT_MS` — graceful conversion drain time.

## Architecture

Current:

```text
Browser / static frontend
          |
          v
      Express API
          |
   in-memory queue (1 process)
          |
      IfcConvert
          |
   LocalStorage driver
```

Planned production:

```text
Cloudflare Pages  ---> Browser
                         |
                         v
                  VPS reverse proxy
                         |
                    Node API
                         |
                    IfcConvert
                         |
                  Cloudflare R2

Later: PostgreSQL for metadata and Redis/BullMQ for distributed conversion.
```

The frontend remains a normal static site. The API storage interface currently implements local files only; no fake R2 or database integration is included.

## Security

- Never commit `.env`; use external environment variables in production.
- Uploaded filenames are not used as server paths. IFC structure and complete GLB chunk boundaries are validated server-side.
- Large uploads use randomized temporary disk files. Images are decoded with pixel limits and re-encoded before storage.
- Helmet, CSP, request IDs, an exact CORS allowlist and cookie-origin CSRF checks protect HTTP boundaries.
- `IfcConvert` runs with `spawn`, an argument array and `shell: false`.
- IFC uploads are size-limited and rate-limited. The limiter is in-memory and applies per backend instance only.
- Temporary conversion directories are removed in `finally` after success, failure or timeout.
- Production errors and logs do not expose cookies, tokens, file contents or absolute paths.

`server/.env` was previously tracked. No API key or access token was found in the current tracked content, but if any real `UPLOAD_PASSWORD` or external credential ever existed in that file, rotate/revoke it manually and consider purging it from Git history.

## Checks

```sh
npm ci --prefix server
npm test --prefix server
npm audit --prefix server
docker compose config
docker compose build
```

`GET /health` is deliberately lightweight and returns process health without invoking IfcConvert. A real conversion check requires a valid sample IFC; no synthetic large fixture is committed.

Further production planning: [production architecture](docs/production-architecture.md), [storage](docs/storage.md), [multi-tenant model](docs/multi-tenant.md).
