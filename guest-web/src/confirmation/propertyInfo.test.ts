import { describe, expect, it } from 'vitest';
import { parsePropertyContacts } from './propertyInfo';

describe('parsePropertyContacts', () => {
  it('parses "Name:phone" entries separated by semicolons', () => {
    expect(parsePropertyContacts('Ana:+54 9 223 555-0101; Lucía : +54 9 223 555-0102')).toEqual([
      { name: 'Ana', phone: '+54 9 223 555-0101' },
      { name: 'Lucía', phone: '+54 9 223 555-0102' },
    ]);
  });

  it('returns no contacts when unset, and skips malformed entries', () => {
    expect(parsePropertyContacts(undefined)).toEqual([]);
    expect(parsePropertyContacts('')).toEqual([]);
    expect(parsePropertyContacts('no-phone;:+54 9 223 555-0101;Ana:+54 9 223 555-0101')).toEqual([
      { name: 'Ana', phone: '+54 9 223 555-0101' },
    ]);
  });
});
