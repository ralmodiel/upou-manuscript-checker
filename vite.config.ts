/// <reference types="vitest/config" />
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Strict CSP for production builds (the dev server needs inline scripts for hot reload). Nothing
// leaves the page: scripts, styles, fonts and the pdf.js worker all come from the site itself, and
// connect-src 'none' means no request can carry a manuscript anywhere.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
})

// GitHub Pages has no rewrites; it serves 404.html for unknown paths, so a mistyped link still lands on the app.
const spaFallbackPlugin = (): Plugin => {
  let outDir = 'dist'
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    configResolved: (config) => {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle: () => copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html')),
  }
}

export default defineConfig({
  // "/<repo>/" for GitHub Pages project sites (set by the deploy workflow), "/" otherwise.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss(), cspPlugin(), spaFallbackPlugin()],
  server: { port: 5290 },
  preview: { port: 5291 },
  build: {
    // Every browser Tailwind 4 supports has native modulepreload; skip the polyfill.
    modulePreload: { polyfill: false },
    // React gets its own long-cached chunk. Everything else splits where the app loads it lazily
    // (the engine when idle, pdf.js for a PDF, the report writers on download), so a phone's first
    // load is the page alone.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', 'tmp/**', 'scripts/**'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    testTimeout: 20_000,
  },
})
