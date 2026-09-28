# Guest Check-in Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin guest-web's check-in flow to match a user-provided mockup, restructure step 4 into a tabbed view (Pago/Cómo llegar/La zona/Sensores), and give sound/CO/smoke readings a clear Ideal/Alto status chip.

**Architecture:** Evolve guest-web's existing Tailwind `@theme` token system (colors/fonts) in place rather than importing a parallel styling system. Extract step 4 into `confirmation/step4/` — one file per tab, plus a `Step4Confirmation` shell owning tab state — and extract the bank-details markup shared by step 3 and the new Pago tab into `confirmation/BankDetails.tsx`. All tab panels render eagerly (toggled via the `hidden` attribute, not mount/unmount) so existing ambient-visibility tests keep working unchanged.

**Tech Stack:** React + TypeScript, Tailwind CSS v4 (`@theme`), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-guest-checkin-redesign-design.md`

## Global Constraints

- guest-web only — no backend or firmware changes anywhere in this plan.
- Fonts: Fraunces (heading) + Work Sans (body), loaded via Google Fonts in `index.html`.
- No dark-mode support is added (guest-web has none today and no toggle exists).
- `propertyInfo.ts`'s content (address, Maps URL, contacts, zone places) is the property's real business data taken verbatim from the mockup — not placeholder text to fill in later.
- Temperature and humidity readings never get an Ideal/Alto chip, permanently — only sensors with a non-null `threshold` do.
- The sensor gauge's bar width is `threshold * 2` for every sensor that has one (sound, CO, smoke) — no sensor-name-specific logic.
- All commits use `git commit -m "$(cat <<'EOF' ... EOF)"` ending with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Run tests via `docker compose exec guest-web npx vitest run <path>` (this repo has no local Node — everything runs through the docker compose services).

---

### Task 1: Visual design tokens

**Files:**
- Modify: `guest-web/src/index.css`
- Modify: `guest-web/index.html`

**Interfaces:**
- Consumes: nothing (pure CSS/HTML).
- Produces: updated `--color-*`/`--font-*` custom properties that every later task's Tailwind utility classes (`bg-zone`, `text-driftwood`, `bg-accent`, etc.) rely on.

- [ ] **Step 1: Replace `index.css`'s `@theme` block and font stack**

Replace the entire contents of `guest-web/src/index.css` with:

```css
@import "tailwindcss";

@theme {
  --color-bg: #F1EDE3;
  --color-surface: #ffffff;
  --color-border: #DCD5C3;
  --color-text: #1C2B30;
  --color-text-muted: #4B5D62;
  --color-heading: #1C2B30;
  --color-accent: #2C4E52;
  --color-accent-hover: #214448;
  --color-accent-fg: #ffffff;
  --color-danger: #c0392b;
  --color-danger-bg: #fdecea;
  --color-success: #3F6B44;
  --color-success-bg: #E7EFE3;
  --color-warning: #93672A;
  --color-warning-bg: #F6EBD9;
  --color-zone: #D6E6E3;
  --color-driftwood: #B0824F;
  --font-sans: "Work Sans", sans-serif;
  --font-heading: "Fraunces", serif;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}

/* Native <button> elements don't get a pointer cursor by default the way links do — this
   covers any raw button/role="button" outside the shared Button component (which already
   sets cursor-pointer directly) without having to remember it on every one-off button. */
a,
button:not(:disabled),
[role='button']:not([aria-disabled='true']) {
  cursor: pointer;
}
```

- [ ] **Step 2: Swap the Google Fonts link in `index.html`**

In `guest-web/index.html`, replace the `<link href="https://fonts.googleapis.com/css2?family=Inter...` line with:

```html
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 3: Run the full guest-web test suite to confirm nothing broke**

Run: `docker compose exec guest-web npx vitest run`
Expected: PASS, same test count as before this change (this task touches no component text or structure, only colors/fonts).

- [ ] **Step 4: Commit**

```bash
git add guest-web/src/index.css guest-web/index.html
git commit -m "$(cat <<'EOF'
Update guest-web's color palette and fonts to match the check-in redesign

Swaps Playfair Display/Inter for Fraunces/Work Sans and nudges the
existing Tailwind theme's color tokens to the redesign mockup's exact
palette - the two were already close, so this is a token-level update,
not a new styling system.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract `BankDetails` and wire it into step 3

**Files:**
- Create: `guest-web/src/confirmation/BankDetails.tsx`
- Test: `guest-web/src/confirmation/BankDetails.test.tsx`
- Modify: `guest-web/src/confirmation/ConfirmationPage.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BankDetails` component — `{ accountHolder: string; cuil: string; accountNumber: string; cbu: string; alias: string; bankName: string }` props, self-contained copy-to-clipboard state. Used by this task's step 3 rewiring and by Task 5's `PagoTab`.

- [ ] **Step 1: Write `BankDetails.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BankDetails } from './BankDetails';

const props = {
  accountHolder: 'Ana Pérez',
  cuil: '20123456789',
  accountNumber: '0001234567',
  cbu: '0000003100012345678901',
  alias: 'LABRISA.DEMO.ARS',
  bankName: 'Banco Ejemplo',
};

describe('BankDetails', () => {
  it('renders every bank field', () => {
    render(<BankDetails {...props} />);

    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('20123456789')).toBeInTheDocument();
    expect(screen.getByText('0001234567')).toBeInTheDocument();
    expect(screen.getByText('0000003100012345678901')).toBeInTheDocument();
    expect(screen.getByText('LABRISA.DEMO.ARS')).toBeInTheDocument();
    expect(screen.getByText('Banco Ejemplo')).toBeInTheDocument();
  });

  it('copies the CBU and shows feedback, independently from the alias button', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    render(<BankDetails {...props} />);

    const copyButtons = screen.getAllByRole('button', { name: 'Copiar' });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(props.cbu));
    expect(await screen.findByText('¡Copiado!')).toBeInTheDocument();
    // The alias button is unaffected
    expect(screen.getAllByRole('button', { name: 'Copiar' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/BankDetails.test.tsx`
Expected: FAIL — `BankDetails.tsx` doesn't exist yet.

- [ ] **Step 3: Create `BankDetails.tsx`**

```tsx
import { useState } from 'react';

type CopyField = 'cbu' | 'alias';
type CopyStatus = 'copied' | 'failed';

function CopyButton({
  value,
  field,
  status,
  onCopy,
}: {
  value: string;
  field: CopyField;
  status: CopyStatus | null;
  onCopy: (field: CopyField, value: string) => void;
}) {
  return (
    <span role="status" aria-live="polite">
      <button
        type="button"
        onClick={() => onCopy(field, value)}
        className="min-h-11 shrink-0 rounded px-2 text-sm font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {status === 'copied' ? '¡Copiado!' : status === 'failed' ? 'No se pudo copiar' : 'Copiar'}
      </button>
    </span>
  );
}

interface BankDetailsProps {
  accountHolder: string;
  cuil: string;
  accountNumber: string;
  cbu: string;
  alias: string;
  bankName: string;
}

export function BankDetails({ accountHolder, cuil, accountNumber, cbu, alias, bankName }: BankDetailsProps) {
  const [copyStatus, setCopyStatus] = useState<Record<CopyField, CopyStatus | null>>({ cbu: null, alias: null });

  function handleCopy(field: CopyField, value: string) {
    if (!value) return;
    navigator.clipboard
      ?.writeText(value)
      .then(() => setCopyStatus((prev) => ({ ...prev, [field]: 'copied' })))
      .catch(() => setCopyStatus((prev) => ({ ...prev, [field]: 'failed' })));
    setTimeout(() => setCopyStatus((prev) => ({ ...prev, [field]: null })), 2000);
  }

  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Titular</dt>
        <dd className="font-medium text-heading">{accountHolder}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">CUIL</dt>
        <dd className="font-medium text-heading">{cuil}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Caja de ahorro en pesos</dt>
        <dd className="font-medium text-heading">{accountNumber}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">CBU</dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium text-heading">
          <span className="break-all">{cbu}</span>
          <CopyButton value={cbu} field="cbu" status={copyStatus.cbu} onCopy={handleCopy} />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Alias</dt>
        <dd className="flex flex-wrap items-center gap-2 font-medium text-heading">
          <span className="break-all">{alias}</span>
          <CopyButton value={alias} field="alias" status={copyStatus.alias} onCopy={handleCopy} />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-text-muted">Banco</dt>
        <dd className="font-medium text-heading">{bankName}</dd>
      </div>
    </dl>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/BankDetails.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire `BankDetails` into step 3, removing the now-duplicated code from `ConfirmationPage.tsx`**

In `guest-web/src/confirmation/ConfirmationPage.tsx`:

1. Add the import: `import { BankDetails } from './BankDetails';`
2. Delete these top-level declarations (they move into `BankDetails.tsx`): the `CopyField`/`CopyStatus` types, the `CopyButton` function, and — inside `ConfirmationPage()` — the `copyStatus` state (`const [copyStatus, setCopyStatus] = useState<Record<CopyField, CopyStatus | null>>({ cbu: null, alias: null });`) and the `handleCopy` function.
3. In step 3's JSX, replace this entire block:

```tsx
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Titular</dt>
                  <dd className="font-medium text-heading">{reservation.bankAccountHolder}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">CUIL</dt>
                  <dd className="font-medium text-heading">{reservation.bankCuil}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Caja de ahorro en pesos</dt>
                  <dd className="font-medium text-heading">{reservation.bankAccountNumber}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">CBU</dt>
                  <dd className="flex flex-wrap items-center gap-2 font-medium text-heading">
                    <span className="break-all">{reservation.bankCbu}</span>
                    <CopyButton value={reservation.bankCbu} field="cbu" status={copyStatus.cbu} onCopy={handleCopy} />
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Alias</dt>
                  <dd className="flex flex-wrap items-center gap-2 font-medium text-heading">
                    <span className="break-all">{reservation.bankAlias}</span>
                    <CopyButton
                      value={reservation.bankAlias}
                      field="alias"
                      status={copyStatus.alias}
                      onCopy={handleCopy}
                    />
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-text-muted">Banco</dt>
                  <dd className="font-medium text-heading">{reservation.bankName}</dd>
                </div>
              </dl>
```

with:

```tsx
              <div className="mt-4">
                <BankDetails
                  accountHolder={reservation.bankAccountHolder}
                  cuil={reservation.bankCuil}
                  accountNumber={reservation.bankAccountNumber}
                  cbu={reservation.bankCbu}
                  alias={reservation.bankAlias}
                  bankName={reservation.bankName}
                />
              </div>
```

- [ ] **Step 6: Run the existing step-3 test to confirm it still passes unchanged**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx -t "resumes at step 3"`
Expected: PASS (the visible text/behavior is identical — only the implementation moved).

- [ ] **Step 7: Run the full guest-web suite**

Run: `docker compose exec guest-web npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add guest-web/src/confirmation/BankDetails.tsx guest-web/src/confirmation/BankDetails.test.tsx guest-web/src/confirmation/ConfirmationPage.tsx
git commit -m "$(cat <<'EOF'
Extract BankDetails from ConfirmationPage's step 3

Step 4's upcoming Pago tab needs the same CBU/alias/titular rows with
copy buttons that step 3 already renders inline - extracting it now
avoids duplicating that markup once the Pago tab exists.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `propertyInfo.ts` and `ComoLlegarTab`

**Files:**
- Create: `guest-web/src/confirmation/propertyInfo.ts`
- Create: `guest-web/src/confirmation/step4/ComoLlegarTab.tsx`
- Test: `guest-web/src/confirmation/step4/ComoLlegarTab.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `PROPERTY_ADDRESS: string`, `PROPERTY_MAPS_URL: string`, `PROPERTY_CONTACTS: PropertyContact[]`, `PROPERTY_ZONE: ZoneGroup[]`, `ZonePlace` type (icon key union `'wave'|'anchor'|'fork'|'bag'|'bus'`) — all consumed by this task's `ComoLlegarTab` and Task 4's `LaZonaTab`. `ComoLlegarTab` component takes no props.

- [ ] **Step 1: Create `propertyInfo.ts`**

```ts
export interface PropertyContact {
  name: string;
  phone: string;
}

export interface ZonePlace {
  icon: 'wave' | 'anchor' | 'fork' | 'bag' | 'bus';
  name: string;
  description: string;
}

export interface ZoneGroup {
  group: string;
  places: ZonePlace[];
}

export const PROPERTY_ADDRESS = 'Formosa 259, Depto L';
export const PROPERTY_MAPS_URL = 'https://maps.app.goo.gl/tMMvfWUcGDKKQuQh6';

export const PROPERTY_CONTACTS: PropertyContact[] = [
  { name: 'Johanna', phone: '+54 9 2235550101' },
  { name: 'Marta', phone: '+54 9 2235550102' },
];

export const PROPERTY_ZONE: ZoneGroup[] = [
  {
    group: 'Playas y paseos',
    places: [
      {
        icon: 'wave',
        name: 'Playa Grande',
        description: 'La playa más famosa de la ciudad para el surf y los atardeceres.',
      },
      {
        icon: 'anchor',
        name: 'Puerto de Mar del Plata',
        description: 'Lobos marinos, barcos pesqueros y restaurantes de pescado fresco.',
      },
    ],
  },
  {
    group: 'Comer y comprar',
    places: [
      { icon: 'fork', name: 'Zona Güemes', description: 'Bares, cafés y restaurantes para salir a la noche.' },
      {
        icon: 'bag',
        name: 'Supermercados y farmacias',
        description: 'Completá con los más cercanos al departamento.',
      },
    ],
  },
  {
    group: 'Moverse',
    places: [
      {
        icon: 'bus',
        name: 'Transporte',
        description: 'Completá con paradas de colectivo y recomendaciones de remis o taxi.',
      },
    ],
  },
];
```

- [ ] **Step 2: Write `ComoLlegarTab.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComoLlegarTab } from './ComoLlegarTab';

describe('ComoLlegarTab', () => {
  it('shows the address, a Maps link, and WhatsApp contacts', () => {
    render(<ComoLlegarTab />);

    expect(screen.getByText('Formosa 259, Depto L')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir en google maps/i })).toHaveAttribute(
      'href',
      'https://maps.app.goo.gl/tMMvfWUcGDKKQuQh6',
    );
    expect(screen.getByText('Johanna')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /whatsapp/i })[0]).toHaveAttribute(
      'href',
      'https://wa.me/5492235550101',
    );
  });

  it('copies the address and shows feedback', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    render(<ComoLlegarTab />);

    fireEvent.click(screen.getByRole('button', { name: /copiar dirección/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Formosa 259, Depto L'));
    expect(await screen.findByRole('button', { name: /copiada/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/ComoLlegarTab.test.tsx`
Expected: FAIL — `ComoLlegarTab.tsx` doesn't exist yet.

- [ ] **Step 4: Create `ComoLlegarTab.tsx`**

```tsx
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
    </div>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/ComoLlegarTab.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add guest-web/src/confirmation/propertyInfo.ts guest-web/src/confirmation/step4/ComoLlegarTab.tsx guest-web/src/confirmation/step4/ComoLlegarTab.test.tsx
git commit -m "$(cat <<'EOF'
Add property info config and the Cómo llegar tab

Address, Maps link, and WhatsApp contacts are hardcoded in
propertyInfo.ts rather than admin-editable, per the redesign's scope -
this content doesn't exist anywhere in the app today.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `LaZonaTab`

**Files:**
- Create: `guest-web/src/confirmation/step4/LaZonaTab.tsx`
- Test: `guest-web/src/confirmation/step4/LaZonaTab.test.tsx`

**Interfaces:**
- Consumes: `PROPERTY_ZONE`, `ZonePlace` from `../propertyInfo` (Task 3).
- Produces: `LaZonaTab` component, no props.

- [ ] **Step 1: Write `LaZonaTab.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LaZonaTab } from './LaZonaTab';

describe('LaZonaTab', () => {
  it('renders each zone group and its places', () => {
    render(<LaZonaTab />);

    expect(screen.getByText('Playas y paseos')).toBeInTheDocument();
    expect(screen.getByText('Playa Grande')).toBeInTheDocument();
    expect(screen.getByText('Puerto de Mar del Plata')).toBeInTheDocument();
    expect(screen.getByText('Comer y comprar')).toBeInTheDocument();
    expect(screen.getByText('Zona Güemes')).toBeInTheDocument();
    expect(screen.getByText('Moverse')).toBeInTheDocument();
    expect(screen.getByText('Transporte')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/LaZonaTab.test.tsx`
Expected: FAIL — `LaZonaTab.tsx` doesn't exist yet.

- [ ] **Step 3: Create `LaZonaTab.tsx`**

```tsx
import { ReactNode } from 'react';
import { PROPERTY_ZONE, ZonePlace } from '../propertyInfo';

const ZONE_ICONS: Record<ZonePlace['icon'], ReactNode> = {
  wave: <path d="M2 12c2.5-4 5-4 7.5 0s5 4 7.5 0 3-3 5-2" />,
  anchor: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11H5v2M16 11h3v2" />
    </>
  ),
  fork: <path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-2.5 5-2.5 8h2.5v10" />,
  bag: (
    <>
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  bus: (
    <>
      <rect x="4" y="4" width="16" height="13" rx="2" />
      <path d="M4 12h16M8 20v-3M16 20v-3" />
      <circle cx="8.5" cy="14.5" r=".6" />
      <circle cx="15.5" cy="14.5" r=".6" />
    </>
  ),
};

function PlaceIcon({ icon }: { icon: ZonePlace['icon'] }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ZONE_ICONS[icon]}
    </svg>
  );
}

export function LaZonaTab() {
  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Información de la zona</h3>
      <p className="mt-1 text-sm text-text-muted">
        Lugares para conocer, comer y resolver lo que necesites cerca del departamento.
      </p>

      {PROPERTY_ZONE.map((group) => (
        <div key={group.group} className="mt-5 first:mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">{group.group}</h4>
          <div className="mt-2 flex flex-col">
            {group.places.map((place) => (
              <div key={place.name} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-driftwood">
                  <PlaceIcon icon={place.icon} />
                </div>
                <div>
                  <p className="font-semibold text-heading">{place.name}</p>
                  <p className="text-sm text-text-muted">{place.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/LaZonaTab.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add guest-web/src/confirmation/step4/LaZonaTab.tsx guest-web/src/confirmation/step4/LaZonaTab.test.tsx
git commit -m "$(cat <<'EOF'
Add the La zona tab

Groups nearby places by category, reading from the same hardcoded
propertyInfo.ts config the Cómo llegar tab uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `PagoTab`

**Files:**
- Create: `guest-web/src/confirmation/step4/PagoTab.tsx`
- Test: `guest-web/src/confirmation/step4/PagoTab.test.tsx`

**Interfaces:**
- Consumes: `BankDetails` from `../BankDetails` (Task 2); `GuestReservation` from `../types`.
- Produces: `PagoTab` component — `{ reservation: GuestReservation }` props.

- [ ] **Step 1: Write `PagoTab.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PagoTab } from './PagoTab';
import { GuestReservation } from '../types';

const reservation: GuestReservation = {
  guestName: 'Jane Doe',
  checkIn: '2026-03-01',
  checkOut: '2026-03-05',
  paxCount: 2,
  totalAmount: 100000,
  confirmationPaymentAmount: 30000,
  confirmationPaymentPercentage: 30,
  currency: 'ARS',
  datesConfirmedAt: '2026-01-01T00:00:00.000Z',
  contractAcceptedAt: '2026-01-01T00:00:00.000Z',
  contractAcceptedName: 'Jane Doe',
  contractSnapshot: 'No parties.',
  confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
  depositReceivedAt: '2026-01-02T00:00:00.000Z',
  houseRulesText: 'No parties.',
  paymentInstructions: 'Transfer to bank X.',
  depositInstructions: 'Deposit charged at check-in.',
  confirmationStepText: 'All done, see you soon!',
  bankAccountHolder: 'Ana Pérez',
  bankCuil: '20123456789',
  bankAccountNumber: '0001234567',
  bankCbu: '0000003100012345678901',
  bankAlias: 'LABRISA.DEMO.ARS',
  bankName: 'Banco Ejemplo',
  securityDepositAmount: 150000,
};

describe('PagoTab', () => {
  it('shows the payment summary with both confirmed badges', () => {
    render(<PagoTab reservation={reservation} />);

    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(screen.getByText('ARS 100.000')).toBeInTheDocument();
    expect(screen.getByText(/pago de reserva \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('Restante a pagar en el lugar')).toBeInTheDocument();
    expect(screen.getByText('ARS 70.000')).toBeInTheDocument();
    expect(screen.getAllByText('✓ Confirmado')).toHaveLength(2);
  });

  it('shows the payment label without a percentage when it is a fixed amount', () => {
    render(<PagoTab reservation={{ ...reservation, confirmationPaymentAmount: 45000, confirmationPaymentPercentage: null }} />);

    expect(screen.getByText('Pago de reserva')).toBeInTheDocument();
    expect(screen.queryByText(/pago de reserva \(/i)).not.toBeInTheDocument();
  });

  it('reveals the bank transfer details when the accordion is opened', () => {
    render(<PagoTab reservation={reservation} />);

    expect(screen.queryByText('LABRISA.DEMO.ARS')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Datos de la cuenta para transferir'));

    expect(screen.getByText('LABRISA.DEMO.ARS')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/PagoTab.test.tsx`
Expected: FAIL — `PagoTab.tsx` doesn't exist yet.

- [ ] **Step 3: Create `PagoTab.tsx`**

```tsx
import { GuestReservation } from '../types';
import { BankDetails } from '../BankDetails';
import { Badge } from '../../ui';

function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('es-AR')}`;
}

function ChevronIcon() {
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
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function PagoTab({ reservation }: { reservation: GuestReservation }) {
  const remainingAtProperty = reservation.totalAmount - reservation.confirmationPaymentAmount;

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Información de pago</h3>
      <p className="mt-1 text-sm text-text-muted">Así está el estado de cada pago de tu estadía.</p>

      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <dt className="font-semibold text-heading">Total a pagar</dt>
          <dd className="font-heading text-lg font-bold text-accent">
            {formatMoney(reservation.currency, reservation.totalAmount)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <dt className="text-text-muted">
            Pago de reserva
            {reservation.confirmationPaymentPercentage !== null && ` (${reservation.confirmationPaymentPercentage}%)`}
          </dt>
          <dd className="flex items-center gap-2 font-semibold text-heading">
            {formatMoney(reservation.currency, reservation.confirmationPaymentAmount)}
            <Badge tone="success">✓ Confirmado</Badge>
          </dd>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <dt className="text-text-muted">Restante a pagar en el lugar</dt>
            <p className="text-xs text-text-muted">Se abona al momento del check-in.</p>
          </div>
          <dd className="font-semibold text-heading">{formatMoney(reservation.currency, remainingAtProperty)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <dt className="text-text-muted">Depósito de garantía</dt>
            <p className="max-w-[20ch] text-xs text-text-muted">
              Se devuelve dentro de las 48 h posteriores al check-out, una vez verificado que no haya daños.
            </p>
          </div>
          <dd className="flex items-center gap-2 font-semibold text-heading">
            {formatMoney(reservation.currency, reservation.securityDepositAmount)}
            <Badge tone="success">✓ Confirmado</Badge>
          </dd>
        </div>
      </dl>

      <details className="mt-4 overflow-hidden rounded-lg border border-border">
        <summary className="flex cursor-pointer items-center justify-between bg-bg px-4 py-3 text-sm font-semibold text-heading">
          Datos de la cuenta para transferir
          <ChevronIcon />
        </summary>
        <div className="p-4">
          <BankDetails
            accountHolder={reservation.bankAccountHolder}
            cuil={reservation.bankCuil}
            accountNumber={reservation.bankAccountNumber}
            cbu={reservation.bankCbu}
            alias={reservation.bankAlias}
            bankName={reservation.bankName}
          />
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/PagoTab.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add guest-web/src/confirmation/step4/PagoTab.tsx guest-web/src/confirmation/step4/PagoTab.test.tsx
git commit -m "$(cat <<'EOF'
Add the Pago tab

Moves step 4's payment summary into its own component and adds a
collapsible bank-details section reusing BankDetails, matching the
redesign mockup's accordion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `threshold` field and `SensoresTab`

**Files:**
- Modify: `guest-web/src/api/ambient.ts`
- Create: `guest-web/src/confirmation/step4/SensoresTab.tsx`
- Test: `guest-web/src/confirmation/step4/SensoresTab.test.tsx`

**Note:** `guest-web/src/confirmation/AmbientStatus.tsx`/`.test.tsx` are superseded by this task but NOT deleted here — `ConfirmationPage.tsx` still imports `AmbientStatus` until Task 8 replaces that usage with `Step4Confirmation` in the same edit. Deleting the files here would leave `ConfirmationPage.tsx` (and anything importing it, including its own test file) with a broken import for two tasks. Task 8 deletes both files as its first step, atomically with removing the import.

**Interfaces:**
- Consumes: `getAmbientReadings` from `../../api/ambient` (existing); `Badge` from `../../ui`.
- Produces: `SensoresTab` component — `{ token: string }` props. Updated `AmbientDeviceReadingEntry` type now includes `threshold: number | null`.

- [ ] **Step 1: Add `threshold` to `AmbientDeviceReadingEntry`**

In `guest-web/src/api/ambient.ts`, update the interface:

```ts
export interface AmbientDeviceReadingEntry {
  id: string;
  sensor: string;
  level: number;
  // The device's own calibrated alert threshold for this sensor, if it has one (sound, co,
  // smoke do; temperature/humidity report null) - see SensoresTab for how this drives the
  // Ideal/Alto status chip.
  threshold: number | null;
  updatedAt: string;
}
```

(The rest of the file — `AmbientDeviceEntry`, `getAmbientReadings` — is unchanged.)

- [ ] **Step 2: Write `SensoresTab.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SensoresTab } from './SensoresTab';
import * as ambientApi from '../../api/ambient';

describe('SensoresTab', () => {
  it('shows an Ideal chip for a reading below its threshold', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [{ id: 'r-1', sensor: 'smoke', level: 300, threshold: 2500, updatedAt: '2026-09-27T12:00:00.000Z' }],
      },
    ]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText('Ideal')).toBeInTheDocument();
  });

  it('shows an Alto chip for a reading at or above its threshold', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [{ id: 'r-1', sensor: 'co', level: 2600, threshold: 2500, updatedAt: '2026-09-27T12:00:00.000Z' }],
      },
    ]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText('Alto')).toBeInTheDocument();
  });

  it('shows no status chip for a sensor with no threshold, like temperature', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [
          { id: 'r-1', sensor: 'temperature', level: 23, threshold: null, updatedAt: '2026-09-27T12:00:00.000Z' },
        ],
      },
    ]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText('23')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    expect(screen.queryByText('Ideal')).not.toBeInTheDocument();
    expect(screen.queryByText('Alto')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there are no devices', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText(/todavía no hay datos/i)).toBeInTheDocument();
  });

  it('shows an empty-state message on a fetch failure', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockRejectedValue(new Error('forbidden'));

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText(/todavía no hay datos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/SensoresTab.test.tsx`
Expected: FAIL — `SensoresTab.tsx` doesn't exist yet.

- [ ] **Step 4: Create `SensoresTab.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { getAmbientReadings, AmbientDeviceEntry, AmbientDeviceReadingEntry } from '../../api/ambient';
import { Badge } from '../../ui';

// guest-web-local, deliberately not imported from admin-web's lib/labels.ts — this codebase's
// convention is per-app duplication of small UI bits, not a shared package.
const AMBIENT_SENSOR_LABELS: Record<string, string> = {
  sound: 'Sonido',
  co: 'Monóxido de carbono',
  smoke: 'Humo',
  temperature: 'Temperatura',
  humidity: 'Humedad',
};

const AMBIENT_SENSOR_UNITS: Record<string, string> = {
  temperature: '°C',
  humidity: '%',
};

// The gauge has no natural symmetric range for these sensors (a single "don't cross this"
// threshold, not a min/max comfort band) - threshold * GAUGE_MAX_MULTIPLIER sets how wide to
// draw the bar, reusing the same multiplier the firmware's buzzer emergency tier already uses
// for smoke/CO (ambient-control/include/config.h's EMERGENCY_THRESHOLD_MULTIPLIER), applied
// here uniformly to sound too purely as a display scale - no new "emergency" concept in the UI.
const GAUGE_MAX_MULTIPLIER = 2;

function ambientSensorLabel(sensor: string): string {
  return AMBIENT_SENSOR_LABELS[sensor] ?? sensor;
}

function SensorGauge({ level, threshold }: { level: number; threshold: number }) {
  const max = threshold * GAUGE_MAX_MULTIPLIER;
  const zonePercent = Math.min(100, (threshold / max) * 100);
  const dotPercent = Math.min(100, (level / max) * 100);

  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-border">
      <div className="absolute inset-y-0 left-0 rounded-full bg-zone" style={{ width: `${zonePercent}%` }} />
      <div
        className="absolute top-1/2 h-3 w-3 rounded-full border-2 border-surface bg-accent"
        style={{ left: `${dotPercent}%`, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
}

function SensorCard({ reading }: { reading: AmbientDeviceReadingEntry }) {
  const hasThreshold = reading.threshold != null;
  const isIdeal = hasThreshold && reading.level < reading.threshold!;
  const unit = AMBIENT_SENSOR_UNITS[reading.sensor];

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-text-muted">{ambientSensorLabel(reading.sensor)}</p>
      <p className="font-heading text-2xl font-medium text-heading">
        {reading.level}
        {unit && <span className="ml-1 text-sm font-normal text-text-muted">{unit}</span>}
      </p>
      {hasThreshold && (
        <>
          <SensorGauge level={reading.level} threshold={reading.threshold!} />
          <div className="mt-2">
            <Badge tone={isIdeal ? 'success' : 'warning'}>{isIdeal ? 'Ideal' : 'Alto'}</Badge>
          </div>
        </>
      )}
    </div>
  );
}

export function SensoresTab({ token }: { token: string }) {
  const [devices, setDevices] = useState<AmbientDeviceEntry[] | null>(null);

  useEffect(() => {
    getAmbientReadings(token)
      .then(setDevices)
      .catch(() => setDevices(null));
  }, [token]);

  if (!devices || devices.length === 0) {
    return (
      <div>
        <h3 className="font-heading text-lg font-semibold text-heading">Sensores de ambiente</h3>
        <p className="mt-1 text-sm text-text-muted">Todavía no hay datos de los sensores disponibles.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Sensores de ambiente</h3>
      <p className="mt-1 text-sm text-text-muted">Cómo está el departamento en este momento.</p>

      {devices.map((device) => (
        <div key={device.id} className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-heading">{device.name || device.id}</p>
            <Badge tone={device.online ? 'success' : 'danger'}>{device.online ? 'En línea' : 'Sin conexión'}</Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {device.readings.map((reading) => (
              <SensorCard key={reading.id} reading={reading} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/SensoresTab.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add guest-web/src/api/ambient.ts guest-web/src/confirmation/step4/SensoresTab.tsx guest-web/src/confirmation/step4/SensoresTab.test.tsx
git commit -m "$(cat <<'EOF'
Add the Sensores tab with Ideal/Alto status chips

Replaces AmbientStatus with a tab that shows a gauge + Ideal/Alto chip
for any reading with a calibrated threshold (sound/CO/smoke) and a bare
value for readings with none (temperature/humidity) - the threshold
field was already plumbed through the backend and firmware, guest-web
just wasn't reading it yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `Step4Confirmation` tab shell

**Files:**
- Create: `guest-web/src/confirmation/step4/Step4Confirmation.tsx`
- Test: `guest-web/src/confirmation/step4/Step4Confirmation.test.tsx`

**Interfaces:**
- Consumes: `PagoTab` (Task 5), `ComoLlegarTab` (Task 3), `LaZonaTab` (Task 4), `SensoresTab` (Task 6), `Badge` from `../../ui`, `GuestReservation` from `../types`.
- Produces: `Step4Confirmation` component — `{ reservation: GuestReservation; token: string; showAmbient: boolean; stepHeadingRef: RefObject<HTMLHeadingElement> }` props. Consumed by Task 8's `ConfirmationPage.tsx`.

- [ ] **Step 1: Write `Step4Confirmation.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Step4Confirmation } from './Step4Confirmation';
import { GuestReservation } from '../types';
import * as ambientApi from '../../api/ambient';

const reservation: GuestReservation = {
  guestName: 'Jane Doe',
  checkIn: '2026-03-01',
  checkOut: '2026-03-05',
  paxCount: 2,
  totalAmount: 100000,
  confirmationPaymentAmount: 30000,
  confirmationPaymentPercentage: 30,
  currency: 'ARS',
  datesConfirmedAt: '2026-01-01T00:00:00.000Z',
  contractAcceptedAt: '2026-01-01T00:00:00.000Z',
  contractAcceptedName: 'Jane Doe',
  contractSnapshot: 'No parties.',
  confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
  depositReceivedAt: '2026-01-02T00:00:00.000Z',
  houseRulesText: 'No parties.',
  paymentInstructions: 'Transfer to bank X.',
  depositInstructions: 'Deposit charged at check-in.',
  confirmationStepText: 'All done, see you soon!',
  bankAccountHolder: 'Ana Pérez',
  bankCuil: '20123456789',
  bankAccountNumber: '0001234567',
  bankCbu: '0000003100012345678901',
  bankAlias: 'LABRISA.DEMO.ARS',
  bankName: 'Banco Ejemplo',
  securityDepositAmount: 150000,
};

describe('Step4Confirmation', () => {
  it('shows the Pago tab by default', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    expect(screen.getByRole('tab', { name: /pago/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
  });

  it('switches to another tab on click', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    fireEvent.click(screen.getByRole('tab', { name: /cómo llegar/i }));

    expect(screen.getByRole('tab', { name: /cómo llegar/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Formosa 259, Depto L')).toBeInTheDocument();
  });

  it('moves to the next tab with ArrowRight and moves focus with it', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    const pagoTab = screen.getByRole('tab', { name: /pago/i });
    pagoTab.focus();
    fireEvent.keyDown(pagoTab, { key: 'ArrowRight' });

    const llegarTab = screen.getByRole('tab', { name: /cómo llegar/i });
    expect(llegarTab).toHaveAttribute('aria-selected', 'true');
    expect(llegarTab).toHaveFocus();
  });

  it('wraps from the last tab back to the first with ArrowRight', () => {
    render(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />);

    const zonaTab = screen.getByRole('tab', { name: /la zona/i });
    zonaTab.focus();
    fireEvent.keyDown(zonaTab, { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: /pago/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('only shows the Sensores tab when showAmbient is true', () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([]);
    const { rerender } = render(
      <Step4Confirmation reservation={reservation} token="tok-1" showAmbient={false} stepHeadingRef={createRef()} />,
    );

    expect(screen.queryByRole('tab', { name: /sensores/i })).not.toBeInTheDocument();

    rerender(<Step4Confirmation reservation={reservation} token="tok-1" showAmbient={true} stepHeadingRef={createRef()} />);

    expect(screen.getByRole('tab', { name: /sensores/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/Step4Confirmation.test.tsx`
Expected: FAIL — `Step4Confirmation.tsx` doesn't exist yet.

- [ ] **Step 3: Create `Step4Confirmation.tsx`**

```tsx
import { KeyboardEvent, ReactNode, RefObject, useRef, useState } from 'react';
import { GuestReservation } from '../types';
import { Badge } from '../../ui';
import { PagoTab } from './PagoTab';
import { ComoLlegarTab } from './ComoLlegarTab';
import { LaZonaTab } from './LaZonaTab';
import { SensoresTab } from './SensoresTab';

type TabId = 'pago' | 'llegar' | 'zona' | 'sensores';

interface Tab {
  id: TabId;
  label: string;
  icon: ReactNode;
}

function iconProps() {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

function PagoIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6.5 15h4" />
    </svg>
  );
}

function LlegarIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 21s7-5.6 7-11.2A7 7 0 0 0 5 9.8C5 15.4 12 21 12 21z" />
      <circle cx="12" cy="9.8" r="2.4" />
    </svg>
  );
}

function ZonaIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  );
}

function SensoresIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" />
      <path d="M12 9v7" />
    </svg>
  );
}

interface Step4ConfirmationProps {
  reservation: GuestReservation;
  token: string;
  showAmbient: boolean;
  stepHeadingRef: RefObject<HTMLHeadingElement>;
}

export function Step4Confirmation({ reservation, token, showAmbient, stepHeadingRef }: Step4ConfirmationProps) {
  const [activeTab, setActiveTab] = useState<TabId>('pago');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs: Tab[] = [
    { id: 'pago', label: 'Pago', icon: <PagoIcon /> },
    { id: 'llegar', label: 'Cómo llegar', icon: <LlegarIcon /> },
    { id: 'zona', label: 'La zona', icon: <ZonaIcon /> },
  ];
  if (showAmbient) {
    tabs.push({ id: 'sensores', label: 'Sensores', icon: <SensoresIcon /> });
  }

  function selectTabAt(index: number, focus: boolean) {
    setActiveTab(tabs[index].id);
    if (focus) {
      tabRefs.current[index]?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectTabAt((index + 1) % tabs.length, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTabAt((index - 1 + tabs.length) % tabs.length, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTabAt(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTabAt(tabs.length - 1, true);
    }
  }

  return (
    <>
      <Badge tone="success">✓ Pago confirmado</Badge>
      <h2 ref={stepHeadingRef} tabIndex={-1} className="mt-2 font-heading text-xl font-bold text-heading outline-none">
        Confirmación
      </h2>
      <p className="mt-1 text-sm text-text-muted">{reservation.confirmationStepText}</p>

      <div
        role="tablist"
        aria-label="Información de tu estadía"
        className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg p-1 sm:grid-cols-4"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => selectTabAt(index, false)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
              activeTab === tab.id ? 'bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-pago" aria-labelledby="tab-pago" hidden={activeTab !== 'pago'} className="mt-4">
        <PagoTab reservation={reservation} />
      </div>
      <div role="tabpanel" id="panel-llegar" aria-labelledby="tab-llegar" hidden={activeTab !== 'llegar'} className="mt-4">
        <ComoLlegarTab />
      </div>
      <div role="tabpanel" id="panel-zona" aria-labelledby="tab-zona" hidden={activeTab !== 'zona'} className="mt-4">
        <LaZonaTab />
      </div>
      {showAmbient && (
        <div
          role="tabpanel"
          id="panel-sensores"
          aria-labelledby="tab-sensores"
          hidden={activeTab !== 'sensores'}
          className="mt-4"
        >
          <SensoresTab token={token} />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/step4/Step4Confirmation.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add guest-web/src/confirmation/step4/Step4Confirmation.tsx guest-web/src/confirmation/step4/Step4Confirmation.test.tsx
git commit -m "$(cat <<'EOF'
Add the Step4Confirmation tab shell

Owns tab state and accessible keyboard navigation (arrow keys/Home/End,
matching the redesign mockup's pattern) across Pago/Cómo llegar/La
zona/Sensores. All panels render eagerly, toggled via the hidden
attribute rather than mount/unmount, so switching tabs never re-fetches
data. Not yet wired into ConfirmationPage.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire `Step4Confirmation` into `ConfirmationPage` and update its tests

**Files:**
- Modify: `guest-web/src/confirmation/ConfirmationPage.tsx`
- Modify: `guest-web/src/confirmation/ConfirmationPage.test.tsx`
- Delete: `guest-web/src/confirmation/AmbientStatus.tsx`
- Delete: `guest-web/src/confirmation/AmbientStatus.test.tsx`

**Interfaces:**
- Consumes: `Step4Confirmation` from `./step4/Step4Confirmation` (Task 7).
- Produces: nothing further — this is the final integration task.

- [ ] **Step 1: Delete the superseded `AmbientStatus` files**

```bash
git rm guest-web/src/confirmation/AmbientStatus.tsx guest-web/src/confirmation/AmbientStatus.test.tsx
```

`SensoresTab` (Task 6) already replaces everything `AmbientStatus` did — deleting it now, in the same task that removes `ConfirmationPage.tsx`'s import of it (next step), means the import is never left dangling.

- [ ] **Step 2: Replace step 4's block and remove the standalone `AmbientStatus` rendering in `ConfirmationPage.tsx`**

1. Replace the import `import { AmbientStatus } from './AmbientStatus';` with `import { Step4Confirmation } from './step4/Step4Confirmation';`.
2. Delete the now-unused `const remainingAtProperty = reservation.totalAmount - reservation.confirmationPaymentAmount;` line (it moved into `PagoTab`).
3. Replace this entire block:

```tsx
        {step === 4 && (
          <>
            <Badge tone="success">✓ Pago confirmado</Badge>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="mt-2 font-heading text-xl font-bold text-heading outline-none"
            >
              Confirmación
            </h2>
            <p className="mt-1 text-sm text-text-muted">{reservation.confirmationStepText}</p>

            <dl className="mt-6 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-text-muted">Total a pagar</dt>
                <dd className="font-semibold text-heading">
                  {formatMoney(reservation.currency, reservation.totalAmount)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-text-muted">
                  Pago de reserva
                  {reservation.confirmationPaymentPercentage !== null &&
                    ` (${reservation.confirmationPaymentPercentage}%)`}
                </dt>
                <dd className="font-semibold text-heading">
                  {formatMoney(reservation.currency, reservation.confirmationPaymentAmount)}
                  {reservation.confirmationPaymentReceivedAt && (
                    <span className="ml-1 text-success" aria-label="Recibido">
                      ✓
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-text-muted">Restante a pagar en el lugar</dt>
                <dd className="font-semibold text-heading">{formatMoney(reservation.currency, remainingAtProperty)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-text-muted">Depósito de garantía</dt>
                <dd className="font-semibold text-heading">
                  {formatMoney(reservation.currency, reservation.securityDepositAmount)}
                  {reservation.depositReceivedAt && (
                    <span className="ml-1 text-success" aria-label="Recibido">
                      ✓
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
      {showAmbient && <AmbientStatus token={token!} />}
    </PageShell>
  );
}
```

with:

```tsx
        {step === 4 && (
          <Step4Confirmation
            reservation={reservation}
            token={token!}
            showAmbient={showAmbient}
            stepHeadingRef={stepHeadingRef}
          />
        )}
      </div>
    </PageShell>
  );
}
```

(Everything above the replaced block — steps 1–3, the shared "Ver reglas de la casa" toggle, `PageShell`, `StepIndicator`, etc. — is unchanged.)

- [ ] **Step 3: Update the two `ConfirmationPage.test.tsx` tests that assert on the old flat step-4 markup**

Replace this test:

```tsx
  it('resumes at step 4 (Confirmación) once payment and deposit are both received, showing the totals breakdown', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-05-03T12:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });

    renderAt('tok-1');

    expect(await screen.findByText('All done, see you soon!')).toBeInTheDocument();
    expect(screen.getByText(/pago confirmado/i)).toBeInTheDocument();
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(screen.getByText('ARS 100.000')).toBeInTheDocument();
    expect(screen.getByText(/pago de reserva \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('Restante a pagar en el lugar')).toBeInTheDocument();
    expect(screen.getByText('ARS 70.000')).toBeInTheDocument();
    // Two checkmarks: one for the reservation payment, one for the deposit
    expect(screen.getAllByLabelText('Recibido')).toHaveLength(2);
  });
```

with:

```tsx
  it('resumes at step 4 (Confirmación) once payment and deposit are both received, showing the Pago tab by default', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-05-03T12:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });

    renderAt('tok-1');

    expect(await screen.findByText('All done, see you soon!')).toBeInTheDocument();
    expect(screen.getByText(/pago confirmado/i)).toBeInTheDocument();
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
    expect(screen.getByText('ARS 100.000')).toBeInTheDocument();
    expect(screen.getByText(/pago de reserva \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('Restante a pagar en el lugar')).toBeInTheDocument();
    expect(screen.getByText('ARS 70.000')).toBeInTheDocument();
    // Two "Confirmado" badges: one for the reservation payment, one for the deposit
    expect(screen.getAllByText('✓ Confirmado')).toHaveLength(2);
  });
```

Replace this test:

```tsx
  it('shows ambient sensor status regardless of confirmation or dates when debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      { id: 'dev-1', name: 'Living room', online: true, lastSeenAt: null, readings: [] },
    ]);

    renderAt('tok-1');

    expect(await screen.findByText('Living room')).toBeInTheDocument();
  });
```

with:

```tsx
  it('shows ambient sensor status when debug mode is on, even outside the stay dates, once step 4 is reached', async () => {
    // Ambient data now lives inside step 4's Sensores tab, which only exists once both
    // payments are received (debug mode does not bypass that) - what debug mode still bypasses
    // is the stay-date window check, tested here with dates far in the past.
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
      checkIn: '2020-01-01T00:00:00.000Z',
      checkOut: '2020-01-02T00:00:00.000Z',
    });
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      { id: 'dev-1', name: 'Living room', online: true, lastSeenAt: null, readings: [] },
    ]);

    renderAt('tok-1');

    expect(await screen.findByText('Living room')).toBeInTheDocument();
  });
```

The other three ambient-related tests ("shows ambient sensor status once fully confirmed and during the stay dates", "does not show ambient sensor status outside the stay dates, even when fully confirmed", "does not show ambient sensor status during the stay dates when not yet fully confirmed") need no changes — `Step4Confirmation` still renders every eligible panel unconditionally (just hidden via the `hidden` attribute when not the active tab), and `getByText`/`findByText` don't filter out `hidden` elements, so these assertions keep passing exactly as written.

- [ ] **Step 4: Run the full `ConfirmationPage.test.tsx` file**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx`
Expected: PASS, all tests including the two just rewritten.

- [ ] **Step 5: Run the entire guest-web test suite and typecheck**

Run: `docker compose exec guest-web npx vitest run`
Expected: PASS

Run: `docker compose exec guest-web npx tsc --noEmit`
Expected: no errors (confirms the deleted `AmbientStatus` import and the removed `remainingAtProperty`/`CopyButton`/`copyStatus` code left no dangling references).

- [ ] **Step 6: Commit**

```bash
git add guest-web/src/confirmation/ConfirmationPage.tsx guest-web/src/confirmation/ConfirmationPage.test.tsx
git commit -m "$(cat <<'EOF'
Wire Step4Confirmation into ConfirmationPage

Step 4 now renders the tabbed Pago/Cómo llegar/La zona/Sensores view
instead of a flat summary, completing the check-in redesign. Updates
the two ConfirmationPage tests whose assertions targeted markup that
no longer exists (the bare "Recibido" checkmark span, and debug mode's
now-narrowed any-step ambient preview).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** visual tokens (Task 1), `BankDetails` extraction (Task 2), `propertyInfo.ts` + Cómo llegar/La zona (Tasks 3–4), Pago tab (Task 5), `threshold` field + Sensores tab with Ideal/Alto logic (Task 6), tab shell with accessible keyboard nav (Task 7), final integration + test updates (Task 8) — every section of the spec has a task.
- **Placeholder scan:** no TBD/TODO; every step has complete code, not a description of code.
- **Type consistency:** `BankDetails` props (Task 2) match its usage in `PagoTab` (Task 5) exactly. `AmbientDeviceReadingEntry.threshold` (Task 6) matches `SensorCard`'s usage in the same task. `Step4Confirmation`'s props (Task 7) match exactly how `ConfirmationPage.tsx` calls it (Task 8): `reservation`, `token`, `showAmbient`, `stepHeadingRef`.
