/// <reference types="vitest/config" />
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Strict CSP for production builds (the dev server needs inline scripts for hot reload). Nothing
// leaves the page: scripts, styles, fonts and the workers all come from the site itself. The only
// other host scripts may reach is Hugging Face, where the topic planner's optional model is fetched
// from once the visitor turns it on; no request can carry a manuscript anywhere. The model's
// runtime is WebAssembly, which needs 'wasm-unsafe-eval' (compiling WebAssembly, not JavaScript).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'self' https://huggingface.co https://*.hf.co",
  "object-src 'none'",
  "frame-src 'none'",
  "manifest-src 'self'",
  "media-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

// ONNX Runtime's WebAssembly, for the topic planner's model: served from this site under ort/ (its
// default is a CDN, which the security policy does not allow). Of the builds this version ships
// (plain, jsep, asyncify, jspi), the bundled runtime names only the asyncify pair, so only that
// pair is served (checked in the built worker and a headless run; re-check on upgrading either).
const ORT_DIR = resolve('node_modules/onnxruntime-web/dist')
const ORT_FILES = existsSync(ORT_DIR)
  ? readdirSync(ORT_DIR).filter((f) => /^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f))
  : []
const ortPlugin = (): Plugin => ({
  name: 'ort-wasm',
  configureServer: (server) => {
    server.middlewares.use((req, res, next) => {
      const f = /^\/ort\/([^?]+)/.exec(req.url ?? '')?.[1]
      if (!f || !ORT_FILES.includes(f)) return next()
      res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
      createReadStream(join(ORT_DIR, f)).pipe(res)
    })
  },
  generateBundle(_, bundle) {
    // (the bundler also emits the wasm the runtime's code points at from its own folder; with
    // ort/ set as the path, that copy under assets/ is never fetched)
    for (const k of Object.keys(bundle)) if (/^assets\/ort-wasm-.*\.wasm$/.test(k)) delete bundle[k]
    for (const f of ORT_FILES)
      this.emitFile({ type: 'asset', fileName: `ort/${f}`, source: readFileSync(join(ORT_DIR, f)) })
  },
})

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
  plugins: [react(), tailwindcss(), cspPlugin(), spaFallbackPlugin(), ortPlugin()],
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
    exclude: ['**/node_modules/**', '**/dist/**', 'tmp/**', 'scripts/**', '.claude/**'],
    css: false,
    testTimeout: 20_000,
  },
})
