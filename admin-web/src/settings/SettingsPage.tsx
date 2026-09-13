import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings, runChannelSync } from '../api/settings';
import {
  getGoogleCalendarStatus,
  getGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  runGoogleCalendarSync,
} from '../api/google-calendar';

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
    <>
      <form onSubmit={handleSubmit}>
        <h1>Settings</h1>
        {loadError && <p role="alert">{loadError}</p>}
        {saveError && <p role="alert">{saveError}</p>}
        <label>
          House rules
          <textarea value={houseRulesText} onChange={(e) => setHouseRulesText(e.target.value)} rows={8} />
        </label>
        <label>
          Payment instructions
          <textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={8} />
        </label>
        <label>
          Booking.com iCal URL
          <input value={bookingIcalUrl} onChange={(e) => setBookingIcalUrl(e.target.value)} />
        </label>
        <label>
          Airbnb iCal URL
          <input value={airbnbIcalUrl} onChange={(e) => setAirbnbIcalUrl(e.target.value)} />
        </label>
        {saved && <p role="status">Saved</p>}
        <button type="submit">Save</button>
      </form>
      <section>
        <h2>Channel sync</h2>
        {lastSyncError ? (
          <p role="alert">Last sync failed: {lastSyncError}</p>
        ) : (
          <p>Last synced: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never'}</p>
        )}
        {syncActionError && <p role="alert">{syncActionError}</p>}
        <button type="button" onClick={handleSyncNow} disabled={syncing}>
          Sync now
        </button>
      </section>
      <section>
        <h2>Google Calendar</h2>
        {googleActionError && <p role="alert">{googleActionError}</p>}
        {googleConnected ? (
          <>
            {googleLastSyncError ? (
              <p role="alert">Last sync failed: {googleLastSyncError}</p>
            ) : (
              <p>Connected — last synced: {googleLastSyncAt ? new Date(googleLastSyncAt).toLocaleString() : 'never'}</p>
            )}
            <button type="button" onClick={handleSyncGoogleCalendarNow} disabled={googleSyncing}>
              Sync Google Calendar now
            </button>
            <button type="button" onClick={handleDisconnectGoogleCalendar}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <p>Not connected.</p>
            <button type="button" onClick={handleConnectGoogleCalendar}>
              Connect Google Calendar
            </button>
          </>
        )}
      </section>
    </>
  );
}
