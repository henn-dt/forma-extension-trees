import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './', // Use relative paths for assets to support subpath deployment
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        // Ensure Set-Cookie from backend is rewritten to a browser-acceptable domain
        cookieDomainRewrite: 'localhost',
        // Model generation can take minutes; download streams 200MB+
        timeout: 600000,
      }
    }
  }
})
