# Multi-tenant and white-label direction

Use one backend and one codebase for every designer/company. Do not deploy a backend copy per customer.

Suggested future entities:

```text
Tenant
  id, name, domain, logo, primaryColor, theme

Project
  id, tenantId, name, status

Room
  id, projectId, name, area

Model
  id, projectId, storageKey, status

Note
  id, projectId, roomId, authorId, text, status

Upload
  id, projectId, roomId, storageKey, type
```

Every database query and storage key must be scoped by `tenantId` and `projectId`. Domains should resolve to a tenant, while authorization decides whether the current user may read or mutate it.

The current `scripts/config.js` centralizes the default brand (`name`, `logoText`, `accentColor`, `defaultTheme`). Later, load tenant branding from a public project/tenant endpoint and apply CSS custom properties. Never generate separate frontend copies for white-label customers.

Current JSON persistence is single-process development storage. It is not a substitute for tenant-safe PostgreSQL transactions.
