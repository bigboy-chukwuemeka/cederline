export const ACCOUNT_APP_PATH = '/account-app'
export const ADMIN_BASE_PATH = `${ACCOUNT_APP_PATH}/admin`

export function getAccountAppRedirectUrl(origin = window.location.origin) {
  return new URL(`${ACCOUNT_APP_PATH}/`, origin).toString()
}
