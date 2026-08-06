# Elite Dental Lab — Client Copy

This branch is a **separate white-label copy** for **Elite Dental Lab**.

## Isolation rules (important)

- **Do not merge this branch into `main`.**
- **Do not deploy this branch to Elegance production** (Vercel / Railway / Mongo of Elegance).
- Elegance continues on branch `main` only.
- Elite gets its own:
  - Vercel project (frontend)
  - Railway project (backend)
  - MongoDB database (empty / new)
  - Print Agent config pointing to *Elite* Railway URL

## Brand

- Lab name: **Elite Dental Lab**
- Short name: **Elite**
- Tagline: **Dental Lab**

## Deploy checklist for Elite

1. Create new MongoDB database (not Elegance DB).
2. Create new Railway service from this branch; set env vars (Mongo, JWT, PRINT_AGENT_SECRET, CORS origins).
3. Create new Vercel project from this branch; set `apiUrl` / environment to Elite Railway.
4. Create first admin user for Elite.
5. Install Print Agent on Elite’s print laptop with Elite `SERVER_URL` + Elite secret.
6. Hand over Elite login URL only — never Elegance credentials/URLs.
