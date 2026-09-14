import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';

export interface ExtractedReservationFields {
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  paxCount: number | null;
  externalReference: string | null;
}

const MONTHS: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

// Both patterns are matched against the FULL OCR text, not line-by-line — real OCR output
// merges visually side-by-side elements onto shared lines (e.g. both dates on one line, or
// an icon-row's text bleeding into the next), so a global match is the only reliable way to
// find these patterns regardless of what surrounds them. See the design spec's "Data
// extracted" section for the real captured OCR text this was calibrated against.
const DATE_PATTERN =
  /(lun|mar|mié|jue|vie|sáb|dom),\s*(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})/gi;
const ID_PATTERN = /\b(\d{8,12})\b/;
const PAX_PATTERN = /(\d+)\s*adultos/i;

function toIsoDate(match: RegExpMatchArray): string {
  const day = match[2].padStart(2, '0');
  const month = String(MONTHS[match[3].toLowerCase()]).padStart(2, '0');
  return `${match[4]}-${month}-${day}`;
}

export function parseExtractedText(text: string): ExtractedReservationFields {
  const lines = text.split('\n');

  let guestName: string | null = null;
  let externalReference: string | null = null;
  const idLineIndex = lines.findIndex((line) => ID_PATTERN.test(line));
  if (idLineIndex !== -1) {
    const idMatch = lines[idLineIndex].match(ID_PATTERN) as RegExpMatchArray;
    externalReference = `booking-manual-${idMatch[1]}`;
    // The guest's name appears twice in the screenshot (nav bar + heading) — the line
    // directly above the reservation-ID line is always the heading occurrence, never the
    // nav bar's, so anchoring off the ID's position picks the right one without needing
    // any positional/pixel information OCR text alone doesn't carry.
    for (let i = idLineIndex - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        guestName = lines[i].trim();
        break;
      }
    }
  }

  const dateMatches = [...text.matchAll(DATE_PATTERN)];
  const checkIn = dateMatches[0] ? toIsoDate(dateMatches[0]) : null;
  const checkOut = dateMatches[1] ? toIsoDate(dateMatches[1]) : null;

  const paxMatch = text.match(PAX_PATTERN);
  const paxCount = paxMatch ? Number(paxMatch[1]) : null;

  return { guestName, checkIn, checkOut, paxCount, externalReference };
}

@Injectable()
export class ReservationImportService {
  async extractFromScreenshot(buffer: Buffer): Promise<ExtractedReservationFields> {
    const worker = await createWorker('spa');
    try {
      const {
        data: { text },
      } = await worker.recognize(buffer);
      return parseExtractedText(text);
    } finally {
      await worker.terminate();
    }
  }
}
