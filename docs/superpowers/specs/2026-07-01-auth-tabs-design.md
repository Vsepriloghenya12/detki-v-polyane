# Authentication Tabs Design

## Goal

Present separate `Вход` and `Регистрация` tabs on the shared application entry
screen while keeping parent and educator access in one app.

## Tabs

- The authentication card opens on `Вход`.
- Two compact tabs, `Вход` and `Регистрация`, switch the visible form without
  navigation or page reload.
- Switching tabs clears stale errors but preserves a phone number already
  entered by the user.
- The existing hero and internal parent and educator interfaces remain
  unchanged.

## Login Tab

- The first field is `Телефон или логин`.
- Phone identifiers attempt parent login without a password.
- Text identifiers reveal the educator password field and authenticate against
  `OWNER_LOGIN` and `OWNER_PASSWORD`.
- An unknown phone remains on the login tab and shows
  `Пользователь не найден`.
- The unknown-phone message includes `Перейти к регистрации`, which selects the
  registration tab and keeps the entered phone.
- A failed educator login shows `Неверный логин или пароль`.

## Registration Tab

- The form contains phone, parent first name, parent last name, and child name.
- Registration creates a new household through the existing family route.
- If the phone already belongs to a household, registration is rejected without
  changing data and offers `Перейти ко входу`.
- The login tab can then use that same preserved phone.

## Phone Normalization

- Accept Russian phone values beginning with `+7`, `7`, or `8`.
- Accept ten digits without a country prefix.
- Ignore spaces, parentheses, and hyphens.
- Normalize every accepted form to the same eleven-digit value beginning with
  `7`.
- Use `inputMode="tel"` and browser telephone autocomplete for phone fields.
- Reject values that do not normalize to exactly eleven digits.

## API Behavior

- Keep `POST /api/families` and its successful response shape.
- A phone-only request for an unknown family returns `family_not_found`.
- A registration request marks its intent with `register: true`.
- Registration with an existing phone returns `family_already_exists`.
- Existing full-data requests without `register` remain backward compatible.

## Verification

- Unit tests confirm that `+7`, `7`, `8`, and ten-digit inputs normalize to the
  same value.
- Server tests confirm unknown login and duplicate registration errors without
  data mutation.
- Browser verification covers tab switching, preserved phone values, parent
  registration fields, and educator password reveal.
- The full test suite and production build pass.
