import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings, runChannelSync } from '../api/settings';
import {
  getGoogleCalendarStatus,
  getGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  runGoogleCalendarSync,
  pushAllReservationsToGoogleCalendar,
} from '../api/google-calendar';
import { PageContainer, PageHeader, Alert, Button, Card, FormField, Input, Tabs, Textarea } from '../ui';
import { formatDateTime } from '../lib/date';

type SettingsTab = 'checkin' | 'alojamiento' | 'mensajes';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'checkin', label: 'Check-in del huésped' },
  { id: 'alojamiento', label: 'Alojamiento' },
  { id: 'mensajes', label: 'Mensajes automáticos' },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('checkin');
  const [houseRulesText, setHouseRulesText] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [depositInstructions, setDepositInstructions] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [initialEmailTemplate, setInitialEmailTemplate] = useState('');
  const [finalEmailTemplate, setFinalEmailTemplate] = useState('');
  const [cancellationEmailTemplate, setCancellationEmailTemplate] = useState('');
  const [reservationReminderDaysBefore, setReservationReminderDaysBefore] = useState(3);
  const [depositReminderDaysAfter, setDepositReminderDaysAfter] = useState(3);
  const [reservationReminderWhatsappTemplate, setReservationReminderWhatsappTemplate] = useState('');
  const [depositReminderWhatsappTemplate, setDepositReminderWhatsappTemplate] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [bankCuil, setBankCuil] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankCbu, setBankCbu] = useState('');
  const [bankAlias, setBankAlias] = useState('');
  const [bankName, setBankName] = useState('');
  const [confirmationPaymentValue, setConfirmationPaymentValue] = useState('30%');
  const [securityDepositValue, setSecurityDepositValue] = useState('15%');
  const [confirmationStepText, setConfirmationStepText] = useState('');
  const [airbnbMessageTemplate, setAirbnbMessageTemplate] = useState('');
  const [bookingIcalUrl, setBookingIcalUrl] = useState('');
  const [airbnbIcalUrl, setAirbnbIcalUrl] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncActionError, setSyncActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleLastSyncAt, setGoogleLastSyncAt] = useState<string | null>(null);
  const [googleLastSyncError, setGoogleLastSyncError] = useState<string | null>(null);
  const [googleActionError, setGoogleActionError] = useState<string | null>(null);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googlePushing, setGooglePushing] = useState(false);
  const [googlePushResult, setGooglePushResult] = useState<number | null>(null);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [googleCallbackStatus, setGoogleCallbackStatus] = useState<'connected' | 'error' | null>(null);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setHouseRulesText(settings.houseRulesText);
        setPaymentInstructions(settings.paymentInstructions);
        setDepositInstructions(settings.depositInstructions);
        setPropertyAddress(settings.propertyAddress);
        setGoogleMapsUrl(settings.googleMapsUrl);
        setInitialEmailTemplate(settings.initialEmailTemplate);
        setFinalEmailTemplate(settings.finalEmailTemplate);
        setCancellationEmailTemplate(settings.cancellationEmailTemplate);
        setReservationReminderDaysBefore(settings.reservationReminderDaysBefore);
        setDepositReminderDaysAfter(settings.depositReminderDaysAfter);
        setReservationReminderWhatsappTemplate(settings.reservationReminderWhatsappTemplate);
        setDepositReminderWhatsappTemplate(settings.depositReminderWhatsappTemplate);
        setBankAccountHolder(settings.bankAccountHolder);
        setBankCuil(settings.bankCuil);
        setBankAccountNumber(settings.bankAccountNumber);
        setBankCbu(settings.bankCbu);
        setBankAlias(settings.bankAlias);
        setBankName(settings.bankName);
        setConfirmationPaymentValue(settings.confirmationPaymentValue);
        setSecurityDepositValue(settings.securityDepositValue);
        setConfirmationStepText(settings.confirmationStepText);
        setAirbnbMessageTemplate(settings.airbnbMessageTemplate);
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
      setActiveTab('alojamiento');
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
    setSaving(true);
    try {
      await updateSettings({
        houseRulesText,
        paymentInstructions,
        depositInstructions,
        propertyAddress,
        googleMapsUrl,
        initialEmailTemplate,
        finalEmailTemplate,
        cancellationEmailTemplate,
        reservationReminderDaysBefore,
        depositReminderDaysAfter,
        reservationReminderWhatsappTemplate,
        depositReminderWhatsappTemplate,
        bankAccountHolder,
        bankCuil,
        bankAccountNumber,
        bankCbu,
        bankAlias,
        bankName,
        confirmationPaymentValue,
        securityDepositValue,
        confirmationStepText,
        airbnbMessageTemplate,
        bookingIcalUrl,
        airbnbIcalUrl,
        lastChannelSyncAt: lastSyncAt,
        lastChannelSyncError: lastSyncError,
      });
      setSaved(true);
    } catch {
      setSaveError('No se pudo guardar la configuración. Por favor, intentá de nuevo.');
    } finally {
      setSaving(false);
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
    setGoogleConnecting(true);
    try {
      const { url } = await getGoogleCalendarConnectUrl();
      window.location.href = url;
    } catch {
      setGoogleActionError('No se pudo iniciar la conexión con Google Calendar. Por favor, intentá de nuevo.');
      setGoogleConnecting(false);
    }
  }

  async function handleDisconnectGoogleCalendar() {
    if (!window.confirm('¿Desconectar Google Calendar? Vas a dejar de sincronizar reservas hasta que lo conectes de nuevo.')) {
      return;
    }
    setGoogleActionError(null);
    setGoogleDisconnecting(true);
    try {
      await disconnectGoogleCalendar();
      setGoogleConnected(false);
    } catch {
      setGoogleActionError('No se pudo desconectar Google Calendar. Por favor, intentá de nuevo.');
    } finally {
      setGoogleDisconnecting(false);
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

  // Covers reservations whose one-time push at create/update time was silently skipped —
  // e.g. created before Google Calendar was ever connected, or while a misconfigured OAuth
  // client made every push fail — and never got a second attempt since nothing else
  // re-triggers it on its own.
  async function handleForceSyncCalendar() {
    setGoogleActionError(null);
    setGooglePushResult(null);
    setGooglePushing(true);
    try {
      const { pushed } = await pushAllReservationsToGoogleCalendar();
      setGooglePushResult(pushed);
    } catch {
      setGoogleActionError('No se pudo forzar la sincronización. Por favor, intentá de nuevo.');
    } finally {
      setGooglePushing(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Configuración" subtitle="Textos, pagos, datos bancarios y sincronización del alojamiento." />
      {loadError && <Alert>{loadError}</Alert>}
      <Tabs
        id="settings"
        tabs={TABS}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as SettingsTab)}
        className="mb-6"
      />
      <form id="settings-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div
          role="tabpanel"
          id={`settings-panel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0}
          className="flex flex-col gap-6"
        >
        {activeTab === 'checkin' && (
        <>
        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Reglas de la casa</h2>
          <p className="mb-4 text-sm text-text-muted">Se le muestran al huésped en el paso 2 del check-in online.</p>
          <FormField label="Reglas de la casa">
            <Textarea value={houseRulesText} onChange={(e) => setHouseRulesText(e.target.value)} rows={8} />
          </FormField>
        </Card>

        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Pagos y depósito</h2>
          <p className="mb-4 text-sm text-text-muted">
            Cada monto acepta un porcentaje del total (30%) o un monto fijo en pesos (210000, sin puntos de miles).
          </p>
          <div className="flex flex-col gap-4">
            <FormField label="Instrucciones de pago">
              <Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={6} />
            </FormField>
            <FormField label="Pago de confirmación">
              <Input
                value={confirmationPaymentValue}
                onChange={(e) => setConfirmationPaymentValue(e.target.value)}
                placeholder="30% o 210000"
              />
            </FormField>
            <FormField label="Descripción del depósito de garantía">
              <Textarea value={depositInstructions} onChange={(e) => setDepositInstructions(e.target.value)} rows={6} />
            </FormField>
            <FormField label="Depósito de garantía">
              <Input
                value={securityDepositValue}
                onChange={(e) => setSecurityDepositValue(e.target.value)}
                placeholder="15% o 150000"
              />
            </FormField>
            <FormField label="Texto del paso de confirmación final">
              <Textarea value={confirmationStepText} onChange={(e) => setConfirmationStepText(e.target.value)} rows={4} />
            </FormField>
            <p className="-mt-2 text-xs text-text-muted">
              Se muestra al huésped en el último paso, una vez que el pago de confirmación y el depósito de
              garantía fueron marcados como recibidos.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Datos bancarios</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se muestran al huésped en el paso de pago, con botones para copiar el CBU y el alias.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Titular">
              <Input value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} />
            </FormField>
            <FormField label="CUIL">
              <Input value={bankCuil} onChange={(e) => setBankCuil(e.target.value)} />
            </FormField>
            <FormField label="Número de cuenta (caja de ahorro en pesos)">
              <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
            </FormField>
            <FormField label="CBU">
              <Input value={bankCbu} onChange={(e) => setBankCbu(e.target.value)} />
            </FormField>
            <FormField label="Alias">
              <Input value={bankAlias} onChange={(e) => setBankAlias(e.target.value)} />
            </FormField>
            <FormField label="Banco">
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </FormField>
          </div>
        </Card>
        </>
        )}

        {activeTab === 'alojamiento' && (
        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Alojamiento</h2>
          <p className="mb-4 text-sm text-text-muted">Dirección y enlaces compartidos con el huésped.</p>
          <div className="flex flex-col gap-4">
            <FormField label="Dirección del alojamiento">
              <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
            </FormField>
            <FormField label="Link de Google Maps">
              <Input
                value={googleMapsUrl}
                onChange={(e) => setGoogleMapsUrl(e.target.value)}
                placeholder="https://maps.google.com/..."
              />
            </FormField>
            <FormField label="URL de iCal de Booking.com">
              <Input value={bookingIcalUrl} onChange={(e) => setBookingIcalUrl(e.target.value)} />
            </FormField>
            <FormField label="URL de iCal de Airbnb">
              <Input value={airbnbIcalUrl} onChange={(e) => setAirbnbIcalUrl(e.target.value)} />
            </FormField>
          </div>
        </Card>
        )}

        {activeTab === 'mensajes' && (
        <>
        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Plantillas de email</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se envían automáticamente en cada paso del proceso de reserva. Podés usar las variables entre
            llaves dobles indicadas debajo de cada una — se reemplazan por el dato real al enviar el email.
          </p>
          <div className="flex flex-col gap-4">
            <FormField label="Email inicial (con el link de confirmación)">
              <Textarea value={initialEmailTemplate} onChange={(e) => setInitialEmailTemplate(e.target.value)} rows={6} />
            </FormField>
            <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{confirmationUrl}}'}</p>

            <FormField label="Email de confirmación final">
              <Textarea value={finalEmailTemplate} onChange={(e) => setFinalEmailTemplate(e.target.value)} rows={6} />
            </FormField>
            <p className="-mt-2 text-xs text-text-muted">
              Variables: {'{{guestName}} {{propertyAddress}} {{googleMapsUrl}} {{confirmationUrl}}'}
            </p>

            <FormField label="Email de cancelación">
              <Textarea
                value={cancellationEmailTemplate}
                onChange={(e) => setCancellationEmailTemplate(e.target.value)}
                rows={6}
              />
            </FormField>
            <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{checkIn}} {{checkOut}}'}</p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Recordatorios de WhatsApp</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se envían automáticamente por WhatsApp (vía Twilio) cuando el huésped tiene un número de teléfono
            cargado. Podés usar las mismas variables entre llaves dobles indicadas debajo de cada uno.
          </p>
          <div className="flex flex-col gap-4">
            <FormField label="Días antes del check-in para el recordatorio de reserva">
              <Input
                type="number"
                min={1}
                value={reservationReminderDaysBefore === 0 ? '' : reservationReminderDaysBefore}
                onChange={(e) =>
                  setReservationReminderDaysBefore(e.target.value === '' ? 0 : Number(e.target.value))
                }
              />
            </FormField>
            <FormField label="Mensaje de recordatorio de reserva">
              <Textarea
                value={reservationReminderWhatsappTemplate}
                onChange={(e) => setReservationReminderWhatsappTemplate(e.target.value)}
                rows={4}
              />
            </FormField>
            <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{checkIn}} {{checkOut}}'}</p>

            <FormField label="Días después del email inicial para el recordatorio de depósito">
              <Input
                type="number"
                min={1}
                value={depositReminderDaysAfter === 0 ? '' : depositReminderDaysAfter}
                onChange={(e) => setDepositReminderDaysAfter(e.target.value === '' ? 0 : Number(e.target.value))}
              />
            </FormField>
            <FormField label="Mensaje de recordatorio de depósito">
              <Textarea
                value={depositReminderWhatsappTemplate}
                onChange={(e) => setDepositReminderWhatsappTemplate(e.target.value)}
                rows={4}
              />
            </FormField>
            <p className="-mt-2 text-xs text-text-muted">
              Variables: {'{{guestName}} {{checkIn}} {{paymentInstructions}}'}
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Mensaje de Airbnb</h2>
          <p className="mb-4 text-sm text-text-muted">
            Cuando usás la extensión de Chrome para generar el link de check-in desde los mensajes de Airbnb, este
            texto se copia al portapapeles listo para pegar en la conversación con el huésped.
          </p>
          <FormField label="Mensaje de check-in de Airbnb">
            <Textarea value={airbnbMessageTemplate} onChange={(e) => setAirbnbMessageTemplate(e.target.value)} rows={4} />
          </FormField>
          <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{confirmationUrl}}'}</p>
        </Card>
        </>
        )}
        </div>
      </form>

      <div className="sticky bottom-0 z-10 mt-6 -mx-4 border-t border-border bg-bg/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface sm:px-6 sm:shadow-sm">
        {saveError && <Alert>{saveError}</Alert>}
        {saved && <Alert tone="success">Guardado</Alert>}
        <Button type="submit" form="settings-form" loading={saving} className="mt-2 first:mt-0">
          Guardar
        </Button>
      </div>

      {activeTab === 'alojamiento' && (
      <div className="mt-6 flex flex-col gap-6">
      <Card>
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Sincronización de canales</h2>
        {lastSyncError ? (
          <Alert>Falló la última sincronización: {lastSyncError}</Alert>
        ) : (
          <p className="text-sm text-text-muted">
            Última sincronización: {lastSyncAt ? formatDateTime(lastSyncAt) : 'nunca'}
          </p>
        )}
        {syncActionError && <Alert>{syncActionError}</Alert>}
        <Button type="button" variant="secondary" className="mt-3" loading={syncing} onClick={handleSyncNow}>
          Sincronizar ahora
        </Button>
      </Card>

      <Card>
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" loading={googleSyncing} onClick={handleSyncGoogleCalendarNow}>
                Sincronizar Google Calendar ahora
              </Button>
              <Button type="button" variant="danger" loading={googleDisconnecting} onClick={handleDisconnectGoogleCalendar}>
                Desconectar
              </Button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Trae a La Brisa los cambios hechos directamente en Google Calendar.
            </p>

            <div className="mt-4 border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" loading={googlePushing} onClick={handleForceSyncCalendar}>
                  Forzar sync de reservas al calendario
                </Button>
                {googlePushResult !== null && (
                  <span className="text-sm text-text-muted">
                    {googlePushResult} reserva{googlePushResult === 1 ? '' : 's'} enviada
                    {googlePushResult === 1 ? '' : 's'} a Google Calendar.
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Reenvía todas las reservas a Google Calendar — usalo si una reserva no aparece (por ejemplo, si se
                creó antes de conectar el calendario).
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">No conectado.</p>
            <Button type="button" className="mt-3" loading={googleConnecting} onClick={handleConnectGoogleCalendar}>
              Conectar Google Calendar
            </Button>
          </>
        )}
      </Card>
      </div>
      )}
    </PageContainer>
  );
}
