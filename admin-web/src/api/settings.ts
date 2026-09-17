import { apiClient } from './client';

export interface Settings {
  houseRulesText: string;
  paymentInstructions: string;
  depositInstructions: string;
  propertyAddress: string;
  googleMapsUrl: string;
  initialEmailTemplate: string;
  finalEmailTemplate: string;
  cancellationEmailTemplate: string;
  reservationReminderDaysBefore: number;
  depositReminderDaysAfter: number;
  reservationReminderWhatsappTemplate: string;
  depositReminderWhatsappTemplate: string;
  bankAccountHolder: string;
  bankCuil: string;
  bankAccountNumber: string;
  bankCbu: string;
  bankAlias: string;
  bankName: string;
  confirmationPaymentValue: string;
  securityDepositValue: string;
  confirmationStepText: string;
  airbnbMessageTemplate: string;
  bookingIcalUrl: string | null;
  airbnbIcalUrl: string | null;
  lastChannelSyncAt: string | null;
  lastChannelSyncError: string | null;
}

export function getSettings(): Promise<Settings> {
  return apiClient.request('/settings');
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return apiClient.request('/settings', { method: 'PUT', body: JSON.stringify(settings) });
}

export function runChannelSync(): Promise<{ triggeredAt: string }> {
  return apiClient.request('/channel-sync/run', { method: 'POST' });
}
