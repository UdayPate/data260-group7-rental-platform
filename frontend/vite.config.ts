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
  build: {
    rolldownOptions: {
      output: {
        // The mock code (only loaded when mocks are on) is big: put the MSW library in its
        // own file, separate from our mock handlers and seed data, so no file is over 500 kB.
        codeSplitting: {
          groups: [{ name: 'msw', test: /node_modules[\\/](msw|@mswjs)/ }],
        },
      },
    },
  },
})
