import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings, runChannelSync } from '../api/settings';
import {
  getGoogleCalendarStatus,
  getGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  runGoogleCalendarSync,
} from '../api/google-calendar';
import { PageContainer, Alert, Button, FormField, Input, Textarea } from '../ui';
import { formatDateTime } from '../lib/date';

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
        setLoadError('No se pudo cargar la configuración. Por favor, recargá la página.');
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
      setSaveError('No se pudo guardar la configuración. Por favor, intentá de nuevo.');
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
      setSyncActionError('No se pudo iniciar la sincronización. Por favor, intentá de nuevo.');
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
      setGoogleActionError('No se pudo iniciar la conexión con Google Calendar. Por favor, intentá de nuevo.');
    }
  }

  async function handleDisconnectGoogleCalendar() {
    setGoogleActionError(null);
    try {
      await disconnectGoogleCalendar();
      setGoogleConnected(false);
    } catch {
      setGoogleActionError('No se pudo desconectar Google Calendar. Por favor, intentá de nuevo.');
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
      setGoogleActionError('No se pudo iniciar la sincronización. Por favor, intentá de nuevo.');
    } finally {
      setGoogleSyncing(false);
    }
  }

  return (
    <PageContainer>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">Configuración</h1>
        {loadError && <Alert>{loadError}</Alert>}
        {saveError && <Alert>{saveError}</Alert>}
        <FormField label="Reglas de la casa">
          <Textarea value={houseRulesText} onChange={(e) => setHouseRulesText(e.target.value)} rows={8} />
        </FormField>
        <FormField label="Instrucciones de pago">
          <Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={8} />
        </FormField>
        <FormField label="URL de iCal de Booking.com">
          <Input value={bookingIcalUrl} onChange={(e) => setBookingIcalUrl(e.target.value)} />
        </FormField>
        <FormField label="URL de iCal de Airbnb">
          <Input value={airbnbIcalUrl} onChange={(e) => setAirbnbIcalUrl(e.target.value)} />
        </FormField>
        {saved && <Alert tone="success">Guardado</Alert>}
        <Button type="submit">Guardar</Button>
      </form>
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Sincronización de canales</h2>
        {lastSyncError ? (
          <Alert>Falló la última sincronización: {lastSyncError}</Alert>
        ) : (
          <p className="text-sm text-text-muted">
            Última sincronización: {lastSyncAt ? formatDateTime(lastSyncAt) : 'nunca'}
          </p>
        )}
        {syncActionError && <Alert>{syncActionError}</Alert>}
        <Button type="button" variant="secondary" className="mt-3" onClick={handleSyncNow} disabled={syncing}>
          Sincronizar ahora
        </Button>
      </section>
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Google Calendar</h2>
        {googleCallbackStatus === 'connected' && <Alert tone="success">Google Calendar conectado.</Alert>}
        {googleCallbackStatus === 'error' && <Alert>No se pudo conectar Google Calendar. Por favor, intentá de nuevo.</Alert>}
        {googleActionError && <Alert>{googleActionError}</Alert>}
        {googleConnected ? (
          <>
            {googleLastSyncError ? (
              <Alert>Falló la última sincronización: {googleLastSyncError}</Alert>
            ) : (
              <p className="text-sm text-text-muted">
                Conectado — última sincronización: {googleLastSyncAt ? formatDateTime(googleLastSyncAt) : 'nunca'}
              </p>
            )}
            <div className="mt-3 flex gap-3">
              <Button type="button" variant="secondary" onClick={handleSyncGoogleCalendarNow} disabled={googleSyncing}>
                Sincronizar Google Calendar ahora
              </Button>
              <Button type="button" variant="danger" onClick={handleDisconnectGoogleCalendar}>
                Desconectar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">No conectado.</p>
            <Button type="button" className="mt-3" onClick={handleConnectGoogleCalendar}>
              Conectar Google Calendar
            </Button>
          </>
        )}
      </section>
    </PageContainer>
  );
}
