"use client";

import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

/**
 * A view choice, such as list or board, that stays after a reload. It is kept in this browser only.
 * The server always renders the fallback, so the first paint matches and nothing flickers into an error.
 */
export function useStoredChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const read = () => {
    try {
      const value = localStorage.getItem(`ug-choice:${key}`);
      return value && (allowed as readonly string[]).includes(value) ? value as T : fallback;
    } catch { return fallback; }
  };
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback((next: T) => {
    try { localStorage.setItem(`ug-choice:${key}`, next); } catch { /* The choice still applies until the page reloads. */ }
    listeners.forEach(listener => listener());
  }, [key]);
  return [value, set];
}

const noSubscribe = () => () => {};
/** The search shortcut as this computer writes it: ⌘K on a Mac, Ctrl K elsewhere. The server assumes a Mac. */
export function useSearchShortcut() {
  return useSyncExternalStore(noSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K', () => '⌘K');
}
