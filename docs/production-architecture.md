# Future production architecture

No VPS, Cloudflare Pages, R2, PostgreSQL or Redis resource is created by this repository today.

```text
Browser
  |
  +------> Cloudflare Pages (static HTML/CSS/JS)
  |
  +------> api.example.com
                 |
           VPS reverse proxy
                 |
             Node API
                 |
       single-process conversion queue
                 |
            IfcConvert
                 |
          Cloudflare R2

Later:
  PostgreSQL <- project/tenant/note metadata
  Redis/BullMQ <- distributed conversion queue
```

## Cloudflare Pages

Deploy the repository's static frontend files. Set the runtime API endpoint before `scripts/config.js` (or generate a small environment-specific config asset). Preserve SPA-like rewrites only where required; existing `.html` entry points and relative assets work as static files.

## VPS API

Run the Docker image behind exactly one TLS reverse proxy. Set `TRUST_PROXY_HOPS=1`, strict `ALLOWED_ORIGINS`, `NODE_ENV=production`, a strong `UPLOAD_PASSWORD`, persistent storage, a dedicated `TEMP_DIR`, and resource limits. Forward SIGTERM to Node and allow at least `SHUTDOWN_TIMEOUT_MS` before forced termination.

Do not expose the Node port publicly if the reverse proxy can reach it privately. Restrict upload body size at both proxy and application layers.

## Scaling boundary

The current queue and rate limiter are intentionally in-memory. Run one conversion API instance. Before horizontal scaling, move queue state to Redis/BullMQ and metadata/users/projects to PostgreSQL. Avoid scaling multiple instances against JSON files.

## R2 migration

Implement an `R2Storage` driver, stream converted GLB and media to R2, store object keys in PostgreSQL, and remove local temporary files. Details are in `storage.md`.

## Pre-deployment checklist

- Provision DNS, Cloudflare Pages and a TLS reverse proxy.
- Create external production secrets; set strict CORS origins.
- Mount adequate temporary disk space for worst-case concurrent IFC conversions.
- Verify IfcConvert against representative customer IFC files.
- Add backups and monitoring for persistent data.
- Run dependency audit, tests, image build and a real conversion smoke test.
