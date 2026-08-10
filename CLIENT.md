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
2. Create new Railway service from branch `client/elite-dental-lab` (root/`backend`); set env vars (Mongo, JWT, PRINT_AGENT_SECRET, CORS origins).
3. Create / use a **separate** Vercel project from branch `client/elite-dental-lab`.
4. In that Vercel project → Settings → Environment Variables, set:
   - `ELITE_API_URL` = `https://YOUR-ELITE-RAILWAY.up.railway.app`  
     (or `NG_APP_API_URL` = `https://YOUR-ELITE-RAILWAY.up.railway.app/api`)
   - Never point these at the Elegance Railway URL.
5. Create first admin user for Elite.
6. Install Print Agent on Elite’s print laptop with Elite `SERVER_URL` + Elite secret.
7. Hand over Elite login URL only — never Elegance credentials/URLs.

### Why phone/password fixes need Elite API

Staff phone is optional and passwords are stored for admin display in the **Elite backend** on this branch.  
If the frontend still calls Elegance Railway, those features will not work — and Elegance must not be modified for Elite.
