import assert from 'node:assert/strict'
import test from 'node:test'
import { loginKind, normalizePhone } from './login.js'

test('login kind separates parent phones from educator logins', () => {
  assert.equal(loginKind('+7 999 111-22-33'), 'parent')
  assert.equal(loginKind('9991112233'), 'parent')
  assert.equal(loginKind('teacher'), 'owner')
  assert.equal(loginKind('999111223'), 'invalid')
  assert.equal(loginKind(''), 'invalid')
})

test('phone formats normalize to the same Russian number', () => {
  const expected = '79991112233'
  assert.equal(normalizePhone('+7 (999) 111-22-33'), expected)
  assert.equal(normalizePhone('7 999 111 22 33'), expected)
  assert.equal(normalizePhone('8 999 111 22 33'), expected)
  assert.equal(normalizePhone('9991112233'), expected)
  assert.equal(normalizePhone('999111223'), '')
})
