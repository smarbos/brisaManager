import { useEffect, useRef } from 'react';

interface LightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Imagen'}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Cerrar"
        className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface text-xl text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt ?? 'Comprobante de pago'}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded object-contain"
      />
    </div>
  );
}
