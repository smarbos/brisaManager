import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listNotifications, markNotificationRead, Notification, NotificationType } from '../api/notifications';
import { notifyUnreadCountChanged } from './unreadCountBus';
import { PageContainer, PageHeader, Alert, Badge, Button, Card, EmptyState, LoadingState } from '../ui';
import { formatDateTime } from '../lib/date';
import { notificationTypeLabel } from '../lib/labels';

const NOTIFICATION_ICON_PATHS: Record<NotificationType, string> = {
  CALENDAR_MISMATCH: 'M4 6h16M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M4 6v12a2 2 0 0 0 2 2h6M16 3v3M8 3v3|M16.5 15.5 19 18l2.5-2.5M19 14v1',
  PAYMENT_RECEIPT_UPLOADED: 'M7 3h10a1 1 0 0 1 1 1v16l-2.5-1.5L13 20l-2.5-1.5L8 20l-2.5-1.5L3.5 20V4a1 1 0 0 1 1-1z|M8.5 8h7M8.5 11.5h7M8.5 15h4',
  GUEST_MESSAGE: 'M4 5h16v11H8l-4 4z',
  AMBIENT_ALERT: 'M12 3 2 20h20L12 3z|M12 10v4M12 16.5v.01',
  DEVICE_OFFLINE: 'M4 4l16 16|M5 9.5a12 12 0 0 1 5.5-2.6M13.5 6.9a12 12 0 0 1 5 2.6M2 4.9a16 16 0 0 1 4.2-2.4M8.5 12.5a7 7 0 0 1 5.6-.4M12 17.5v.01',
};

function NotificationIcon({ type }: { type: NotificationType }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      {NOTIFICATION_ICON_PATHS[type].split('|').map((piece, i) => (
        <path key={i} d={piece} />
      ))}
    </svg>
  );
}

function NotificationRow({
  notification,
  marking,
  onMarkRead,
}: {
  notification: Notification;
  marking: boolean;
  onMarkRead: () => void;
}) {
  const unread = !notification.readAt;
  return (
    <div
      className={`flex flex-wrap items-start gap-3.5 border-b border-border p-4 last:border-0 sm:flex-nowrap sm:items-center ${unread ? 'bg-accent/5' : ''}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          unread ? 'bg-accent/10 text-accent' : 'bg-bg text-text-muted'
        }`}
      >
        <NotificationIcon type={notification.type} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={unread ? 'warning' : 'neutral'}>{notificationTypeLabel(notification.type)}</Badge>
          <span className="text-xs text-text-muted">{formatDateTime(notification.createdAt)}</span>
        </div>
        <p className="mt-1 text-sm text-text">{notification.message}</p>
        {notification.reservation && (
          <Link
            to={`/reservations/${notification.reservation.id}`}
            className="mt-0.5 inline-block text-sm text-accent hover:underline"
          >
            {notification.reservation.guestName}
          </Link>
        )}
      </div>
      {unread && (
        <Button type="button" variant="outline" loading={marking} onClick={onMarkRead}>
          Marcar como leída
        </Button>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);

  function load() {
    setError(null);
    setLoading(true);
    listNotifications()
      .then(setNotifications)
      .catch(() => setError('No se pudieron cargar las notificaciones. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleMarkRead(id: string) {
    setMarkingId(id);
    try {
      await markNotificationRead(id);
      load();
      notifyUnreadCountChanged();
    } catch {
      setError('No se pudo marcar la notificación como leída. Por favor, intentá de nuevo.');
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Notificaciones" subtitle="Alertas del sistema: calendarios sin coincidencia y comprobantes de pago subidos." />
      {error && <Alert>{error}</Alert>}
      <Card className="!p-0">
        {loading ? (
          <div className="p-6">
            <LoadingState />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-6">
            <EmptyState message="No hay notificaciones." />
          </div>
        ) : (
          <div className="flex flex-col">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                marking={markingId === notification.id}
                onMarkRead={() => handleMarkRead(notification.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
