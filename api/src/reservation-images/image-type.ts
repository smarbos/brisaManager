// Receipt uploads are identified by their actual leading bytes, never by the client-sent
// Content-Type or filename: both are attacker-controlled, and trusting "image/*" let an SVG
// (which can carry <script>) through and get served back as image/svg+xml. Only raster
// formats a phone camera or screenshot actually produces are accepted.
export interface DetectedImageType {
  mimeType: string;
  extension: string;
}

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (
    buffer.length >= 6 &&
    ['GIF87a', 'GIF89a'].includes(buffer.toString('latin1', 0, 6))
  ) {
    return { mimeType: 'image/gif', extension: '.gif' };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 4, 8) === 'ftyp' &&
    HEIF_BRANDS.has(buffer.toString('latin1', 8, 12))
  ) {
    return { mimeType: 'image/heic', extension: '.heic' };
  }
  return null;
}

const SERVABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
]);

// Rows uploaded before magic-byte detection existed may carry any client-claimed image/*
// type (image/svg+xml included) — those are served as an opaque download instead of
// something a browser would render or execute.
export function isServableMimeType(mimeType: string): boolean {
  return SERVABLE_MIME_TYPES.has(mimeType);
}
