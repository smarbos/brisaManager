import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listNotifications, markNotificationRead, Notification } from '../api/notifications';
import {
  PageContainer,
  PageHeader,
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Table,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDateTime } from '../lib/date';
import { notificationTypeLabel } from '../lib/labels';

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
      <Card>
        {loading ? (
          <LoadingState />
        ) : notifications.length === 0 ? (
          <EmptyState message="No hay notificaciones." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Tipo</th>
                <th className={thClass}>Mensaje</th>
                <th className={thClass}>Reserva</th>
                <th className={thClass}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((notification) => (
                <tr key={notification.id} className={notification.readAt ? undefined : 'bg-accent/5'}>
                  <td className={tdClass}>{formatDateTime(notification.createdAt)}</td>
                  <td className={tdClass}>
                    <Badge tone={notification.readAt ? 'neutral' : 'warning'}>
                      {notificationTypeLabel(notification.type)}
                    </Badge>
                  </td>
                  <td className={tdClass}>{notification.message}</td>
                  <td className={tdClass}>
                    {notification.reservation ? (
                      <Link to={`/reservations/${notification.reservation.id}`} className="text-accent hover:underline">
                        {notification.reservation.guestName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={tdClass}>
                    {!notification.readAt && (
                      <Button
                        type="button"
                        variant="secondary"
                        loading={markingId === notification.id}
                        onClick={() => handleMarkRead(notification.id)}
                      >
                        Marcar como leída
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
