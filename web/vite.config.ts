import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/voice': 'http://localhost:18790',
      '/chat': 'http://localhost:18790',
      '/hooks': 'http://localhost:18790'
    }
  }
})
