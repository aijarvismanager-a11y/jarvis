import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import V2App from './v2/V2App.tsx'
import { applyTextSize, readTextSize } from './v2/textSize.ts'

applyTextSize(readTextSize())

// the desktop window has no menu bar: make reloading work from the keyboard
window.addEventListener('keydown', (e) => {
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
    e.preventDefault()
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <V2App />
  </StrictMode>,
)
