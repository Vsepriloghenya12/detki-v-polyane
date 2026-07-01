# Lesson Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore educator-defined lesson capacity for parent bookings while allowing educator overrides.

**Architecture:** Reuse the existing `capacity` and `capacitySnapshot` fields. Enforce the snapshot only in the public booking route; keep the authenticated educator child-addition route unchanged so it remains an explicit override.

**Tech Stack:** Node.js HTTP server, Node test runner, React 18, TypeScript, Vite.

---

### Task 1: Enforce Capacity For Parent Bookings

**Files:**
- Modify: `server/index.test.js:169-198`
- Modify: `server/index.js:940-962`

- [ ] **Step 1: Change the integration test to require capacity enforcement**

After the first successful booking, assert that the second parent booking fails
and that the educator can add that same child manually:

```js
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
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node --test server/index.test.js`

Expected: FAIL because the second public booking currently returns `200`.

- [ ] **Step 3: Add the minimal server guard**

In the public `/book` handler, after the existing duplicate-booking return and
before subscription validation, add:

```js
if (session.bookedChildIds.length >= session.capacitySnapshot) {
  return badRequest(res, 'lesson_full')
}
```

Do not add this check to `/api/owner/lesson-sessions/:id/children`.

- [ ] **Step 4: Run the integration test and verify GREEN**

Run: `node --test server/index.test.js`

Expected: PASS, including the educator override assertion.

### Task 2: Restore Capacity Controls And Parent Feedback

**Files:**
- Modify: `src/App.tsx:103-109`
- Modify: `src/App.tsx:218-262`
- Modify: `src/App.tsx:802-853`
- Modify: `src/App.tsx:980-1025`

- [ ] **Step 1: Restore capacity in submitted template data**

Add `capacity: number` to `NewTemplate`, map the form value, and add the
localized server error:

```ts
type NewTemplate = {
  title: string
  weekdays: Weekday[]
  time: string
  duration: string
  description: string
  capacity: number
}

const errorMessages: Record<string, string> = {
  lesson_full: 'На занятии больше нет свободных мест.',
  // existing entries remain unchanged
}

const templateFromForm = (form: FormData): NewTemplate => ({
  title: String(form.get('title') || '').trim(),
  weekdays: form.getAll('weekdays').map(String).filter(day => weekdayOrder.includes(day as Weekday)) as Weekday[],
  time: String(form.get('time') || ''),
  duration: String(form.get('duration') || '').trim(),
  description: String(form.get('description') || '').trim(),
  capacity: Math.max(1, Number(form.get('capacity')) || 1)
})
```

- [ ] **Step 2: Restore the educator input**

Add this field to `TemplateForm` after duration:

```tsx
<label>
  Максимальное количество детей
  <input name="capacity" type="number" min="1" defaultValue={initial?.capacity ?? 10} required />
</label>
```

- [ ] **Step 3: Restore capacity display and disable full parent bookings**

Render `Записано: {bookedCount} из {session.capacitySnapshot}` in
`LessonCard`. In `ParentSchedule`, compute:

```ts
const full = !booked && (session.bookedCount ?? session.bookedChildIds.length) >= session.capacitySnapshot
const disabled = !booked && (remaining < 1 || full)
```

Pass `actionLabel={booked ? 'Отменить запись' : full ? 'Мест нет' : 'Записаться'}`.
Cancellation remains enabled because `full` is false for an already-booked
child.

- [ ] **Step 4: Run type and production build verification**

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

### Task 3: Full Verification

**Files:**
- Verify only; no additional code is expected.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all server integration and calendar tests pass.

- [ ] **Step 2: Inspect the scoped diff**

Run:

```powershell
git diff --check
git diff -- server/index.js server/index.test.js src/App.tsx
```

Expected: no whitespace errors; only capacity behavior and the pre-existing
uncommitted family-management changes appear.
