import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // tailwindcss() scans our files for class names and generates only the CSS we use
  plugins: [react(), tailwindcss()],
})
