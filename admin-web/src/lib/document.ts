import type { DocumentFields, DocumentType } from '../reservations/types';
import { formatDateTime } from './date';

export interface Country {
  code: string;
  name: string;
}

// Recognized by Intl.DisplayNames but not countries: unknown region, supranational and
// pseudo-region codes. Same list as guest-web's check-in form.
const NOT_COUNTRIES = new Set(['ZZ', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB']);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const regionNames = new Intl.DisplayNames(['es'], { type: 'region', fallback: 'none' });

// Every ISO alpha-2 code Intl recognizes, named in Spanish — the API validates passport
// countries with the same Intl check.
export const COUNTRIES: Country[] = (() => {
  const countries: Country[] = [];
  for (const first of LETTERS) {
    for (const second of LETTERS) {
      const code = first + second;
      const name = NOT_COUNTRIES.has(code) ? undefined : regionNames.of(code);
      if (name) countries.push({ code, name });
    }
  }
  return countries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
})();

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = { DNI: 'DNI', PASAPORTE: 'Pasaporte' };

export const DOCUMENT_UNREADABLE_LABEL = 'No se pudo leer el documento';

// Full document on detail views, masked in lists, and a clear notice when decryption failed.
export function formatDocument(fields: DocumentFields): string {
  if (fields.documentUnreadable) {
    return DOCUMENT_UNREADABLE_LABEL;
  }
  const document = fields.document;
  if (document) {
    return document.type === 'DNI'
      ? `DNI ${document.number}`
      : `Pasaporte ${document.number} (${regionNames.of(document.country) ?? document.country})`;
  }
  return fields.documentMasked ?? '—';
}

// A rejected document comes back as Nest's JSON 400 with the Spanish message the API's
// normalizeDocument produced — shown inline next to the document field.
export function documentErrorMessage(body: string): string {
  try {
    const { message } = JSON.parse(body) as { message?: string | string[] };
    if (message) return Array.isArray(message) ? message.join(' ') : message;
  } catch {
    // Not JSON — fall through.
  }
  return 'Documento inválido.';
}

// Mirror of the API's normalizeDocument rules, for an immediate inline error. The API still
// validates on its own.
export function documentValidationError(type: DocumentType, country: string, number: string): string | null {
  if (type === 'DNI') {
    const digits = number.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 8 ? null : 'El DNI debe tener 7 u 8 dígitos.';
  }
  const cleaned = number.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 5 || cleaned.length > 15) {
    return 'El número de pasaporte debe tener entre 5 y 15 letras o números.';
  }
  return country ? null : 'Elegí el país emisor del pasaporte.';
}

export function formatMarketingConsent(consentAt: string | null | undefined): string {
  return consentAt ? `Aceptó recibir promociones el ${formatDateTime(consentAt)}` : 'Sin consentimiento';
}
