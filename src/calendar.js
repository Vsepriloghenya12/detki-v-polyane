const escapeCalendarText = value => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;')

const calendarDateTime = date => (
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}00`
)

const lessonTimes = ({ date, time, duration }) => {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const durationMinutes = Math.max(1, Number.parseInt(duration, 10) || 60)
  const start = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return { start: calendarDateTime(start), end: calendarDateTime(end) }
}

export const buildCalendarEvent = event => {
  const { start, end } = lessonTimes(event)
  const stamp = calendarDateTime(new Date())
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Развивашки//Занятия//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeCalendarText(event.id)}@razvivashki`,
    `DTSTAMP:${stamp}Z`,
    `DTSTART;TZID=Europe/Moscow:${start}`,
    `DTEND;TZID=Europe/Moscow:${end}`,
    `SUMMARY:${escapeCalendarText(event.title)}`,
    `DESCRIPTION:${escapeCalendarText(event.description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Через час занятие: ${escapeCalendarText(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
}

export const openCalendarEvent = async (event, browser = globalThis) => {
  const content = buildCalendarEvent(event)
  const fileName = `zanyatie-${event.date}-${event.time.replace(':', '-')}.ics`
  let file = null
  if (typeof browser.File === 'function') {
    try {
      file = new browser.File([content], fileName, { type: 'text/calendar;charset=utf-8' })
    } catch {
      file = null
    }
  }
  const shareData = file ? { files: [file], title: event.title } : null
  let canShareFile = false

  try {
    canShareFile = Boolean(shareData) &&
      typeof browser.navigator?.share === 'function' &&
      typeof browser.navigator?.canShare === 'function' &&
      browser.navigator.canShare(shareData)
  } catch {
    canShareFile = false
  }

  if (canShareFile) {
    try {
      await browser.navigator.share(shareData)
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
      if (error?.name !== 'NotAllowedError') throw error
    }
  }

  const link = browser.document.createElement('a')
  link.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`
  link.download = fileName
  browser.document.body.appendChild(link)
  link.click()
  link.remove()
  return 'downloaded'
}
