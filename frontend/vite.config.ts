import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // tailwindcss() scans our files for class names and generates only the CSS we use
  plugins: [react(), tailwindcss()],
  server: {
    // We run "npm run dev" inside WSL on a Windows drive (/mnt/c), where Vite isn't told
    // about file changes. Polling = Vite checks the files itself every so often instead.
    watch: { usePolling: true },
  },
})
