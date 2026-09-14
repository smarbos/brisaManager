# Design: UI Component Library (admin-web + guest-web)

Status: Approved
Date: 2026-09-14

## Purpose

Both `admin-web` and `guest-web` currently render plain, unstyled HTML elements (`<button>`, `<input>`, `<table>`, etc.) with no shared visual language and no responsive design. This project introduces a small set of styled UI primitives, used consistently across both apps, retrofitted onto every existing page. `guest-web` must visually match labrisa.com.ar's existing branding (guests reach it from a confirmation link in email/WhatsApp and should feel it's the same site); `admin-web` is internal-only and has no branding constraint beyond being clean and functional. Both apps must work well mobile-first, since admin staff may check reservations from a phone and guests will almost always open confirmation links on one.

This does not add any new user-facing feature — it's a visual/structural pass over the existing UI from sub-projects 1-5.

## Branding source

`guest-web/src/index.css` already defines a color/type palette (`--color-dark`, `--color-teal`, `--color-teal-dark`, `--color-bg`, `--color-white`, `--color-grey`, `--color-light-grey`; `Inter` for body text, `Montserrat` for headings) from an earlier, barely-applied attempt to match labrisa.com.ar. This is treated as the source of truth for guest-web's theme — no further verification against the live site.

`admin-web/src/index.css` has Vite's unmodified starter-template palette (purple accent, generic neutrals). This is replaced with a plain, functional neutral theme — no branding constraint, just needs to look clean and consistent.

## Tooling

Add Tailwind CSS v4 to both apps independently, via `@tailwindcss/vite` (no separate PostCSS config file needed — the plugin integrates directly with each app's existing Vite config). Each app keeps its own `index.css` and its own `@theme` block mapping that app's palette into Tailwind design tokens (e.g. `--color-accent`, `--color-bg`, `--font-heading`), so the same component code resolves to a different look per app purely through which app it's compiled in.

No shared package, no npm/pnpm workspace, no changes to `docker-compose.yml` or either app's Dockerfile — this is an addition to each app's own `package.json`/Vite config, nothing structural about the build changes.

## Shared primitives (vendored, not a package)

A `src/ui/` folder, with near-identical contents, added independently to both `admin-web` and `guest-web` (small enough — under a dozen components — that hand-copying on future changes is acceptable; see Sharing mechanism below). Scope is driven by what the existing pages actually use (24 `<label>`, 17 `<button>`, 14 `<input>`, 6 `<select>`, 5 `<form>`, 4 `<textarea>`, 2 `<table>` across both apps today):

- **`Button`** — variants `primary` / `secondary` / `danger`; renders a real `<button>`, preserves `type`/`disabled`/`onClick` props as passthrough.
- **`FormField`** — wraps a label, one form control, and an optional error message; wires `htmlFor`/`id` and `aria-describedby` automatically so existing RTL queries by label text keep working.
- **`Input`, `Select`, `Textarea`** — styled form controls, meant to be used inside `FormField`; forward all native props (`value`, `onChange`, `required`, etc.) unchanged.
- **`Alert`** — the existing `role="alert"` error/status banners (e.g. "Could not load the guests"), now styled; keeps `role="alert"` so existing `screen.findByRole('alert')` assertions keep passing.
- **`Badge`** — small status pill (e.g. Subscribed/Unsubscribed, SENT/FAILED, confirmation status) with color driven by a `tone` prop (`neutral` / `success` / `warning` / `danger`).
- **`Table`** — a thin styled wrapper around `<table>`/`<thead>`/`<tbody>`, plus a horizontal-scroll container (`overflow-x-auto`) for narrow viewports. Not a responsive card-transform — with only two tables in the app today, a scroll container is enough; a full transform would be speculative.
- **`PageHeader`** — page title + the top-of-page nav links (e.g. "Reservations", "Guests", "Settings"), replacing the current ad-hoc `<Link>` row repeated at the top of each admin-web page.
- **`PageContainer`** — the outermost content wrapper (max-width, consistent padding, mobile-first) every page renders inside.

Components are built mobile-first using Tailwind's responsive utilities directly (stacked/full-width by default, `md:`/`lg:` prefixes for wider layouts) — no separate mobile/desktop component variants.

## Sharing mechanism

There is no npm/pnpm workspace today — `admin-web`, `guest-web`, and `api` are each an independent Docker build context with their own `node_modules`. Introducing a true shared package would mean restructuring the repo root into a workspace and changing every Dockerfile/compose build context, a meaningfully bigger change than two apps' worth of ~10 small components justifies.

Instead, `src/ui/` is vendored: the same component source is copied into both apps. The two copies are allowed to diverge slightly on tokens/classNames (each app's Tailwind theme differs), but the component *props/behavior* stay the same shape. When a primitive's behavior changes going forward, the change is applied to both copies by hand — acceptable at this scale; revisit with a real workspace package if the primitive count or the number of apps grows meaningfully.

## Retrofit scope

Every existing page in both apps is converted to the new primitives + Tailwind as part of this same project, not left for later:

- **admin-web**: `auth/LoginPage`, `reservations/ReservationListPage`, `reservations/ReservationFormPage`, `guests/GuestListPage`, `templates/TemplatesPage`, `campaigns/CampaignsPage`, `settings/SettingsPage`.
- **guest-web**: `confirmation/ConfirmationPage`, the `HomePlaceholder` in `App.tsx`.

Existing tests query primarily by role/label/text (RTL best practice, already followed in this codebase), so most assertions keep passing unchanged as long as primitives preserve the same semantics (`role="alert"`, label-to-control association, button text). Where a primitive's DOM nesting changes an assertion's match (e.g. button text wrapped in an inner `<span>`), the test is updated to match — expected churn, not a regression signal.

## Testing

No new test tooling — stays Vitest + React Testing Library in both apps. Light smoke tests are added for the primitives themselves, not exhaustive variant coverage:

- `Button` — renders, forwards `onClick`, respects `disabled`.
- `FormField` — label is associated with its control (`getByLabelText` resolves), error message renders with the right `aria-describedby` wiring.
- `Alert` — renders with `role="alert"`.

Every retrofitted page's existing test file is run after conversion and kept green (with the expected small updates noted above) — no new page-level test coverage is required by this project, since it changes presentation, not behavior.
