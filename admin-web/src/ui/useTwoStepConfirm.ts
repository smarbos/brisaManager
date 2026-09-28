import { useEffect, useRef, useState } from 'react';

const DEFAULT_ARMED_LABEL = '¿Seguro? Tocá de nuevo';
const DEFAULT_TIMEOUT_MS = 3000;

// Replaces a native window.confirm() dialog for a destructive/impactful action with an
// inline "click again to confirm" affordance on the button itself: the first click arms it
// (swapping its label) instead of firing immediately, and either a second click within
// timeoutMs confirms, or it quietly disarms on its own. Used for actions like cancelling a
// reservation or testing the ambient-control siren.
export function useTwoStepConfirm(action: () => void, options: { armedLabel?: string; timeoutMs?: number } = {}) {
  const { armedLabel = DEFAULT_ARMED_LABEL, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleClick() {
    if (armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setArmed(false);
      action();
      return;
    }
    setArmed(true);
    timerRef.current = setTimeout(() => setArmed(false), timeoutMs);
  }

  return { armed, armedLabel, handleClick };
}
