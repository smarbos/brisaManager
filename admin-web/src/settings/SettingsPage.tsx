import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings, runChannelSync } from '../api/settings';

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
    </>
  );
}
