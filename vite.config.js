import react from '@vitejs/plugin-react'
import { cpSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const siteRoot = fileURLToPath(new URL('..', import.meta.url))
const outputDirectory = fileURLToPath(new URL('./dist', import.meta.url))
const publicPageRoutes = {
  '/personal-banking': 'index.html',
  '/personal-banking/checking': 'checking.html',
  '/personal-banking/checking.html': 'checking.html',
  '/personal-banking/checking/compare-checking-accounts': 'compare-checking-accounts.html',
  '/personal-banking/checking/compare-checking-accounts.html': 'compare-checking-accounts.html',
  '/personal-banking/savings': 'savings.html',
  '/personal-banking/overdraft-grace': 'overdraft-grace.html',
  '/personal-banking/greenprint-financial-planning': 'greenprint-financial-planning.html',
  '/personal-banking/rewards': 'rewards.html',
  '/personal-banking/credit-cards': 'credit-card.html',
  '/personal-banking/home-loans': 'montage-home-loan.html',
  '/personal-banking/home-equity': 'home-equity.html',
  '/digital-banking': 'digital-banking.html',
  '/digital-banking/digital-services/lockit-card-controls': 'digital-services-lockit-card-controls.html',
  '/insights/personal/calculator/how-do-i-reach-my-savings-goal': 'how-do-i-reach-my-savings-goal.html',
  '/wealth-management': 'wealth.html',
  '/small-business': 'small-business.html',
  '/commercial-banking': 'commercial.html',
  '/about-regions': 'about.html',
  '/help': 'help.html',
}

function copyStaticSite() {
  let isBuild = false

  return {
    name: 'copy-static-site',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    closeBundle() {
      if (!isBuild) return

      for (const entry of readdirSync(siteRoot, { withFileTypes: true })) {
        if (entry.name === 'account-app') continue
        cpSync(resolve(siteRoot, entry.name), resolve(outputDirectory, entry.name), { recursive: true })
      }

      for (const [route, page] of Object.entries(publicPageRoutes)) {
        const routeFile = route.endsWith('.html')
          ? resolve(outputDirectory, route.slice(1))
          : resolve(outputDirectory, route.slice(1), 'index.html')
        mkdirSync(dirname(routeFile), { recursive: true })
        copyFileSync(resolve(outputDirectory, page), routeFile)
      }

      const appEntry = resolve(outputDirectory, 'account-app', 'index.html')
      for (const page of ['', 'users', 'accounts', 'applications', 'transactions', 'messages', 'audit-logs']) {
        const routeEntry = resolve(outputDirectory, 'account-app', 'admin', page, 'index.html')
        mkdirSync(dirname(routeEntry), { recursive: true })
        copyFileSync(appEntry, routeEntry)
      }
    },
    configureServer: routeAdminPaths,
    configurePreviewServer: routeAdminPaths,
  }
}

function routeAdminPaths(server) {
  server.middlewares.use((request, _response, next) => {
    if (request.url) {
      const separatorIndex = request.url.search(/[?#]/)
      const pathname = separatorIndex === -1 ? request.url : request.url.slice(0, separatorIndex)
      const suffix = separatorIndex === -1 ? '' : request.url.slice(separatorIndex)
      if (publicPageRoutes[pathname]) {
        request.url = `/${publicPageRoutes[pathname]}${suffix}`
      }
      request.url = request.url.replace(/^\/account-app(?=$|\?)/, '/account-app/index.html')
      request.url = request.url.replace(/^\/account-app\/admin(?:\/[^?]*)?/, '/account-app/index.html')
    }
    next()
  })
}

export default defineConfig({
  root: siteRoot,
  plugins: [react(), copyStaticSite()],
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
    outDir: outputDirectory,
    rollupOptions: {
      input: resolve(siteRoot, 'account-app/index.html'),
    },
  },
})
