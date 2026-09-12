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

1. On the server, clone this repo and create `.env` with production secrets, including `ADMIN_DOMAIN`, `GUEST_DOMAIN`, `API_DOMAIN`, and `ACME_EMAIL`
2. Point DNS A records for `admin.labrisa.com.ar`, `reservas.labrisa.com.ar`, and `api.labrisa.com.ar` at the server's IP
3. Start: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
4. Run migrations and seed as above, using the same `docker compose -f ... exec` commands
