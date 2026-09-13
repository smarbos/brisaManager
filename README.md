# La Brisa de Mar del Plata — Reservation Manager

## Local development

1. Copy environment variables: `cp .env.example .env` (adjust secrets as needed)
2. Start everything: `docker compose up -d --build`
3. Run database migrations: `docker compose exec api npx prisma migrate deploy`
4. Seed the initial admin user: `docker compose exec api npx prisma db seed`
5. Admin app: http://localhost:5183 (or `$ADMIN_WEB_PORT`)
6. Guest app placeholder: http://localhost:5174 (or `$GUEST_WEB_PORT`)
7. API: http://localhost:3001 (or `$API_PORT`)

## Running tests

- API: `docker compose exec api npm test` (unit) and `docker compose exec api npm run test:e2e` (e2e)
- Admin web: `docker compose exec admin-web npm test`

## Production deployment

> **Warning — change the placeholder secrets.** `.env.example` ships with `changeme`-style
> values for `JWT_SECRET`, `POSTGRES_PASSWORD` and `ADMIN_SEED_PASSWORD`. Replace all three
> with real, randomly generated secrets in the production `.env` before the first deploy, and
> change the seeded admin password after the first login.

1. On the server, clone this repo and create `.env` with production values:
   - **Routing/TLS:** `ADMIN_DOMAIN`, `GUEST_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`
   - **Secrets (never leave at the `.env.example` defaults):** `JWT_SECRET`, `POSTGRES_PASSWORD`
     (keep `DATABASE_URL` in sync with it), `ADMIN_SEED_PASSWORD`
   - **`VITE_API_URL`:** must be the public API origin, e.g. `https://api.labrisa.com.ar`
     (whatever `API_DOMAIN` resolves to) — **not** `http://localhost:3001`. Vite inlines this
     value at *build* time into the admin-web bundle, so it is passed as a build arg; changing
     it later requires rebuilding the `admin-web` image (`--build`).
   - **CORS origins:** `ADMIN_WEB_ORIGIN=https://admin.labrisa.com.ar` and
     `GUEST_WEB_ORIGIN=https://reservas.labrisa.com.ar` — the API rejects browser requests from
     any other origin, so localhost defaults will break the deployed admin app.
2. Point DNS A records for `admin.labrisa.com.ar`, `reservas.labrisa.com.ar`, and `api.labrisa.com.ar` at the server's IP
3. Start: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
4. Run migrations and seed as above, using the same `docker compose -f ... exec` commands

In production only Traefik publishes ports (80/443); Postgres, the API and both web apps are
reachable only on the internal Docker network.
