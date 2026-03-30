import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@mui/icons-material')) return 'mui-icons'
          if (
            id.includes('react')
            || id.includes('scheduler')
            || id.includes('@mui/material')
            || id.includes('@emotion')
          ) {
            return 'framework-vendor'
          }
          return undefined
        },
      },
    },
  },
})
