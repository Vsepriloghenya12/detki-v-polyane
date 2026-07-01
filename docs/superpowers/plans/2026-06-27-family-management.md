# Family Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-managed households, parent phone linking, walk-in attendance, unlimited lesson booking, and calendar reminders.

**Architecture:** Preserve child IDs and existing route behavior by extending child records with `householdId` and storing parent contacts separately. Add focused owner endpoints and small client helpers while keeping subscriptions and attendance child-based.

**Tech Stack:** Node.js HTTP server, JSON/PostgreSQL state storage, React 18, TypeScript, Vite, Node test runner.

---

### Task 1: Household State And Parent Login

**Files:**
- Modify: `server/index.js`
- Modify: `src/App.tsx`
- Test: `server/index.test.js`

- [ ] Write an integration test that creates an owner household with two parents
  and two children, then signs in through the public family endpoint using the
  second parent's normalized phone.
- [ ] Run `node --test server/index.test.js` and confirm the missing owner
  household endpoint fails.
- [ ] Add parent normalization, legacy migration, household owner endpoints,
  household-scoped parent state, and active-child selection.
- [ ] Run the integration test and confirm both children and their subscriptions
  are returned.

### Task 2: Walk-In Attendance And Unlimited Booking

**Files:**
- Modify: `server/index.js`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `server/index.test.js`

- [ ] Add a failing test that books beyond legacy capacity and manually adds a
  child to a session.
- [ ] Remove capacity validation and add the owner session-child endpoint.
- [ ] Add the attendance child picker and remove capacity controls and labels
  from lesson UI.
- [ ] Run the integration test and verify present attendance consumes exactly
  one lesson.

### Task 3: Calendar Reminder

**Files:**
- Create: `src/calendar.ts`
- Create: `src/calendar.test.js`
- Modify: `src/App.tsx`

- [ ] Add a failing unit test for an iCalendar event containing
  `TRIGGER:-PT1H`.
- [ ] Implement calendar serialization and browser download/open behavior.
- [ ] Trigger the calendar prompt after a successful parent booking.
- [ ] Run the calendar test.

### Task 4: Verification And Delivery

**Files:**
- Modify: `package.json`

- [ ] Add the Node test command.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Inspect the final diff, commit the requested changes, and push `main`.
