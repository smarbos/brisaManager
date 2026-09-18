export function LoadingState({ message = 'Cargando...' }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      {message}
    </div>
  );
}
