# Subscription Adjustments Design

## Goal

Allow the application owner to add or remove lessons from a child's current
subscription balance without changing attendance history.

## Owner Flow

- Each child card continues to show paid, used, and remaining lesson totals.
- The existing subscription area gains two compact actions:
  `Добавить занятия` and `Убрать занятия`.
- The owner enters a positive lesson count and may add a short note.
- Adding increases the current balance by creating an owner adjustment.
- Removing decreases the current balance, but the server rejects an amount
  greater than the child's available remaining lessons.
- The refreshed totals appear immediately after a successful adjustment.

## Data And API

- Add one authenticated child adjustment endpoint accepting `direction`,
  `amount`, and optional `note`.
- Preserve all existing subscription and attendance records.
- Apply additions to the newest active subscription. If no active subscription
  exists, create a new active subscription containing the added lessons.
- Apply removals across active subscriptions with remaining lessons, newest
  first, until the requested amount is removed.
- Keep each subscription internally consistent by changing `totalLessons`
  alongside the remaining balance while leaving `usedLessons` unchanged.
- Record every change as a `manual_adjustment` transaction with its direction
  in the reason text.
- Reject zero, negative, invalid, or excessive adjustments without saving
  partial changes.

## Compatibility

- Existing subscription creation, attendance charging, refunds, routes, and
  response shapes remain unchanged.
- No storage migration or new dependency is required.

## Verification

- An integration test adds lessons and confirms the remaining total increases.
- The test removes lessons and confirms the remaining total decreases while
  `usedLessons` stays unchanged.
- The test confirms an excessive removal is rejected and leaves state intact.
- The full test suite and production build pass together with lesson-capacity
  changes.
