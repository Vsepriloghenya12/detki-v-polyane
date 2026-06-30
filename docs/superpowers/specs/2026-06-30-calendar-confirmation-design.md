# Calendar Confirmation Design

## Goal

After a parent books a lesson, offer a clear confirmation step that opens a
ready-made calendar event with a reminder one hour before the lesson on both
iPhone and Android.

## Parent Flow

- A successful new booking opens an in-app confirmation dialog.
- The dialog shows the lesson name, date, time, and the text
  `Напоминание за 1 час`.
- `Добавить в календарь` passes an `.ics` event to the phone from a direct user
  action, allowing the operating system to show its own save/import
  confirmation.
- `Не сейчас` closes the dialog without changing the booking.
- Cancelling a booking never opens the calendar dialog.
- Calendar import failure does not undo a successful lesson booking.

## Calendar Handoff

- Keep the existing iCalendar event format and `VALARM` with
  `TRIGGER:-PT1H`.
- Build a calendar `File` in the browser.
- When the mobile browser supports sharing files, open the system share/import
  sheet with that file.
- Otherwise, open or download the `.ics` file from the confirmation button and
  show a short instruction to open it and confirm adding the event.
- Never claim that the event was saved automatically; the final save is always
  controlled by the phone's calendar application.

## Interface

- Add one compact modal using the existing visual styles and button patterns.
- Keep focus on the dialog while it is open and provide a labelled close
  action.
- Show a fallback instruction only when direct file sharing is unavailable.
- Do not add calendar controls to unrelated screens.

## Error Handling

- Keep the booking successful if calendar sharing is dismissed or fails.
- Treat a user-cancelled system share sheet as a normal cancellation.
- Show the existing application error area only for an unexpected calendar
  handoff failure.

## Verification

- Unit tests confirm the generated event still contains lesson details and
  `TRIGGER:-PT1H`.
- A client testable helper selects file sharing when supported and file opening
  otherwise.
- The production build and full test suite pass.
- Manual mobile verification checks that the confirmation dialog appears only
  after a successful new booking.
