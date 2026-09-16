import { useEffect, useState } from 'react';
import { getConfig } from './api/config';

export function DebugModeBanner() {
  const [emailDebugMode, setEmailDebugMode] = useState(false);

  useEffect(() => {
    getConfig()
      .then((config) => setEmailDebugMode(config.emailDebugMode))
      .catch(() => setEmailDebugMode(false));
  }, []);

  if (!emailDebugMode) {
    return null;
  }

  return (
    <div className="bg-warning-bg text-warning px-3 py-2 text-center text-sm">
      Modo debug activo: los emails no se envían a los huéspedes reales.
    </div>
  );
}
