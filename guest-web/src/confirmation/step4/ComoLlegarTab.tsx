import { useState } from 'react';
import { PROPERTY_ADDRESS, PROPERTY_CONTACTS, PROPERTY_MAPS_URL } from '../propertyInfo';

function MapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function ComoLlegarTab() {
  const [copied, setCopied] = useState(false);

  function handleCopyAddress() {
    navigator.clipboard
      ?.writeText(PROPERTY_ADDRESS)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Cómo llegar</h3>
      <p className="mt-1 text-sm text-text-muted">
        Guardá la dirección y avisanos tu horario estimado de llegada por WhatsApp.
      </p>

      <div className="mt-4 rounded-lg bg-bg p-4">
        <p className="text-xs text-text-muted">Dirección</p>
        <p className="mt-1 font-heading text-lg font-medium text-heading">{PROPERTY_ADDRESS}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={PROPERTY_MAPS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
          >
            <MapIcon />
            Abrir en Google Maps
          </a>
          <button
            type="button"
            onClick={handleCopyAddress}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded border border-border bg-surface px-4 py-2 text-sm font-semibold text-text"
          >
            <CopyIcon />
            {copied ? 'Copiada' : 'Copiar dirección'}
          </button>
        </div>
      </div>

      {PROPERTY_CONTACTS.length > 0 && (
        <>
          <h4 className="mt-6 text-xs font-bold uppercase tracking-wide text-text-muted">¿Necesitás ayuda para entrar?</h4>
          <div className="mt-2 flex flex-col">
            {PROPERTY_CONTACTS.map((contact) => {
              const digits = contact.phone.replace(/\D/g, '');
              return (
                <div
                  key={contact.name}
                  className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <div>
                    <p className="font-semibold text-heading">{contact.name}</p>
                    <p className="text-sm text-text-muted">{contact.phone}</p>
                  </div>
                  <a
                    href={`https://wa.me/${digits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-11 shrink-0 rounded-full bg-success-bg px-3 py-2 text-sm font-semibold text-success"
                  >
                    WhatsApp
                  </a>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
