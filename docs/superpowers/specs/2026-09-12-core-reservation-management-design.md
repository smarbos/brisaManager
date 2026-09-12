# Design: Core Reservation Management (Sub-project 1)

Status: Approved
Date: 2026-09-12

## Purpose

Foundation sub-project for the La Brisa de Mar del Plata reservation manager (see `TODO.md`). Delivers:

- A working admin app where staff can list, create, and edit reservations manually
- Tracking of which channel each reservation came from (Booking.com, Airbnb, direct/WhatsApp, other)
- The base Docker + deployment skeleton (admin app, guest-facing app placeholder, API, DB, reverse proxy) that later sub-projects build on

Out of scope for this sub-project (deferred to later sub-projects per `TODO.md`):
- Automated guest onboarding workflow (confirmation message, 30% deposit, digital contract, security deposit, confirmation email) — sub-project 2
- Booking.com / Airbnb API integrations — sub-project 3
- Google Calendar sync — sub-project 4
- Marketing / CRM campaigns — sub-project 5
- Multi-user roles/permissions — single admin login only for now

## Architecture

Monorepo with three deployable services plus a database:

- **`api`** — NestJS + Prisma, backed by PostgreSQL. Owns reservation data and all business logic. Exposes a REST API consumed by `admin-web` (and later `guest-web`).
- **`admin-web`** — React + TypeScript SPA. Served at `admin.labrisa.com.ar`. The real functionality of this sub-project: login, list/filter reservations, create/edit reservations.
- **`guest-web`** — React + TypeScript SPA. Served at `reservas.labrisa.com.ar`. Placeholder page only in this sub-project, proving the routing/infra works end-to-end; real guest-facing forms (confirmation, contract, payment) are built in sub-project 2.
- **`postgres`** — PostgreSQL database container.

Local development: Docker Compose runs all four services with hot-reload volumes (source mounted into containers, dev servers with file watching) so the workflow feels like normal local development.

Production: the same container images run behind **Traefik**, which:
- Routes `admin.labrisa.com.ar` → `admin-web` and `reservas.labrisa.com.ar` → `guest-web`
- Routes `api.labrisa.com.ar` → `api`, so both frontends call the same public API host
- Automatically provisions and renews Let's Encrypt TLS certificates for all three subdomains

## Data model (Prisma schema, conceptual)

### Reservation
| Field | Type | Notes |
|---|---|---|
| `id` | UUID | primary key |
| `guestName` | string | |
| `guestPhone` | string, nullable | |
| `guestEmail` | string, nullable | |
| `checkIn` | date | |
| `checkOut` | date | must be after `checkIn` |
| `paxCount` | int | must be > 0 |
| `source` | enum: `BOOKING`, `AIRBNB`, `DIRECT`, `OTHER` | |
| `externalReference` | string, nullable | e.g. Booking/Airbnb confirmation code |
| `totalAmount` | decimal | |
| `currency` | string | e.g. `ARS`, `USD` |
| `status` | enum: `PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED` | manually set in this sub-project; driven by workflow automation starting in sub-project 2 |
| `notes` | text, nullable | free-form staff notes |
| `createdAt` / `updatedAt` | timestamps | |

### AdminUser
| Field | Type | Notes |
|---|---|---|
| `id` | UUID | primary key |
| `email` | string, unique | |
| `passwordHash` | string | bcrypt hash |
| `createdAt` | timestamp | |

Modeled as a table (not hardcoded credentials) even though only one user exists today, so multi-staff support later doesn't require a schema rework.

## Auth

Simple email+password login against `AdminUser`, issuing a JWT. All admin API routes require a valid JWT (NestJS guard). `admin-web` stores the token and redirects to login when missing/expired. No roles/permissions yet — every authenticated user has full access.

## Admin app features (this sub-project)

- Login screen
- Reservation list, filterable by `source` and `status`
- Create reservation form (manual entry: guest info, dates, pax, source, external reference, amount, currency, notes)
- Edit reservation / view details, including manual status change (dropdown)

## Guest app (this sub-project)

Minimal React app skeleton at `reservas.labrisa.com.ar` showing a placeholder page. No real functionality yet — exists to validate the Docker/Traefik/subdomain setup end-to-end.

## Error handling

- NestJS validation pipes reject malformed input with 400 (e.g. `checkOut` before `checkIn`, `paxCount <= 0`, missing required fields)
- Auth guard returns 401 on missing/invalid/expired JWT
- No exotic error handling needed at this stage — no external integrations exist yet in this sub-project

## Testing

- **Backend:** unit tests for the reservation service (date validation, pax validation, source/status enum handling); e2e tests hitting the API for create → list → filter by source/status
- **Frontend:** smoke tests for the reservation list and create/edit form rendering
- **Auth:** unit test for login (valid/invalid credentials) and guard behavior (rejects missing/invalid token)

## Deployment

- Target: a self-managed VPS (SSH access) running Docker Compose
- Reverse proxy: Traefik, using Docker labels for service discovery and automatic Let's Encrypt certs
- Subdomains: `admin.labrisa.com.ar` (admin-web), `reservas.labrisa.com.ar` (guest-web placeholder), `api.labrisa.com.ar` (api)
- Same `docker-compose.yml` structure used for local dev and prod, with an override file (e.g. `docker-compose.prod.yml`) supplying production-specific config (Traefik labels, restart policies, env vars) — avoids maintaining divergent setups
