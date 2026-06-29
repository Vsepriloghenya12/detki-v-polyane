# Lesson Capacity Design

## Goal

Restore a maximum child count for each lesson while preserving the educator's
ability to add a child manually when an exception is needed.

## Behavior

- The educator enters a positive maximum child count when creating or editing a
  recurring lesson.
- Generated lesson sessions retain the template capacity in
  `capacitySnapshot`, preserving the existing data model.
- Lesson cards show the current booking count and maximum, for example
  `Записано: 5 из 8`.
- When a scheduled lesson reaches its maximum, a parent who is not already
  booked sees `Мест нет` and cannot submit a booking.
- The server rejects parent bookings at capacity with a dedicated
  `lesson_full` error so stale clients cannot exceed the limit.
- A parent who is already booked can still cancel a booking.
- The educator's existing `Добавить из базы` action deliberately bypasses the
  capacity check and can add a child beyond the maximum.

## Compatibility

- Keep existing routes, API response shapes, `capacity`, and
  `capacitySnapshot` fields.
- Existing templates and sessions retain their stored capacity values.
- No new dependencies, routes, or storage migrations are required.

## Verification

- An integration test confirms the second parent booking is rejected when a
  capacity-one lesson is full.
- The same test confirms the educator can manually add the second child beyond
  the limit.
- The frontend build and full test suite pass.
