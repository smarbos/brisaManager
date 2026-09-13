const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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

  if (!response.ok) {
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

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<{ accessToken: string }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export const apiClient = { request };
