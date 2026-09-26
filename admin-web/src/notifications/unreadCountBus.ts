// Lets any component that changes notification read-state (e.g. NotificationsPage marking one
// read) tell AppNav's unread-count badge to refresh immediately, instead of waiting for its
// next polling tick (see AppNav's UNREAD_POLL_MS) - there's no shared state/context between
// them otherwise.
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyUnreadCountChanged(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeToUnreadCountChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
