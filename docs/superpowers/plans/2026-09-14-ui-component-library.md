# UI Component Library (admin-web + guest-web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain, unstyled HTML in `admin-web` and `guest-web` with a small set of styled, shared UI primitives (Tailwind CSS v4), themed per app — `guest-web` matching labrisa.com.ar's existing branding, `admin-web` getting a plain neutral theme — and retrofit every existing page onto them.

**Architecture:** Tailwind CSS v4 is added independently to each app via `@tailwindcss/vite`. A `src/ui/` folder of ~10 primitive components (`Button`, `FormField`, `Input`, `Select`, `Textarea`, `Alert`, `Badge`, `Table`, `PageHeader`, `PageContainer`) is vendored — the same component source copied into both apps — with each app's own `@theme` tokens (defined in its `index.css`) supplying the visual difference. Every existing page in both apps is then rewritten to use these primitives in place of raw HTML elements, preserving exact behavior and test-observable semantics (roles, labels, visible text).

**Tech Stack:** React 19, Vite 8, TypeScript, Tailwind CSS v4 (`tailwindcss` + `@tailwindcss/vite`, both pinned to `4.3.3`), Vitest + React Testing Library (unchanged).

**Spec:** `docs/superpowers/specs/2026-09-14-ui-component-library-design.md`

## Global Constraints

- No shared npm/pnpm workspace and no changes to `docker-compose.yml` or either app's `Dockerfile` — `src/ui/` is vendored (duplicated source) between `admin-web` and `guest-web`, not a shared package.
- Both apps' `@theme` blocks define the exact same token names (`--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-heading`, `--color-accent`, `--color-accent-hover`, `--color-danger`, `--color-danger-bg`, `--color-success`, `--color-success-bg`, `--color-warning`, `--color-warning-bg`, `--font-sans`, `--font-heading`) so the same primitive source resolves correctly in both apps — only the values differ.
- `guest-web`'s theme values come from the palette already in `guest-web/src/index.css` (`--color-teal: #0bb4aa`, `--color-teal-dark: #089990`, `--color-dark: #101010`, `--color-bg: #f9fafd`, `--color-grey: #6c6c77`, `--color-light-grey: #d9d9d9`, `Inter` body / `Montserrat` headings) — used as-is, no further verification against the live labrisa.com.ar site.
- `admin-web`'s theme is a plain neutral palette (no branding constraint) — replacing Vite's unmodified purple starter theme.
- Every retrofitted page keeps the exact roles, label text, and visible text its existing test file queries by. No test file is modified by this plan — a retrofit task is only done when that page's existing test file passes unchanged.
- Primitives are mobile-first by default (stacked/full-width), using Tailwind's `md:`/`lg:` prefixes only where a page needs a wider layout.

---

### Task 1: Add Tailwind CSS v4 to admin-web

**Files:**
- Modify: `admin-web/package.json`, `admin-web/vite.config.ts`, `admin-web/src/index.css`

**Interfaces:**
- Produces: Tailwind utility classes and the `@theme` tokens listed in Global Constraints, available to every `admin-web` component from Task 3 onward.

- [ ] **Step 1: Install Tailwind CSS v4 and its Vite plugin**

Run:
```bash
docker compose exec admin-web npm install tailwindcss@4.3.3 @tailwindcss/vite@4.3.3
```
Expected: `admin-web/package.json` gains both packages under `dependencies`.

- [ ] **Step 2: Wire the Vite plugin**

Modify `admin-web/vite.config.ts`:
```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5180,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
```

- [ ] **Step 3: Replace `admin-web/src/index.css` with the Tailwind import and admin-web's neutral theme**

Replace the entire contents of `admin-web/src/index.css` with:
```css
@import "tailwindcss";

@theme {
  --color-bg: #ffffff;
  --color-surface: #f4f4f6;
  --color-border: #d9d9df;
  --color-text: #33323b;
  --color-text-muted: #6b6b76;
  --color-heading: #16151c;
  --color-accent: #2f6fed;
  --color-accent-hover: #2557c4;
  --color-danger: #c0392b;
  --color-danger-bg: #fdecea;
  --color-success: #1e8e5a;
  --color-success-bg: #e8f6ef;
  --color-warning: #b7791f;
  --color-warning-bg: #fdf3e0;
  --font-sans: system-ui, "Segoe UI", Roboto, sans-serif;
  --font-heading: system-ui, "Segoe UI", Roboto, sans-serif;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}
```
This drops the old Vite-starter purple theme (`#root` width cap, `h1`/`h2`/`code` rules, dark-mode media query) entirely — every page from Task 5 onward supplies its own layout and typography via `PageContainer`/`PageHeader`/Tailwind classes instead of global element selectors.

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
docker compose exec admin-web npm run build
```
Expected: succeeds with no errors (confirms the Tailwind plugin and `@theme` syntax are wired correctly).

- [ ] **Step 5: Run the existing test suite to confirm no regressions**

Run:
```bash
docker compose exec admin-web npm test
```
Expected: all suites PASS — no component markup has changed yet, only global CSS, which RTL tests don't assert on.

- [ ] **Step 6: Commit**

```bash
git add admin-web/package.json admin-web/package-lock.json admin-web/vite.config.ts admin-web/src/index.css
git commit -m "Add Tailwind CSS v4 to admin-web with a neutral theme"
```

---

### Task 2: Add Tailwind CSS v4 to guest-web

**Files:**
- Modify: `guest-web/package.json`, `guest-web/vite.config.ts`, `guest-web/src/index.css`

**Interfaces:**
- Produces: the same `@theme` token names as Task 1, resolving to guest-web's labrisa.com.ar-matching values — available to every `guest-web` component from Task 4 onward.

- [ ] **Step 1: Install Tailwind CSS v4 and its Vite plugin**

Run:
```bash
docker compose exec guest-web npm install tailwindcss@4.3.3 @tailwindcss/vite@4.3.3
```
Expected: `guest-web/package.json` gains both packages under `dependencies`.

- [ ] **Step 2: Wire the Vite plugin**

Modify `guest-web/vite.config.ts`:
```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
```

- [ ] **Step 3: Replace `guest-web/src/index.css` with the Tailwind import and guest-web's labrisa.com.ar theme**

Replace the entire contents of `guest-web/src/index.css` with:
```css
@import "tailwindcss";

@theme {
  --color-bg: #f9fafd;
  --color-surface: #ffffff;
  --color-border: #d9d9d9;
  --color-text: #101010;
  --color-text-muted: #6c6c77;
  --color-heading: #101010;
  --color-accent: #0bb4aa;
  --color-accent-hover: #089990;
  --color-danger: #c0392b;
  --color-danger-bg: #fdecea;
  --color-success: #0bb4aa;
  --color-success-bg: #e6f7f6;
  --color-warning: #b7791f;
  --color-warning-bg: #fdf3e0;
  --font-sans: "Inter", sans-serif;
  --font-heading: "Montserrat", sans-serif;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}
```
This carries forward the exact colors and fonts from the old `--color-*` custom properties and the `Inter`/`Montserrat` font rules, dropping only the now-unused `.container`/`.btn`/bare `input, textarea`/`a` selectors — Task 12 replaces every one of their usages with `PageContainer`/`Button`/`Input`/Tailwind classes.

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
docker compose exec guest-web npm run build
```
Expected: succeeds with no errors.

- [ ] **Step 5: Run the existing test suite to confirm no regressions**

Run:
```bash
docker compose exec guest-web npm test
```
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add guest-web/package.json guest-web/package-lock.json guest-web/vite.config.ts guest-web/src/index.css
git commit -m "Add Tailwind CSS v4 to guest-web with labrisa.com.ar's theme"
```

---

### Task 3: Shared UI primitives in admin-web

**Files:**
- Create: `admin-web/src/ui/Button.tsx`, `admin-web/src/ui/FormField.tsx`, `admin-web/src/ui/Input.tsx`, `admin-web/src/ui/Select.tsx`, `admin-web/src/ui/Textarea.tsx`, `admin-web/src/ui/Alert.tsx`, `admin-web/src/ui/Badge.tsx`, `admin-web/src/ui/Table.tsx`, `admin-web/src/ui/PageHeader.tsx`, `admin-web/src/ui/PageContainer.tsx`, `admin-web/src/ui/index.ts`
- Create: `admin-web/src/ui/Button.test.tsx`, `admin-web/src/ui/FormField.test.tsx`, `admin-web/src/ui/Alert.test.tsx`

**Interfaces:**
- Produces: `Button({variant?: 'primary'|'secondary'|'danger', ...ButtonHTMLAttributes})`, `FormField({label: ReactNode, error?: string|null, children: ReactNode})`, `Input(InputHTMLAttributes)`, `Select(SelectHTMLAttributes)`, `Textarea(TextareaHTMLAttributes)`, `Alert({tone?: 'danger'|'success', children: ReactNode})`, `Badge({tone?: 'neutral'|'success'|'warning'|'danger', children: ReactNode})`, `Table({children: ReactNode, className?: string})`, `PageHeader({title: ReactNode, nav?: ReactNode})`, `PageContainer({children: ReactNode})`, all re-exported from `admin-web/src/ui/index.ts` — consumed by Tasks 5-11.

- [ ] **Step 1: Write the failing tests**

`admin-web/src/ui/Button.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label and forwards onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects the disabled prop', () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
```

`admin-web/src/ui/FormField.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './FormField';
import { Input } from './Input';

describe('FormField', () => {
  it('associates the label with its control', () => {
    render(
      <FormField label="Email">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders an error message', () => {
    render(
      <FormField label="Email" error="Required">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
```

`admin-web/src/ui/Alert.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './Alert';

describe('Alert', () => {
  it('renders with role="alert" by default', () => {
    render(<Alert>Something went wrong</Alert>);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('renders with role="status" for the success tone', () => {
    render(<Alert tone="success">Saved</Alert>);

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `docker compose exec admin-web npx vitest run src/ui`
Expected: FAIL (`Cannot find module './Button'` etc. — none of the primitives exist yet)

- [ ] **Step 3: Implement the primitives**

`admin-web/src/ui/Button.tsx`:
```tsx
import { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-border disabled:text-text-muted',
  secondary: 'bg-surface text-text border border-border hover:bg-border disabled:text-text-muted',
  danger: 'bg-danger text-white hover:opacity-90 disabled:bg-border disabled:text-text-muted',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
```

`admin-web/src/ui/Input.tsx`:
```tsx
import { InputHTMLAttributes } from 'react';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
```

`admin-web/src/ui/Select.tsx`:
```tsx
import { SelectHTMLAttributes } from 'react';

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
```

`admin-web/src/ui/Textarea.tsx`:
```tsx
import { TextareaHTMLAttributes } from 'react';

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
```

`admin-web/src/ui/FormField.tsx`:
```tsx
import { ReactNode } from 'react';

interface FormFieldProps {
  label: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function FormField({ label, error, children }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-text">
      {label}
      {children}
      {error && (
        <span role="alert" className="text-sm font-normal text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
```

`admin-web/src/ui/Alert.tsx`:
```tsx
import { ReactNode } from 'react';

type AlertTone = 'danger' | 'success';

const toneClasses: Record<AlertTone, string> = {
  danger: 'bg-danger-bg text-danger',
  success: 'bg-success-bg text-success',
};

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
}

export function Alert({ tone = 'danger', children }: AlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded px-3 py-2 text-sm ${toneClasses[tone]}`}>
      {children}
    </div>
  );
}
```

`admin-web/src/ui/Badge.tsx`:
```tsx
import { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-text-muted',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
```

`admin-web/src/ui/Table.tsx`:
```tsx
import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full min-w-[480px] border-collapse text-left text-sm ${className}`}>{children}</table>
    </div>
  );
}
```

`admin-web/src/ui/PageHeader.tsx`:
```tsx
import { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  nav?: ReactNode;
}

export function PageHeader({ title, nav }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="font-heading text-2xl font-semibold text-heading">{title}</h1>
      {nav && <nav className="flex flex-wrap items-center gap-3 text-sm">{nav}</nav>}
    </header>
  );
}
```

`admin-web/src/ui/PageContainer.tsx`:
```tsx
import { ReactNode } from 'react';

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}
```

`admin-web/src/ui/index.ts`:
```typescript
export * from './Alert';
export * from './Badge';
export * from './Button';
export * from './FormField';
export * from './Input';
export * from './PageContainer';
export * from './PageHeader';
export * from './Select';
export * from './Table';
export * from './Textarea';
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec admin-web npx vitest run src/ui`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/ui
git commit -m "Add shared UI primitives to admin-web"
```

---

### Task 4: Shared UI primitives in guest-web

**Files:**
- Create: `guest-web/src/ui/Button.tsx`, `guest-web/src/ui/FormField.tsx`, `guest-web/src/ui/Input.tsx`, `guest-web/src/ui/Select.tsx`, `guest-web/src/ui/Textarea.tsx`, `guest-web/src/ui/Alert.tsx`, `guest-web/src/ui/Badge.tsx`, `guest-web/src/ui/Table.tsx`, `guest-web/src/ui/PageHeader.tsx`, `guest-web/src/ui/PageContainer.tsx`, `guest-web/src/ui/index.ts`
- Create: `guest-web/src/ui/Button.test.tsx`, `guest-web/src/ui/FormField.test.tsx`, `guest-web/src/ui/Alert.test.tsx`

**Interfaces:**
- Produces: the same component API as Task 3 (`Button`, `FormField`, `Input`, `Select`, `Textarea`, `Alert`, `Badge`, `Table`, `PageHeader`, `PageContainer`), resolving to guest-web's theme tokens — consumed by Task 12. `PageHeader`/`Table`/`Select`/`Badge` are included for API parity with admin-web even though guest-web's current pages don't all need them yet.

- [ ] **Step 1: Create the primitive source files**

These are the same component source as `admin-web/src/ui` (Task 3) — the class names reference the same theme token names (`bg-accent`, `text-heading`, etc.), which Task 2 already mapped to guest-web's own values, so no file needs to differ.

`guest-web/src/ui/Button.tsx`:
```tsx
import { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-border disabled:text-text-muted',
  secondary: 'bg-surface text-text border border-border hover:bg-border disabled:text-text-muted',
  danger: 'bg-danger text-white hover:opacity-90 disabled:bg-border disabled:text-text-muted',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
```

`guest-web/src/ui/Input.tsx`:
```tsx
import { InputHTMLAttributes } from 'react';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
```

`guest-web/src/ui/Select.tsx`:
```tsx
import { SelectHTMLAttributes } from 'react';

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
```

`guest-web/src/ui/Textarea.tsx`:
```tsx
import { TextareaHTMLAttributes } from 'react';

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
```

`guest-web/src/ui/FormField.tsx`:
```tsx
import { ReactNode } from 'react';

interface FormFieldProps {
  label: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function FormField({ label, error, children }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-text">
      {label}
      {children}
      {error && (
        <span role="alert" className="text-sm font-normal text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
```

`guest-web/src/ui/Alert.tsx`:
```tsx
import { ReactNode } from 'react';

type AlertTone = 'danger' | 'success';

const toneClasses: Record<AlertTone, string> = {
  danger: 'bg-danger-bg text-danger',
  success: 'bg-success-bg text-success',
};

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
}

export function Alert({ tone = 'danger', children }: AlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded px-3 py-2 text-sm ${toneClasses[tone]}`}>
      {children}
    </div>
  );
}
```

`guest-web/src/ui/Badge.tsx`:
```tsx
import { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-text-muted',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
```

`guest-web/src/ui/Table.tsx`:
```tsx
import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full min-w-[480px] border-collapse text-left text-sm ${className}`}>{children}</table>
    </div>
  );
}
```

`guest-web/src/ui/PageHeader.tsx`:
```tsx
import { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  nav?: ReactNode;
}

export function PageHeader({ title, nav }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="font-heading text-2xl font-semibold text-heading">{title}</h1>
      {nav && <nav className="flex flex-wrap items-center gap-3 text-sm">{nav}</nav>}
    </header>
  );
}
```

`guest-web/src/ui/PageContainer.tsx`:
```tsx
import { ReactNode } from 'react';

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}
```

`guest-web/src/ui/index.ts`:
```typescript
export * from './Alert';
export * from './Badge';
export * from './Button';
export * from './FormField';
export * from './Input';
export * from './PageContainer';
export * from './PageHeader';
export * from './Select';
export * from './Table';
export * from './Textarea';
```

- [ ] **Step 2: Create the primitive test files**

`guest-web/src/ui/Button.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label and forwards onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects the disabled prop', () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
```

`guest-web/src/ui/FormField.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './FormField';
import { Input } from './Input';

describe('FormField', () => {
  it('associates the label with its control', () => {
    render(
      <FormField label="Email">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders an error message', () => {
    render(
      <FormField label="Email" error="Required">
        <Input type="email" />
      </FormField>,
    );

    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
```

`guest-web/src/ui/Alert.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './Alert';

describe('Alert', () => {
  it('renders with role="alert" by default', () => {
    render(<Alert>Something went wrong</Alert>);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('renders with role="status" for the success tone', () => {
    render(<Alert tone="success">Saved</Alert>);

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
```

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `docker compose exec guest-web npx vitest run src/ui`
Expected: PASS (6 tests)

- [ ] **Step 4: Run the full guest-web suite**

Run: `docker compose exec guest-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add guest-web/src/ui
git commit -m "Add shared UI primitives to guest-web"
```

---

### Task 5: Retrofit admin-web LoginPage

**Files:**
- Modify: `admin-web/src/auth/LoginPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `Button`, `FormField`, `Input`, `Alert` (Task 3).

- [ ] **Step 1: Rewrite `LoginPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/auth/LoginPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PageContainer, Button, FormField, Input, Alert } from '../ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    }
  }

  return (
    <PageContainer>
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa - Admin</h1>
        <FormField label="Email">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </FormField>
        <FormField label="Password">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </FormField>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Log in</Button>
      </form>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/auth/LoginPage.test.tsx`
Expected: PASS — no changes needed to the test. It queries by `getByLabelText(/email/i)`, `getByLabelText(/password/i)`, `getByRole('button', {name: /log in/i})`, and `getByRole('alert')`, all of which the primitives preserve exactly.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/auth/LoginPage.tsx
git commit -m "Retrofit LoginPage onto the shared UI primitives"
```

---

### Task 6: Retrofit admin-web ReservationListPage

**Files:**
- Modify: `admin-web/src/reservations/ReservationListPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `PageHeader`, `Button`, `FormField`, `Select`, `Alert`, `Table` (Task 3).

- [ ] **Step 1: Rewrite `ReservationListPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/reservations/ReservationListPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listReservations } from '../api/reservations';
import { useAuth } from '../auth/AuthContext';
import { Reservation, ReservationSource, ReservationStatus } from './types';
import { PageContainer, PageHeader, Button, FormField, Select, Alert, Table } from '../ui';

const thClass = 'border-b border-border px-3 py-2 text-left font-semibold text-text-muted';
const tdClass = 'border-b border-border px-3 py-2';

export function ReservationListPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [source, setSource] = useState<ReservationSource | ''>('');
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setError(null);
    listReservations({
      source: source || undefined,
      status: status || undefined,
    })
      .then(setReservations)
      .catch((err) => {
        console.error('Failed to load reservations', err);
        setError('Could not load the reservations');
      });
  }, [source, status]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <PageContainer>
      <PageHeader
        title="Reservations"
        nav={
          <>
            <Link to="/settings" className="text-accent hover:underline">
              Settings
            </Link>
            <Link to="/guests" className="text-accent hover:underline">
              Guests
            </Link>
            <Link to="/templates" className="text-accent hover:underline">
              Templates
            </Link>
            <Link to="/campaigns" className="text-accent hover:underline">
              Campaigns
            </Link>
            <Link to="/reservations/new" className="text-accent hover:underline">
              New reservation
            </Link>
            <Button type="button" variant="secondary" onClick={handleLogout}>
              Log out
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-4">
        <FormField label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value as ReservationSource | '')}>
            <option value="">All</option>
            <option value="BOOKING">Booking.com</option>
            <option value="AIRBNB">Airbnb</option>
            <option value="DIRECT">Direct</option>
            <option value="OTHER">Other</option>
          </Select>
        </FormField>
        <FormField label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | '')}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="COMPLETED">Completed</option>
          </Select>
        </FormField>
      </div>
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>Guest</th>
            <th className={thClass}>Check-in</th>
            <th className={thClass}>Check-out</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td className={tdClass}>
                <Link to={`/reservations/${r.id}`} className="text-accent hover:underline">
                  {r.guestName}
                </Link>
                {r.missingFromChannelAt && <span> ⚠ No longer in channel feed</span>}
              </td>
              <td className={tdClass}>{r.checkIn}</td>
              <td className={tdClass}>{r.checkOut}</td>
              <td className={tdClass}>{r.source}</td>
              <td className={tdClass}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationListPage.test.tsx`
Expected: PASS — the test queries by `getByText`, `getByRole('alert')`, `getByRole('button', {name: /log out/i})`, and `getByLabelText(/source/i)`, all preserved.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/reservations/ReservationListPage.tsx
git commit -m "Retrofit ReservationListPage onto the shared UI primitives"
```

---

### Task 7: Retrofit admin-web ReservationFormPage

**Files:**
- Modify: `admin-web/src/reservations/ReservationFormPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `Alert`, `Button`, `FormField`, `Input`, `Select`, `Textarea` (Task 3).

- [ ] **Step 1: Rewrite `ReservationFormPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/reservations/ReservationFormPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  checkOverlap,
  createReservation,
  getReservation,
  listReservationEvents,
  markDepositReceived,
  markDepositReturned,
  markPaymentReceived,
  updateReservation,
} from '../api/reservations';
import { Reservation, ReservationEvent, ReservationSource, ReservationStatus } from './types';
import { PageContainer, Alert, Button, FormField, Input, Select, Textarea } from '../ui';

const emptyForm = {
  guestName: '',
  guestPhone: '',
  guestEmail: '',
  checkIn: '',
  checkOut: '',
  paxCount: 1,
  source: 'DIRECT' as ReservationSource,
  externalReference: '',
  totalAmount: 0,
  currency: 'ARS',
  status: 'PENDING' as ReservationStatus,
  notes: '',
};

export function ReservationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reservationRecord, setReservationRecord] = useState<Reservation | null>(null);
  const [events, setEvents] = useState<ReservationEvent[]>([]);
  const [overlaps, setOverlaps] = useState<Reservation[]>([]);
  const guestWebUrl = import.meta.env.VITE_GUEST_WEB_URL as string;

  function loadReservation() {
    if (!id) return;
    getReservation(id)
      .then((reservation: Reservation) => {
        setReservationRecord(reservation);
        setForm({
          ...emptyForm,
          ...reservation,
          checkIn: reservation.checkIn.slice(0, 10),
          checkOut: reservation.checkOut.slice(0, 10),
          totalAmount: Number(reservation.totalAmount),
        });
      })
      .catch((err) => {
        console.error('Failed to load the reservation', err);
        setError('Could not load the reservation');
      });
    listReservationEvents(id)
      .then(setEvents)
      .catch((err) => {
        console.error('Failed to load the reservation events', err);
      });
  }

  useEffect(() => {
    loadReservation();
  }, [id]);

  useEffect(() => {
    if (!form.checkIn || !form.checkOut) {
      setOverlaps([]);
      return;
    }
    checkOverlap(form.checkIn, form.checkOut, id)
      .then(setOverlaps)
      .catch(() => setOverlaps([]));
  }, [form.checkIn, form.checkOut, id]);

  async function handleMarkPaymentReceived() {
    if (!id) return;
    setActionError(null);
    try {
      await markPaymentReceived(id);
      loadReservation();
    } catch {
      setActionError('Could not mark the 30% payment as received. Please try again.');
    }
  }

  async function handleMarkDepositReceived() {
    if (!id) return;
    setActionError(null);
    try {
      await markDepositReceived(id);
      loadReservation();
    } catch {
      setActionError('Could not mark the deposit as received. Please try again.');
    }
  }

  async function handleMarkDepositReturned() {
    if (!id) return;
    setActionError(null);
    try {
      await markDepositReturned(id);
      loadReservation();
    } catch {
      setActionError('Could not mark the deposit as returned. Please try again.');
    }
  }

  function copyGuestLink() {
    if (!reservationRecord) return;
    navigator.clipboard.writeText(`${guestWebUrl}/r/${reservationRecord.confirmationToken}`);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditing && id) {
        await updateReservation(id, form);
      } else {
        await createReservation(form);
      }
      navigate('/');
    } catch {
      setError('Could not save the reservation');
    }
  }

  return (
    <PageContainer>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">
          {isEditing ? 'Edit reservation' : 'New reservation'}
        </h1>
        {overlaps.length > 0 && (
          <Alert>
            <p>These dates overlap with existing reservation(s):</p>
            <ul className="mt-1 list-disc pl-5">
              {overlaps.map((o) => (
                <li key={o.id}>
                  {o.guestName} ({o.source}): {o.checkIn.slice(0, 10)} – {o.checkOut.slice(0, 10)}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <FormField label="Guest name">
          <Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} required />
        </FormField>
        <FormField label="Check-in">
          <Input
            type="date"
            value={form.checkIn}
            onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            required
          />
        </FormField>
        <FormField label="Check-out">
          <Input
            type="date"
            value={form.checkOut}
            onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            required
          />
        </FormField>
        <FormField label="Pax">
          <Input
            type="number"
            min={1}
            value={form.paxCount}
            onChange={(e) => setForm({ ...form, paxCount: Number(e.target.value) })}
            required
          />
        </FormField>
        <FormField label="Source">
          <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ReservationSource })}>
            <option value="BOOKING">Booking.com</option>
            <option value="AIRBNB">Airbnb</option>
            <option value="DIRECT">Direct</option>
            <option value="OTHER">Other</option>
          </Select>
        </FormField>
        <FormField label="Total amount">
          <Input
            type="number"
            min={0}
            value={form.totalAmount}
            onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })}
            required
          />
        </FormField>
        <FormField label="Currency">
          <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
        </FormField>
        {isEditing && (
          <FormField label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReservationStatus })}>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="COMPLETED">Completed</option>
            </Select>
          </FormField>
        )}
        <FormField label="Notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormField>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Save</Button>
      </form>
      {isEditing && reservationRecord && (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Onboarding progress</h2>
          {actionError && <Alert>{actionError}</Alert>}
          {reservationRecord.missingFromChannelAt && (
            <Alert>
              No longer found in the channel's calendar as of{' '}
              {new Date(reservationRecord.missingFromChannelAt).toLocaleString()} — confirm with the guest or cancel
              this reservation.
            </Alert>
          )}
          <ul className="flex flex-col gap-2">
            <li>Dates confirmed: {reservationRecord.datesConfirmedAt ? 'Yes' : 'No'}</li>
            <li>
              Contract accepted:{' '}
              {reservationRecord.contractAcceptedAt ? `Yes (${reservationRecord.contractAcceptedName})` : 'No'}
            </li>
            <li>
              30% payment received:{' '}
              {reservationRecord.confirmationPaymentReceivedAt ? (
                'Yes'
              ) : (
                <Button type="button" variant="secondary" onClick={handleMarkPaymentReceived}>
                  Mark 30% payment received
                </Button>
              )}
            </li>
            <li>
              Deposit received:{' '}
              {reservationRecord.depositReceivedAt ? (
                'Yes'
              ) : (
                <Button type="button" variant="secondary" onClick={handleMarkDepositReceived}>
                  Mark deposit received
                </Button>
              )}
            </li>
            <li>
              Deposit returned:{' '}
              {reservationRecord.depositReturnedAt ? (
                'Yes'
              ) : (
                <Button type="button" variant="secondary" onClick={handleMarkDepositReturned}>
                  Mark deposit returned
                </Button>
              )}
            </li>
          </ul>
          <Button type="button" variant="secondary" className="mt-3" onClick={copyGuestLink}>
            Copy guest confirmation link
          </Button>

          <h2 className="mb-3 mt-6 font-heading text-lg font-semibold text-heading">Event history</h2>
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {events.map((event) => (
              <li key={event.id}>
                {event.type} — {new Date(event.createdAt).toLocaleString()}
                {event.detail ? `: ${event.detail}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: PASS — the test queries by `getByLabelText` (guest name, check-in, check-out, total amount), `getByRole('button', ...)` (save, mark 30% payment received), `getByRole('alert')`, and `findByText`, all preserved.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/reservations/ReservationFormPage.tsx
git commit -m "Retrofit ReservationFormPage onto the shared UI primitives"
```

---

### Task 8: Retrofit admin-web GuestListPage

**Files:**
- Modify: `admin-web/src/guests/GuestListPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `PageHeader`, `Alert`, `Table`, `Badge` (Task 3).

- [ ] **Step 1: Rewrite `GuestListPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/guests/GuestListPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, Guest } from '../api/guests';
import { PageContainer, PageHeader, Alert, Table, Badge } from '../ui';

const thClass = 'border-b border-border px-3 py-2 text-left font-semibold text-text-muted';
const tdClass = 'border-b border-border px-3 py-2';

export function GuestListPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch(() => setError('Could not load the guests. Please reload the page.'));
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Guests"
        nav={
          <Link to="/" className="text-accent hover:underline">
            Reservations
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Email</th>
            <th className={thClass}>Phone</th>
            <th className={thClass}>Total stays</th>
            <th className={thClass}>Last stay</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td className={tdClass}>{g.name}</td>
              <td className={tdClass}>{g.email}</td>
              <td className={tdClass}>{g.phone ?? '—'}</td>
              <td className={tdClass}>{g.totalStays}</td>
              <td className={tdClass}>{g.lastStayAt ? new Date(g.lastStayAt).toLocaleDateString() : '—'}</td>
              <td className={tdClass}>
                <Badge tone={g.unsubscribedAt ? 'warning' : 'success'}>
                  {g.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/guests/GuestListPage.test.tsx`
Expected: PASS — the test queries by `getByText` (name, "unsubscribed") and `findByRole('alert')`, both preserved.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/guests/GuestListPage.tsx
git commit -m "Retrofit GuestListPage onto the shared UI primitives"
```

---

### Task 9: Retrofit admin-web TemplatesPage

**Files:**
- Modify: `admin-web/src/templates/TemplatesPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `PageHeader`, `Alert`, `Button`, `FormField`, `Input`, `Textarea` (Task 3).

- [ ] **Step 1: Rewrite `TemplatesPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/templates/TemplatesPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listCampaignTemplates,
  createCampaignTemplate,
  deleteCampaignTemplate,
  CampaignTemplate,
} from '../api/campaign-templates';
import { PageContainer, PageHeader, Alert, Button, FormField, Input, Textarea } from '../ui';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setLoadError('Could not load the templates. Please reload the page.'));
  }

  useEffect(reload, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      await createCampaignTemplate({ name, subject, bodyHtml });
      setName('');
      setSubject('');
      setBodyHtml('');
      reload();
    } catch {
      setActionError('Could not create the template. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await deleteCampaignTemplate(id);
      reload();
    } catch {
      setActionError('Could not delete the template — it may already be used in a campaign.');
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        nav={
          <Link to="/" className="text-accent hover:underline">
            Reservations
          </Link>
        }
      />
      {loadError && <Alert>{loadError}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}
      <form onSubmit={handleCreate} className="mb-8 flex flex-col gap-4">
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label="Body">
          <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={6} />
        </FormField>
        <p className="text-sm text-text-muted">
          Use <code className="rounded bg-surface px-1 py-0.5">{'{{guestName}}'}</code> in the subject or body to
          insert the guest's name.
        </p>
        <Button type="submit">Create template</Button>
      </form>
      <ul className="flex flex-col gap-2">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 border-b border-border pb-2">
            <span>
              <strong>{t.name}</strong> — {t.subject}
            </span>
            <Button type="button" variant="danger" onClick={() => handleDelete(t.id)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/templates/TemplatesPage.test.tsx`
Expected: PASS — the test queries by `getByLabelText(/^name$/i)`, `getByLabelText(/subject/i)`, `getByLabelText(/body/i)`, `getByRole('button', ...)` (create template, delete), `getByText`, and `findByRole('alert')`, all preserved.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/templates/TemplatesPage.tsx
git commit -m "Retrofit TemplatesPage onto the shared UI primitives"
```

---

### Task 10: Retrofit admin-web CampaignsPage

**Files:**
- Modify: `admin-web/src/campaigns/CampaignsPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `PageHeader`, `Alert`, `Badge`, `Button`, `FormField`, `Input`, `Select` (Task 3).

- [ ] **Step 1: Rewrite `CampaignsPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/campaigns/CampaignsPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCampaignTemplates, CampaignTemplate } from '../api/campaign-templates';
import {
  previewCampaign,
  sendCampaign,
  listCampaignHistory,
  Campaign,
  CampaignFilterType,
} from '../api/campaigns';
import { PageContainer, PageHeader, Alert, Badge, Button, FormField, Input, Select } from '../ui';

export function CampaignsPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [filterType, setFilterType] = useState<CampaignFilterType | ''>('');
  const [filterMonths, setFilterMonths] = useState('6');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [history, setHistory] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setError('Could not load templates.'));
    reloadHistory();
  }, []);

  function reloadHistory() {
    listCampaignHistory()
      .then(setHistory)
      .catch(() => setError('Could not load campaign history.'));
  }

  useEffect(() => {
    if (!templateId || !filterType) {
      setRecipientCount(null);
      return;
    }
    if (filterType !== 'ALL' && !filterMonths) {
      setRecipientCount(null);
      return;
    }
    // Clear the previous count immediately so a stale value is never shown
    // (and the Send button stays disabled) while the new preview is in flight.
    setRecipientCount(null);
    let isCurrent = true;
    const query = {
      templateId,
      filterType,
      filterMonths: filterType === 'ALL' ? undefined : Number(filterMonths),
    };
    previewCampaign(query)
      .then((result) => {
        // Discard the result if a newer selection has superseded this request.
        if (isCurrent) setRecipientCount(result.recipientCount);
      })
      .catch(() => {
        if (isCurrent) setRecipientCount(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [templateId, filterType, filterMonths]);

  async function handleSend() {
    if (!templateId || !filterType) return;
    if (!window.confirm(`Send this campaign to ${recipientCount ?? 0} guest(s)? This cannot be undone.`)) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendCampaign({
        templateId,
        filterType,
        filterMonths: filterType === 'ALL' ? undefined : Number(filterMonths),
      });
      reloadHistory();
    } catch {
      setError('Could not send the campaign. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        nav={
          <Link to="/" className="text-accent hover:underline">
            Reservations
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}
      <section className="mb-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Compose</h2>
        <div className="flex flex-col gap-4">
          <FormField label="Template">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Select a template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Filter">
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value as CampaignFilterType | '')}>
              <option value="">Select a filter</option>
              <option value="ALL">All guests</option>
              <option value="STAYED_WITHIN_MONTHS">Stayed within the last N months</option>
              <option value="NOT_STAYED_WITHIN_MONTHS">Not stayed within the last N months</option>
            </Select>
          </FormField>
          {filterType !== 'ALL' && filterType !== '' && (
            <FormField label="N months">
              <Input type="number" min={1} value={filterMonths} onChange={(e) => setFilterMonths(e.target.value)} />
            </FormField>
          )}
          {recipientCount !== null && (
            <p className="text-sm text-text-muted">{recipientCount} recipient(s) match this filter.</p>
          )}
          <Button type="button" onClick={handleSend} disabled={sending || recipientCount === null}>
            Send campaign
          </Button>
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">History</h2>
        <ul className="flex flex-col gap-4">
          {history.map((c) => (
            <li key={c.id} className="border-b border-border pb-4">
              <p>
                {c.template.name} — {c.recipientCount} recipient(s) — {new Date(c.sentAt).toLocaleString()}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {c.recipients.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <Badge tone={r.status === 'SENT' ? 'success' : 'danger'}>{r.status}</Badge>
                    {r.error ? <span>{r.error}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/campaigns/CampaignsPage.test.tsx`
Expected: PASS — the test queries by `getByLabelText` (template, filter, N months), `getByText` (recipient count, template name), and `getByRole('button', {name: /send campaign/i})`, all preserved.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/campaigns/CampaignsPage.tsx
git commit -m "Retrofit CampaignsPage onto the shared UI primitives"
```

---

### Task 11: Retrofit admin-web SettingsPage

**Files:**
- Modify: `admin-web/src/settings/SettingsPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `Alert`, `Button`, `FormField`, `Input`, `Textarea` (Task 3).

- [ ] **Step 1: Rewrite `SettingsPage.tsx` using the shared primitives**

Replace the entire contents of `admin-web/src/settings/SettingsPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings, runChannelSync } from '../api/settings';
import {
  getGoogleCalendarStatus,
  getGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  runGoogleCalendarSync,
} from '../api/google-calendar';
import { PageContainer, Alert, Button, FormField, Input, Textarea } from '../ui';

export function SettingsPage() {
  const [houseRulesText, setHouseRulesText] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [bookingIcalUrl, setBookingIcalUrl] = useState('');
  const [airbnbIcalUrl, setAirbnbIcalUrl] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncActionError, setSyncActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleLastSyncAt, setGoogleLastSyncAt] = useState<string | null>(null);
  const [googleLastSyncError, setGoogleLastSyncError] = useState<string | null>(null);
  const [googleActionError, setGoogleActionError] = useState<string | null>(null);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleCallbackStatus, setGoogleCallbackStatus] = useState<'connected' | 'error' | null>(null);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setHouseRulesText(settings.houseRulesText);
        setPaymentInstructions(settings.paymentInstructions);
        setBookingIcalUrl(settings.bookingIcalUrl ?? '');
        setAirbnbIcalUrl(settings.airbnbIcalUrl ?? '');
        setLastSyncAt(settings.lastChannelSyncAt);
        setLastSyncError(settings.lastChannelSyncError);
      })
      .catch(() => {
        setLoadError('Could not load the settings. Please reload the page.');
      });
  }, []);

  useEffect(() => {
    const googleCalendarParam = new URLSearchParams(window.location.search).get('googleCalendar');
    if (googleCalendarParam === 'connected' || googleCalendarParam === 'error') {
      setGoogleCallbackStatus(googleCalendarParam);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    getGoogleCalendarStatus()
      .then((status) => {
        setGoogleConnected(status.connected);
        setGoogleLastSyncAt(status.lastSyncAt);
        setGoogleLastSyncError(status.lastSyncError);
      })
      .catch(() => {
        // Status is a secondary concern to the main Settings form — fail silently, the
        // section below simply won't have anything to show.
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setSaveError(null);
    try {
      await updateSettings({
        houseRulesText,
        paymentInstructions,
        bookingIcalUrl,
        airbnbIcalUrl,
        lastChannelSyncAt: lastSyncAt,
        lastChannelSyncError: lastSyncError,
      });
      setSaved(true);
    } catch {
      setSaveError('Could not save the settings. Please try again.');
    }
  }

  async function handleSyncNow() {
    setSyncActionError(null);
    setSyncing(true);
    try {
      await runChannelSync();
      const settings = await getSettings();
      setLastSyncAt(settings.lastChannelSyncAt);
      setLastSyncError(settings.lastChannelSyncError);
    } catch {
      setSyncActionError('Could not trigger the sync. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleConnectGoogleCalendar() {
    setGoogleActionError(null);
    try {
      const { url } = await getGoogleCalendarConnectUrl();
      window.location.href = url;
    } catch {
      setGoogleActionError('Could not start the Google Calendar connection. Please try again.');
    }
  }

  async function handleDisconnectGoogleCalendar() {
    setGoogleActionError(null);
    try {
      await disconnectGoogleCalendar();
      setGoogleConnected(false);
    } catch {
      setGoogleActionError('Could not disconnect Google Calendar. Please try again.');
    }
  }

  async function handleSyncGoogleCalendarNow() {
    setGoogleActionError(null);
    setGoogleSyncing(true);
    try {
      await runGoogleCalendarSync();
      const status = await getGoogleCalendarStatus();
      setGoogleLastSyncAt(status.lastSyncAt);
      setGoogleLastSyncError(status.lastSyncError);
    } catch {
      setGoogleActionError('Could not trigger the sync. Please try again.');
    } finally {
      setGoogleSyncing(false);
    }
  }

  return (
    <PageContainer>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">Settings</h1>
        {loadError && <Alert>{loadError}</Alert>}
        {saveError && <Alert>{saveError}</Alert>}
        <FormField label="House rules">
          <Textarea value={houseRulesText} onChange={(e) => setHouseRulesText(e.target.value)} rows={8} />
        </FormField>
        <FormField label="Payment instructions">
          <Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={8} />
        </FormField>
        <FormField label="Booking.com iCal URL">
          <Input value={bookingIcalUrl} onChange={(e) => setBookingIcalUrl(e.target.value)} />
        </FormField>
        <FormField label="Airbnb iCal URL">
          <Input value={airbnbIcalUrl} onChange={(e) => setAirbnbIcalUrl(e.target.value)} />
        </FormField>
        {saved && <Alert tone="success">Saved</Alert>}
        <Button type="submit">Save</Button>
      </form>
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Channel sync</h2>
        {lastSyncError ? (
          <Alert>Last sync failed: {lastSyncError}</Alert>
        ) : (
          <p className="text-sm text-text-muted">
            Last synced: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never'}
          </p>
        )}
        {syncActionError && <Alert>{syncActionError}</Alert>}
        <Button type="button" variant="secondary" className="mt-3" onClick={handleSyncNow} disabled={syncing}>
          Sync now
        </Button>
      </section>
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Google Calendar</h2>
        {googleCallbackStatus === 'connected' && <Alert tone="success">Google Calendar connected.</Alert>}
        {googleCallbackStatus === 'error' && <Alert>Could not connect Google Calendar. Please try again.</Alert>}
        {googleActionError && <Alert>{googleActionError}</Alert>}
        {googleConnected ? (
          <>
            {googleLastSyncError ? (
              <Alert>Last sync failed: {googleLastSyncError}</Alert>
            ) : (
              <p className="text-sm text-text-muted">
                Connected — last synced: {googleLastSyncAt ? new Date(googleLastSyncAt).toLocaleString() : 'never'}
              </p>
            )}
            <div className="mt-3 flex gap-3">
              <Button type="button" variant="secondary" onClick={handleSyncGoogleCalendarNow} disabled={googleSyncing}>
                Sync Google Calendar now
              </Button>
              <Button type="button" variant="danger" onClick={handleDisconnectGoogleCalendar}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">Not connected.</p>
            <Button type="button" className="mt-3" onClick={handleConnectGoogleCalendar}>
              Connect Google Calendar
            </Button>
          </>
        )}
      </section>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Run the page's test file and confirm it still passes**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: PASS — the test queries by `getByLabelText` (house rules, Booking.com iCal URL), `getByRole('button', ...)` (save, sync now, connect/disconnect/sync Google Calendar), `findByRole('status')` (saved, connected), and `findByRole('alert')`, all preserved.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/settings/SettingsPage.tsx
git commit -m "Retrofit SettingsPage onto the shared UI primitives"
```

---

### Task 12: Retrofit guest-web (App.tsx + ConfirmationPage) and final full-suite check

**Files:**
- Modify: `guest-web/src/App.tsx`, `guest-web/src/confirmation/ConfirmationPage.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `Alert`, `Button`, `FormField`, `Input` (Task 4).

- [ ] **Step 1: Rewrite `App.tsx`'s `HomePlaceholder` using the shared primitives**

Replace the entire contents of `guest-web/src/App.tsx`:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfirmationPage } from './confirmation/ConfirmationPage';
import { PageContainer } from './ui';

function HomePlaceholder() {
  return (
    <PageContainer>
      <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa de Mar del Plata</h1>
      <p className="mt-2 text-text-muted">Guest portal coming soon.</p>
    </PageContainer>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePlaceholder />} />
        <Route path="/r/:token" element={<ConfirmationPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Rewrite `ConfirmationPage.tsx` using the shared primitives**

Replace the entire contents of `guest-web/src/confirmation/ConfirmationPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import { GuestReservation } from './types';
import { PageContainer, Alert, Button, FormField, Input } from '../ui';

export function ConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [reservation, setReservation] = useState<GuestReservation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!token) return;
    getReservationByToken(token)
      .then((r) => {
        setReservation(r);
        setNotFound(false);
        setLoadError(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(true);
        }
      });
  }

  useEffect(load, [token]);

  async function handleConfirmDates() {
    if (!token) return;
    setError(null);
    try {
      await confirmDates(token);
      load();
    } catch {
      setError('Could not confirm dates. Please try again.');
    }
  }

  async function handleAcceptContract(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await acceptContract(token, fullName);
      load();
    } catch {
      setError('Could not accept the contract. Please try again.');
    }
  }

  if (notFound) {
    return (
      <PageContainer>
        <h1 className="font-heading text-2xl font-semibold text-heading">Reservation not found</h1>
        <p className="mt-2 text-text-muted">This confirmation link is invalid. Please contact us directly.</p>
      </PageContainer>
    );
  }

  if (loadError) {
    return (
      <PageContainer>
        <h1 className="font-heading text-2xl font-semibold text-heading">Unable to load reservation</h1>
        <p className="mt-2 text-text-muted">
          Something went wrong loading your reservation. Please try again or contact us directly.
        </p>
      </PageContainer>
    );
  }

  if (!reservation) {
    return (
      <PageContainer>
        <p className="text-text-muted">Loading...</p>
      </PageContainer>
    );
  }

  const allDone = Boolean(
    reservation.datesConfirmedAt &&
      reservation.contractAcceptedAt &&
      reservation.confirmationPaymentReceivedAt &&
      reservation.depositReceivedAt,
  );

  return (
    <PageContainer>
      <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa de Mar del Plata</h1>
      <h2 className="mt-1 font-heading text-lg font-semibold text-heading">
        Reservation for {reservation.guestName}
      </h2>
      <p className="mt-4 text-text">Check-in: {reservation.checkIn.slice(0, 10)}</p>
      <p className="text-text">Check-out: {reservation.checkOut.slice(0, 10)}</p>
      <p className="text-text">Guests: {reservation.paxCount}</p>
      <p className="text-text">
        Total: {reservation.totalAmount} {reservation.currency}
      </p>

      {error && <Alert>{error}</Alert>}

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">1. Confirm your dates</h3>
        {reservation.datesConfirmedAt ? (
          <p className="text-text">Confirmed.</p>
        ) : (
          <Button type="button" onClick={handleConfirmDates}>
            Confirm dates and guests
          </Button>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">2. Accept the house rules</h3>
        <p className="whitespace-pre-wrap text-text">{reservation.houseRulesText}</p>
        {reservation.contractAcceptedAt ? (
          <p className="text-text">Accepted by {reservation.contractAcceptedName}.</p>
        ) : (
          <form onSubmit={handleAcceptContract} className="mt-3 flex flex-col gap-3">
            <FormField label="Full name">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </FormField>
            <Button type="submit">I accept the house rules</Button>
          </form>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-heading text-base font-semibold text-heading">3. Payment</h3>
        <p className="whitespace-pre-wrap text-text">{reservation.paymentInstructions}</p>
        <p className="mt-2 text-text">
          30% confirmation payment ({reservation.confirmationPaymentAmount} {reservation.currency}):{' '}
          {reservation.confirmationPaymentReceivedAt ? 'Received' : 'Pending'}
        </p>
        <p className="text-text">Security deposit: {reservation.depositReceivedAt ? 'Received' : 'Pending'}</p>
      </section>

      {allDone && (
        <p className="mt-6 text-text">Your reservation is fully confirmed. We look forward to hosting you!</p>
      )}
    </PageContainer>
  );
}
```

- [ ] **Step 3: Run the page's test file and confirm it still passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx`
Expected: PASS — the test queries by `findByText` (not found / error / confirmed messages, guest name, payment amount), `getByLabelText(/full name/i)`, and `getByRole('button', ...)` (confirm dates, accept house rules), all preserved.

- [ ] **Step 4: Run the full guest-web suite**

Run: `docker compose exec guest-web npm test`
Expected: all suites PASS, no regressions.

- [ ] **Step 5: Run the full admin-web suite one more time**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS — a final cross-task regression check now that every admin-web page has been retrofitted.

- [ ] **Step 6: Verify both apps still build for production**

Run:
```bash
docker compose exec admin-web npm run build
docker compose exec guest-web npm run build
```
Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add guest-web/src/App.tsx guest-web/src/confirmation/ConfirmationPage.tsx
git commit -m "Retrofit guest-web's home placeholder and ConfirmationPage onto the shared UI primitives"
```
