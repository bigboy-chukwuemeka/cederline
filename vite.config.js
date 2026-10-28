import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

function routeAccountAppPaths(server) {
  server.middlewares.use((request, _response, next) => {
    if (!request.url) {
      next()
      return
    }

    const separatorIndex = request.url.search(/[?#]/)
    const pathname = separatorIndex === -1 ? request.url : request.url.slice(0, separatorIndex)
    const suffix = separatorIndex === -1 ? '' : request.url.slice(separatorIndex)

    if (
      pathname === '/admin' ||
      pathname.startsWith('/admin/') ||
      pathname === '/account-app' ||
      pathname === '/account-app/' ||
      pathname === '/account-app/admin' ||
      pathname.startsWith('/account-app/admin/')
    ) {
      request.url = `/${suffix || 'index.html'}`
    }

    next()
  })
}

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/rdcresources': {
        target: 'https://www.regions.com',
        changeOrigin: true,
        secure: false,
      },
      '/RDCResources': {
        target: 'https://www.regions.com',
        changeOrigin: true,
        secure: false,
      },
      '/-/media': {
        target: 'https://www.regions.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/rdcresources': {
        target: 'https://www.regions.com',
        changeOrigin: true,
        secure: false,
      },
      '/RDCResources': {
        target: 'https://www.regions.com',
        changeOrigin: true,
        secure: false,
      },
      '/-/media': {
        target: 'https://www.regions.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(rootDir, 'index.html'),
    },
  },
  configureServer: routeAccountAppPaths,
  configurePreviewServer: routeAccountAppPaths,
})
