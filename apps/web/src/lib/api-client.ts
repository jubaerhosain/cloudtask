import type { ProblemDetails } from '@cloudtask/contracts';

import { getToken, clearToken } from './auth-store';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

/** Error carrying the parsed RFC 7807 problem-details payload. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Attach the stored bearer token (default true). */
  auth?: boolean;
}

/**
 * Low-level API request. Serializes JSON, attaches the bearer token, and turns
 * non-2xx responses into ApiError (parsing the problem-details body). A 401
 * clears the stored token so the app can send the user back to login.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    clearToken();
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const problem = (data ?? null) as ProblemDetails | null;
    throw new ApiError(res.status, problem, problem?.detail ?? problem?.title ?? res.statusText);
  }

  return data as T;
}
