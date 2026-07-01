export const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '')
  const normalized = digits.length === 10
    ? `7${digits}`
    : digits.length === 11 && digits.startsWith('8')
      ? `7${digits.slice(1)}`
      : digits
  return /^7\d{10}$/.test(normalized) ? normalized : ''
}

export const loginKind = value => {
  const identifier = String(value || '').trim()
  if (!identifier) return 'invalid'
  if (normalizePhone(identifier)) return 'parent'
  return /[a-zа-яё]/i.test(identifier) ? 'owner' : 'invalid'
}
