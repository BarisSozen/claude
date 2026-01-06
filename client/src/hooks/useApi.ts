import { useAuthStore } from '../store/auth';

const API_BASE = '/api';

// User-friendly error messages - prevent leaking internal server details
const ERROR_MESSAGES: Record<string, string> = {
  'Invalid credentials': 'Invalid email or password',
  'Token expired': 'Your session has expired. Please sign in again',
  'Unauthorized': 'Please sign in to continue',
  'Forbidden': 'You do not have permission to perform this action',
  'Not found': 'The requested resource was not found',
  'Rate limit exceeded': 'Too many requests. Please try again later',
};

/**
 * Sanitize error messages to prevent exposing internal server details
 */
function sanitizeErrorMessage(error: string | undefined): string {
  if (!error) return 'Request failed';

  // Check for known safe error messages
  for (const [pattern, message] of Object.entries(ERROR_MESSAGES)) {
    if (error.toLowerCase().includes(pattern.toLowerCase())) {
      return message;
    }
  }

  // Check for potentially sensitive patterns and replace with generic message
  const sensitivePatterns = [
    /sql|query|database|postgres|mysql/i,
    /stack|trace|at\s+\w+\s*\(/i,
    /internal|server|exception/i,
    /path|file|directory|\/\w+\//i,
    /connection|timeout|refused/i,
    /secret|key|password|token|credential/i,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(error)) {
      return 'An error occurred. Please try again';
    }
  }

  // Return original error if it appears safe (short, no sensitive patterns)
  if (error.length <= 100 && !error.includes('\n')) {
    return error;
  }

  return 'An error occurred. Please try again';
}

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

      // Handle non-JSON responses gracefully
      let data: Record<string, unknown>;
      try {
        data = await response.json();
      } catch {
        // Response was not valid JSON
        if (!response.ok) {
          throw new Error('Request failed');
        }
        return {} as T;
      }

      if (!response.ok) {
        // Sanitize error messages - don't expose internal server details
        const safeError = sanitizeErrorMessage(data.error as string | undefined);
        throw new Error(safeError);
      }

      return data as T;
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
