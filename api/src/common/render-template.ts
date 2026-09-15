// Simple string-replace substitution, not a template engine: `{{key}}` in staff-edited
// template text is replaced with vars[key]. split/join avoids needing to escape `{{...}}`
// as a regex, since it's matched as a literal string.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((result, [key, value]) => result.split(`{{${key}}}`).join(value), template);
}
