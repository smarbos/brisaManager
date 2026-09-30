// For interpolating untrusted text (a guest's own name, an error message) into HTML we send —
// emails, mostly. Not applied inside renderTemplate() itself: that also renders plain-text
// WhatsApp/Airbnb messages, where escaping would show up as literal "&amp;".
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// renderTemplate() vars for an HTML template: every value escaped, the template itself left
// alone (it's staff-authored HTML on purpose).
export function escapeHtmlVars(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, escapeHtml(value)]),
  );
}
