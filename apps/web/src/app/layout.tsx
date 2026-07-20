import type { Metadata } from 'next';

import './globals.css';
import { Nav } from '../components/nav';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CloudTask',
  description: 'Multi-user task management',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-4xl p-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
