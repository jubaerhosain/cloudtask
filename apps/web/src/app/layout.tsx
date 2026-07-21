import type { Metadata } from 'next';

import './globals.css';
import { Nav } from '../components/nav';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CloudTask',
  description: 'Multi-user task management',
};

// Applies the stored theme (or OS preference) to <html> before paint, so there
// is no flash of the wrong theme on first load. Kept in sync with theme-store.
const themeInitScript = `(function(){try{var t=localStorage.getItem('cloudtask.theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-4xl p-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
