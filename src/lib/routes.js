export const ACCOUNT_APP_PATH = '/account-app'
export const LEGACY_ADMIN_BASE_PATH = `${ACCOUNT_APP_PATH}/admin`
export const PASSWORD_RESET_PATH = '/reset-password'
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

export function isPasswordRecoveryPath(pathname = window.location.pathname, search = window.location.search) {
  return pathname === PASSWORD_RESET_PATH ||
    pathname === `${ACCOUNT_APP_PATH}${PASSWORD_RESET_PATH}` ||
    (isAdminPathname(pathname) && new URLSearchParams(search).get('flow') === 'password-recovery')
}

export function getAccountAppRedirectUrl(origin = window.location.origin, pathname = window.location.pathname) {
  if (isAdminPathname(pathname)) {
    return new URL('/admin', origin).toString()
  }

  if (pathname === ACCOUNT_APP_PATH || pathname.startsWith(`${ACCOUNT_APP_PATH}/`)) {
    return new URL(`${ACCOUNT_APP_PATH}/`, origin).toString()
  }

  return new URL('/', origin).toString()
}

export function getPasswordRecoveryRedirectUrl(origin = window.location.origin, pathname = window.location.pathname) {
  if (isAdminPathname(pathname)) {
    const adminPath = pathname === LEGACY_ADMIN_BASE_PATH || pathname.startsWith(`${LEGACY_ADMIN_BASE_PATH}/`)
      ? LEGACY_ADMIN_BASE_PATH
      : '/admin'
    const redirectUrl = new URL(adminPath, origin)
    redirectUrl.searchParams.set('flow', 'password-recovery')
    return redirectUrl.toString()
  }

  if (pathname === ACCOUNT_APP_PATH || pathname.startsWith(`${ACCOUNT_APP_PATH}/`)) {
    return new URL(`${ACCOUNT_APP_PATH}${PASSWORD_RESET_PATH}`, origin).toString()
  }

  return new URL(PASSWORD_RESET_PATH, origin).toString()
}
