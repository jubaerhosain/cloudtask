'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getToken } from '../lib/auth-store';

export default function HomePage(): React.ReactElement {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? '/projects' : '/login');
  }, [router]);
  return <p className="py-8 text-center text-sm opacity-70">Redirecting…</p>;
}
