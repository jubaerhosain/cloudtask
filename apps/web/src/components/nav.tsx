'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useSession } from '../lib/use-session';
import { ThemeToggle } from './theme-toggle';

export function Nav(): React.ReactElement {
  const { user, token, logout } = useSession();
  const router = useRouter();

  const onLogout = (): void => {
    logout();
    router.replace('/login');
  };

  return (
    <header className="border-b border-gray-200 dark:border-gray-800">
      <nav className="mx-auto flex max-w-4xl items-center justify-between p-4">
        <Link href={token ? '/projects' : '/'} className="text-lg font-bold">
          CloudTask
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {token ? (
            <>
              <span className="opacity-70">{user?.email}</span>
              <button onClick={onLogout} className="underline">
                Log out
              </button>
            </>
          ) : null}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
