import { apiClient } from './client';

export type CampaignFilterType = 'ALL' | 'STAYED_WITHIN_MONTHS' | 'NOT_STAYED_WITHIN_MONTHS';

export interface CampaignRecipient {
  id: string;
  guestId: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
}

export interface Campaign {
  id: string;
  templateId: string;
  template: { name: string };
  filterType: CampaignFilterType;
  filterMonths: number | null;
  recipientCount: number;
  sentAt: string;
  recipients: CampaignRecipient[];
}

export interface CampaignQuery {
  templateId: string;
  filterType: CampaignFilterType;
  filterMonths?: number;
}

export function previewCampaign(query: CampaignQuery): Promise<{ recipientCount: number }> {
  const params = new URLSearchParams({ templateId: query.templateId, filterType: query.filterType });
  if (query.filterMonths !== undefined) {
    params.set('filterMonths', String(query.filterMonths));
  }
  return apiClient.request(`/campaigns/preview?${params.toString()}`);
}

export function sendCampaign(query: CampaignQuery): Promise<Campaign> {
  return apiClient.request('/campaigns', { method: 'POST', body: JSON.stringify(query) });
}

export function listCampaignHistory(): Promise<Campaign[]> {
  return apiClient.request('/campaigns');
}
