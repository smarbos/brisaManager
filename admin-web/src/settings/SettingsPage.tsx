import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings, runChannelSync } from '../api/settings';
import {
  getGoogleCalendarStatus,
  getGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  runGoogleCalendarSync,
} from '../api/google-calendar';
import { PageContainer, Alert, Button, FormField, Input, Textarea } from '../ui';
import { formatDateTime } from '../lib/date';

export function SettingsPage() {
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
  const [confirmationPaymentPercentage, setConfirmationPaymentPercentage] = useState(30);
  const [securityDepositPercentage, setSecurityDepositPercentage] = useState(15);
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
        setConfirmationPaymentPercentage(settings.confirmationPaymentPercentage);
        setSecurityDepositPercentage(settings.securityDepositPercentage);
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
        confirmationPaymentPercentage,
        securityDepositPercentage,
        bookingIcalUrl,
        airbnbIcalUrl,
        lastChannelSyncAt: lastSyncAt,
        lastChannelSyncError: lastSyncError,
      });
      setSaved(true);
    } catch {
      setSaveError('No se pudo guardar la configuración. Por favor, intentá de nuevo.');
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
    try {
      const { url } = await getGoogleCalendarConnectUrl();
      window.location.href = url;
    } catch {
      setGoogleActionError('No se pudo iniciar la conexión con Google Calendar. Por favor, intentá de nuevo.');
    }
  }

  async function handleDisconnectGoogleCalendar() {
    setGoogleActionError(null);
    try {
      await disconnectGoogleCalendar();
      setGoogleConnected(false);
    } catch {
      setGoogleActionError('No se pudo desconectar Google Calendar. Por favor, intentá de nuevo.');
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

  return (
    <PageContainer>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">Configuración</h1>
        {loadError && <Alert>{loadError}</Alert>}
        {saveError && <Alert>{saveError}</Alert>}
        <FormField label="Reglas de la casa">
          <Textarea value={houseRulesText} onChange={(e) => setHouseRulesText(e.target.value)} rows={8} />
        </FormField>
        <FormField label="Instrucciones de pago">
          <Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={8} />
        </FormField>
        <FormField label="Porcentaje de pago de confirmación (%)">
          <Input
            type="number"
            min={1}
            max={100}
            value={confirmationPaymentPercentage === 0 ? '' : confirmationPaymentPercentage}
            onChange={(e) =>
              setConfirmationPaymentPercentage(e.target.value === '' ? 0 : Number(e.target.value))
            }
          />
        </FormField>
        <FormField label="Descripción del depósito de garantía">
          <Textarea value={depositInstructions} onChange={(e) => setDepositInstructions(e.target.value)} rows={8} />
        </FormField>
        <FormField label="Porcentaje del depósito de garantía (%)">
          <Input
            type="number"
            min={1}
            max={100}
            value={securityDepositPercentage === 0 ? '' : securityDepositPercentage}
            onChange={(e) => setSecurityDepositPercentage(e.target.value === '' ? 0 : Number(e.target.value))}
          />
        </FormField>

        <div className="mt-4">
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Datos bancarios</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se muestran al huésped en el paso de pago, con botones para copiar el CBU y el alias.
          </p>
        </div>
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

        <FormField label="Dirección del alojamiento">
          <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
        </FormField>
        <FormField label="Link de Google Maps">
          <Input value={googleMapsUrl} onChange={(e) => setGoogleMapsUrl(e.target.value)} placeholder="https://maps.google.com/..." />
        </FormField>
        <FormField label="URL de iCal de Booking.com">
          <Input value={bookingIcalUrl} onChange={(e) => setBookingIcalUrl(e.target.value)} />
        </FormField>
        <FormField label="URL de iCal de Airbnb">
          <Input value={airbnbIcalUrl} onChange={(e) => setAirbnbIcalUrl(e.target.value)} />
        </FormField>

        <div className="mt-4">
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Plantillas de email</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se envían automáticamente en cada paso del proceso de reserva. Podés usar las
            variables entre llaves dobles indicadas debajo de cada una — se reemplazan por el
            dato real al enviar el email.
          </p>
        </div>
        <FormField label="Email inicial (con el link de confirmación)">
          <Textarea value={initialEmailTemplate} onChange={(e) => setInitialEmailTemplate(e.target.value)} rows={6} />
        </FormField>
        <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{confirmationUrl}}'}</p>

        <FormField label="Email de confirmación final">
          <Textarea value={finalEmailTemplate} onChange={(e) => setFinalEmailTemplate(e.target.value)} rows={6} />
        </FormField>
        <p className="-mt-2 text-xs text-text-muted">
          Variables: {'{{guestName}} {{propertyAddress}} {{googleMapsUrl}}'}
        </p>

        <FormField label="Email de cancelación">
          <Textarea
            value={cancellationEmailTemplate}
            onChange={(e) => setCancellationEmailTemplate(e.target.value)}
            rows={6}
          />
        </FormField>
        <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{checkIn}} {{checkOut}}'}</p>

        <div className="mt-4">
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Recordatorios de WhatsApp</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se envían automáticamente por WhatsApp (vía Twilio) cuando el huésped tiene un
            número de teléfono cargado. Podés usar las mismas variables entre llaves dobles
            indicadas debajo de cada uno.
          </p>
        </div>
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
        <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{checkIn}} {{paymentInstructions}}'}</p>

        {saved && <Alert tone="success">Guardado</Alert>}
        <Button type="submit">Guardar</Button>
      </form>
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Sincronización de canales</h2>
        {lastSyncError ? (
          <Alert>Falló la última sincronización: {lastSyncError}</Alert>
        ) : (
          <p className="text-sm text-text-muted">
            Última sincronización: {lastSyncAt ? formatDateTime(lastSyncAt) : 'nunca'}
          </p>
        )}
        {syncActionError && <Alert>{syncActionError}</Alert>}
        <Button type="button" variant="secondary" className="mt-3" onClick={handleSyncNow} disabled={syncing}>
          Sincronizar ahora
        </Button>
      </section>
      <section className="mt-8">
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
            <div className="mt-3 flex gap-3">
              <Button type="button" variant="secondary" onClick={handleSyncGoogleCalendarNow} disabled={googleSyncing}>
                Sincronizar Google Calendar ahora
              </Button>
              <Button type="button" variant="danger" onClick={handleDisconnectGoogleCalendar}>
                Desconectar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">No conectado.</p>
            <Button type="button" className="mt-3" onClick={handleConnectGoogleCalendar}>
              Conectar Google Calendar
            </Button>
          </>
        )}
      </section>
    </PageContainer>
  );
}
