import { describe, expect, it } from 'vitest';
import { parseSoundAlertWindows, serializeSoundAlertWindows } from './sound-alert-windows';

describe('parseSoundAlertWindows', () => {
  it('returns no rows for an empty string', () => {
    expect(parseSoundAlertWindows('')).toEqual([]);
    expect(parseSoundAlertWindows('   ')).toEqual([]);
  });

  it('parses a single range into one row', () => {
    expect(parseSoundAlertWindows('22:00-08:00')).toEqual([{ start: '22:00', end: '08:00' }]);
  });

  it('parses multiple comma-separated ranges into multiple rows', () => {
    expect(parseSoundAlertWindows('22:00-08:00,13:00-15:00')).toEqual([
      { start: '22:00', end: '08:00' },
      { start: '13:00', end: '15:00' },
    ]);
  });

  it('trims whitespace around each range', () => {
    expect(parseSoundAlertWindows(' 22:00-08:00 , 13:00-15:00 ')).toEqual([
      { start: '22:00', end: '08:00' },
      { start: '13:00', end: '15:00' },
    ]);
  });
});

describe('serializeSoundAlertWindows', () => {
  it('returns an empty string for no rows', () => {
    expect(serializeSoundAlertWindows([])).toBe('');
  });

  it('serializes one row', () => {
    expect(serializeSoundAlertWindows([{ start: '22:00', end: '08:00' }])).toBe('22:00-08:00');
  });

  it('serializes multiple rows, comma-separated', () => {
    expect(
      serializeSoundAlertWindows([
        { start: '22:00', end: '08:00' },
        { start: '13:00', end: '15:00' },
      ]),
    ).toBe('22:00-08:00,13:00-15:00');
  });

  it('drops a row missing a start or end value', () => {
    expect(
      serializeSoundAlertWindows([
        { start: '22:00', end: '08:00' },
        { start: '', end: '' },
        { start: '13:00', end: '' },
      ]),
    ).toBe('22:00-08:00');
  });

  it('round-trips through parse and back', () => {
    const original = '22:00-08:00,13:00-15:00';
    expect(serializeSoundAlertWindows(parseSoundAlertWindows(original))).toBe(original);
  });
});
