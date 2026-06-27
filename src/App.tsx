import { useEffect, useRef, useState, type ReactNode } from 'react'

type ParentTab = 'schedule' | 'bookings' | 'profile'
type OwnerTab = 'home' | 'lessons' | 'families' | 'attendance'
type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type AttendanceStatus = 'present' | 'absent' | 'late' | 'sick' | 'cancelled'
type SessionStatus = 'scheduled' | 'cancelled' | 'completed'

type Family = {
  id: string
  phone: string
  firstName: string
  lastName: string
  childName: string
  paidLessons: number
  createdAt: string
}

type LessonTemplate = {
  id: string
  title: string
  description: string
  weekdays: Weekday[]
  time: string
  duration: string
  capacity: number
  active: boolean
  createdAt: string
  updatedAt: string
}

type AttendanceRecord = {
  status: AttendanceStatus
  markedAt: string
  markedBy: 'owner'
  charged: boolean
  subscriptionId?: string
}

type LessonComment = {
  text: string
  createdAt: string
  updatedAt: string
  author: 'owner'
  migrated?: boolean
}

type LessonSession = {
  id: string
  templateId: string
  date: string
  titleSnapshot: string
  timeSnapshot: string
  durationSnapshot: string
  descriptionSnapshot: string
  capacitySnapshot: number
  bookedChildIds: string[]
  bookedCount?: number
  attendance: Record<string, AttendanceRecord>
  comments: Record<string, LessonComment>
  status: SessionStatus
  createdAt: string
  updatedAt: string
}

type Subscription = {
  id: string
  childId: string
  totalLessons: number
  usedLessons: number
  remainingLessons: number
  status: 'active' | 'expired' | 'finished'
  startsAt: string
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  note: string
}

type SubscriptionTransaction = {
  id: string
  subscriptionId: string
  childId: string
  type: 'add' | 'charge' | 'refund' | 'manual_adjustment'
  amount: number
  reason: string
  lessonSessionId?: string
  createdAt: string
  createdBy: 'owner' | 'system'
}

type AppState = {
  schemaVersion: number
  families: Family[]
  lessonTemplates: LessonTemplate[]
  lessonSessions: LessonSession[]
  subscriptions: Subscription[]
  subscriptionTransactions: SubscriptionTransaction[]
}

type NewTemplate = {
  title: string
  weekdays: Weekday[]
  time: string
  duration: string
  description: string
  capacity: string
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const storeKey = 'detki-v-polyane'
const ownerTokenStorageKey = `${storeKey}-ownerToken`

const weekdayOptions: { value: Weekday; short: string; label: string }[] = [
  { value: 'mon', short: 'Пн', label: 'понедельник' },
  { value: 'tue', short: 'Вт', label: 'вторник' },
  { value: 'wed', short: 'Ср', label: 'среда' },
  { value: 'thu', short: 'Чт', label: 'четверг' },
  { value: 'fri', short: 'Пт', label: 'пятница' },
  { value: 'sat', short: 'Сб', label: 'суббота' },
  { value: 'sun', short: 'Вс', label: 'воскресенье' }
]
const weekdayOrder = weekdayOptions.map(day => day.value)

const attendanceOptions: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Был' },
  { value: 'absent', label: 'Не был' },
  { value: 'late', label: 'Опоздал' },
  { value: 'sick', label: 'Болел' },
  { value: 'cancelled', label: 'Отмена' }
]

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: 'Был',
  absent: 'Не был',
  late: 'Опоздал',
  sick: 'Болел',
  cancelled: 'Отмена'
}

const transactionLabels: Record<SubscriptionTransaction['type'], string> = {
  add: 'Добавлено',
  charge: 'Списано',
  refund: 'Возвращено',
  manual_adjustment: 'Корректировка'
}

const emptyState: AppState = {
  schemaVersion: 2,
  families: [],
  lessonTemplates: [],
  lessonSessions: [],
  subscriptions: [],
  subscriptionTransactions: []
}

const cleanPhone = (value: string) => value.replace(/[\s()-]/g, '')

const todayIso = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatDate = (value: string) => {
  const formatted = new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

const formatShortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})

const formatWeekdays = (values: Weekday[]) => {
  const labels = weekdayOptions.filter(day => values.includes(day.value)).map(day => day.label)
  const text = labels.join(', ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Дни не выбраны'
}

const errorMessages: Record<string, string> = {
  lesson_full: 'На занятии уже нет свободных мест.',
  no_lessons_left: 'В абонементе не осталось занятий.',
  bad_request: 'Проверьте заполнение полей.',
  not_found: 'Данные не найдены. Обновите страницу.',
  unauthorized: 'Неверный пароль или сессия владельца завершена.',
  owner_password_not_configured: 'На сервере не настроен пароль владельца.',
  server_error: 'Ошибка сервера. Попробуйте еще раз.'
}

const readOwnerToken = () => {
  const saved = localStorage.getItem(ownerTokenStorageKey)
  if (!saved) return ''
  try {
    return String(JSON.parse(saved) || '')
  } catch {
    return saved
  }
}

const api = async <T,>(url: string, options?: RequestInit, owner = false): Promise<T> => {
  const ownerToken = readOwnerToken()
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(owner && ownerToken ? { 'x-owner-token': ownerToken } : {}),
      ...(options?.headers || {})
    }
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code = data?.error || 'server_error'
    throw new ApiError(errorMessages[code] || errorMessages.server_error, response.status)
  }
  return data as T
}

const templateFromForm = (form: FormData): NewTemplate => ({
  title: String(form.get('title') || '').trim(),
  weekdays: form.getAll('weekdays').map(String).filter(day => weekdayOrder.includes(day as Weekday)) as Weekday[],
  time: String(form.get('time') || ''),
  duration: String(form.get('duration') || '').trim(),
  description: String(form.get('description') || '').trim(),
  capacity: String(form.get('capacity') || '0')
})

const subscriptionSummary = (subscriptions: Subscription[]) => ({
  total: subscriptions.reduce((sum, item) => sum + item.totalLessons, 0),
  used: subscriptions.reduce((sum, item) => sum + item.usedLessons, 0),
  remaining: subscriptions.reduce((sum, item) => sum + item.remainingLessons, 0),
  expiresAt: subscriptions.find(item => item.status === 'active' && item.expiresAt)?.expiresAt || null
})

export default function App() {
  const [state, setState] = useState<AppState>(emptyState)
  const [currentFamilyId, setCurrentFamilyId] = useStored<string>('currentFamilyId', '')
  const [ownerToken, setOwnerToken] = useStored<string>('ownerToken', '')
  const [parentTab, setParentTab] = useStored<ParentTab>('parentTab', 'schedule')
  const [ownerTab, setOwnerTab] = useStored<OwnerTab>('ownerTab', 'home')
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const syncVersion = useRef(0)
  const mutating = useRef(false)
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  const isOwnerArea = normalizedPath === '/owner' || normalizedPath === '/owner/login'
  const isOwnerLogin = normalizedPath === '/owner/login'

  const applyState = (nextState: AppState) => setState({
    ...emptyState,
    ...nextState,
    families: nextState.families || [],
    lessonTemplates: nextState.lessonTemplates || [],
    lessonSessions: nextState.lessonSessions || [],
    subscriptions: nextState.subscriptions || [],
    subscriptionTransactions: nextState.subscriptionTransactions || []
  })

  const handleOwnerUnauthorized = (requestError: unknown) => {
    if (requestError instanceof ApiError && requestError.status === 401 && isOwnerArea) {
      localStorage.removeItem(ownerTokenStorageKey)
      setOwnerToken('')
      window.location.replace('/owner/login')
      return true
    }
    return false
  }

  const syncState = async (silent = false) => {
    if (isOwnerLogin && !ownerToken) {
      setLoading(false)
      return
    }
    const version = syncVersion.current
    try {
      const url = isOwnerArea
        ? '/api/owner/state'
        : `/api/state${currentFamilyId ? `?familyId=${encodeURIComponent(currentFamilyId)}` : ''}`
      const nextState = await api<AppState>(url, undefined, isOwnerArea)
      if (!mutating.current && version === syncVersion.current) applyState(nextState)
      if (!silent) setError('')
    } catch (requestError) {
      if (handleOwnerUnauthorized(requestError)) return
      if (!silent) setError(requestError instanceof Error ? requestError.message : errorMessages.server_error)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const run = async (action: () => Promise<void>) => {
    mutating.current = true
    syncVersion.current += 1
    try {
      setError('')
      await action()
    } catch (requestError) {
      if (!handleOwnerUnauthorized(requestError)) {
        setError(requestError instanceof Error ? requestError.message : errorMessages.server_error)
      }
    } finally {
      syncVersion.current += 1
      mutating.current = false
    }
  }

  useEffect(() => {
    if (isOwnerArea && !isOwnerLogin && !ownerToken) {
      window.location.replace('/owner/login')
      return
    }
    if (isOwnerLogin && ownerToken) {
      window.location.replace('/owner')
      return
    }
    syncState()
    const timer = window.setInterval(() => syncState(true), 7000)
    return () => window.clearInterval(timer)
  }, [currentFamilyId, ownerToken, normalizedPath])

  useEffect(() => {
    const handleInstall = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleInstall)
  }, [])

  const currentFamily = state.families.find(family => family.id === currentFamilyId) || null
  const currentSubscriptions = state.subscriptions.filter(subscription => subscription.childId === currentFamilyId)
  const currentSummary = subscriptionSummary(currentSubscriptions)

  const saveFamily = async (form: FormData) => {
    const phone = cleanPhone(String(form.get('phone') || ''))
    const firstName = String(form.get('firstName') || '').trim()
    const lastName = String(form.get('lastName') || '').trim()
    const childName = String(form.get('childName') || '').trim()
    if (!phone || !firstName || !lastName || !childName) return
    const result = await api<{ state: AppState; family: Family }>('/api/families', {
      method: 'POST',
      body: JSON.stringify({ phone, firstName, lastName, childName })
    })
    applyState(result.state)
    setCurrentFamilyId(result.family.id)
  }

  const loginOwner = async (password: string) => {
    const result = await api<{ token: string }>('/api/owner/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    })
    localStorage.setItem(ownerTokenStorageKey, JSON.stringify(result.token))
    setOwnerToken(result.token)
    window.location.replace('/owner')
  }

  const logoutOwner = () => {
    localStorage.removeItem(ownerTokenStorageKey)
    setOwnerToken('')
    window.location.href = '/owner/login'
  }

  const addTemplate = async (form: FormData) => {
    const template = templateFromForm(form)
    if (!template.title || template.weekdays.length === 0 || !template.time || !template.duration) return
    const nextState = await api<AppState>('/api/lesson-templates', {
      method: 'POST',
      body: JSON.stringify({ ...template, capacity: Math.max(1, Number(template.capacity) || 1) })
    }, true)
    applyState(nextState)
  }

  const updateTemplate = async (templateId: string, form: FormData) => {
    const template = templateFromForm(form)
    if (!template.title || template.weekdays.length === 0 || !template.time || !template.duration) return
    const nextState = await api<AppState>(`/api/lesson-templates/${encodeURIComponent(templateId)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...template, capacity: Math.max(1, Number(template.capacity) || 1) })
    }, true)
    applyState(nextState)
  }

  const removeTemplate = async (templateId: string) => {
    const nextState = await api<AppState>(`/api/lesson-templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE'
    }, true)
    applyState(nextState)
  }

  const toggleBooking = async (session: LessonSession) => {
    if (!currentFamily) return
    const booked = session.bookedChildIds.includes(currentFamily.id)
    const endpoint = booked ? 'cancel-booking' : 'book'
    const nextState = await api<AppState>(`/api/lesson-sessions/${encodeURIComponent(session.id)}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify({ childId: currentFamily.id })
    })
    applyState(nextState)
  }

  const setAttendance = async (sessionId: string, childId: string, status: AttendanceStatus) => {
    const nextState = await api<AppState>(`/api/owner/lesson-sessions/${encodeURIComponent(sessionId)}/attendance`, {
      method: 'POST',
      body: JSON.stringify({ childId, status })
    }, true)
    applyState(nextState)
  }

  const saveComment = async (sessionId: string, childId: string, text: string) => {
    const nextState = await api<AppState>(`/api/owner/lesson-sessions/${encodeURIComponent(sessionId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ childId, text })
    }, true)
    applyState(nextState)
  }

  const addSubscription = async (childId: string, form: FormData) => {
    const totalLessons = Math.max(1, Number(form.get('totalLessons')) || 0)
    const expiresAt = String(form.get('expiresAt') || '')
    const note = String(form.get('note') || '').trim()
    const nextState = await api<AppState>(`/api/owner/children/${encodeURIComponent(childId)}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({ totalLessons, expiresAt: expiresAt || null, note })
    }, true)
    applyState(nextState)
  }

  const installApp = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  if (isOwnerLogin && !ownerToken) {
    return <OwnerLogin onLogin={password => run(() => loginOwner(password))} error={error} />
  }

  if (isOwnerArea && !ownerToken) {
    return <LoadingScreen />
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (!isOwnerArea && !currentFamily) {
    return <Welcome onRegister={form => run(() => saveFamily(form))} installEvent={installEvent} installApp={installApp} error={error} />
  }

  const sectionTitle = isOwnerArea
    ? ownerTab === 'home' ? 'Главная' : ownerTab === 'lessons' ? 'Занятия' : ownerTab === 'families' ? 'Дети' : 'Учет'
    : parentTab === 'schedule' ? 'Расписание' : parentTab === 'bookings' ? 'Мои записи' : 'Профиль'

  return (
    <main>
      <header>
        <div className="header-title">
          <AppIcon name="mountain" />
          <strong>{sectionTitle}</strong>
        </div>
        {isOwnerArea ? (
          <button type="button" className="plain header-action" onClick={logoutOwner}>Выйти</button>
        ) : installEvent ? (
          <button type="button" className="plain" onClick={installApp}>Установить</button>
        ) : (
          <button type="button" className="plain header-action" onClick={() => setCurrentFamilyId('')}>Выйти</button>
        )}
      </header>

      {error ? <p className="error">{error}</p> : null}

      {!isOwnerArea && currentFamily ? (
        <>
          {parentTab === 'schedule' ? (
            <ParentSchedule
              sessions={state.lessonSessions}
              currentFamily={currentFamily}
              remaining={currentSummary.remaining}
              onToggleBooking={session => run(() => toggleBooking(session))}
            />
          ) : parentTab === 'bookings' ? (
            <ParentBookings
              family={currentFamily}
              sessions={state.lessonSessions}
              onCancel={session => run(() => toggleBooking(session))}
            />
          ) : (
            <ParentProfile
              family={currentFamily}
              sessions={state.lessonSessions}
              subscriptions={currentSubscriptions}
            />
          )}
          <BottomNav items={[
            { id: 'schedule', label: 'Расписание', icon: 'schedule' },
            { id: 'bookings', label: 'Мои записи', icon: 'booking' },
            { id: 'profile', label: 'Профиль', icon: 'profile' }
          ]} active={parentTab} onChange={id => setParentTab(id as ParentTab)} />
        </>
      ) : (
        <>
          {ownerTab === 'home' && (
            <OwnerHome
              sessions={state.lessonSessions}
              families={state.families}
              subscriptions={state.subscriptions}
              onAddLesson={() => setOwnerTab('lessons')}
            />
          )}
          {ownerTab === 'lessons' && (
            <OwnerLessons
              templates={state.lessonTemplates}
              sessions={state.lessonSessions}
              onAdd={form => run(() => addTemplate(form))}
              onUpdate={(templateId, form) => run(() => updateTemplate(templateId, form))}
              onRemove={templateId => run(() => removeTemplate(templateId))}
            />
          )}
          {ownerTab === 'families' && (
            <OwnerFamilies
              families={state.families}
              subscriptions={state.subscriptions}
              transactions={state.subscriptionTransactions}
              onAddSubscription={(childId, form) => run(() => addSubscription(childId, form))}
            />
          )}
          {ownerTab === 'attendance' && (
            <OwnerAttendance
              sessions={state.lessonSessions}
              families={state.families}
              subscriptions={state.subscriptions}
              onSetAttendance={(sessionId, childId, status) => run(() => setAttendance(sessionId, childId, status))}
              onSaveComment={(sessionId, childId, text) => run(() => saveComment(sessionId, childId, text))}
            />
          )}
          <BottomNav items={[
            { id: 'home', label: 'Главная', icon: 'home' },
            { id: 'lessons', label: 'Занятия', icon: 'schedule' },
            { id: 'families', label: 'Дети', icon: 'children' },
            { id: 'attendance', label: 'Учет', icon: 'attendance' }
          ]} active={ownerTab} onChange={id => setOwnerTab(id as OwnerTab)} />
        </>
      )}
    </main>
  )
}

function useStored<T>(key: string, initial: T) {
  const fullKey = `${storeKey}-${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(fullKey)
      return saved ? JSON.parse(saved) as T : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    localStorage.setItem(fullKey, JSON.stringify(value))
  }, [fullKey, value])

  return [value, setValue] as const
}

function LoadingScreen() {
  return (
    <main>
      <section className="hello welcome-hero">
        <div className="brand-lockup">
          <img className="brand-mark" src="/assets/logo-mountain-mark.svg" alt="" />
          <h1>Детки в поляне</h1>
          <p>Загрузка данных</p>
        </div>
      </section>
    </main>
  )
}

function OwnerLogin({ onLogin, error }: { onLogin: (password: string) => void; error: string }) {
  return (
    <main className="auth-screen">
      <section className="hello welcome-hero">
        <div className="brand-lockup">
          <img className="brand-mark" src="/assets/logo-mountain-mark.svg" alt="" />
          <h1>Детки в поляне</h1>
          <p>Вход для владельца</p>
        </div>
      </section>
      {error ? <p className="error">{error}</p> : null}
      <form className="auth-card" onSubmit={event => {
        event.preventDefault()
        onLogin(String(new FormData(event.currentTarget).get('password') || ''))
      }}>
        <div className="form-title">
          <AppIcon name="shield" />
          <h2>Кабинет владельца</h2>
        </div>
        <label>
          Пароль
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Войти</button>
      </form>
    </main>
  )
}

function Welcome({ onRegister, installEvent, installApp, error }: { onRegister: (form: FormData) => void; installEvent: BeforeInstallPromptEvent | null; installApp: () => void; error: string }) {
  return (
    <main className="auth-screen">
      <section className="hello welcome-hero">
        <img className="welcome-cloud" src="/assets/cloud.svg" alt="" />
        <div className="brand-lockup">
          <img className="brand-mark" src="/assets/logo-mountain-mark.svg" alt="" />
          <h1>Детки в поляне</h1>
          <p>Записывайтесь на занятия,<br />смотрите абонемент и получайте<br />комментарии воспитателя</p>
        </div>
      </section>
      {error ? <p className="error">{error}</p> : null}
      <form className="auth-card welcome-form" onSubmit={event => { event.preventDefault(); onRegister(new FormData(event.currentTarget)) }}>
        <h2>Давайте познакомимся</h2>
        <fieldset className="form-section">
          <legend>Ваш ребенок</legend>
          <label>Имя ребенка<input name="childName" placeholder="Миша" required /></label>
        </fieldset>
        <fieldset className="form-section">
          <legend>Контакт родителя</legend>
          <label>Имя<input name="firstName" autoComplete="given-name" placeholder="Анна" required /></label>
          <label>Фамилия<input name="lastName" autoComplete="family-name" placeholder="Иванова" required /></label>
          <label>Телефон<input name="phone" inputMode="tel" autoComplete="tel" placeholder="+7 999 000 00 00" required /></label>
        </fieldset>
        <button type="submit">Продолжить</button>
      </form>
      <section>
        {installEvent ? <button type="button" className="secondary" onClick={installApp}>Установить на телефон</button> : null}
      </section>
    </main>
  )
}

function AppIcon({ name, className = '' }: { name: string; className?: string }) {
  return <img className={`app-icon ${className}`} src={`/assets/icon-${name}.svg`} alt="" />
}

function ChildAvatar({ name }: { name: string }) {
  return (
    <img
      className="child-avatar"
      src="/assets/avatar-neutral-mountain.svg"
      alt={`Аватар ${name}`}
    />
  )
}

function BottomNav({ items, active, onChange }: { items: { id: string; label: string; icon: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <nav className="bottom-nav">
      {items.map(item => (
        <button key={item.id} type="button" className={active === item.id ? 'active' : ''} onClick={() => onChange(item.id)}>
          <AppIcon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function StatusBadge({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'sky' | 'neutral'; children: ReactNode }) {
  return <span className={`status-badge ${tone}`}>{children}</span>
}

function LessonCard({ session, booked, onAction, actionLabel, actionClass = '', disabled = false }: { session: LessonSession; booked?: boolean; onAction?: () => void; actionLabel?: string; actionClass?: string; disabled?: boolean }) {
  const bookedCount = session.bookedCount ?? session.bookedChildIds.length
  const ratio = Math.min(100, Math.round((bookedCount / session.capacitySnapshot) * 100))
  const spotsLeft = Math.max(0, session.capacitySnapshot - bookedCount)
  const progressTone = spotsLeft === 0 ? 'full' : spotsLeft <= 2 ? 'low' : ''
  return (
    <article className="lesson-card">
      <img className="card-corner" src="/assets/card-corner-mountains.svg" alt="" />
      <div className="lesson-card-top">
        <span className="date-pill">{formatDate(session.date)}</span>
        <strong className="lesson-time">{session.timeSnapshot}</strong>
      </div>
      <h3>{session.titleSnapshot}</h3>
      <p className="lesson-duration">{session.durationSnapshot}</p>
      {session.descriptionSnapshot ? <p>{session.descriptionSnapshot}</p> : null}
      <div className="capacity-row">
        <span>{bookedCount} / {session.capacitySnapshot} мест</span>
        {booked ? <StatusBadge tone="success">Вы записаны ✓</StatusBadge> : spotsLeft === 0 ? <StatusBadge tone="danger">Мест нет</StatusBadge> : null}
      </div>
      <div className={`capacity-track ${progressTone}`} aria-hidden="true">
        <span style={{ width: `${ratio}%` }} />
      </div>
      {onAction && actionLabel ? (
        <button type="button" className={actionClass} disabled={disabled} onClick={onAction}>{actionLabel}</button>
      ) : null}
    </article>
  )
}

function ParentSchedule({ sessions, currentFamily, remaining, onToggleBooking }: { sessions: LessonSession[]; currentFamily: Family; remaining: number; onToggleBooking: (session: LessonSession) => void }) {
  const visibleSessions = sessions
    .filter(session => session.date >= todayIso() && session.status === 'scheduled')
    .sort(sortSessions)
  return (
    <section className="screen-section">
      <div className="section-heading">
        <div><span className="eyebrow">Ближайшие даты</span><h2>Расписание занятий</h2></div>
        <StatusBadge tone={remaining > 2 ? 'success' : remaining > 0 ? 'warning' : 'danger'}>{remaining} осталось</StatusBadge>
      </div>
      {visibleSessions.length === 0 ? <p>Занятий пока нет.</p> : visibleSessions.map(session => {
        const booked = session.bookedChildIds.includes(currentFamily.id)
        const bookedCount = session.bookedCount ?? session.bookedChildIds.length
        const full = bookedCount >= session.capacitySnapshot
        const disabled = !booked && (full || remaining < 1)
        return <LessonCard
          key={session.id}
          session={session}
          booked={booked}
          disabled={disabled}
          actionClass={booked ? 'cancel-booking' : ''}
          actionLabel={booked ? 'Отменить запись' : remaining < 1 ? 'Нет занятий в абонементе' : full ? 'Нет мест' : 'Записаться'}
          onAction={() => onToggleBooking(session)}
        />
      })}
    </section>
  )
}

function ParentBookings({ family, sessions, onCancel }: { family: Family; sessions: LessonSession[]; onCancel: (session: LessonSession) => void }) {
  const upcoming = sessions
    .filter(session => session.status === 'scheduled' && session.date >= todayIso() && session.bookedChildIds.includes(family.id))
    .sort(sortSessions)
  const history = sessions
    .filter(session => session.attendance[family.id])
    .sort(sortSessionsDesc)
  return (
    <section className="screen-section">
      <div className="section-heading"><div><span className="eyebrow">Ваше расписание</span><h2>Ближайшие занятия</h2></div></div>
      {upcoming.length === 0 ? <div className="empty-state"><AppIcon name="booking" /><p>Ближайших записей нет.</p></div> : upcoming.map(session => (
        <LessonCard
          key={session.id}
          session={session}
          booked
          actionLabel="Отменить запись"
          actionClass="cancel-booking"
          onAction={() => onCancel(session)}
        />
      ))}
      <div className="section-heading compact"><div><span className="eyebrow">Прошедшие занятия</span><h2>История посещений</h2></div></div>
      {history.length === 0 ? <p>Посещений пока нет.</p> : history.map(session => {
        const record = session.attendance[family.id]
        const tone = record.status === 'present' ? 'success' : record.status === 'late' ? 'warning' : record.status === 'sick' ? 'sky' : 'danger'
        return (
          <article className="history-card" key={session.id}>
            <div><time>{formatDate(session.date)} · {session.timeSnapshot}</time><h3>{session.titleSnapshot}</h3></div>
            <StatusBadge tone={tone}>{attendanceLabels[record.status]}</StatusBadge>
          </article>
        )
      })}
    </section>
  )
}

function ParentProfile({ family, sessions, subscriptions }: { family: Family; sessions: LessonSession[]; subscriptions: Subscription[] }) {
  const summary = subscriptionSummary(subscriptions)
  const upcoming = sessions
    .filter(session => session.date >= todayIso() && session.status === 'scheduled' && session.bookedChildIds.includes(family.id))
    .sort(sortSessions)
  const comments = sessions
    .filter(session => session.comments[family.id]?.text)
    .sort(sortSessionsDesc)

  return (
    <section className="screen-section">
      <article className="child-profile-card">
        <ChildAvatar name={family.childName} />
        <div><span className="eyebrow">Ваш ребенок</span><h2>{family.childName}</h2><p>{family.firstName} {family.lastName} · {family.phone}</p></div>
      </article>

      <article className="subscription-card">
        <img className="subscription-bg" src="/assets/mountain-card-bg.svg" alt="" />
        <div className="subscription-title"><AppIcon name="subscription" /><span>Абонемент</span></div>
        <div className="subscription-balance"><span>Осталось занятий</span><strong>{summary.remaining} из {summary.total}</strong></div>
        <dl>
          <div><dt>Оплачено</dt><dd>{summary.total}</dd></div>
          <div><dt>Посещено</dt><dd>{summary.used}</dd></div>
          <div><dt>Осталось</dt><dd>{summary.remaining}</dd></div>
        </dl>
        {summary.expiresAt ? <p>Действует до {formatShortDate(summary.expiresAt)}</p> : null}
      </article>

      {upcoming.length > 0 ? <p className="status">Ближайшая запись: {formatDate(upcoming[0].date)} · {upcoming[0].timeSnapshot}</p> : null}

      <div className="section-heading compact"><div><span className="eyebrow">Обратная связь</span><h2>Комментарии воспитателя</h2></div></div>
      {comments.length === 0 ? <p>Комментариев пока нет.</p> : comments.map(session => (
        <article className="comment-card" key={session.id}>
          <time>{formatDate(session.date)} · {session.timeSnapshot}</time>
          <h3>{session.titleSnapshot}</h3>
          <p>{session.comments[family.id].text}</p>
        </article>
      ))}
    </section>
  )
}

function OwnerHome({ sessions, families, subscriptions, onAddLesson }: { sessions: LessonSession[]; families: Family[]; subscriptions: Subscription[]; onAddLesson: () => void }) {
  const todaySessions = sessions.filter(session => session.date === todayIso() && session.status !== 'cancelled')
  const todayBookings = todaySessions.reduce((sum, session) => sum + session.bookedChildIds.length, 0)
  const withoutSubscription = families.filter(family => subscriptionSummary(subscriptions.filter(item => item.childId === family.id)).remaining < 1).length
  const missingComments = todaySessions.reduce((sum, session) => (
    sum + session.bookedChildIds.filter(childId => !session.comments[childId]?.text).length
  ), 0)
  const metrics = [
    { value: todaySessions.length, label: 'занятия сегодня', icon: 'schedule', tone: 'sky' },
    { value: todayBookings, label: 'записей сегодня', icon: 'booking', tone: 'green' },
    { value: withoutSubscription, label: 'без абонемента', icon: 'subscription', tone: 'gold' },
    { value: missingComments, label: 'комментариев не заполнено', icon: 'attendance', tone: 'rose' }
  ]
  return (
    <section className="owner-home screen-section">
      <img className="pine-corner" src="/assets/pine-branch.svg" alt="" />
      <div className="owner-greeting"><span className="eyebrow">Кабинет владельца</span><h2>Здравствуйте!</h2><p>Вот что происходит сегодня</p></div>
      <div className="metric-grid">
        {metrics.map(metric => (
          <article className={`metric-card ${metric.tone}`} key={metric.label}>
            <AppIcon name={metric.icon} />
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </article>
        ))}
      </div>
      <button type="button" className="add-lesson-button" onClick={onAddLesson}><span>+</span> Добавить занятие</button>
      {todaySessions.length > 0 ? (
        <>
          <div className="section-heading compact"><div><span className="eyebrow">Сегодня</span><h2>Занятия по расписанию</h2></div></div>
          {todaySessions.map(session => <LessonCard key={session.id} session={session} />)}
        </>
      ) : <div className="empty-state"><AppIcon name="mountain" /><p>На сегодня занятий нет.</p></div>}
    </section>
  )
}

function TemplateForm({ initial, submitLabel, onSubmit }: { initial?: LessonTemplate; submitLabel: string; onSubmit: (form: FormData) => void }) {
  return (
    <form className={initial ? 'inline-form' : ''} onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      if (form.getAll('weekdays').length === 0) return
      onSubmit(form)
      if (!initial) event.currentTarget.reset()
    }}>
      <label>Название занятия<input name="title" defaultValue={initial?.title} placeholder="Сенсорная поляна" required /></label>
      <fieldset>
        <legend>Дни недели</legend>
        <div className="weekday-options">
          {weekdayOptions.map(day => (
            <label className="weekday-option" key={day.value}>
              <input type="checkbox" name="weekdays" value={day.value} aria-label={day.label} defaultChecked={initial?.weekdays.includes(day.value)} />
              {day.short}
            </label>
          ))}
        </div>
      </fieldset>
      <label>Время<input name="time" type="time" defaultValue={initial?.time} required /></label>
      <label>Длительность<input name="duration" defaultValue={initial?.duration} placeholder="60 минут" required /></label>
      <label>Мест<input name="capacity" type="number" min="1" defaultValue={initial?.capacity || 8} required /></label>
      <label>Описание<textarea name="description" defaultValue={initial?.description} placeholder="Что будет на занятии" /></label>
      <button type="submit">{submitLabel}</button>
    </form>
  )
}

function OwnerLessons({ templates, sessions, onAdd, onUpdate, onRemove }: { templates: LessonTemplate[]; sessions: LessonSession[]; onAdd: (form: FormData) => void; onUpdate: (templateId: string, form: FormData) => void; onRemove: (templateId: string) => void }) {
  const [editingId, setEditingId] = useState('')
  const [selectedDate, setSelectedDate] = useState(todayIso())
  const activeTemplates = templates.filter(template => template.active).sort(sortTemplates)
  const dateSessions = sessions.filter(session => session.date === selectedDate && session.status !== 'cancelled').sort(sortSessions)
  return (
    <section className="screen-section">
      <div className="section-heading"><div><span className="eyebrow">Создание расписания</span><h2>Регулярные занятия</h2></div><AppIcon name="schedule" /></div>
      <TemplateForm submitLabel="Добавить в расписание" onSubmit={onAdd} />
      <div className="section-heading compact"><div><span className="eyebrow">Конкретная дата</span><h2>Занятия по датам</h2></div></div>
      <label className="date-picker">Выберите дату<input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
      {dateSessions.length === 0 ? <p>На выбранную дату занятий нет.</p> : dateSessions.map(session => <LessonCard key={session.id} session={session} />)}
      <div className="section-heading compact"><div><span className="eyebrow">Повторение</span><h2>Шаблоны занятий</h2></div></div>
      {activeTemplates.length === 0 ? <p>Регулярных занятий пока нет.</p> : activeTemplates.map(template => (
        <article className="template-card" key={template.id}>
          <img className="card-corner" src="/assets/card-corner-mountains.svg" alt="" />
          <time>{formatWeekdays(template.weekdays)} · {template.time}</time>
          <h3>{template.title}</h3>
          <p>{template.duration}</p>
          {template.description ? <p>{template.description}</p> : null}
          <p>Мест: {template.capacity}</p>
          <div className="inline-actions">
            <button type="button" className="secondary" onClick={() => setEditingId(editingId === template.id ? '' : template.id)}>
              {editingId === template.id ? 'Закрыть' : 'Изменить'}
            </button>
            <button type="button" className="danger" onClick={() => onRemove(template.id)}>Удалить</button>
          </div>
          {editingId === template.id ? (
            <TemplateForm initial={template} submitLabel="Сохранить изменения" onSubmit={form => {
              onUpdate(template.id, form)
              setEditingId('')
            }} />
          ) : null}
        </article>
      ))}
    </section>
  )
}

function OwnerFamilies({ families, subscriptions, transactions, onAddSubscription }: { families: Family[]; subscriptions: Subscription[]; transactions: SubscriptionTransaction[]; onAddSubscription: (childId: string, form: FormData) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'none'>('all')
  const visibleFamilies = families.filter(family => {
    const remaining = subscriptionSummary(subscriptions.filter(item => item.childId === family.id)).remaining
    const matchesQuery = `${family.childName} ${family.firstName} ${family.lastName}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || (filter === 'active' ? remaining > 0 : remaining < 1)
    return matchesQuery && matchesFilter
  })
  return (
    <section className="screen-section">
      <div className="section-heading"><div><span className="eyebrow">База студии</span><h2>Дети и абонементы</h2></div><AppIcon name="children" /></div>
      <label className="search-field">Поиск по имени<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Начните вводить имя" /></label>
      <div className="filter-tabs">
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
        <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>С абонементом</button>
        <button type="button" className={filter === 'none' ? 'active' : ''} onClick={() => setFilter('none')}>Без абонемента</button>
      </div>
      {visibleFamilies.length === 0 ? <div className="empty-state"><AppIcon name="children" /><p>Подходящих детей нет.</p></div> : visibleFamilies.map(family => {
        const childSubscriptions = subscriptions.filter(item => item.childId === family.id)
        const summary = subscriptionSummary(childSubscriptions)
        const childTransactions = transactions
          .filter(item => item.childId === family.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 6)
        return (
          <article className="child-card" key={family.id}>
            <div className="child-card-head">
              <ChildAvatar name={family.childName} />
              <div><h3>{family.childName}</h3><p>{family.firstName} {family.lastName}</p><p>{family.phone}</p></div>
              <StatusBadge tone={summary.remaining > 2 ? 'success' : summary.remaining > 0 ? 'warning' : 'danger'}>
                {summary.remaining > 0 ? `${summary.remaining} занятий` : 'Нет абонемента'}
              </StatusBadge>
            </div>
            <dl>
              <div><dt>Оплачено</dt><dd>{summary.total}</dd></div>
              <div><dt>Использовано</dt><dd>{summary.used}</dd></div>
              <div><dt>Осталось</dt><dd>{summary.remaining}</dd></div>
            </dl>
            <form className="inline-form" onSubmit={event => {
              event.preventDefault()
              onAddSubscription(family.id, new FormData(event.currentTarget))
              event.currentTarget.reset()
            }}>
              <label>Добавить занятий<input name="totalLessons" type="number" min="1" defaultValue="8" required /></label>
              <label>Действует до<input name="expiresAt" type="date" /></label>
              <label>Примечание<input name="note" placeholder="Оплата за июль" /></label>
              <button type="submit">Добавить абонемент</button>
            </form>
            {childTransactions.length > 0 ? (
              <div className="transaction-list">
                <h3>Последние операции</h3>
                {childTransactions.map(transaction => (
                  <p key={transaction.id}>
                    {transactionLabels[transaction.type]}: {transaction.amount} · {new Date(transaction.createdAt).toLocaleDateString('ru-RU')}
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        )
      })}
    </section>
  )
}

function CommentEditor({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="comment-editor">
      <label>
        Комментарий родителю
        <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Как прошло занятие" />
      </label>
      <button type="button" className="secondary" disabled={draft.trim() === value.trim()} onClick={() => onSave(draft)}>
        Сохранить комментарий
      </button>
    </div>
  )
}

function OwnerAttendance({ sessions, families, subscriptions, onSetAttendance, onSaveComment }: { sessions: LessonSession[]; families: Family[]; subscriptions: Subscription[]; onSetAttendance: (sessionId: string, childId: string, status: AttendanceStatus) => void; onSaveComment: (sessionId: string, childId: string, text: string) => void }) {
  const availableSessions = sessions
    .filter(session => session.status !== 'cancelled')
    .sort(sortSessions)
  const [selectedDate, setSelectedDate] = useState(todayIso())
  const dateSessions = availableSessions.filter(session => session.date === selectedDate)
  const preferred = dateSessions[0]
  const [selectedId, setSelectedId] = useState(() => preferred?.id || '')
  const selectedSession = dateSessions.find(session => session.id === selectedId) || preferred

  useEffect(() => {
    if (preferred && !dateSessions.some(session => session.id === selectedId)) {
      setSelectedId(preferred.id)
    }
  }, [sessions, selectedDate, selectedId])

  return (
    <section className="screen-section attendance-screen">
      <div className="section-heading"><div><span className="eyebrow">Рабочий экран</span><h2>Отметка посещений</h2></div><AppIcon name="attendance" /></div>
      <div className="attendance-pickers">
        <label>Дата<input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
        {dateSessions.length > 0 ? (
          <label>Занятие<select value={selectedSession?.id || ''} onChange={event => setSelectedId(event.target.value)}>
            {dateSessions.map(session => <option key={session.id} value={session.id}>{session.timeSnapshot} · {session.titleSnapshot}</option>)}
          </select></label>
        ) : null}
      </div>

      {!selectedSession ? <div className="empty-state"><AppIcon name="schedule" /><p>На выбранную дату занятий нет.</p></div> : (() => {
        const bookedFamilies = families.filter(family => selectedSession.bookedChildIds.includes(family.id))
        const missingComments = bookedFamilies.filter(family => !selectedSession.comments[family.id]?.text).length
        return (
          <>
            <div className="comments-counter">Комментариев не заполнено: <strong>{missingComments}</strong></div>
            {bookedFamilies.length === 0 ? <p>На это занятие никто не записан.</p> : bookedFamilies.map(family => {
        const record = selectedSession.attendance[family.id]
        const summary = subscriptionSummary(subscriptions.filter(item => item.childId === family.id))
        return (
          <article className="attendance-child-card" key={family.id}>
            <div className="child-card-head">
              <ChildAvatar name={family.childName} />
              <div><h3>{family.childName}</h3><p>{family.firstName} {family.lastName}</p></div>
              <StatusBadge tone={summary.remaining > 2 ? 'success' : summary.remaining > 0 ? 'warning' : 'danger'}>{summary.remaining} осталось</StatusBadge>
            </div>
            <div className="attendance-segments" aria-label="Посещение">
              {attendanceOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`${record?.status === option.value ? 'active' : ''} status-${option.value}`}
                  onClick={() => onSetAttendance(selectedSession.id, family.id, option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {record?.charged ? <p className="status">Списано 1 занятие</p> : null}
            <CommentEditor
              value={selectedSession.comments[family.id]?.text || ''}
              onSave={text => onSaveComment(selectedSession.id, family.id, text)}
            />
          </article>
        )
            })}
            <div className="autosave-note"><AppIcon name="shield" /><span>Отметки посещения сохраняются автоматически</span></div>
          </>
        )
      })()}
    </section>
  )
}

function sortTemplates(a: LessonTemplate, b: LessonTemplate) {
  const firstDay = (template: LessonTemplate) => Math.min(...template.weekdays.map(day => weekdayOrder.indexOf(day)))
  return `${String(firstDay(a)).padStart(2, '0')}-${a.time}`.localeCompare(`${String(firstDay(b)).padStart(2, '0')}-${b.time}`)
}

function sortSessions(a: LessonSession, b: LessonSession) {
  return `${a.date}T${a.timeSnapshot}`.localeCompare(`${b.date}T${b.timeSnapshot}`)
}

function sortSessionsDesc(a: LessonSession, b: LessonSession) {
  return sortSessions(b, a)
}
