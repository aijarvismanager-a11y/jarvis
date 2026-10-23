import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// API_PORT lets a second dev stack point at a server that is not on the default port.
const apiPort = process.env.API_PORT ?? '4173'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/ws': {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
      },
    },
  },
})
