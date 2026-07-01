# Unified Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace URL-selected owner access with one root login that routes phone identifiers to parents and text identifiers to the educator.

**Architecture:** Extend the existing owner login route with an environment-backed login while preserving password-only compatibility. Add a tiny pure identifier classifier, then let `App` choose parent or educator mode from stored authentication state instead of `window.location.pathname`.

**Tech Stack:** Node.js HTTP server, React 18, TypeScript, browser localStorage, Node test runner, Vite.

---

### Task 1: Environment-Backed Educator Login

**Files:**
- Modify: `server/index.test.js:45-110`
- Modify: `server/index.js:15-20`
- Modify: `server/index.js:747-760`

- [ ] **Step 1: Add failing owner credential tests**

Start the test server with:

```js
OWNER_LOGIN: 'teacher',
OWNER_PASSWORD: 'test-owner'
```

Before the existing valid login, assert that a wrong login and a wrong password
both return `401`. Then submit both valid fields and retain the current
password-only request as a compatibility assertion:

```js
const wrongLogin = await request(baseUrl, '/api/owner/login', {
  method: 'POST',
  body: JSON.stringify({ login: 'wrong', password: 'test-owner' })
})
assert.equal(wrongLogin.status, 401)

const wrongPassword = await request(baseUrl, '/api/owner/login', {
  method: 'POST',
  body: JSON.stringify({ login: 'teacher', password: 'wrong' })
})
assert.equal(wrongPassword.status, 401)

const login = await request(baseUrl, '/api/owner/login', {
  method: 'POST',
  body: JSON.stringify({ login: 'teacher', password: 'test-owner' })
})
assert.equal(login.status, 200)

const legacyLogin = await request(baseUrl, '/api/owner/login', {
  method: 'POST',
  body: JSON.stringify({ password: 'test-owner' })
})
assert.equal(legacyLogin.status, 200)
```

- [ ] **Step 2: Run the server test and verify RED**

Run: `node --test server/index.test.js`

Expected: FAIL because the current route ignores the invalid login.

- [ ] **Step 3: Implement login validation**

Add:

```js
const ownerLogin = process.env.OWNER_LOGIN || 'admin'
```

In `/api/owner/login`, compare the submitted login when present and compare the
password with the existing timing-safe helper. A missing login uses
`ownerLogin` only for backward request compatibility:

```js
const submittedLogin = String(body.login || ownerLogin)
if (!safePasswordEqual(submittedLogin, ownerLogin) ||
    !safePasswordEqual(body.password, ownerPassword)) {
  return unauthorized(res)
}
```

- [ ] **Step 4: Run the server test and verify GREEN**

Run: `node --test server/index.test.js`

Expected: PASS for valid, invalid, and legacy login requests.

### Task 2: Identifier Classification

**Files:**
- Create: `src/login.js`
- Create: `src/login.d.ts`
- Create: `src/login.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the failing classifier test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { loginKind } from './login.js'

test('login kind separates parent phones from educator logins', () => {
  assert.equal(loginKind('+7 999 111-22-33'), 'parent')
  assert.equal(loginKind('9991112233'), 'parent')
  assert.equal(loginKind('teacher'), 'owner')
  assert.equal(loginKind(''), 'invalid')
})
```

Add `src/login.test.js` to the existing `npm test` command.

- [ ] **Step 2: Run the classifier test and verify RED**

Run: `node --test src/login.test.js`

Expected: FAIL because `src/login.js` does not exist.

- [ ] **Step 3: Implement the classifier**

Export `loginKind(value)`. Trim the value, return `invalid` when empty, count
digits, and return `parent` for 10 or 11 digits; return `owner` otherwise.
Declare the return union in `src/login.d.ts`.

- [ ] **Step 4: Run the classifier test and verify GREEN**

Run: `node --test src/login.test.js`

Expected: all classifier cases pass.

### Task 3: Unified Root Entry

**Files:**
- Modify: `src/App.tsx:1-140`
- Modify: `src/App.tsx:275-410`
- Modify: `src/App.tsx:560-805`
- Modify: `src/styles.css:240-380`

- [ ] **Step 1: Make authentication state determine the mode**

Import `loginKind`. Replace `isOwnerArea` and `isOwnerLogin` with:

```ts
const isOwnerMode = Boolean(ownerToken)
const isLegacyOwnerPath = normalizedPath === '/owner' || normalizedPath === '/owner/login'
```

Redirect legacy owner paths to `/` in the effect. Fetch owner state when
`isOwnerMode`; fetch parent state when `currentFamilyId`; skip state loading
when neither credential exists. On owner `401`, clear the token and stay on
`/`.

- [ ] **Step 2: Add unified entry actions**

Add `entryMode` (`identify`, `owner`, or `parent-register`) and
`entryIdentifier` state.

`startLogin` classifies the identifier. A text login reveals the password
stage. A phone posts `{ phone }` to `/api/families`; success opens the family,
while a `400` reveals parent registration fields. Other errors still use the
existing error handling.

Update `loginOwner(login, password)` to send both values, clear
`currentFamilyId`, and remain on `/`. Update parent login/registration to clear
the owner token. Both logout paths clear active state and return to the
identifier stage.

- [ ] **Step 3: Replace separate auth components**

Replace `OwnerLogin` and `Welcome` with `UnifiedEntry`:

- `identify`: one required `Телефон или логин` input and `Продолжить`.
- `owner`: the same editable login, a required password, `Войти`, and `Назад`.
- `parent-register`: editable phone, parent name, parent surname, child name,
  `Продолжить`, and `Назад`.
- Keep the current hero, install button, semantic labels, autocomplete values,
  and existing error placement.

- [ ] **Step 4: Render role interfaces from state**

Render the parent interface only for `currentFamily`. Render the educator
interface when `isOwnerMode`. Use `isOwnerMode` for the header, navigation,
state requests, and calendar-dialog visibility. Remove all owner-page-specific
render branches and navigations.

- [ ] **Step 5: Add minimal entry styles**

Reuse `auth-card`, `welcome-form`, and existing form styles. Add only a compact
secondary `entry-back` action if needed; do not redesign the hero or internal
role interfaces.

- [ ] **Step 6: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete successfully.

### Task 4: End-To-End Verification

**Files:**
- Verify: `server/index.js`
- Verify: `server/index.test.js`
- Verify: `src/login.js`
- Verify: `src/login.test.js`
- Verify: `src/App.tsx`

- [ ] **Step 1: Run all automated checks**

Run: `npm test`

Expected: server, calendar, and login tests all pass.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Verify browser flows**

On `/`, verify a phone opens or expands parent registration and a text login
reveals the educator password. Verify valid educator credentials open the
educator navigation. Verify `/owner` redirects to `/`.

- [ ] **Step 4: Inspect the final scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only unified-login implementation, tests,
and plan changes.
