import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api/settings';

export function SettingsPage() {
  const [houseRulesText, setHouseRulesText] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setHouseRulesText(settings.houseRulesText);
        setPaymentInstructions(settings.paymentInstructions);
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
      await updateSettings({ houseRulesText, paymentInstructions });
      setSaved(true);
    } catch {
      setSaveError('Could not save the settings. Please try again.');
    }
  }

  return (
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
      {saved && <p role="status">Saved</p>}
      <button type="submit">Save</button>
    </form>
  );
}
