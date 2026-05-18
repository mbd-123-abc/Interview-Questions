import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/employees': 'http://localhost:3000',
      '/locations': 'http://localhost:3000',
      '/balances': 'http://localhost:3000',
      '/pto-requests': 'http://localhost:3000',
      '/reconciliation': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
    },
  },
})
