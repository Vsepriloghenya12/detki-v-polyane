import { useEffect, useRef, useState } from 'react'

type ParentTab = 'schedule' | 'profile'
type OwnerTab = 'lessons' | 'families' | 'attendance'
type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type Family = {
  id: string
  phone: string
  firstName: string
  lastName: string
  childName: string
  paidLessons: number
  createdAt: string
}

type Lesson = {
  id: string
  title: string
  weekdays: Weekday[]
  time: string
  duration: string
  description: string
  capacity: number
  bookedIds: string[]
  attendedIds: string[]
  comments: Record<string, string>
}

type AppState = {
  families: Family[]
  lessons: Lesson[]
}

type NewLesson = {
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

const storeKey = 'detki-v-polyane'

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

const cleanPhone = (value: string) => value.replace(/[\s()-]/g, '')

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
  server_error: 'Ошибка сервера. Попробуйте еще раз.'
}

const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    }
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code = data?.error || 'server_error'
    throw new Error(errorMessages[code] || errorMessages.server_error)
  }
  return data as T
}

export default function App() {
  const [families, setFamilies] = useState<Family[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [currentFamilyId, setCurrentFamilyId] = useStored<string>('currentFamilyId', '')
  const [parentTab, setParentTab] = useStored<ParentTab>('parentTab', 'schedule')
  const [ownerTab, setOwnerTab] = useStored<OwnerTab>('ownerTab', 'lessons')
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const syncVersion = useRef(0)
  const mutating = useRef(false)
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  const isOwnerPath = normalizedPath === '/owner'

  const applyState = (state: AppState) => {
    setFamilies(state.families)
    setLessons(state.lessons)
  }

  const syncState = async (silent = false) => {
    const version = syncVersion.current
    try {
      const state = await api<AppState>('/api/state')
      if (!mutating.current && version === syncVersion.current) applyState(state)
      if (!silent) setError('')
    } catch (requestError) {
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
      setError(requestError instanceof Error ? requestError.message : errorMessages.server_error)
    } finally {
      syncVersion.current += 1
      mutating.current = false
    }
  }

  useEffect(() => {
    syncState()
    const timer = window.setInterval(() => syncState(true), 7000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleInstall = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleInstall)
  }, [])

  const currentFamily = families.find(family => family.id === currentFamilyId) || null

  const logout = () => {
    setCurrentFamilyId('')
  }

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

  const addLesson = async (form: FormData) => {
    const lesson: NewLesson = {
      title: String(form.get('title') || '').trim(),
      weekdays: form.getAll('weekdays').map(String).filter(day => weekdayOrder.includes(day as Weekday)) as Weekday[],
      time: String(form.get('time') || ''),
      duration: String(form.get('duration') || '').trim(),
      description: String(form.get('description') || '').trim(),
      capacity: String(form.get('capacity') || '0')
    }
    if (!lesson.title || lesson.weekdays.length === 0 || !lesson.time || !lesson.duration) return
    const state = await api<AppState>('/api/lessons', {
      method: 'POST',
      body: JSON.stringify({ ...lesson, capacity: Math.max(1, Number(lesson.capacity) || 1) })
    })
    applyState(state)
  }

  const removeLesson = async (lessonId: string) => {
    const state = await api<AppState>(`/api/lessons/${encodeURIComponent(lessonId)}`, { method: 'DELETE' })
    applyState(state)
  }

  const setPaidLessons = async (familyId: string, value: number) => {
    const state = await api<AppState>(`/api/families/${encodeURIComponent(familyId)}/paid`, {
      method: 'PATCH',
      body: JSON.stringify({ paidLessons: Math.max(0, value) })
    })
    applyState(state)
  }

  const countAttended = (familyId: string) => lessons.reduce((sum, lesson) => sum + (lesson.attendedIds.includes(familyId) ? 1 : 0), 0)
  const remainingLessons = (familyId: string) => Math.max(0, (families.find(family => family.id === familyId)?.paidLessons || 0) - countAttended(familyId))

  const toggleBooking = async (lessonId: string) => {
    if (!currentFamily) return
    const state = await api<AppState>(`/api/lessons/${encodeURIComponent(lessonId)}/bookings`, {
      method: 'POST',
      body: JSON.stringify({ familyId: currentFamily.id })
    })
    applyState(state)
  }

  const toggleAttendance = async (lessonId: string, familyId: string) => {
    const state = await api<AppState>(`/api/lessons/${encodeURIComponent(lessonId)}/attendance`, {
      method: 'POST',
      body: JSON.stringify({ familyId })
    })
    applyState(state)
  }

  const setComment = async (lessonId: string, familyId: string, value: string) => {
    const state = await api<AppState>(`/api/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(familyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ comment: value })
    })
    applyState(state)
  }

  const installApp = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  if (loading) {
    return (
      <main>
        <section className="hello">
          <div className="brand-lockup">
            <h1>Детки в поляне</h1>
            <p>Загрузка данных</p>
          </div>
        </section>
      </main>
    )
  }

  if (!isOwnerPath && !currentFamily) {
    return <Welcome onRegister={form => run(() => saveFamily(form))} installEvent={installEvent} installApp={installApp} error={error} />
  }

  return (
    <main>
      <header>
        <button type="button" className="plain" onClick={isOwnerPath ? () => { window.location.href = '/' } : logout}>{isOwnerPath ? 'Родителям' : 'Выйти'}</button>
        <h1>Детки в поляне</h1>
        {installEvent ? <button type="button" className="plain" onClick={installApp}>Установить</button> : <span />}
      </header>

      {error ? <p className="error">{error}</p> : null}

      {!isOwnerPath && currentFamily ? (
        <>
          {parentTab === 'schedule' ? (
            <ParentSchedule lessons={lessons} currentFamily={currentFamily} remaining={remainingLessons(currentFamily.id)} onToggleBooking={lessonId => run(() => toggleBooking(lessonId))} />
          ) : (
            <ParentProfile family={currentFamily} lessons={lessons} attended={countAttended(currentFamily.id)} remaining={remainingLessons(currentFamily.id)} />
          )}
          <nav>
            <button type="button" className={parentTab === 'schedule' ? 'active' : ''} onClick={() => setParentTab('schedule')}>Расписание</button>
            <button type="button" className={parentTab === 'profile' ? 'active' : ''} onClick={() => setParentTab('profile')}>Профиль</button>
          </nav>
        </>
      ) : (
        <>
          {ownerTab === 'lessons' && <OwnerLessons lessons={lessons} onAdd={form => run(() => addLesson(form))} onRemove={lessonId => run(() => removeLesson(lessonId))} />}
          {ownerTab === 'families' && <OwnerFamilies families={families} lessons={lessons} onSetPaid={(familyId, value) => run(() => setPaidLessons(familyId, value))} />}
          {ownerTab === 'attendance' && <OwnerAttendance lessons={lessons} families={families} onToggleAttendance={(lessonId, familyId) => run(() => toggleAttendance(lessonId, familyId))} onComment={(lessonId, familyId, value) => run(() => setComment(lessonId, familyId, value))} />}
          <nav>
            <button type="button" className={ownerTab === 'lessons' ? 'active' : ''} onClick={() => setOwnerTab('lessons')}>Занятия</button>
            <button type="button" className={ownerTab === 'families' ? 'active' : ''} onClick={() => setOwnerTab('families')}>Дети</button>
            <button type="button" className={ownerTab === 'attendance' ? 'active' : ''} onClick={() => setOwnerTab('attendance')}>Учет</button>
          </nav>
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

function Welcome({ onRegister, installEvent, installApp, error }: { onRegister: (form: FormData) => void; installEvent: BeforeInstallPromptEvent | null; installApp: () => void; error: string }) {
  return (
    <main>
      <section className="hello">
        <div className="brand-lockup">
          <h1>Детки в поляне</h1>
          <p>Расписание занятий, запись, посещаемость, комментарии воспитателя и абонементы.</p>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <form onSubmit={event => { event.preventDefault(); onRegister(new FormData(event.currentTarget)) }}>
        <h2>Вход родителя</h2>
        <label>
          Телефон
          <input name="phone" inputMode="tel" autoComplete="tel" placeholder="+7 999 000 00 00" required />
        </label>
        <label>
          Имя
          <input name="firstName" autoComplete="given-name" placeholder="Анна" required />
        </label>
        <label>
          Фамилия
          <input name="lastName" autoComplete="family-name" placeholder="Иванова" required />
        </label>
        <label>
          Имя ребенка
          <input name="childName" placeholder="Миша" required />
        </label>
        <button type="submit">Войти</button>
      </form>

      <section>
        {installEvent ? <button type="button" className="secondary" onClick={installApp}>Установить на телефон</button> : null}
      </section>
    </main>
  )
}

function ParentSchedule({ lessons, currentFamily, remaining, onToggleBooking }: { lessons: Lesson[]; currentFamily: Family; remaining: number; onToggleBooking: (lessonId: string) => void }) {
  const visibleLessons = lessons.slice().sort(sortLessons)
  return (
    <section>
      <h2>Расписание</h2>
      <p className="status">Осталось занятий: {remaining}</p>
      {visibleLessons.length === 0 ? <p>Занятий пока нет.</p> : visibleLessons.map(lesson => {
        const booked = lesson.bookedIds.includes(currentFamily.id)
        const full = lesson.bookedIds.length >= lesson.capacity
        const disabled = !booked && (full || remaining < 1)
        return (
          <article key={lesson.id}>
            <time>{formatWeekdays(lesson.weekdays)} · {lesson.time}</time>
            <h3>{lesson.title}</h3>
            <p>{lesson.duration}</p>
            {lesson.description ? <p>{lesson.description}</p> : null}
            <p>{lesson.bookedIds.length} из {lesson.capacity} мест</p>
            <button type="button" disabled={disabled} onClick={() => onToggleBooking(lesson.id)}>
              {booked ? 'Отменить запись' : remaining < 1 ? 'Нет занятий в абонементе' : full ? 'Нет мест' : 'Записаться'}
            </button>
          </article>
        )
      })}
    </section>
  )
}

function ParentProfile({ family, lessons, attended, remaining }: { family: Family; lessons: Lesson[]; attended: number; remaining: number }) {
  const comments = lessons
    .filter(lesson => lesson.comments[family.id]?.trim())
    .sort(sortLessonsDesc)
  return (
    <section>
      <h2>{family.childName}</h2>
      <p>{family.firstName} {family.lastName}</p>
      <p>{family.phone}</p>
      <dl>
        <div>
          <dt>Оплачено</dt>
          <dd>{family.paidLessons}</dd>
        </div>
        <div>
          <dt>Посещено</dt>
          <dd>{attended}</dd>
        </div>
        <div>
          <dt>Осталось</dt>
          <dd>{remaining}</dd>
        </div>
      </dl>
      <h2>Комментарии после занятий</h2>
      {comments.length === 0 ? <p>Комментариев пока нет.</p> : comments.map(lesson => (
        <article key={lesson.id}>
          <time>{formatWeekdays(lesson.weekdays)} · {lesson.time}</time>
          <h3>{lesson.title}</h3>
          <p>{lesson.comments[family.id]}</p>
        </article>
      ))}
    </section>
  )
}

function OwnerLessons({ lessons, onAdd, onRemove }: { lessons: Lesson[]; onAdd: (form: FormData) => void; onRemove: (lessonId: string) => void }) {
  return (
    <section>
      <h2>Расписание занятий</h2>
      <form onSubmit={event => { event.preventDefault(); onAdd(new FormData(event.currentTarget)); event.currentTarget.reset() }}>
        <label>
          Название занятия
          <input name="title" placeholder="Сенсорная поляна" required />
        </label>
        <fieldset>
          <legend>Дни недели</legend>
          <div className="weekday-options">
            {weekdayOptions.map(day => (
              <label className="weekday-option" key={day.value}>
                <input type="checkbox" name="weekdays" value={day.value} aria-label={day.label} />
                {day.short}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Время
          <input name="time" type="time" required />
        </label>
        <label>
          Длительность
          <input name="duration" placeholder="60 минут" required />
        </label>
        <label>
          Мест
          <input name="capacity" type="number" min="1" defaultValue="8" required />
        </label>
        <label>
          Описание
          <textarea name="description" placeholder="Что будет на занятии" />
        </label>
        <button type="submit">Добавить занятие</button>
      </form>

      {lessons.slice().sort(sortLessons).map(lesson => (
        <article key={lesson.id}>
          <time>{formatWeekdays(lesson.weekdays)} · {lesson.time}</time>
          <h3>{lesson.title}</h3>
          <p>{lesson.duration}</p>
          {lesson.description ? <p>{lesson.description}</p> : null}
          <p>{lesson.bookedIds.length} из {lesson.capacity} мест</p>
          <button type="button" className="danger" onClick={() => onRemove(lesson.id)}>Удалить</button>
        </article>
      ))}
    </section>
  )
}

function OwnerFamilies({ families, lessons, onSetPaid }: { families: Family[]; lessons: Lesson[]; onSetPaid: (familyId: string, value: number) => void }) {
  const attended = (familyId: string) => lessons.reduce((sum, lesson) => sum + (lesson.attendedIds.includes(familyId) ? 1 : 0), 0)
  return (
    <section>
      <h2>Пользователи</h2>
      {families.length === 0 ? <p>Родители пока не зарегистрировались.</p> : families.map(family => {
        const visits = attended(family.id)
        const left = Math.max(0, family.paidLessons - visits)
        return (
          <article key={family.id}>
            <h3>{family.childName}</h3>
            <p>{family.firstName} {family.lastName}</p>
            <p>{family.phone}</p>
            <p>Посещено: {visits}</p>
            <p>Осталось: {left}</p>
            <label>
              Оплачено занятий
              <input type="number" min="0" value={family.paidLessons} onChange={event => onSetPaid(family.id, Number(event.target.value))} />
            </label>
          </article>
        )
      })}
    </section>
  )
}

function OwnerAttendance({ lessons, families, onToggleAttendance, onComment }: { lessons: Lesson[]; families: Family[]; onToggleAttendance: (lessonId: string, familyId: string) => void; onComment: (lessonId: string, familyId: string, value: string) => void }) {
  const [selectedId, setSelectedId] = useState(() => lessons[0]?.id || '')
  const selectedLesson = lessons.find(lesson => lesson.id === selectedId) || lessons[0]

  useEffect(() => {
    if (!selectedId && lessons[0]) setSelectedId(lessons[0].id)
    if (selectedId && !lessons.find(lesson => lesson.id === selectedId)) setSelectedId(lessons[0]?.id || '')
  }, [lessons, selectedId])

  if (lessons.length === 0) {
    return <section><h2>Учет посещений</h2><p>Сначала добавьте занятие.</p></section>
  }

  return (
    <section>
      <h2>Учет посещений</h2>
      <label>
        Занятие
        <select value={selectedLesson.id} onChange={event => setSelectedId(event.target.value)}>
          {lessons.slice().sort(sortLessons).map(lesson => <option key={lesson.id} value={lesson.id}>{formatWeekdays(lesson.weekdays)} · {lesson.time} · {lesson.title}</option>)}
        </select>
      </label>

      {families.length === 0 ? <p>Пользователей пока нет.</p> : families.map(family => {
        const booked = selectedLesson.bookedIds.includes(family.id)
        const attended = selectedLesson.attendedIds.includes(family.id)
        return (
          <article key={family.id}>
            <h3>{family.childName}</h3>
            <p>{family.firstName} {family.lastName}{booked ? ' · записан' : ''}</p>
            <label className="row">
              <input type="checkbox" checked={attended} onChange={() => onToggleAttendance(selectedLesson.id, family.id)} />
              Был на занятии
            </label>
            <label>
              Комментарий родителю
              <textarea value={selectedLesson.comments[family.id] || ''} onChange={event => onComment(selectedLesson.id, family.id, event.target.value)} placeholder="Как прошло занятие" />
            </label>
          </article>
        )
      })}
    </section>
  )
}

function sortLessons(a: Lesson, b: Lesson) {
  const firstDay = (lesson: Lesson) => Math.min(...lesson.weekdays.map(day => weekdayOrder.indexOf(day)))
  return `${String(firstDay(a)).padStart(2, '0')}-${a.time}`.localeCompare(`${String(firstDay(b)).padStart(2, '0')}-${b.time}`)
}

function sortLessonsDesc(a: Lesson, b: Lesson) {
  return sortLessons(b, a)
}
