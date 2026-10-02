import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

// Pure functions behind the guest identity document (see
// docs/superpowers/specs/2026-09-29-guest-identity-document-design.md, section 2). Every write
// path normalizes first, so hashing and encryption always see the same canonical value no
// matter how the guest or staff typed it.

export type GuestDocumentType = 'DNI' | 'PASAPORTE';

export interface DocumentInput {
  type: GuestDocumentType;
  country?: string | null;
  number: string;
}

export interface NormalizedDocument {
  type: GuestDocumentType;
  country: string;
  number: string;
}

export interface DocumentKeys {
  encryptionKey: Buffer;
  hashKey: Buffer;
}

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const STORED_VERSION = 'v1';

// fallback 'none' makes an unrecognized code come back undefined instead of echoing the code.
const regionNames = new Intl.DisplayNames(['es'], { type: 'region', fallback: 'none' });

// ZZ is ICU's "unknown region" — recognized by DisplayNames, but not a real country.
function isKnownCountry(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && regionNames.of(code) !== undefined;
}

export function normalizeDocument(input: DocumentInput): NormalizedDocument {
  if (input.type === 'DNI') {
    const number = (input.number ?? '').replace(/\D/g, '');
    if (number.length < 7 || number.length > 8) {
      throw new BadRequestException('El DNI debe tener 7 u 8 dígitos.');
    }
    return { type: 'DNI', country: 'AR', number };
  }

  if (input.type === 'PASAPORTE') {
    const number = (input.number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (number.length < 5 || number.length > 15) {
      throw new BadRequestException('El número de pasaporte debe tener entre 5 y 15 letras o números.');
    }
    const country = (input.country ?? '').trim().toUpperCase();
    if (!isKnownCountry(country)) {
      throw new BadRequestException('Elegí el país emisor del pasaporte.');
    }
    return { type: 'PASAPORTE', country, number };
  }

  throw new BadRequestException('Tipo de documento inválido.');
}

export function hashDocument(document: NormalizedDocument, hashKey: Buffer): string {
  return createHmac('sha256', hashKey).update(`${document.type}|${document.country}|${document.number}`).digest('hex');
}

export function encryptDocumentNumber(number: string, encryptionKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(number, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [STORED_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

// Throws on a wrong key, tampered data or an unknown version — callers turn that into
// `documentUnreadable` rather than a failed request.
export function decryptDocumentNumber(stored: string, encryptionKey: Buffer): string {
  const [version, iv, tag, ciphertext, ...rest] = stored.split(':');
  if (version !== STORED_VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error('Unrecognized stored document format');
  }
  const decipher = createDecipheriv(CIPHER, encryptionKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function maskDocument(document: NormalizedDocument): string {
  const tail = document.number.slice(-3);
  return document.type === 'DNI' ? `DNI ···${tail}` : `PASAPORTE (${document.country}) ···${tail}`;
}

function parseKey(env: Record<string, string | undefined>, name: string): Buffer {
  const value = env[name]?.trim();
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be set to 64 hex characters (32 bytes) — generate one with: openssl rand -hex 32`);
  }
  return Buffer.from(value, 'hex');
}

export function parseDocumentKeys(env: Record<string, string | undefined>): DocumentKeys {
  const encryptionKey = parseKey(env, 'DOCUMENT_ENCRYPTION_KEY');
  const hashKey = parseKey(env, 'DOCUMENT_HASH_KEY');
  if (encryptionKey.equals(hashKey)) {
    throw new Error('DOCUMENT_ENCRYPTION_KEY and DOCUMENT_HASH_KEY must be distinct keys');
  }
  return { encryptionKey, hashKey };
}
