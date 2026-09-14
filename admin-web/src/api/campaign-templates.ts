import { apiClient } from './client';

export interface CampaignTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
}

export type CampaignTemplateInput = Omit<CampaignTemplate, 'id'>;

export function listCampaignTemplates(): Promise<CampaignTemplate[]> {
  return apiClient.request('/campaign-templates');
}

export function createCampaignTemplate(input: CampaignTemplateInput): Promise<CampaignTemplate> {
  return apiClient.request('/campaign-templates', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCampaignTemplate(id: string, input: Partial<CampaignTemplateInput>): Promise<CampaignTemplate> {
  return apiClient.request(`/campaign-templates/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteCampaignTemplate(id: string): Promise<void> {
  return apiClient.request(`/campaign-templates/${id}`, { method: 'DELETE' });
}
