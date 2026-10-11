// Light, dark or the system's, stored per browser under mdc:theme; public/theme-boot.js applies the
// same choice before the first paint (the CSP allows no inline script).
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type ResolvedTheme = 'light' | 'dark'
const KEY = 'mdc:theme'
const DARK = '(prefers-color-scheme: dark)'
const CHROME: Record<ResolvedTheme, string> = { light: '#faf8f6', dark: '#141112' }
const listeners = new Set<() => void>()

function stored(): ResolvedTheme | undefined {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v === 'light' || v === 'dark' ? v : undefined
  } catch {
    return undefined
  }
}
const system = (): ResolvedTheme => (window.matchMedia(DARK).matches ? 'dark' : 'light')
// The switch's choice for this visit, for when storage is blocked and cannot hold it.
let chosen: ResolvedTheme | undefined
const current = (): ResolvedTheme => stored() ?? chosen ?? system()

function apply(theme: ResolvedTheme) {
  const root = document.documentElement
  const set = () => {
    root.dataset.theme = theme
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', CHROME[theme]))
  }
  // A switch cross-fades where View Transitions exist and motion is welcome.
  if (
    !document.startViewTransition ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    root.dataset.theme === theme
  )
    return set()
  root.dataset.themeFade = ''
  const fade = document.startViewTransition(set)
  // A quick second switch skips the first fade, which rejects `ready`; nothing is lost.
  fade.ready.catch(() => {})
  void fade.finished.finally(() => delete root.dataset.themeFade)
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const query = window.matchMedia(DARK)
  query.addEventListener('change', fn)
  window.addEventListener('storage', fn)
  return () => {
    listeners.delete(fn)
    query.removeEventListener('change', fn)
    window.removeEventListener('storage', fn)
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as const)
  useEffect(() => apply(theme), [theme])
  const toggle = useCallback(() => {
    chosen = current() === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(KEY, JSON.stringify(chosen))
    } catch {
      // Storage blocked: `chosen` keeps the switch for this visit.
    }
    // The effect above applies it, once.
    listeners.forEach((l) => l())
  }, [])
  return { theme, toggle }
}
