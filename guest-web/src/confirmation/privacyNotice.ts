// The check-in form's privacy notice (Ley 25.326 art. 6), shown at the point of collection.
// Lives in this one file so legal review edits one place. Every claim here must stay true of
// the system — see "Keeping the notice true" in
// docs/superpowers/specs/2026-09-29-guest-identity-document-design.md before changing either
// this text or the behavior it describes (document encryption, receipt retention, the
// provider list, what Google receives, marketing only with consent).

export const PRIVACY_SHORT_NOTE =
  'Usamos tus datos para gestionar tu reserva y registrar tu estadía. Tu número de documento se guarda cifrado.';

export const PRIVACY_LINK_LABEL = 'Cómo tratamos tus datos';

export const MARKETING_CONSENT_LABEL = 'Quiero recibir novedades y promociones de La Brisa por email.';

export interface PrivacyNoticeSection {
  title: string | null;
  body: string;
}

export const PRIVACY_NOTICE: PrivacyNoticeSection[] = [
  {
    title: 'Responsable',
    body: 'Damian Mantuano, Formosa 259, depto L. Contacto: contacto@labrisa.com.ar.',
  },
  {
    title: 'Qué datos pedimos',
    body: 'nombre, teléfono, email, tipo y número de documento y, si los enviás, comprobantes de pago.',
  },
  {
    title: 'Para qué',
    body: 'gestionar tu reserva y el check-in, identificarte como huésped y reconocerte en futuras estadías, y comunicarnos con vos sobre tu estadía por email y WhatsApp. Solo si lo aceptás, para enviarte novedades y promociones.',
  },
  {
    title: 'Obligatorios',
    body: 'nombre, teléfono, email y documento son necesarios para completar el check-in. Recibir promociones es opcional.',
  },
  {
    title: 'Con quién los compartimos',
    body: 'proveedores que nos ayudan a operar: DigitalOcean (alojamiento de datos), Resend (emails), Twilio (WhatsApp) y Google (calendario de reservas, solo tu nombre). Algunos procesan datos fuera de Argentina. No vendemos tus datos.',
  },
  {
    title: 'Cómo los protegemos',
    body: 'conexión cifrada (HTTPS), número de documento cifrado y acceso restringido al personal.',
  },
  {
    title: 'Cuánto tiempo',
    body: 'los comprobantes de pago se eliminan al cerrar tu estadía. Tus datos de contacto y documento se conservan para reconocerte en futuras estadías, hasta que pidas su eliminación.',
  },
  {
    title: 'Tus derechos',
    body: 'podés acceder, rectificar o suprimir tus datos escribiendo a contacto@labrisa.com.ar. El acceso es gratuito en intervalos no inferiores a seis meses, salvo interés legítimo (art. 14 inc. 3, Ley 25.326).',
  },
  {
    title: null,
    body: 'La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.',
  },
];
