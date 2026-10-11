// A browser below the site's build target (Chrome and Edge 111, Firefox 114, Safari 16.4) would load
// a broken page: it gets a plain notice instead, and src/main.tsx leaves the page alone. Plain ES5,
// so the browsers it is for can run it; styles go through the CSSOM, which the CSP allows.
;(function () {
  var ok = false
  // color-mix(): Chrome 111, Firefox 113, Safari 16.2. Look-behind, which the checking code uses
  // (pdf.js needs Safari 16.4 too): Safari 16.4; an older browser throws on it.
  try {
    ok = CSS.supports('color', 'color-mix(in srgb, red, red)') && new RegExp('(?<=a)b').test('ab')
    // eslint-disable-next-line no-unused-vars -- ES5 has no catch without a binding
  } catch (e) {
    // No CSS object, or no look-behind: the browser needs an update.
  }
  if (ok) return
  document.documentElement.setAttribute('data-unsupported', '')
  document.addEventListener('DOMContentLoaded', function () {
    var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
    document.body.style.cssText = dark
      ? 'margin:0;background:#141112;color:#f4f1ef'
      : 'margin:0;background:#faf8f6;color:#373637'
    var main = document.createElement('main')
    main.style.cssText =
      'max-width:34rem;margin:12vh auto;padding:0 16px;font:1rem/1.6 system-ui,sans-serif'
    var lines = [
      ['h1', 'MDC Format Check'],
      ['p', 'This browser needs an update to support the checker.'],
      ['p', 'Update it, or open this page in an up-to-date Chrome, Edge, Firefox or Safari.'],
      ['p', 'An unofficial proof of concept in alpha testing, not an official UPOU site.'],
    ]
    for (var i = 0; i < lines.length; i++) {
      var el = document.createElement(lines[i][0])
      el.textContent = lines[i][1]
      if (i === 0) el.style.cssText = 'font-size:1.5rem;margin:0 0 1rem'
      if (i === 3) el.style.cssText = 'font-size:.875rem;opacity:.8'
      main.appendChild(el)
    }
    var root = document.getElementById('root')
    root.innerHTML = ''
    root.appendChild(main)
  })
})()
