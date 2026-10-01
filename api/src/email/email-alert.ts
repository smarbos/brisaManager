import { escapeHtml } from '../common/escape-html';

// Staff alert content, shared by EmailService.sendAlert() and EmailSenderService (which alerts
// when a guest email fails to send). Returns null when no alert address is configured.
export function buildAlert(subject: string, message: string): { to: string; subject: string; html: string } | null {
  const to = process.env.ALERT_EMAIL ?? process.env.ADMIN_SEED_EMAIL;
  if (!to) {
    return null;
  }
  return {
    to,
    subject: `[Alert] ${subject}`,
    // message routinely embeds a guest's name and upstream error text — escaped so neither can
    // inject markup (e.g. a phishing link) into an email that goes to staff.
    html: `<p>${escapeHtml(message)}</p>`,
  };
}
