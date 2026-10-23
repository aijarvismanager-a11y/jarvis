import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import V2App from './v2/V2App.tsx'

// The Mission-centred UI (Phase 7) is the default. The old 3-pane workflow UI stays
// reachable at /?legacy until its removal in Phase 9.
const legacy = new URLSearchParams(window.location.search).has('legacy')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{legacy ? <App /> : <V2App />}</StrictMode>,
)
