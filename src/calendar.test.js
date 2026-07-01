import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCalendarEvent, openCalendarEvent } from './calendar.js'

const lesson = {
  id: 'session-1',
  title: 'Музыкальное занятие',
  date: '2026-06-30',
  time: '11:00',
  duration: '45 минут',
  description: 'Ритм и движение'
}

class FakeFile {
  constructor(parts, name, options = {}) {
    this.content = parts.join('')
    this.name = name
    this.type = options.type
  }
}

test('calendar event contains lesson details and a one-hour reminder', () => {
  const calendar = buildCalendarEvent(lesson)

  assert.match(calendar, /SUMMARY:Музыкальное занятие/)
  assert.match(calendar, /DTSTART;TZID=Europe\/Moscow:20260630T110000/)
  assert.match(calendar, /DTEND;TZID=Europe\/Moscow:20260630T114500/)
  assert.match(calendar, /TRIGGER:-PT1H/)
  assert.match(calendar, /DESCRIPTION:Ритм и движение/)
})

test('calendar handoff shares an ics file when file sharing is supported', async () => {
  const shared = []
  const result = await openCalendarEvent(lesson, {
    File: FakeFile,
    navigator: {
      canShare: value => value.files?.[0]?.name.endsWith('.ics'),
      share: value => { shared.push(value) }
    }
  })

  assert.equal(result, 'shared')
  assert.equal(shared.length, 1)
  assert.match(shared[0].files[0].content, /TRIGGER:-PT1H/)
})

test('calendar handoff treats a dismissed share sheet as cancellation', async () => {
  const result = await openCalendarEvent(lesson, {
    File: FakeFile,
    navigator: {
      canShare: () => true,
      share: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
    }
  })

  assert.equal(result, 'cancelled')
})

test('calendar handoff downloads when system sharing is blocked', async () => {
  let clicked = false
  const link = { click: () => { clicked = true }, remove: () => {} }
  const result = await openCalendarEvent(lesson, {
    File: FakeFile,
    navigator: {
      canShare: () => true,
      share: () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
    },
    document: {
      createElement: () => link,
      body: { appendChild: () => {} }
    }
  })

  assert.equal(result, 'downloaded')
  assert.equal(clicked, true)
})

test('calendar handoff downloads an ics file when sharing is unavailable', async () => {
  let clicked = false
  const link = { click: () => { clicked = true }, remove: () => {} }
  const result = await openCalendarEvent(lesson, {
    File: FakeFile,
    navigator: {},
    URL: { createObjectURL: () => 'blob:event', revokeObjectURL: () => {} },
    document: {
      createElement: () => link,
      body: { appendChild: () => {} }
    },
    setTimeout: callback => callback()
  })

  assert.equal(result, 'downloaded')
  assert.equal(clicked, true)
  assert.match(link.download, /\.ics$/)
})

test('calendar handoff downloads a data ics when file APIs are unavailable', async () => {
  const link = { click: () => {}, remove: () => {} }
  const result = await openCalendarEvent(lesson, {
    File: () => {},
    navigator: {},
    document: {
      createElement: () => link,
      body: { appendChild: () => {} }
    }
  })

  assert.equal(result, 'downloaded')
  assert.match(link.href, /^data:text\/calendar/)
  assert.match(decodeURIComponent(link.href), /TRIGGER:-PT1H/)
})
