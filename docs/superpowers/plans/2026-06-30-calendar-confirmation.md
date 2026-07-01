# Calendar Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a confirmation after booking and hand a one-hour reminder event to the phone's calendar flow from an explicit user action.

**Architecture:** Keep iCalendar serialization in `src/calendar.js`, but separate it from delivery. Delivery first uses mobile file sharing when available and falls back to downloading the `.ics` file; `App` owns the confirmation-dialog state and invokes delivery only from the dialog button.

**Tech Stack:** React 18, TypeScript, browser File and Web Share APIs, iCalendar, Node test runner, Vite.

---

### Task 1: Testable Calendar Handoff

**Files:**
- Modify: `src/calendar.test.js`
- Modify: `src/calendar.js`
- Modify: `src/calendar.d.ts`

- [ ] **Step 1: Add failing handoff tests**

Add tests with injected browser dependencies. The first test supplies
`navigator.share` and `navigator.canShare` and asserts that one `.ics` file is
shared. The second omits sharing support and asserts that an anchor with an
`.ics` download name is clicked.

```js
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
```

Define `lesson` once from the existing event fixture and a minimal `FakeFile`
that stores `content`, `name`, and `type`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test src/calendar.test.js`

Expected: FAIL because `openCalendarEvent` does not accept injected browser
dependencies, does not return a promise result, and does not use file sharing.

- [ ] **Step 3: Implement the handoff**

Change `openCalendarEvent(event, browser = globalThis)` to:

1. Build a `File` named `zanyatie-<date>-<time>.ics`.
2. If `browser.navigator.canShare({ files: [file] })` and
   `browser.navigator.share` are available, await sharing and return `shared`.
3. Return `cancelled` for `AbortError`.
4. Otherwise create an object URL, click a download anchor, revoke the URL, and
   return `downloaded`.
5. Re-throw unexpected sharing errors.

Update `calendar.d.ts` so `openCalendarEvent` returns
`Promise<'shared' | 'downloaded' | 'cancelled'>`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test src/calendar.test.js`

Expected: all serializer and handoff tests pass.

### Task 2: Booking Confirmation Dialog

**Files:**
- Modify: `src/App.tsx:2-120`
- Modify: `src/App.tsx:271-454`
- Modify: `src/App.tsx:567-704`
- Modify: `src/styles.css`

- [ ] **Step 1: Replace automatic download with pending state**

Import `CalendarLesson` as a type. Add:

```ts
const [pendingCalendarEvent, setPendingCalendarEvent] = useState<CalendarLesson | null>(null)
const [calendarNotice, setCalendarNotice] = useState('')
```

After a successful new booking, call `setPendingCalendarEvent(...)` instead of
`openCalendarEvent(...)`. Cancellation leaves this state unchanged.

- [ ] **Step 2: Add confirmation actions**

Add an async action:

```ts
const confirmCalendarReminder = async () => {
  if (!pendingCalendarEvent) return
  try {
    const result = await openCalendarEvent(pendingCalendarEvent)
    if (result === 'downloaded') {
      setCalendarNotice('Файл календаря скачан. Откройте его и подтвердите добавление события.')
    }
    setPendingCalendarEvent(null)
  } catch {
    setError('Не удалось открыть календарь. Попробуйте ещё раз.')
  }
}
```

`Не сейчас` clears only `pendingCalendarEvent`.

- [ ] **Step 3: Render the accessible dialog**

Create a small `CalendarConfirmation` component with `role="dialog"`,
`aria-modal="true"`, a labelled heading, lesson date and time,
`Напоминание за 1 час`, an autofocus `Добавить в календарь` button, and a
secondary `Не сейчас` button.

Render it only for the parent area when `pendingCalendarEvent` is not null.
Render `calendarNotice` near the existing error area and allow it to be
dismissed.

- [ ] **Step 4: Add scoped modal styles**

Add fixed backdrop, compact dialog, and two-button action styles using existing
colors, radii, shadows, and mobile width limits. Do not alter existing cards or
navigation.

- [ ] **Step 5: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete successfully.

### Task 3: Full Verification

**Files:**
- Verify: `src/calendar.js`
- Verify: `src/calendar.test.js`
- Verify: `src/App.tsx`
- Verify: `src/styles.css`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: server integration and all calendar tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: build succeeds without TypeScript errors.

- [ ] **Step 3: Inspect scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; existing uncommitted family, capacity, and
subscription changes remain intact.
