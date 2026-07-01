# Family Management Design

## Goal

Allow the owner to build the client base before parents join, support multiple
parents and children in one household, add walk-in children to a lesson, and
offer a one-hour calendar reminder after booking.

## Data Model

- Keep `families` as child records so existing subscription, booking,
  attendance, and comment references remain valid.
- Add `householdId` to each child record.
- Add `parents` with `id`, `householdId`, `firstName`, `lastName`, `phone`, and
  `createdAt`.
- Migrate every legacy family into a household containing one child and one
  parent. Preserve legacy parent fields on child records for compatibility.
- Keep subscriptions linked to child IDs.

## Owner Flows

- The owner can create a household with one parent, one child, and an optional
  initial subscription balance.
- Each household card provides `+ Родитель` and `+ Ребёнок` actions.
- A newly added child can receive an initial subscription balance.
- The attendance screen provides `+ Добавить ребёнка`, searching the complete
  child list and adding the selected child to the session.

## Parent Flow

- Registration searches normalized phone numbers in `parents`.
- A known phone opens all children in its household with their existing
  subscriptions, bookings, attendance, and comments.
- An unknown phone creates a new household from the submitted parent and child
  details.
- Parents can switch the active child without registering again.

## Lessons And Calendar

- Lesson capacity is no longer entered, displayed, or enforced. Existing
  capacity fields remain readable for backward-compatible state migration.
- After a successful booking, the client opens an iCalendar event containing
  the lesson title, date, time, duration, and a one-hour alarm. The phone asks
  the parent to confirm adding it to the system calendar.
- Manual attendance additions become normal session bookings and appear in the
  parent's booking/history views.
- Only `present` and `late` attendance statuses consume one subscription lesson.

## API Compatibility

- Keep existing routes and response shapes where possible.
- Extend parent state to include all children and parents from the matched
  household.
- Add owner-only routes for household creation, adding parents, adding
  children, and adding a child to a session.
- Reject a parent phone already assigned to another household.

## Verification

- Legacy state migrates without losing child IDs or subscriptions.
- A household created by the owner is found by either parent's phone.
- Both children in one household are returned and selectable.
- Booking does not consume a lesson; present attendance consumes exactly one.
- A walk-in child can be added and marked present without capacity checks.
- The generated calendar event includes a one-hour alarm.
- Production build and integration tests pass.
