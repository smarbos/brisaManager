jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}));

import { parseExtractedText } from './reservation-import.service';
import { createWorker } from 'tesseract.js';
import { ReservationImportService } from './reservation-import.service';

// Captured verbatim from a real tesseract.js('spa') run against a real Booking.com
// reservation-detail screenshot — see the design spec's "Data extracted" section.
const REAL_SAMPLE_OCR_TEXT = `3:02 O Cd $ MX Y + N e 29 il 29% E
Weber Clara
< SS
La Brisa
Weber Clara
5459856627 Genius
O)
la SS O
Datos del Contactar Enviar mensaje
cliente
Check-in Check-out
vie, 6 nov 2026 dom, 8 nov 2026
No se ha especificado
hora
Solicitar cambio de fechas
2 Apartamento de 2
E: 2 noches — dormitorios
22 3 adultos
1 habitación
Anartamanta da 7? darmitarino
HI e <`;

describe('parseExtractedText', () => {
  it('extracts every field from a real captured screenshot OCR text', () => {
    expect(parseExtractedText(REAL_SAMPLE_OCR_TEXT)).toEqual({
      guestName: 'Weber Clara',
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });
  });

  it('returns null for guestName and externalReference when no reservation-ID line is found', () => {
    const text =
      'Some unrelated text\nwith no digit run of the right length\nvie, 6 nov 2026 dom, 8 nov 2026\n3 adultos';

    const result = parseExtractedText(text);

    expect(result.externalReference).toBeNull();
    expect(result.guestName).toBeNull();
    expect(result.checkIn).toBe('2026-11-06');
    expect(result.checkOut).toBe('2026-11-08');
    expect(result.paxCount).toBe(3);
  });

  it('returns null for paxCount when no "adultos" text is found', () => {
    const text = 'Jane Doe\n5459856627 Genius\nvie, 6 nov 2026 dom, 8 nov 2026';

    expect(parseExtractedText(text).paxCount).toBeNull();
  });

  it('returns a check-in with a null check-out when only one date is found', () => {
    const text = 'Jane Doe\n5459856627 Genius\nvie, 6 nov 2026\n3 adultos';

    const result = parseExtractedText(text);

    expect(result.checkIn).toBe('2026-11-06');
    expect(result.checkOut).toBeNull();
  });

  it('returns null for both dates when no date pattern is found', () => {
    const text = 'Jane Doe\n5459856627 Genius\n3 adultos';

    const result = parseExtractedText(text);

    expect(result.checkIn).toBeNull();
    expect(result.checkOut).toBeNull();
  });

  it('returns every field null for empty text', () => {
    expect(parseExtractedText('')).toEqual({
      guestName: null,
      checkIn: null,
      checkOut: null,
      paxCount: null,
      externalReference: null,
    });
  });
});

describe('ReservationImportService', () => {
  let service: ReservationImportService;
  let recognizeMock: jest.Mock;
  let terminateMock: jest.Mock;

  beforeEach(() => {
    service = new ReservationImportService();
    recognizeMock = jest.fn();
    terminateMock = jest.fn().mockResolvedValue(undefined);
    (createWorker as jest.Mock).mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });
  });

  it('runs OCR against the buffer with the Spanish language pack and parses the resulting text', async () => {
    recognizeMock.mockResolvedValue({
      data: { text: 'Jane Doe\n5459856627 Genius\nvie, 6 nov 2026 dom, 8 nov 2026\n3 adultos' },
    });

    const result = await service.extractFromScreenshot(Buffer.from('fake-image-bytes'));

    expect(createWorker).toHaveBeenCalledWith('spa');
    expect(recognizeMock).toHaveBeenCalledWith(expect.any(Buffer));
    expect(result.guestName).toBe('Jane Doe');
    expect(terminateMock).toHaveBeenCalled();
  });

  it('still terminates the worker when recognize() throws', async () => {
    recognizeMock.mockRejectedValue(new Error('OCR engine crashed'));

    await expect(service.extractFromScreenshot(Buffer.from('fake-image-bytes'))).rejects.toThrow(
      'OCR engine crashed',
    );

    expect(terminateMock).toHaveBeenCalled();
  });
});
