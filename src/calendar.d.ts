export type CalendarLesson = {
  id: string
  title: string
  date: string
  time: string
  duration: string
  description: string
}

export function buildCalendarEvent(event: CalendarLesson): string
export function openCalendarEvent(
  event: CalendarLesson,
  browser?: unknown
): Promise<'shared' | 'downloaded' | 'cancelled'>
