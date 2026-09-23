const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;

  const body = await response.text();

  if (response.status === 401) {
    // The token is missing, invalid or expired: drop it and send the user back to
    // the login page. This lives outside React Router, hence the full-page redirect.
    localStorage.removeItem('accessToken');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  throw new ApiError(response.status, body);
}

async function handleResponse<T>(response: Response): Promise<T> {
  await throwIfNotOk(response);

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  return handleResponse<T>(response);
}

async function upload<T>(path: string, formData: FormData, options: { signal?: AbortSignal } = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');

  // No Content-Type header here: the browser must set multipart/form-data with the
  // correct boundary itself, which it can only do when the header is left unset.
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
    signal: options.signal,
  });

  return handleResponse<T>(response);
}

// For a route that returns raw bytes (e.g. a receipt image), not JSON — handleResponse()
// always calls response.json(), which would throw on a binary body.
async function fetchBlob(path: string): Promise<Blob> {
  const token = localStorage.getItem('accessToken');

  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  await throwIfNotOk(response);

  return response.blob();
}

export async function login(email: string, password: string): Promise<{ accessToken: string }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export const apiClient = { request, upload, fetchBlob };
