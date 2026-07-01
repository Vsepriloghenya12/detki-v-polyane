export type LoginKind = 'parent' | 'owner' | 'invalid'

export function normalizePhone(value: string): string
export function loginKind(value: string): LoginKind
