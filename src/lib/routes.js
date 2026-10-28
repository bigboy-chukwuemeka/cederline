export const ACCOUNT_APP_PATH = '/account-app'
export const LEGACY_ADMIN_BASE_PATH = `${ACCOUNT_APP_PATH}/admin`
export const ADMIN_BASE_PATH = window.location.pathname === ACCOUNT_APP_PATH ||
  window.location.pathname.startsWith(`${ACCOUNT_APP_PATH}/`)
  ? LEGACY_ADMIN_BASE_PATH
  : '/admin'

export function isAdminPathname(pathname = window.location.pathname) {
  return pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === LEGACY_ADMIN_BASE_PATH ||
    pathname.startsWith(`${LEGACY_ADMIN_BASE_PATH}/`)
}

export function getAccountAppRedirectUrl(origin = window.location.origin) {
  return new URL(`${ACCOUNT_APP_PATH}/`, origin).toString()
}
