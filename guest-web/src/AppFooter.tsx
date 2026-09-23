import { useEffect, useState } from 'react';
import { getConfig } from './api/config';

// VITE_COMMIT_HASH is passed as a Docker build arg from the server's own git checkout at
// deploy time (the guest-web Docker build context is scoped to ./guest-web, so .git isn't
// available inside the build to compute it directly — see guest-web/Dockerfile and
// .github/workflows/deploy.yml). Falls back to 'dev' for local development, where it's unset.
const COMMIT_HASH = (import.meta.env.VITE_COMMIT_HASH as string) || 'dev';

// Fixed to the bottom of the viewport, always visible, so staff can ask a guest what it says
// (or check a screenshot) to identify exactly which deployed build they're looking at —
// unlike admin-web's semver, this is a commit hash since guest-web isn't otherwise versioned.
export function AppFooter() {
  const [emailDebugMode, setEmailDebugMode] = useState(false);

  useEffect(() => {
    getConfig()
      .then((config) => setEmailDebugMode(config.emailDebugMode))
      .catch(() => setEmailDebugMode(false));
  }, []);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-3 py-1.5 text-xs text-text-muted">
      <span>{COMMIT_HASH}</span>
      {emailDebugMode && (
        <span className="rounded bg-warning-bg px-2 py-0.5 font-semibold text-warning">
          Modo debug activo: los emails no se envían a los huéspedes reales.
        </span>
      )}
    </footer>
  );
}
