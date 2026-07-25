'use client';

import { useTheme } from '../lib/use-theme';

export function ThemeToggle(): React.ReactElement {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
