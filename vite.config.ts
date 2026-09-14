import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.LEUBAI_API_URL || 'http://127.0.0.1:5200'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "framework", test: /node_modules[\\/]+(react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
