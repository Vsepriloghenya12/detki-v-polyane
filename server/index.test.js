import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const findFreePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

const request = async (baseUrl, pathname, options = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options.headers
    }
  })
  const body = await response.json()
  return { status: response.status, body }
}

const waitForServer = async baseUrl => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw new Error('Test server did not start')
}

test('owner household is available to every parent and contains every child', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'detki-family-test-'))
  const stateFile = path.join(directory, 'state.json')
  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  await writeFile(stateFile, JSON.stringify({
    schemaVersion: 2,
    families: [{
      id: 'legacy-child',
      phone: '+7 999 111-22-33',
      firstName: 'Мария',
      lastName: 'Смирнова',
      childName: 'Коля',
      paidLessons: 0,
      createdAt: '2026-06-01T10:00:00.000Z'
    }],
    lessonTemplates: [],
    lessonSessions: [],
    subscriptions: [{
      id: 'legacy-subscription',
      childId: 'legacy-child',
      totalLessons: 3,
      usedLessons: 0,
      remainingLessons: 3,
      status: 'active',
      startsAt: '2026-06-01',
      expiresAt: null,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      note: ''
    }],
    subscriptionTransactions: []
  }), 'utf8')

  const childProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PORT: String(port),
      STATE_FILE: stateFile,
      OWNER_PASSWORD: 'test-owner',
      NODE_ENV: 'test'
    },
    stdio: 'ignore'
  })
  t.after(async () => {
    childProcess.kill()
    await rm(directory, { recursive: true, force: true })
  })
  await waitForServer(baseUrl)

  const login = await request(baseUrl, '/api/owner/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'test-owner' })
  })
  assert.equal(login.status, 200)
  const ownerHeaders = { 'x-owner-token': login.body.token }
  const migrated = await request(baseUrl, '/api/owner/state', { headers: ownerHeaders })
  assert.equal(migrated.body.families.find(item => item.id === 'legacy-child').householdId, 'household-legacy-child')
  assert.equal(migrated.body.parents.find(item => item.householdId === 'household-legacy-child').phone, '79991112233')
  assert.equal(migrated.body.subscriptions.find(item => item.childId === 'legacy-child').remainingLessons, 3)

  const created = await request(baseUrl, '/api/owner/households', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      parent: { firstName: 'Анна', lastName: 'Иванова', phone: '+7 900 100-20-30' },
      child: { childName: 'Миша', totalLessons: 8 }
    })
  })
  assert.equal(created.status, 200)
  const createdChild = created.body.families.find(item => item.childName === 'Миша')
  const householdId = createdChild.householdId
  const firstChildId = createdChild.id

  const addedParent = await request(baseUrl, `/api/owner/households/${householdId}/parents`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ firstName: 'Иван', lastName: 'Иванов', phone: '8 (900) 555-44-33' })
  })
  assert.equal(addedParent.status, 200)

  const addedChild = await request(baseUrl, `/api/owner/households/${householdId}/children`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ childName: 'Лиза', totalLessons: 4 })
  })
  assert.equal(addedChild.status, 200)

  const parentLogin = await request(baseUrl, '/api/families', {
    method: 'POST',
    body: JSON.stringify({
      phone: '+7 900 555 44 33',
      firstName: 'Иван',
      lastName: 'Иванов',
      childName: 'Не используется'
    })
  })

  assert.equal(parentLogin.status, 200)
  assert.equal(parentLogin.body.family.id, firstChildId)
  assert.equal(parentLogin.body.state.families.length, 2)
  assert.equal(parentLogin.body.state.parents.length, 2)
  assert.deepEqual(
    parentLogin.body.state.subscriptions.map(item => item.remainingLessons).sort((a, b) => a - b),
    [4, 8]
  )

  const secondChildId = parentLogin.body.state.families.find(item => item.id !== firstChildId).id
  const addAdjustment = await request(baseUrl, `/api/owner/children/${secondChildId}/subscription-adjustments`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ direction: 'add', amount: 2, note: 'Доплата' })
  })
  assert.equal(addAdjustment.status, 200)
  assert.equal(
    addAdjustment.body.subscriptions
      .filter(item => item.childId === secondChildId)
      .reduce((sum, item) => sum + item.remainingLessons, 0),
    6
  )

  const removeAdjustment = await request(baseUrl, `/api/owner/children/${secondChildId}/subscription-adjustments`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ direction: 'remove', amount: 3, note: 'Перерасчёт' })
  })
  assert.equal(removeAdjustment.status, 200)
  assert.equal(
    removeAdjustment.body.subscriptions
      .filter(item => item.childId === secondChildId)
      .reduce((sum, item) => sum + item.remainingLessons, 0),
    3
  )
  assert.equal(
    removeAdjustment.body.subscriptions
      .filter(item => item.childId === secondChildId)
      .reduce((sum, item) => sum + item.usedLessons, 0),
    0
  )

  const excessiveAdjustment = await request(baseUrl, `/api/owner/children/${secondChildId}/subscription-adjustments`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ direction: 'remove', amount: 4 })
  })
  assert.equal(excessiveAdjustment.status, 400)
  assert.equal(excessiveAdjustment.body.error, 'adjustment_exceeds_balance')

  const stateAfterRejectedAdjustment = await request(baseUrl, '/api/owner/state', {
    headers: ownerHeaders
  })
  assert.equal(
    stateAfterRejectedAdjustment.body.subscriptions
      .filter(item => item.childId === secondChildId)
      .reduce((sum, item) => sum + item.remainingLessons, 0),
    3
  )

  const lessonState = await request(baseUrl, '/api/lesson-templates', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      title: 'Музыка',
      description: 'Тестовое занятие',
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      time: '11:00',
      duration: '45 минут',
      capacity: 1
    })
  })
  assert.equal(lessonState.status, 200)
  const session = lessonState.body.lessonSessions.find(item => item.status === 'scheduled')

  const firstBooking = await request(baseUrl, `/api/lesson-sessions/${session.id}/book`, {
    method: 'POST',
    body: JSON.stringify({ childId: firstChildId })
  })
  assert.equal(firstBooking.status, 200)
  const secondBooking = await request(baseUrl, `/api/lesson-sessions/${session.id}/book`, {
    method: 'POST',
    body: JSON.stringify({ childId: secondChildId })
  })
  assert.equal(secondBooking.status, 400)
  assert.equal(secondBooking.body.error, 'lesson_full')

  const manualSecondBooking = await request(baseUrl, `/api/owner/lesson-sessions/${session.id}/children`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ childId: secondChildId })
  })
  assert.equal(manualSecondBooking.status, 200)
  assert.equal(
    manualSecondBooking.body.lessonSessions.find(item => item.id === session.id).bookedChildIds.includes(secondChildId),
    true
  )

  const walkInHousehold = await request(baseUrl, '/api/owner/households', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      parent: { firstName: 'Ольга', lastName: 'Петрова', phone: '+7 901 222-33-44' },
      child: { childName: 'Саша', totalLessons: 2 }
    })
  })
  const walkInChildId = walkInHousehold.body.families.find(item => item.childName === 'Саша').id
  const walkIn = await request(baseUrl, `/api/owner/lesson-sessions/${session.id}/children`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ childId: walkInChildId })
  })
  assert.equal(walkIn.status, 200)
  assert.equal(
    walkIn.body.lessonSessions.find(item => item.id === session.id).bookedChildIds.includes(walkInChildId),
    true
  )

  const attendance = await request(baseUrl, `/api/owner/lesson-sessions/${session.id}/attendance`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ childId: walkInChildId, status: 'present' })
  })
  assert.equal(attendance.status, 200)
  assert.equal(
    attendance.body.subscriptions.find(item => item.childId === walkInChildId).remainingLessons,
    1
  )
})
