'use client';

import { useSyncExternalStore } from 'react';

import { getTheme, subscribe, toggleTheme, type Theme } from './theme-store';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

/** Reactive access to the current theme (updates when toggled). */
export function useTheme(): ThemeState {
  // Server snapshot is 'light' so markup is stable; the inline init script in
  // the layout applies the real theme before paint, and this syncs on mount.
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'light' as Theme);
  return { theme, toggle: toggleTheme };
}
