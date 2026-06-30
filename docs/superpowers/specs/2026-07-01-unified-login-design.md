# Unified Login Design

## Goal

Use one application entry point for parents and the educator. Determine the
role from the entered identifier instead of requiring the educator to open a
separate `/owner` page.

## Entry Flow

- The root page shows one initial field labelled `Телефон или логин`.
- A value that normalizes to a 10- or 11-digit phone number follows the parent
  flow.
- Any non-phone identifier follows the educator flow.
- The interface preserves the existing compact visual style and reveals only
  fields needed for the selected flow.

## Parent Flow

- A known phone signs into the existing household without a password.
- If the phone is unknown, the same screen expands to request the parent's
  first name and last name plus the child's name.
- Submitting the expanded form creates the family through the existing
  `/api/families` route.
- Parent login clears any saved educator token before opening the parent area.

## Educator Flow

- After a text login is entered, the screen reveals a password field.
- The client sends both `login` and `password` to the existing
  `/api/owner/login` route.
- The server compares them with `OWNER_LOGIN` and `OWNER_PASSWORD`.
- `OWNER_LOGIN` defaults to `admin` only when it is not configured, preserving
  local development and existing deployments.
- The existing local-development password fallback remains unchanged.
- A failed attempt returns the generic message `Неверный логин или пароль`.
- Successful educator login clears any saved parent selection before opening
  the educator interface.

## Application Mode

- The current mode is determined by stored authenticated state, not by the URL:
  an educator token opens the educator interface; otherwise a selected family
  opens the parent interface.
- Logging out clears the active mode and returns to the unified entry screen.
- The root path is the canonical application URL.
- Legacy `/owner` and `/owner/login` URLs redirect to `/` so saved links keep
  working without maintaining a second interface.

## Security And Compatibility

- Railway service variables contain `OWNER_LOGIN` and `OWNER_PASSWORD`; neither
  value is included in frontend code or API responses.
- Preserve the existing owner token mechanism, authenticated owner routes,
  parent family route, state shapes, and storage keys.
- Continue accepting the current password-only owner login request for
  backward API compatibility, while the new client always sends both fields.
- Do not add dependencies or change Railway build and start commands.

## Verification

- Server tests cover a valid configured login and password, an invalid login,
  an invalid password, and the legacy password-only request.
- Client behavior distinguishes phone identifiers from text logins.
- A known parent phone opens the parent area without a password.
- An unknown phone reveals registration fields.
- An educator login opens the educator area from `/`.
- Legacy owner URLs redirect to `/`.
- The full test suite and production build pass.
