import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The UI sits on top of the pure engine in /src/engine, untouched — Vite bundles the
// TypeScript (including the explicit .ts import extensions the Node runtime needs).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
})
