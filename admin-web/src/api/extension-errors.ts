import { apiClient } from './client';

export interface ExtensionErrorEntry {
  id: string;
  source: string;
  resId: string | null;
  operation: string;
  message: string;
  detail: string | null;
  url: string;
  extensionVersion: string | null;
  createdAt: string;
}

export function listExtensionErrors(): Promise<ExtensionErrorEntry[]> {
  return apiClient.request('/extension-errors');
}
