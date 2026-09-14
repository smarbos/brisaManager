# Screenshot-Based Reservation Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff upload or paste a screenshot of a Booking.com reservation's detail page into the "New reservation" form, OCR it, and pre-fill the form's fields — staff still review and save manually, exactly as they already do for a fully manual entry.

**Architecture:** A new NestJS module (`api/src/reservation-import/`) runs `tesseract.js` OCR against an in-memory image upload and parses the result with regex rules already calibrated against real OCR output, returning whatever fields it could confidently extract (`null` for the rest). `admin-web`'s existing "New reservation" form gets a file/paste input that calls this endpoint and merges non-null results into its own state, never overwriting a field the user already typed.

**Tech Stack:** NestJS, `tesseract.js` (OCR), `multer` memory storage (already a transitive dependency via `@nestjs/platform-express`), React, Vitest/RTL (unchanged).

**Spec:** `docs/superpowers/specs/2026-09-14-screenshot-reservation-import-design.md`

## Global Constraints

- `tesseract.js` pinned to `7.0.0`; `@types/multer` (dev) pinned to `2.2.0` — matches the already-installed `multer@2.2.0` transitive runtime version exactly.
- No new image storage of any kind — the upload is processed via `multer`'s in-memory storage engine (`memoryStorage()`) and the buffer is discarded once OCR finishes. No disk write, no new Prisma model, no new migration.
- Upload size limit: 10 MB (`10 * 1024 * 1024` bytes). Non-image MIME types are rejected by the controller's `fileFilter`, never reach the service.
- The extraction endpoint never returns a 500 for a bad/unreadable image — a failure inside the service is caught by the controller and turned into a `BadRequestException` (400). A field the parser can't confidently match is `null` in a normal (200) response, never guessed.
- Exact parsing regexes (all applied to the full OCR text, not line-by-line — see the spec's "Data extracted" section for why):
  - Reservation ID: `\b(\d{8,12})\b` — first match found, searched line-by-line to also locate the guest name (see below).
  - Guest name: the non-empty line immediately preceding the line where the reservation-ID pattern matched. If no ID line is found, guest name is also `null` — there is no independent fallback for it.
  - Dates: `/(lun|mar|mié|jue|vie|sáb|dom),\s*(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})/gi` — all matches in the full text, in order; first match is check-in, second is check-out.
  - Pax count: `/(\d+)\s*adultos/i` — first match.
  - `externalReference` is built as `booking-manual-<id>` (not the bare digit ID) so it can never collide with the iCal channel-sync's own UID format (`<hash>@booking.com`) under the same `@@unique([source, externalReference])` constraint.
- The import control only appears on the "New reservation" view (`!isEditing` in `ReservationFormPage.tsx`), never on the edit view.
- Merging extracted fields into the form: every field the API returns as non-null overwrites the form; every `null` field is left untouched (never clobbers something the user already typed). `source` is unconditionally set to `'BOOKING'` on any successful extraction (this feature only ever applies to Booking.com screenshots).

---

### Task 1: `parseExtractedText` and `ReservationImportService`

**Files:**
- Create: `api/src/reservation-import/reservation-import.service.ts`, `reservation-import.service.spec.ts`

**Interfaces:**
- Produces: `ExtractedReservationFields` interface (`guestName`, `checkIn`, `checkOut`, `paxCount`, `externalReference`, all `string | null` except `paxCount: number | null`), `parseExtractedText(text: string): ExtractedReservationFields` (pure function, exported for direct testing), `ReservationImportService.extractFromScreenshot(buffer: Buffer): Promise<ExtractedReservationFields>` — consumed by Task 2's controller.

- [ ] **Step 1: Install `tesseract.js`**

Run:
```bash
docker compose exec api npm install tesseract.js@7.0.0
```
Expected: `api/package.json` gains `tesseract.js` under `dependencies`.

- [ ] **Step 2: Write the failing tests for `parseExtractedText`**

`api/src/reservation-import/reservation-import.service.spec.ts`:
```typescript
import { parseExtractedText } from './reservation-import.service';

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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec api npx jest reservation-import.service.spec.ts`
Expected: FAIL (`Cannot find module './reservation-import.service'`)

- [ ] **Step 4: Implement `parseExtractedText` and `ReservationImportService`**

`api/src/reservation-import/reservation-import.service.ts`:
```typescript
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `docker compose exec api npx jest reservation-import.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Write the failing tests for `ReservationImportService.extractFromScreenshot`**

Add to the top of `api/src/reservation-import/reservation-import.service.spec.ts` (before the existing `import`):
```typescript
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}));
```
Add these imports below the existing ones:
```typescript
import { createWorker } from 'tesseract.js';
import { ReservationImportService } from './reservation-import.service';
```
Add this new `describe` block at the end of the file:
```typescript
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
```

- [ ] **Step 7: Run it and confirm the two new tests fail**

Run: `docker compose exec api npx jest reservation-import.service.spec.ts`
Expected: the 2 new tests FAIL (`ReservationImportService` isn't exported as a class import target the mock can intercept correctly until the mock is wired — if they instead error on `Cannot find module 'tesseract.js'` or similar, that's also an acceptable RED signal); the original 6 `parseExtractedText` tests still PASS.

- [ ] **Step 8: Confirm they pass**

Run: `docker compose exec api npx jest reservation-import.service.spec.ts`
Expected: PASS (8 tests total) — the implementation from Step 4 already satisfies these; this step is only confirming the mock wiring works, not writing new production code.

- [ ] **Step 9: Commit**

```bash
git add api/package.json api/package-lock.json api/src/reservation-import
git commit -m "Add screenshot OCR parsing service for reservation import"
```

---

### Task 2: `ReservationImportController` and module wiring

**Files:**
- Create: `api/src/reservation-import/reservation-import.controller.ts`, `reservation-import.module.ts`
- Modify: `api/src/app.module.ts`
- Create: `api/test/reservation-import.e2e-spec.ts`

**Interfaces:**
- Consumes: `ReservationImportService.extractFromScreenshot(buffer: Buffer): Promise<ExtractedReservationFields>` (Task 1).
- Produces: `POST /reservation-import/parse-screenshot` (JWT-guarded, multipart file upload, field name `file`) — consumed by Task 3's frontend API client.

- [ ] **Step 1: Install `@types/multer`**

Run:
```bash
docker compose exec api npm install -D @types/multer@2.2.0
```
Expected: `api/package.json` gains `@types/multer` under `devDependencies`.

- [ ] **Step 2: Implement the controller**

`api/src/reservation-import/reservation-import.controller.ts`:
```typescript
import { BadRequestException, Controller, HttpCode, HttpStatus, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExtractedReservationFields, ReservationImportService } from './reservation-import.service';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('reservation-import')
export class ReservationImportController {
  constructor(private readonly reservationImportService: ReservationImportService) {}

  @Post('parse-screenshot')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          callback(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async parseScreenshot(@UploadedFile() file: Express.Multer.File): Promise<ExtractedReservationFields> {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    try {
      return await this.reservationImportService.extractFromScreenshot(file.buffer);
    } catch {
      throw new BadRequestException('Could not process the uploaded image');
    }
  }
}
```

`api/src/reservation-import/reservation-import.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReservationImportController } from './reservation-import.controller';
import { ReservationImportService } from './reservation-import.service';

@Module({
  controllers: [ReservationImportController],
  providers: [ReservationImportService],
})
export class ReservationImportModule {}
```

Modify `api/src/app.module.ts`: add the import `import { ReservationImportModule } from './reservation-import/reservation-import.module';` and add `ReservationImportModule` to the `imports` array, alongside `CampaignsModule`.

- [ ] **Step 3: Write the e2e test**

`api/test/reservation-import.e2e-spec.ts`:
```typescript
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { createWorker } from 'tesseract.js';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ReservationImportController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    (createWorker as jest.Mock).mockResolvedValue({
      recognize: jest.fn().mockResolvedValue({
        data: { text: 'Jane Doe\n5459856627 Genius\nvie, 6 nov 2026 dom, 8 nov 2026\n3 adultos' },
      }),
      terminate: jest.fn().mockResolvedValue(undefined),
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-reservation-import@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservation-import@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/reservation-import/parse-screenshot')
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'screenshot.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('extracts reservation fields from an uploaded screenshot', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservation-import/parse-screenshot')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'screenshot.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(response.body).toEqual({
      guestName: 'Jane Doe',
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });
  });
});
```

**Do not use the user's real screenshot image anywhere in this repo** — it's real guest PII and is `.gitignore`d for that reason. The `Buffer.from('fake-image-bytes')` content above is sufficient because the OCR call itself is mocked; the controller never actually decodes the bytes as an image in this test.

- [ ] **Step 4: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS, including the 2 new e2e tests

- [ ] **Step 5: Commit**

```bash
git add api/package.json api/package-lock.json api/src/reservation-import api/src/app.module.ts api/test/reservation-import.e2e-spec.ts
git commit -m "Add reservation-import endpoint (screenshot upload -> extracted fields)"
```

---

### Task 3: admin-web API client (`upload` helper + `parseScreenshot`)

**Files:**
- Modify: `admin-web/src/api/client.ts`, `client.test.ts`
- Create: `admin-web/src/api/reservation-import.ts`

**Interfaces:**
- Produces: `apiClient.upload<T>(path: string, formData: FormData): Promise<T>`, `parseScreenshot(file: File): Promise<ExtractedReservationFields>` (re-declaring the same shape as the backend's `ExtractedReservationFields`, since this is a separate frontend package with no shared types) — consumed by Task 4.

- [ ] **Step 1: Write the failing tests for `apiClient.upload`**

Add to `admin-web/src/api/client.test.ts`, as a new `describe` block after the existing `apiClient.request` one:
```typescript
describe('apiClient.upload', () => {
  it('attaches the auth header and does not force a Content-Type, letting the browser set the multipart boundary', async () => {
    localStorage.setItem('accessToken', 'a-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const formData = new FormData();

    await apiClient.upload('/reservation-import/parse-screenshot', formData);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({ Authorization: 'Bearer a-token' });
    expect(options.body).toBe(formData);
  });

  it('drops an expired token when the API answers 401', async () => {
    window.history.pushState({}, '', '/login');
    localStorage.setItem('accessToken', 'expired-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })));

    await expect(apiClient.upload('/reservation-import/parse-screenshot', new FormData())).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(localStorage.getItem('accessToken')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/api/client.test.ts`
Expected: FAIL (`apiClient.upload is not a function`)

- [ ] **Step 3: Refactor `client.ts` to add `upload`, sharing response handling with `request`**

Replace the entire contents of `admin-web/src/api/client.ts`:
```typescript
const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();

    if (response.status === 401) {
      // The token is missing, invalid or expired: drop it and send the user back to
      // the login page. This lives outside React Router, hence the full-page redirect.
      localStorage.removeItem('accessToken');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    throw new ApiError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  return handleResponse<T>(response);
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem('accessToken');

  // No Content-Type header here: the browser must set multipart/form-data with the
  // correct boundary itself, which it can only do when the header is left unset.
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  return handleResponse<T>(response);
}

export async function login(email: string, password: string): Promise<{ accessToken: string }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export const apiClient = { request, upload };
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec admin-web npx vitest run src/api/client.test.ts`
Expected: PASS (4 tests total)

- [ ] **Step 5: Add the `parseScreenshot` API client function**

`admin-web/src/api/reservation-import.ts`:
```typescript
import { apiClient } from './client';

export interface ExtractedReservationFields {
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  paxCount: number | null;
  externalReference: string | null;
}

export function parseScreenshot(file: File): Promise<ExtractedReservationFields> {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.upload('/reservation-import/parse-screenshot', formData);
}
```

- [ ] **Step 6: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/api/client.ts admin-web/src/api/client.test.ts admin-web/src/api/reservation-import.ts
git commit -m "Add apiClient.upload and the reservation-import API client"
```

---

### Task 4: `ReservationFormPage` screenshot import control

**Files:**
- Modify: `admin-web/src/reservations/ReservationFormPage.tsx`, `ReservationFormPage.test.tsx`

**Interfaces:**
- Consumes: `parseScreenshot(file: File): Promise<ExtractedReservationFields>` (Task 3).

- [ ] **Step 1: Write the failing tests**

Add to `admin-web/src/reservations/ReservationFormPage.test.tsx`. First, add this import alongside the existing ones:
```typescript
import * as reservationImportApi from '../api/reservation-import';
```
Then add these three tests inside the existing `describe('ReservationFormPage', ...)` block, anywhere after the `'submits a new reservation'` test:
```typescript
  it('imports fields from a screenshot and pre-fills the form', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockResolvedValue({
      guestName: 'Weber Clara',
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/nombre del huésped/i)).toHaveValue('Weber Clara'));
    expect(screen.getByLabelText(/check-in/i)).toHaveValue('2026-11-06');
    expect(screen.getByLabelText(/check-out/i)).toHaveValue('2026-11-08');
    expect(screen.getByLabelText(/huéspedes/i)).toHaveValue(3);
  });

  it('does not overwrite a field the user already typed when the extraction returns null for it', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockResolvedValue({
      guestName: null,
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/nombre del huésped/i), { target: { value: 'Ya escrito' } });

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/check-in/i)).toHaveValue('2026-11-06'));
    expect(screen.getByLabelText(/nombre del huésped/i)).toHaveValue('Ya escrito');
  });

  it('shows a fallback notice when the import fails', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockRejectedValue(new Error('network error'));

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos leer los datos de la captura/i);
  });
```

- [ ] **Step 2: Run it and confirm the 3 new tests fail**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: the 3 new tests FAIL (the import control doesn't exist yet); all pre-existing tests in the file still PASS.

- [ ] **Step 3: Add the import control to `ReservationFormPage.tsx`**

Modify the import block at the top of `admin-web/src/reservations/ReservationFormPage.tsx` — change:
```typescript
import { FormEvent, useEffect, useState } from 'react';
```
to:
```typescript
import { ChangeEvent, ClipboardEvent, FormEvent, useEffect, useState } from 'react';
```
Add this new import alongside the existing `../lib/labels` one:
```typescript
import { parseScreenshot } from '../api/reservation-import';
```

Add two new state declarations right after the existing `const [overlaps, setOverlaps] = useState<Reservation[]>([]);` line:
```typescript
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
```

Add these three new functions right after `copyGuestLink()` (before `handleSubmit`):
```typescript
  async function applyExtractedFields(file: File) {
    setImportError(null);
    setImporting(true);
    try {
      const extracted = await parseScreenshot(file);
      setForm((prev) => ({
        ...prev,
        guestName: extracted.guestName ?? prev.guestName,
        checkIn: extracted.checkIn ?? prev.checkIn,
        checkOut: extracted.checkOut ?? prev.checkOut,
        paxCount: extracted.paxCount ?? prev.paxCount,
        externalReference: extracted.externalReference ?? prev.externalReference,
        source: 'BOOKING',
      }));
    } catch {
      setImportError('No pudimos leer los datos de la captura — completá el formulario manualmente.');
    } finally {
      setImporting(false);
    }
  }

  function handleScreenshotFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      void applyExtractedFields(file);
    }
  }

  function handleScreenshotPaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      void applyExtractedFields(file);
    }
  }
```

Add the import control's JSX right after the `<h1>` heading and before the `{overlaps.length > 0 && (...)}` block:
```tsx
        {!isEditing && (
          <div
            tabIndex={0}
            onPaste={handleScreenshotPaste}
            className="flex flex-col gap-2 rounded border border-dashed border-border p-4"
          >
            <FormField label="Importar desde captura de Booking.com">
              <input
                type="file"
                accept="image/*"
                onChange={handleScreenshotFileChange}
                disabled={importing}
                className="text-sm text-text"
              />
            </FormField>
            <p className="text-xs text-text-muted">
              También podés pegar una captura copiada (Ctrl+V) haciendo clic acá primero.
            </p>
            {importing && <p className="text-sm text-text-muted">Leyendo captura...</p>}
            {importError && <Alert>{importError}</Alert>}
          </div>
        )}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: PASS (all original tests + the 3 new ones)

- [ ] **Step 5: Run the full admin-web suite and build**

Run:
```bash
docker compose exec admin-web npm test
docker compose exec admin-web npm run build
```
Expected: all suites PASS, build succeeds — this is the last task, a final check before the whole-branch review.

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/reservations/ReservationFormPage.tsx admin-web/src/reservations/ReservationFormPage.test.tsx
git commit -m "Add screenshot import control to the New Reservation form"
```
