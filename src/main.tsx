import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// public/browser-check.js has shown its "needs an update" notice in a browser that cannot run the site.
if (!document.documentElement.hasAttribute('data-unsupported'))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
