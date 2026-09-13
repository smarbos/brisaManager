import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api/settings';

export function SettingsPage() {
  const [houseRulesText, setHouseRulesText] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((settings) => {
      setHouseRulesText(settings.houseRulesText);
      setPaymentInstructions(settings.paymentInstructions);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await updateSettings({ houseRulesText, paymentInstructions });
    setSaved(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Settings</h1>
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
