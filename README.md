# La Brisa de Mar del Plata — Reservation Manager

## Local development

1. Copy environment variables: `cp .env.example .env` (adjust secrets as needed)
2. Start everything: `docker compose up -d --build`
3. Run database migrations: `docker compose exec api npx prisma migrate deploy`
4. Seed the initial admin user: `docker compose exec api npx prisma db seed`
5. Admin app: http://localhost:5183 (or `$ADMIN_WEB_PORT`)
6. Guest app: http://localhost:5174 (or `$GUEST_WEB_PORT`)
7. API: http://localhost:3001 (or `$API_PORT`)

## Running tests

- API: `docker compose exec api npm test` (unit) and `docker compose exec api npm run test:e2e` (e2e)
- Admin web: `docker compose exec admin-web npm test`
- Guest web: `docker compose exec guest-web npm test`

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
   - **`VITE_GUEST_WEB_URL`:** must be the real public guest-web origin, e.g.
     `https://reservas.labrisa.com.ar` — **not** `http://localhost:5174`. Admin-web uses it to
     build the guest confirmation link it shows staff. Like `VITE_API_URL`, this is baked into
     the admin-web bundle at *build* time, so changing it later also requires rebuilding the
     `admin-web` image (`--build`).
   - **Email:** `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL` — the API uses these to send the
     guest confirmation email and internal alerts via Resend. `EMAIL_FROM`'s domain must be
     verified in Resend before emails will actually send.
   - **WhatsApp (Twilio):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` — while
     using Twilio's WhatsApp Sandbox, any phone number you want to test with must first text the
     Sandbox's join code to the Sandbox number before it can receive anything. Real, un-prompted
     guest messaging requires a verified WhatsApp Business Sender (a Twilio/Meta business
     verification process, not a config change). Every guest message (the check-in link and both
     reminders) is business-initiated, outside the guest's 24-hour reply window, so it must be a
     Meta-approved template: set `TWILIO_TEMPLATE_CHECKIN_LINK`,
     `TWILIO_TEMPLATE_RESERVATION_REMINDER` and `TWILIO_TEMPLATE_DEPOSIT_REMINDER` to the
     templates' Content SIDs (`HX…`, from Twilio's Content Template Builder). **Don't leave one
     empty in production:** an empty value sends freeform text instead, which Twilio accepts and
     WhatsApp then silently drops — the reservation still shows it as sent. The wording lives in
     Twilio; changing it means submitting a new template for approval and updating the SID here.
   - **CORS origins:** `ADMIN_WEB_ORIGIN=https://admin.labrisa.com.ar` and
     `GUEST_WEB_ORIGIN=https://reservas.labrisa.com.ar` — the API rejects browser requests from
     any other origin, so localhost defaults will break the deployed admin app. `GUEST_WEB_ORIGIN`
     serves double duty: besides being a CORS-allowed origin, it's also the base URL the API
     embeds in the initial confirmation email sent to guests — left at its localhost default,
     guests receive broken links.
   - **`API_ORIGIN`:** must be the API's own public origin, e.g. `https://api.labrisa.com.ar`
     (whatever `API_DOMAIN` resolves to). The API embeds it in the unsubscribe link appended to
     every marketing email — left at its localhost default, every campaign email ships a broken
     unsubscribe link, silently, with the campaign still recorded as sent.
2. Point DNS A records for `admin.labrisa.com.ar`, `reservas.labrisa.com.ar`, and `api.labrisa.com.ar` at the server's IP
3. Start: `VITE_COMMIT_HASH=$(git rev-parse --short HEAD) docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
   (the GitHub Actions deploy workflow sets `VITE_COMMIT_HASH` automatically — only needed by hand for a manual deploy. It's baked into guest-web's footer so staff can identify exactly which build a guest is looking at.)
4. Run migrations and seed as above, using the same `docker compose -f ... exec` commands

In production only Traefik publishes ports (80/443); Postgres, the API and both web apps are
reachable only on the internal Docker network.
