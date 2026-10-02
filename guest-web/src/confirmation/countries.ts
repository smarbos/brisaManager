// Passport issuing countries for the check-in form: every ISO 3166-1 alpha-2 code the browser's
// Intl data recognizes, named in Spanish and sorted by name. Built from Intl rather than a
// hand-kept list so it matches what the API accepts (it validates with the same Intl check).

export interface Country {
  code: string;
  name: string;
}

// Recognized by Intl.DisplayNames but not countries: unknown region, supranational and
// pseudo-region codes.
const NOT_COUNTRIES = new Set(['ZZ', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB']);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function buildCountries(): Country[] {
  const names = new Intl.DisplayNames(['es'], { type: 'region', fallback: 'none' });
  const countries: Country[] = [];
  for (const first of LETTERS) {
    for (const second of LETTERS) {
      const code = first + second;
      const name = NOT_COUNTRIES.has(code) ? undefined : names.of(code);
      if (name) {
        countries.push({ code, name });
      }
    }
  }
  return countries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export const COUNTRIES: Country[] = buildCountries();

export type DocumentType = 'DNI' | 'PASAPORTE';

// Client-side mirror of the API's normalizeDocument rules, for an immediate inline error. The
// API still validates on its own; this only saves a round-trip.
export function documentError(type: DocumentType, country: string, number: string): string | null {
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
