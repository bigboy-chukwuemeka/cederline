export function isAdminUser(user) {
  const appMetadata = user?.app_metadata
  const role = typeof appMetadata?.role === 'string' ? appMetadata.role.toLowerCase() : ''
  const roles = Array.isArray(appMetadata?.roles) ? appMetadata.roles : []

  return role === 'admin' || roles.some((item) => typeof item === 'string' && item.toLowerCase() === 'admin')
}
