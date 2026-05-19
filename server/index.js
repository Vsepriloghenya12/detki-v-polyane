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
let pool = null
let dbReady = false

const uid = () => crypto.randomUUID()

const addDays = days => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const cleanPhone = value => String(value || '').replace(/[\s()-]/g, '')

const initialState = () => ({
  families: [],
  lessons: [
    {
      id: uid(),
      title: 'Творческая поляна',
      date: addDays(1),
      time: '10:00',
      duration: '60 минут',
      description: 'Рисование, лепка и свободная игра',
      capacity: 10,
      bookedIds: [],
      attendedIds: [],
      comments: {}
    },
    {
      id: uid(),
      title: 'Музыкальное занятие',
      date: addDays(3),
      time: '11:00',
      duration: '45 минут',
      description: 'Ритм, песни, движение и мягкая адаптация',
      capacity: 8,
      bookedIds: [],
      attendedIds: [],
      comments: {}
    }
  ]
})

const normalizeState = value => ({
  families: Array.isArray(value?.families) ? value.families : [],
  lessons: Array.isArray(value?.lessons) ? value.lessons.map(lesson => ({
    id: String(lesson.id || uid()),
    title: String(lesson.title || ''),
    date: String(lesson.date || ''),
    time: String(lesson.time || ''),
    duration: String(lesson.duration || ''),
    description: String(lesson.description || ''),
    capacity: Math.max(1, Number(lesson.capacity) || 1),
    bookedIds: Array.isArray(lesson.bookedIds) ? lesson.bookedIds : [],
    attendedIds: Array.isArray(lesson.attendedIds) ? lesson.attendedIds : [],
    comments: lesson.comments && typeof lesson.comments === 'object' ? lesson.comments : {}
  })) : []
})

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

const readState = async () => {
  if (usePostgres) {
    await initDb()
    const result = await pool.query('SELECT value FROM app_state WHERE key = $1', ['main'])
    if (result.rows[0]?.value) return normalizeState(result.rows[0].value)
    const state = initialState()
    await saveState(state)
    return state
  }

  try {
    const raw = await readFile(stateFile, 'utf8')
    return normalizeState(JSON.parse(raw))
  } catch {
    const state = initialState()
    await saveState(state)
    return state
  }
}

const saveState = async state => {
  const normalized = normalizeState(state)
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

const countAttended = (state, familyId) => state.lessons.reduce((sum, lesson) => sum + (lesson.attendedIds.includes(familyId) ? 1 : 0), 0)
const remainingLessons = (state, familyId) => Math.max(0, (state.families.find(family => family.id === familyId)?.paidLessons || 0) - countAttended(state, familyId))

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

const handleApi = async (req, res, pathname) => {
  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, storage: usePostgres ? 'postgres' : 'file' })
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return json(res, 200, await readState())
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
      family = { id: uid(), phone, firstName, lastName, childName, paidLessons: 0, createdAt: new Date().toISOString() }
      state.families.push(family)
    }
    await saveState(state)
    return json(res, 200, { state, family })
  }

  const familyPaidMatch = pathname.match(/^\/api\/families\/([^/]+)\/paid$/)
  if (req.method === 'PATCH' && familyPaidMatch) {
    const body = await readBody(req)
    const familyId = decodeURIComponent(familyPaidMatch[1])
    const paidLessons = Math.max(0, Number(body.paidLessons) || 0)
    const state = await readState()
    if (!state.families.some(family => family.id === familyId)) return notFound(res)
    state.families = state.families.map(family => family.id === familyId ? { ...family, paidLessons } : family)
    await saveState(state)
    return json(res, 200, state)
  }

  if (req.method === 'POST' && pathname === '/api/lessons') {
    const body = await readBody(req)
    const title = String(body.title || '').trim()
    const date = String(body.date || '')
    const time = String(body.time || '')
    const duration = String(body.duration || '').trim()
    const description = String(body.description || '').trim()
    const capacity = Math.max(1, Number(body.capacity) || 1)
    if (!title || !date || !time || !duration) return badRequest(res)
    const state = await readState()
    state.lessons.push({ id: uid(), title, date, time, duration, description, capacity, bookedIds: [], attendedIds: [], comments: {} })
    state.lessons.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    await saveState(state)
    return json(res, 200, state)
  }

  const lessonMatch = pathname.match(/^\/api\/lessons\/([^/]+)$/)
  if (req.method === 'DELETE' && lessonMatch) {
    const lessonId = decodeURIComponent(lessonMatch[1])
    const state = await readState()
    state.lessons = state.lessons.filter(lesson => lesson.id !== lessonId)
    await saveState(state)
    return json(res, 200, state)
  }

  const bookingMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/bookings$/)
  if (req.method === 'POST' && bookingMatch) {
    const body = await readBody(req)
    const lessonId = decodeURIComponent(bookingMatch[1])
    const familyId = String(body.familyId || '')
    const state = await readState()
    const lesson = state.lessons.find(item => item.id === lessonId)
    if (!lesson || !state.families.some(family => family.id === familyId)) return notFound(res)
    const booked = lesson.bookedIds.includes(familyId)
    if (!booked && lesson.bookedIds.length >= lesson.capacity) return badRequest(res, 'lesson_full')
    if (!booked && remainingLessons(state, familyId) < 1) return badRequest(res, 'no_lessons_left')
    lesson.bookedIds = booked ? lesson.bookedIds.filter(id => id !== familyId) : [...lesson.bookedIds, familyId]
    await saveState(state)
    return json(res, 200, state)
  }

  const attendanceMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/attendance$/)
  if (req.method === 'POST' && attendanceMatch) {
    const body = await readBody(req)
    const lessonId = decodeURIComponent(attendanceMatch[1])
    const familyId = String(body.familyId || '')
    const state = await readState()
    const lesson = state.lessons.find(item => item.id === lessonId)
    if (!lesson || !state.families.some(family => family.id === familyId)) return notFound(res)
    const attended = lesson.attendedIds.includes(familyId)
    lesson.attendedIds = attended ? lesson.attendedIds.filter(id => id !== familyId) : [...lesson.attendedIds, familyId]
    await saveState(state)
    return json(res, 200, state)
  }

  const commentMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/comments\/([^/]+)$/)
  if (req.method === 'PATCH' && commentMatch) {
    const body = await readBody(req)
    const lessonId = decodeURIComponent(commentMatch[1])
    const familyId = decodeURIComponent(commentMatch[2])
    const comment = String(body.comment || '')
    const state = await readState()
    const lesson = state.lessons.find(item => item.id === lessonId)
    if (!lesson || !state.families.some(family => family.id === familyId)) return notFound(res)
    lesson.comments = { ...lesson.comments, [familyId]: comment }
    await saveState(state)
    return json(res, 200, state)
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
  '.ico': 'image/x-icon'
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
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname)
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
