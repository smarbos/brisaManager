# Repository instructions for AI agents

## Version bumps

This repo tracks an independent semantic version per deployable component — not a single
repo-wide version:

- `admin-web/package.json` → `version` — shown in the admin app's fixed footer (`AppFooter`)
- `api/package.json` → `version` — returned by `GET /health`
- `chrome-extension/manifest.json` → `version`

**Before committing any change that touches one of these directories, bump that component's
own `version` field.** A patch bump for routine changes; use your judgement for larger ones.
Components are versioned independently — changing `api` doesn't warrant bumping `admin-web`
or vice versa. This is what lets `/health` and the admin footer tell you, at a glance, exactly
what's actually deployed when debugging a production issue.

`guest-web` is not part of this scheme — no manual version bump needed there. It's identified
by git commit hash instead (shown in its fixed footer, `AppFooter`), baked in automatically at
deploy time from `VITE_COMMIT_HASH` (see `guest-web/Dockerfile` and
`.github/workflows/deploy.yml`), not something you set by hand.
