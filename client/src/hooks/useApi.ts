import { useAuthStore } from '../store/auth';

const API_BASE = '/api';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export function useApi() {
  const token = useAuthStore((state) => state.token);

  async function request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
    const { method = 'GET', body } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  return {
    get: <T>(endpoint: string) => request<T>(endpoint),
    post: <T>(endpoint: string, body?: unknown) =>
      request<T>(endpoint, { method: 'POST', body }),
    patch: <T>(endpoint: string, body?: unknown) =>
      request<T>(endpoint, { method: 'PATCH', body }),
    delete: <T>(endpoint: string) =>
      request<T>(endpoint, { method: 'DELETE' }),
  };
}
