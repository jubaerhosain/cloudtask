import type { UserPublic } from '@cloudtask/contracts';

const TOKEN_KEY = 'cloudtask.token';
const USER_KEY = 'cloudtask.user';

// Simple observable so React can react to login/logout across the app.
type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

// Cache the parsed user so getUser returns a STABLE reference until the stored
// value actually changes — required for useSyncExternalStore (a fresh object
// each call causes an infinite render loop).
let cachedRaw: string | null = null;
let cachedUser: UserPublic | null = null;

export function getUser(): UserPublic | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedUser = raw ? (JSON.parse(raw) as UserPublic) : null;
  }
  return cachedUser;
}

export function setSession(token: string, user: UserPublic): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  notify();
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  notify();
}
