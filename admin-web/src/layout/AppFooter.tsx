import { useEffect, useState } from 'react';
import { getConfig } from '../api/config';

// Fixed to the bottom of the viewport (not just appended after page content) so the debug
// warning stays visible even while scrolling, instead of being easy to scroll past — see
// PageContainer's bottom padding, which reserves space so this never covers page content.
export function AppFooter() {
  const [debugMode, setDebugMode] = useState(false);
  // null until /config responds — the API version isn't known at build time like the
  // client's own, so it's just left out of the label rather than shown as a placeholder.
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then((config) => {
        setDebugMode(config.debugMode);
        setApiVersion(config.version);
      })
      .catch(() => setDebugMode(false));
  }, []);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-3 py-1.5 text-xs text-text-muted sm:left-[252px]">
      <span>
        v{__APP_VERSION__}
        {apiVersion && ` · API v${apiVersion}`}
      </span>
      {debugMode && (
        <span className="rounded bg-warning-bg px-2 py-0.5 font-semibold text-warning">
          Modo debug activo: los emails no se envían a los huéspedes reales y los sensores son visibles para cualquier reserva.
        </span>
      )}
    </footer>
  );
}
