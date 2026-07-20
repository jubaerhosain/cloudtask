'use client';

import type { UserPublic } from '@cloudtask/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { clearToken, getToken, getUser, subscribe } from './auth-store';

interface Session {
  token: string | null;
  user: UserPublic | null;
  logout: () => void;
}

/** Reactive access to the stored session (updates on login/logout). */
export function useSession(): Session {
  const token = useSyncExternalStore(subscribe, getToken, () => null);
  const user = useSyncExternalStore(subscribe, getUser, () => null);
  return { token, user, logout: clearToken };
}

/**
 * Redirects to /login when there is no token. Returns whether auth has been
 * checked, so pages can avoid flashing content before the redirect.
 */
export function useRequireAuth(): { ready: boolean } {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  return { ready };
}
