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
