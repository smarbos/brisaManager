export function EmptyState({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="py-10 text-center text-sm text-text-muted">
      {message}
    </p>
  );
}
