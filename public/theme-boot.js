// The stored theme (or the system's) on <html data-theme> before the first paint, as
// bootstrapTheme in src/lib/theme.ts does once the app runs; the CSP allows no inline script.
;(function () {
  var theme
  try {
    theme = JSON.parse(localStorage.getItem('mdc:theme'))
  } catch {
    // No storage (privacy mode): follow the system.
  }
  if (theme !== 'light' && theme !== 'dark')
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#141112' : '#faf8f6')
  })
})()
