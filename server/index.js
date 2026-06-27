import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data')
const stateFile = process.env.STATE_FILE || path.join(dataDir, 'state.json')
const port = Number(process.env.PORT || 3000)
const usePostgres = Boolean(process.env.DATABASE_URL)
const isLocalDevelopment = !process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production'
const ownerPassword = process.env.OWNER_PASSWORD || (isLocalDevelopment ? 'detki-owner-dev' : '')
const ownerTokens = new Set()
let pool = null
let dbReady = false

const uid = () => crypto.randomUUID()
const nowIso = () => new Date().toISOString()
const weekdayCodes = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const jsDayToWeekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const attendanceStatuses = ['present', 'absent', 'late', 'sick', 'cancelled']
const sessionStatuses = ['scheduled', 'cancelled', 'completed']
const subscriptionStatuses = ['active', 'expired', 'finished']
const sessionPastDays = 30
const sessionFutureDays = 30

const cleanPhone = value => String(value || '').replace(/[\s()-]/g, '')

const moscowToday = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const get = type => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const shiftDate = (value, days) => {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

const weekdayForDate = value => jsDayToWeekday[new Date(`${value}T00:00:00Z`).getUTCDay()]
const sessionIdFor = (templateId, date) => `session-${templateId}-${date}`
const sessionSortKey = session => `${session.date}T${session.timeSnapshot}`

const initialState = () => ({
  schemaVersion: 2,
  families: [],
  lessonTemplates: [
    {
      id: uid(),
      title: 'Творческая поляна',
      description: 'Рисование, лепка и свободная игра',
      weekdays: ['tue', 'thu'],
      time: '10:00',
      duration: '60 минут',
      capacity: 10,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    {
      id: uid(),
      title: 'Музыкальное занятие',
      description: 'Ритм, песни, движение и мягкая адаптация',
      weekdays: ['sat'],
      time: '11:00',
      duration: '45 минут',
      capacity: 8,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ],
  lessonSessions: [],
  subscriptions: [],
  subscriptionTransactions: []
})

const normalizeWeekdays = value => {
  const weekdays = Array.isArray(value?.weekdays)
    ? [...new Set(value.weekdays.map(String).filter(day => weekdayCodes.includes(day)))]
    : []
  if (weekdays.length) return weekdays.sort((a, b) => weekdayCodes.indexOf(a) - weekdayCodes.indexOf(b))

  const legacyDate = String(value?.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(legacyDate)) return []
  return [jsDayToWeekday[new Date(`${legacyDate}T12:00:00Z`).getUTCDay()]]
}

const normalizeFamily = family => ({
  id: String(family.id || uid()),
  phone: cleanPhone(family.phone),
  firstName: String(family.firstName || ''),
  lastName: String(family.lastName || ''),
  childName: String(family.childName || ''),
  paidLessons: Math.max(0, Number(family.paidLessons) || 0),
  createdAt: String(family.createdAt || nowIso())
})

const normalizeTemplate = template => {
  const createdAt = String(template.createdAt || nowIso())
  return {
    id: String(template.id || uid()),
    title: String(template.title || ''),
    description: String(template.description || ''),
    weekdays: normalizeWeekdays(template),
    time: String(template.time || ''),
    duration: String(template.duration || ''),
    capacity: Math.max(1, Number(template.capacity) || 1),
    active: template.active !== false,
    createdAt,
    updatedAt: String(template.updatedAt || createdAt)
  }
}

const normalizeAttendanceRecord = record => {
  const status = attendanceStatuses.includes(record?.status) ? record.status : 'absent'
  return {
    status,
    markedAt: String(record?.markedAt || nowIso()),
    markedBy: 'owner',
    charged: Boolean(record?.charged),
    ...(record?.subscriptionId ? { subscriptionId: String(record.subscriptionId) } : {})
  }
}

const normalizeComment = comment => {
  if (typeof comment === 'string') {
    return {
      text: comment,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      author: 'owner',
      migrated: true
    }
  }
  const createdAt = String(comment?.createdAt || nowIso())
  return {
    text: String(comment?.text || ''),
    createdAt,
    updatedAt: String(comment?.updatedAt || createdAt),
    author: 'owner',
    ...(comment?.migrated ? { migrated: true } : {})
  }
}

const normalizeSession = (session, templates) => {
  const templateId = String(session.templateId || '')
  const template = templates.find(item => item.id === templateId)
  const attendance = {}
  if (session.attendance && typeof session.attendance === 'object') {
    for (const [childId, record] of Object.entries(session.attendance)) {
      attendance[childId] = normalizeAttendanceRecord(record)
    }
  }
  for (const childId of Array.isArray(session.attendedIds) ? session.attendedIds : []) {
    if (!attendance[childId]) {
      attendance[childId] = normalizeAttendanceRecord({ status: 'present', charged: true })
    }
  }

  const comments = {}
  if (session.comments && typeof session.comments === 'object') {
    for (const [childId, comment] of Object.entries(session.comments)) {
      comments[childId] = normalizeComment(comment)
    }
  }

  const createdAt = String(session.createdAt || nowIso())
  const status = sessionStatuses.includes(session.status)
    ? session.status
    : String(session.date || '') < moscowToday() ? 'completed' : 'scheduled'

  return {
    id: String(session.id || uid()),
    templateId,
    date: String(session.date || ''),
    titleSnapshot: String(session.titleSnapshot || session.title || template?.title || ''),
    timeSnapshot: String(session.timeSnapshot || session.time || template?.time || ''),
    durationSnapshot: String(session.durationSnapshot || session.duration || template?.duration || ''),
    descriptionSnapshot: String(session.descriptionSnapshot || session.description || template?.description || ''),
    capacitySnapshot: Math.max(1, Number(session.capacitySnapshot ?? session.capacity ?? template?.capacity) || 1),
    bookedChildIds: Array.isArray(session.bookedChildIds)
      ? session.bookedChildIds.map(String)
      : Array.isArray(session.bookedIds) ? session.bookedIds.map(String) : [],
    attendance,
    comments,
    status,
    createdAt,
    updatedAt: String(session.updatedAt || createdAt)
  }
}

const normalizeSubscription = subscription => {
  const totalLessons = Math.max(0, Number(subscription.totalLessons) || 0)
  const usedLessons = Math.min(totalLessons, Math.max(0, Number(subscription.usedLessons) || 0))
  const createdAt = String(subscription.createdAt || nowIso())
  return {
    id: String(subscription.id || uid()),
    childId: String(subscription.childId || ''),
    totalLessons,
    usedLessons,
    remainingLessons: Math.max(0, totalLessons - usedLessons),
    status: subscriptionStatuses.includes(subscription.status) ? subscription.status : 'active',
    startsAt: String(subscription.startsAt || createdAt.slice(0, 10)),
    expiresAt: subscription.expiresAt ? String(subscription.expiresAt) : null,
    createdAt,
    updatedAt: String(subscription.updatedAt || createdAt),
    note: String(subscription.note || '')
  }
}

const normalizeTransaction = transaction => ({
  id: String(transaction.id || uid()),
  subscriptionId: String(transaction.subscriptionId || ''),
  childId: String(transaction.childId || ''),
  type: ['add', 'charge', 'refund', 'manual_adjustment'].includes(transaction.type)
    ? transaction.type
    : 'manual_adjustment',
  amount: Math.max(0, Number(transaction.amount) || 0),
  reason: String(transaction.reason || ''),
  ...(transaction.lessonSessionId ? { lessonSessionId: String(transaction.lessonSessionId) } : {}),
  createdAt: String(transaction.createdAt || nowIso()),
  createdBy: transaction.createdBy === 'owner' ? 'owner' : 'system'
})

const createSessionsFromTemplates = (state, from = shiftDate(moscowToday(), -sessionPastDays), to = shiftDate(moscowToday(), sessionFutureDays)) => {
  const existing = new Set(state.lessonSessions.map(session => `${session.templateId}:${session.date}`))
  let created = 0

  for (const template of state.lessonTemplates.filter(item => item.active)) {
    const templateStart = /^\d{4}-\d{2}-\d{2}/.test(template.createdAt)
      ? template.createdAt.slice(0, 10)
      : from
    let date = templateStart > from ? templateStart : from

    while (date <= to) {
      const key = `${template.id}:${date}`
      if (template.weekdays.includes(weekdayForDate(date)) && !existing.has(key)) {
        const timestamp = nowIso()
        state.lessonSessions.push({
          id: sessionIdFor(template.id, date),
          templateId: template.id,
          date,
          titleSnapshot: template.title,
          timeSnapshot: template.time,
          durationSnapshot: template.duration,
          descriptionSnapshot: template.description,
          capacitySnapshot: template.capacity,
          bookedChildIds: [],
          attendance: {},
          comments: {},
          status: date < moscowToday() ? 'completed' : 'scheduled',
          createdAt: timestamp,
          updatedAt: timestamp
        })
        existing.add(key)
        created += 1
      }
      date = shiftDate(date, 1)
    }
  }

  state.lessonSessions.sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
  return created
}

const getUpcomingSessions = (state, from = moscowToday(), to = shiftDate(moscowToday(), sessionFutureDays)) => (
  state.lessonSessions
    .filter(session => session.date >= from && session.date <= to && session.status === 'scheduled')
    .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
)

const migrateState = value => {
  const families = Array.isArray(value?.families) ? value.families.map(normalizeFamily) : []
  const legacyLessons = Array.isArray(value?.lessons) ? value.lessons : []
  const templateSource = Array.isArray(value?.lessonTemplates)
    ? value.lessonTemplates
    : Array.isArray(value?.templates) ? value.templates : legacyLessons
  const lessonTemplates = templateSource.map(normalizeTemplate)

  const legacySessions = legacyLessons
    .filter(lesson => /^\d{4}-\d{2}-\d{2}$/.test(String(lesson.date || '')))
    .map(lesson => ({
      ...lesson,
      id: `legacy-${lesson.id}-${lesson.date}`,
      templateId: String(lesson.id || ''),
      date: String(lesson.date)
    }))
  const sessionSource = Array.isArray(value?.lessonSessions)
    ? value.lessonSessions
    : Array.isArray(value?.sessions) ? value.sessions : legacySessions
  const lessonSessions = sessionSource.map(session => normalizeSession(session, lessonTemplates))

  const state = {
    schemaVersion: 2,
    families,
    lessonTemplates,
    lessonSessions,
    subscriptions: Array.isArray(value?.subscriptions) ? value.subscriptions.map(normalizeSubscription) : [],
    subscriptionTransactions: Array.isArray(value?.subscriptionTransactions)
      ? value.subscriptionTransactions.map(normalizeTransaction)
      : []
  }

  createSessionsFromTemplates(state)

  if (!Array.isArray(value?.lessonSessions) && !Array.isArray(value?.sessions)) {
    for (const lesson of legacyLessons.filter(item => !item.date)) {
      const session = state.lessonSessions.find(item => item.templateId === String(lesson.id || ''))
      if (!session) continue
      session.bookedChildIds = [...new Set([
        ...session.bookedChildIds,
        ...(Array.isArray(lesson.bookedIds) ? lesson.bookedIds.map(String) : [])
      ])]
      for (const childId of Array.isArray(lesson.attendedIds) ? lesson.attendedIds : []) {
        session.attendance[childId] = normalizeAttendanceRecord({ status: 'present', charged: true })
      }
      for (const [childId, comment] of Object.entries(lesson.comments || {})) {
        session.comments[childId] = normalizeComment(comment)
      }
    }
  }

  if (!Array.isArray(value?.subscriptions)) {
    for (const family of families) {
      const attendedSessions = state.lessonSessions
        .filter(session => ['present', 'late'].includes(session.attendance[family.id]?.status))
        .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
      const totalLessons = family.paidLessons
      if (totalLessons < 1) {
        for (const session of attendedSessions) session.attendance[family.id].charged = false
        continue
      }

      const usedLessons = Math.min(totalLessons, attendedSessions.length)
      const subscriptionId = `legacy-subscription-${family.id}`
      const createdAt = family.createdAt || nowIso()
      state.subscriptions.push(normalizeSubscription({
        id: subscriptionId,
        childId: family.id,
        totalLessons,
        usedLessons,
        status: usedLessons >= totalLessons ? 'finished' : 'active',
        startsAt: createdAt.slice(0, 10),
        createdAt,
        updatedAt: nowIso(),
        note: 'Перенесено из старого абонемента'
      }))
      state.subscriptionTransactions.push(normalizeTransaction({
        id: `legacy-add-${family.id}`,
        subscriptionId,
        childId: family.id,
        type: 'add',
        amount: totalLessons,
        reason: 'Миграция paidLessons',
        createdAt,
        createdBy: 'system'
      }))
      attendedSessions.forEach((session, index) => {
        const charged = index < usedLessons
        session.attendance[family.id].charged = charged
        if (charged) {
          session.attendance[family.id].subscriptionId = subscriptionId
          state.subscriptionTransactions.push(normalizeTransaction({
            id: `legacy-charge-${session.id}-${family.id}`,
            subscriptionId,
            childId: family.id,
            type: 'charge',
            amount: 1,
            reason: 'Миграция посещения',
            lessonSessionId: session.id,
            createdAt: session.date,
            createdBy: 'system'
          }))
        }
      })
    }
  }

  return state
}

const refreshSubscriptionStatuses = state => {
  const today = moscowToday()
  for (const subscription of state.subscriptions) {
    if (subscription.expiresAt && subscription.expiresAt < today) subscription.status = 'expired'
    else if (subscription.remainingLessons <= 0) subscription.status = 'finished'
    else subscription.status = 'active'
  }
}

const getChildSubscriptions = (state, childId) => {
  refreshSubscriptionStatuses(state)
  return state.subscriptions
    .filter(subscription => subscription.childId === childId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

const getSubscriptionSummary = (state, childId) => {
  const subscriptions = getChildSubscriptions(state, childId)
  return {
    totalLessons: subscriptions.reduce((sum, item) => sum + item.totalLessons, 0),
    usedLessons: subscriptions.reduce((sum, item) => sum + item.usedLessons, 0),
    remainingLessons: subscriptions.reduce((sum, item) => sum + item.remainingLessons, 0),
    expiresAt: subscriptions.find(item => item.status === 'active' && item.expiresAt)?.expiresAt || null
  }
}

const chargeSubscription = (state, childId, lessonSessionId) => {
  const today = moscowToday()
  const subscription = getChildSubscriptions(state, childId)
    .filter(item => item.status === 'active' && item.startsAt <= today && (!item.expiresAt || item.expiresAt >= today))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .find(item => item.remainingLessons > 0)
  if (!subscription) return null

  subscription.usedLessons += 1
  subscription.remainingLessons = Math.max(0, subscription.totalLessons - subscription.usedLessons)
  subscription.updatedAt = nowIso()
  if (subscription.remainingLessons === 0) subscription.status = 'finished'
  state.subscriptionTransactions.push(normalizeTransaction({
    id: uid(),
    subscriptionId: subscription.id,
    childId,
    type: 'charge',
    amount: 1,
    reason: 'Посещение занятия',
    lessonSessionId,
    createdAt: nowIso(),
    createdBy: 'system'
  }))
  return subscription
}

const refundSubscription = (state, childId, lessonSessionId, subscriptionId) => {
  const subscription = state.subscriptions.find(item => item.id === subscriptionId && item.childId === childId)
  if (!subscription || subscription.usedLessons <= 0) return null

  subscription.usedLessons -= 1
  subscription.remainingLessons = Math.max(0, subscription.totalLessons - subscription.usedLessons)
  subscription.updatedAt = nowIso()
  refreshSubscriptionStatuses(state)
  state.subscriptionTransactions.push(normalizeTransaction({
    id: uid(),
    subscriptionId: subscription.id,
    childId,
    type: 'refund',
    amount: 1,
    reason: 'Изменение статуса посещения',
    lessonSessionId,
    createdAt: nowIso(),
    createdBy: 'system'
  }))
  return subscription
}

const markAttendance = (state, sessionId, childId, status) => {
  if (!attendanceStatuses.includes(status)) return { error: 'bad_request' }
  const session = state.lessonSessions.find(item => item.id === sessionId)
  if (!session || !state.families.some(family => family.id === childId)) return { error: 'not_found' }

  const previous = session.attendance[childId]
  if (previous?.status === status) return { session, record: previous }

  const shouldCharge = status === 'present' || status === 'late'
  let subscriptionId = previous?.subscriptionId
  let charged = Boolean(previous?.charged)

  if (shouldCharge && !charged) {
    const subscription = chargeSubscription(state, childId, sessionId)
    if (!subscription) return { error: 'no_lessons_left' }
    subscriptionId = subscription.id
    charged = true
  } else if (!shouldCharge && charged) {
    refundSubscription(state, childId, sessionId, subscriptionId)
    subscriptionId = undefined
    charged = false
  }

  session.attendance[childId] = {
    status,
    markedAt: nowIso(),
    markedBy: 'owner',
    charged,
    ...(subscriptionId ? { subscriptionId } : {})
  }
  session.updatedAt = nowIso()
  if (session.date <= moscowToday() && session.status !== 'cancelled') session.status = 'completed'
  return { session, record: session.attendance[childId] }
}

const saveLessonComment = (state, sessionId, childId, text) => {
  const session = state.lessonSessions.find(item => item.id === sessionId)
  if (!session || !state.families.some(family => family.id === childId)) return { error: 'not_found' }
  const existing = session.comments[childId]
  const trimmed = String(text || '').trim()
  if (existing?.text === trimmed) return { session, comment: existing }
  const timestamp = nowIso()
  session.comments[childId] = {
    text: trimmed,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    author: 'owner'
  }
  session.updatedAt = timestamp
  return { session, comment: session.comments[childId] }
}

const initDb = async () => {
  if (!usePostgres || dbReady) return
  const { Pool } = await import('pg')
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  })
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
  dbReady = true
}

const saveState = async state => {
  const normalized = migrateState(state)
  createSessionsFromTemplates(normalized)
  refreshSubscriptionStatuses(normalized)
  if (usePostgres) {
    await initDb()
    await pool.query(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      ['main', JSON.stringify(normalized)]
    )
    return normalized
  }

  await mkdir(dataDir, { recursive: true })
  await writeFile(stateFile, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

const readState = async () => {
  if (usePostgres) {
    await initDb()
    const result = await pool.query('SELECT value FROM app_state WHERE key = $1', ['main'])
    if (result.rows[0]?.value) {
      const raw = result.rows[0].value
      const state = migrateState(raw)
      createSessionsFromTemplates(state)
      refreshSubscriptionStatuses(state)
      if (raw.schemaVersion !== 2) await saveState(state)
      return state
    }
    const state = initialState()
    createSessionsFromTemplates(state)
    await saveState(state)
    return state
  }

  try {
    const rawText = await readFile(stateFile, 'utf8')
    const raw = JSON.parse(rawText)
    const state = migrateState(raw)
    createSessionsFromTemplates(state)
    refreshSubscriptionStatuses(state)
    if (raw.schemaVersion !== 2) await saveState(state)
    return state
  } catch {
    const state = initialState()
    createSessionsFromTemplates(state)
    await saveState(state)
    return state
  }
}

const json = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

const readBody = req => new Promise((resolve, reject) => {
  let data = ''
  req.on('data', chunk => {
    data += chunk
    if (data.length > 1000000) req.destroy()
  })
  req.on('end', () => {
    if (!data) return resolve({})
    try {
      resolve(JSON.parse(data))
    } catch (error) {
      reject(error)
    }
  })
  req.on('error', reject)
})

const notFound = res => json(res, 404, { error: 'not_found' })
const badRequest = (res, message = 'bad_request') => json(res, 400, { error: message })
const unauthorized = res => json(res, 401, { error: 'unauthorized' })

const requireOwnerAuth = (req, res) => {
  const token = String(req.headers['x-owner-token'] || '')
  if (!token || !ownerTokens.has(token)) {
    unauthorized(res)
    return false
  }
  return true
}

const safePasswordEqual = (left, right) => {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest()
  const rightHash = crypto.createHash('sha256').update(String(right)).digest()
  return crypto.timingSafeEqual(leftHash, rightHash)
}

const publicSession = (session, familyId) => ({
  ...session,
  bookedCount: session.bookedChildIds.length,
  bookedChildIds: familyId && session.bookedChildIds.includes(familyId) ? [familyId] : [],
  attendance: familyId && session.attendance[familyId] ? { [familyId]: session.attendance[familyId] } : {},
  comments: familyId && session.comments[familyId] ? { [familyId]: session.comments[familyId] } : {}
})

const parentState = (state, familyId = '') => {
  const family = state.families.find(item => item.id === familyId)
  return {
    schemaVersion: 2,
    families: family ? [family] : [],
    lessonTemplates: [],
    lessonSessions: state.lessonSessions.map(session => publicSession(session, familyId)),
    subscriptions: family ? getChildSubscriptions(state, family.id) : [],
    subscriptionTransactions: family
      ? state.subscriptionTransactions.filter(transaction => transaction.childId === family.id)
      : []
  }
}

const parseRange = url => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '')
    ? url.searchParams.get('from')
    : moscowToday(),
  to: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') || '')
    ? url.searchParams.get('to')
    : shiftDate(moscowToday(), sessionFutureDays)
})

const handleApi = async (req, res, url) => {
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, storage: usePostgres ? 'postgres' : 'file' })
  }

  if (req.method === 'POST' && pathname === '/api/owner/login') {
    if (!ownerPassword) return json(res, 503, { error: 'owner_password_not_configured' })
    const body = await readBody(req)
    if (!safePasswordEqual(body.password, ownerPassword)) return unauthorized(res)
    const token = crypto.randomBytes(32).toString('hex')
    ownerTokens.add(token)
    return json(res, 200, { token })
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    const state = await readState()
    return json(res, 200, parentState(state, String(url.searchParams.get('familyId') || '')))
  }

  if (req.method === 'GET' && pathname === '/api/owner/state') {
    if (!requireOwnerAuth(req, res)) return
    return json(res, 200, await readState())
  }

  if (req.method === 'GET' && pathname === '/api/lesson-sessions') {
    const state = await readState()
    const { from, to } = parseRange(url)
    const familyId = String(url.searchParams.get('familyId') || '')
    return json(res, 200, getUpcomingSessions(state, from, to)
      .map(session => publicSession(session, familyId)))
  }

  const publicSessionMatch = pathname.match(/^\/api\/lesson-sessions\/([^/]+)$/)
  if (req.method === 'GET' && publicSessionMatch) {
    const state = await readState()
    const session = state.lessonSessions.find(item => item.id === decodeURIComponent(publicSessionMatch[1]))
    if (!session) return notFound(res)
    return json(res, 200, publicSession(session, String(url.searchParams.get('familyId') || '')))
  }

  if (req.method === 'POST' && pathname === '/api/families') {
    const body = await readBody(req)
    const phone = cleanPhone(body.phone)
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const childName = String(body.childName || '').trim()
    if (!phone || !firstName || !lastName || !childName) return badRequest(res)
    const state = await readState()
    const existing = state.families.find(family => cleanPhone(family.phone) === phone)
    let family
    if (existing) {
      family = { ...existing, phone, firstName, lastName, childName }
      state.families = state.families.map(item => item.id === existing.id ? family : item)
    } else {
      family = normalizeFamily({ id: uid(), phone, firstName, lastName, childName, paidLessons: 0, createdAt: nowIso() })
      state.families.push(family)
    }
    await saveState(state)
    return json(res, 200, { state: parentState(state, family.id), family })
  }

  if (req.method === 'POST' && pathname === '/api/lesson-templates') {
    if (!requireOwnerAuth(req, res)) return
    const body = await readBody(req)
    const template = normalizeTemplate({
      id: uid(),
      title: String(body.title || '').trim(),
      description: String(body.description || '').trim(),
      weekdays: body.weekdays,
      time: String(body.time || ''),
      duration: String(body.duration || '').trim(),
      capacity: body.capacity,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
    if (!template.title || template.weekdays.length === 0 || !template.time || !template.duration) return badRequest(res)
    const state = await readState()
    state.lessonTemplates.push(template)
    createSessionsFromTemplates(state)
    await saveState(state)
    return json(res, 200, state)
  }

  const templateMatch = pathname.match(/^\/api\/lesson-templates\/([^/]+)$/)
  if (req.method === 'PUT' && templateMatch) {
    if (!requireOwnerAuth(req, res)) return
    const state = await readState()
    const templateId = decodeURIComponent(templateMatch[1])
    const existing = state.lessonTemplates.find(item => item.id === templateId)
    if (!existing) return notFound(res)
    const body = await readBody(req)
    const updated = normalizeTemplate({
      ...existing,
      ...body,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    })
    if (!updated.title || updated.weekdays.length === 0 || !updated.time || !updated.duration) return badRequest(res)
    state.lessonTemplates = state.lessonTemplates.map(item => item.id === templateId ? updated : item)
    const today = moscowToday()
    state.lessonSessions = state.lessonSessions.filter(session => {
      if (session.templateId !== templateId || session.date < today) return true
      const hasActivity = session.bookedChildIds.length > 0 ||
        Object.keys(session.attendance).length > 0 ||
        Object.keys(session.comments).length > 0
      return hasActivity
    })
    createSessionsFromTemplates(state)
    await saveState(state)
    return json(res, 200, state)
  }

  if (req.method === 'DELETE' && templateMatch) {
    if (!requireOwnerAuth(req, res)) return
    const state = await readState()
    const templateId = decodeURIComponent(templateMatch[1])
    const template = state.lessonTemplates.find(item => item.id === templateId)
    if (!template) return notFound(res)
    template.active = false
    template.updatedAt = nowIso()
    const today = moscowToday()
    state.lessonSessions = state.lessonSessions.filter(session => {
      if (session.templateId !== templateId || session.date < today) return true
      return session.bookedChildIds.length > 0 ||
        Object.keys(session.attendance).length > 0 ||
        Object.keys(session.comments).length > 0
    })
    await saveState(state)
    return json(res, 200, state)
  }

  const bookMatch = pathname.match(/^\/api\/lesson-sessions\/([^/]+)\/book$/)
  if (req.method === 'POST' && bookMatch) {
    const body = await readBody(req)
    const childId = String(body.childId || '')
    const state = await readState()
    const session = state.lessonSessions.find(item => item.id === decodeURIComponent(bookMatch[1]))
    if (!session || !state.families.some(family => family.id === childId)) return notFound(res)
    if (session.status !== 'scheduled' || session.date < moscowToday()) return badRequest(res)
    if (session.bookedChildIds.includes(childId)) return json(res, 200, parentState(state, childId))
    if (session.bookedChildIds.length >= session.capacitySnapshot) return badRequest(res, 'lesson_full')
    const remaining = getSubscriptionSummary(state, childId).remainingLessons
    const reserved = state.lessonSessions.filter(item =>
      item.date >= moscowToday() &&
      item.bookedChildIds.includes(childId) &&
      !item.attendance[childId]?.charged
    ).length
    if (remaining <= reserved) return badRequest(res, 'no_lessons_left')
    session.bookedChildIds.push(childId)
    session.updatedAt = nowIso()
    await saveState(state)
    return json(res, 200, parentState(state, childId))
  }

  const cancelBookingMatch = pathname.match(/^\/api\/lesson-sessions\/([^/]+)\/cancel-booking$/)
  if (req.method === 'POST' && cancelBookingMatch) {
    const body = await readBody(req)
    const childId = String(body.childId || '')
    const state = await readState()
    const session = state.lessonSessions.find(item => item.id === decodeURIComponent(cancelBookingMatch[1]))
    if (!session || !state.families.some(family => family.id === childId)) return notFound(res)
    session.bookedChildIds = session.bookedChildIds.filter(id => id !== childId)
    session.updatedAt = nowIso()
    await saveState(state)
    return json(res, 200, parentState(state, childId))
  }

  const ownerAttendanceMatch = pathname.match(/^\/api\/owner\/lesson-sessions\/([^/]+)\/attendance$/)
  if (req.method === 'POST' && ownerAttendanceMatch) {
    if (!requireOwnerAuth(req, res)) return
    const body = await readBody(req)
    const state = await readState()
    const result = markAttendance(
      state,
      decodeURIComponent(ownerAttendanceMatch[1]),
      String(body.childId || ''),
      String(body.status || '')
    )
    if (result.error === 'not_found') return notFound(res)
    if (result.error) return badRequest(res, result.error)
    await saveState(state)
    return json(res, 200, state)
  }

  const ownerCommentMatch = pathname.match(/^\/api\/owner\/lesson-sessions\/([^/]+)\/comments$/)
  if (req.method === 'POST' && ownerCommentMatch) {
    if (!requireOwnerAuth(req, res)) return
    const body = await readBody(req)
    const state = await readState()
    const result = saveLessonComment(
      state,
      decodeURIComponent(ownerCommentMatch[1]),
      String(body.childId || ''),
      body.text
    )
    if (result.error) return notFound(res)
    await saveState(state)
    return json(res, 200, state)
  }

  const subscriptionMatch = pathname.match(/^\/api\/owner\/children\/([^/]+)\/subscriptions$/)
  if (req.method === 'POST' && subscriptionMatch) {
    if (!requireOwnerAuth(req, res)) return
    const body = await readBody(req)
    const childId = decodeURIComponent(subscriptionMatch[1])
    const totalLessons = Math.max(1, Number(body.totalLessons) || 0)
    const state = await readState()
    if (!state.families.some(family => family.id === childId)) return notFound(res)
    const timestamp = nowIso()
    const subscription = normalizeSubscription({
      id: uid(),
      childId,
      totalLessons,
      usedLessons: 0,
      status: 'active',
      startsAt: moscowToday(),
      expiresAt: body.expiresAt || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      note: String(body.note || '')
    })
    state.subscriptions.push(subscription)
    state.subscriptionTransactions.push(normalizeTransaction({
      id: uid(),
      subscriptionId: subscription.id,
      childId,
      type: 'add',
      amount: totalLessons,
      reason: subscription.note || 'Добавление абонемента',
      createdAt: timestamp,
      createdBy: 'owner'
    }))
    await saveState(state)
    return json(res, 200, state)
  }

  if (req.method === 'GET' && subscriptionMatch) {
    if (!requireOwnerAuth(req, res)) return
    const state = await readState()
    const childId = decodeURIComponent(subscriptionMatch[1])
    if (!state.families.some(family => family.id === childId)) return notFound(res)
    return json(res, 200, getChildSubscriptions(state, childId))
  }

  const transactionMatch = pathname.match(/^\/api\/owner\/children\/([^/]+)\/subscription-transactions$/)
  if (req.method === 'GET' && transactionMatch) {
    if (!requireOwnerAuth(req, res)) return
    const state = await readState()
    const childId = decodeURIComponent(transactionMatch[1])
    if (!state.families.some(family => family.id === childId)) return notFound(res)
    return json(res, 200, state.subscriptionTransactions
      .filter(transaction => transaction.childId === childId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  }

  return notFound(res)
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const serveStatic = async (req, res, pathname) => {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(distDir, safePath === '/' ? 'index.html' : safePath)
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    filePath = path.join(distDir, 'index.html')
  }

  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res)
    return await serveStatic(req, res, url.pathname)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: 'server_error' })
  }
})

server.listen(port, () => {
  console.log(`Detki v Polyane server started on ${port}`)
})
