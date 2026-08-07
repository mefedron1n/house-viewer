# Storage evolution

## Current local driver

`server/storage/index.js` creates the configured storage driver. Only `LocalStorage` is implemented and selected with `STORAGE_DRIVER=local`. Keys are resolved beneath `MODEL_STORAGE_DIR`; attempts to escape that root are rejected.

IFC conversion currently follows this lifecycle:

```text
upload buffer
  -> TEMP_DIR/<random-job-id>/input.ifc
  -> IfcConvert writes temporary model.glb
  -> LocalStorage saves model.glb + metadata.json
  -> finally removes TEMP_DIR/<random-job-id>
  -> TTL cleanup removes expired result objects
```

User room/project media is still backed by the same persistent local root. Metadata is JSON until PostgreSQL is introduced.

## Future R2 driver

Do not send IFC conversion input to R2 unless retention is explicitly required. The intended production flow is:

```text
Browser -> VPS TEMP_DIR -> IfcConvert -> R2 object -> remove local temp
```

Add `R2Storage` behind the existing storage factory with compatible `save`, `get`, `delete`, `exists`, and delivery semantics. Large objects should stream rather than buffer. The API should store object keys in PostgreSQL and return signed or controlled URLs.

Future credentials must be external environment variables, never committed:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

They are intentionally absent from `.env.example` until an R2 driver actually consumes them.
