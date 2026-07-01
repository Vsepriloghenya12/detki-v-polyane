# Subscription Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner add or remove lessons from a child's remaining subscription balance while preserving attendance history.

**Architecture:** Add one authenticated adjustment route beside the existing child subscription routes. Adjust `totalLessons` while leaving `usedLessons` intact, refresh derived balances and statuses, and record each owner action as a manual adjustment transaction.

**Tech Stack:** Node.js HTTP server, Node test runner, React 18, TypeScript, Vite.

---

### Task 1: Subscription Adjustment API

**Files:**
- Modify: `server/index.test.js:127-153`
- Modify: `server/index.js:450-478`
- Modify: `server/index.js:1031-1075`

- [ ] **Step 1: Add failing integration assertions**

After `secondChildId` is known, add two lessons, remove three lessons, then
attempt to remove more than the remaining balance:

```js
const addAdjustment = await request(baseUrl, `/api/owner/children/${secondChildId}/subscription-adjustments`, {
  method: 'POST',
  headers: ownerHeaders,
  body: JSON.stringify({ direction: 'add', amount: 2, note: 'Доплата' })
})
assert.equal(addAdjustment.status, 200)
assert.equal(
  addAdjustment.body.subscriptions
    .filter(item => item.childId === secondChildId)
    .reduce((sum, item) => sum + item.remainingLessons, 0),
  6
)

const removeAdjustment = await request(baseUrl, `/api/owner/children/${secondChildId}/subscription-adjustments`, {
  method: 'POST',
  headers: ownerHeaders,
  body: JSON.stringify({ direction: 'remove', amount: 3, note: 'Перерасчёт' })
})
assert.equal(removeAdjustment.status, 200)
assert.equal(
  removeAdjustment.body.subscriptions
    .filter(item => item.childId === secondChildId)
    .reduce((sum, item) => sum + item.remainingLessons, 0),
  3
)
assert.equal(
  removeAdjustment.body.subscriptions
    .filter(item => item.childId === secondChildId)
    .reduce((sum, item) => sum + item.usedLessons, 0),
  0
)

const excessiveAdjustment = await request(baseUrl, `/api/owner/children/${secondChildId}/subscription-adjustments`, {
  method: 'POST',
  headers: ownerHeaders,
  body: JSON.stringify({ direction: 'remove', amount: 4 })
})
assert.equal(excessiveAdjustment.status, 400)
assert.equal(excessiveAdjustment.body.error, 'adjustment_exceeds_balance')

const stateAfterRejectedAdjustment = await request(baseUrl, '/api/owner/state', {
  headers: ownerHeaders
})
assert.equal(
  stateAfterRejectedAdjustment.body.subscriptions
    .filter(item => item.childId === secondChildId)
    .reduce((sum, item) => sum + item.remainingLessons, 0),
  3
)
```

- [ ] **Step 2: Run the server test and verify RED**

Run: `node --test server/index.test.js`

Expected: FAIL because the adjustment endpoint returns `404`.

- [ ] **Step 3: Add the balance adjustment helper**

Add `adjustSubscriptionBalance(state, childId, direction, amount, note)` beside
`addSubscription`. It must validate the direction and positive integer amount
before mutation. For additions, update the newest active subscription or create
and append a normalized subscription directly. Do not call `addSubscription`
for this fallback because it would create a second transaction. For removals,
first compare the amount with the sum of `remainingLessons`, then reduce
`totalLessons` across newest subscriptions without reducing any `usedLessons`.

After a successful mutation, call `refreshSubscriptionStatuses(state)` and push
one normalized transaction:

```js
state.subscriptionTransactions.push(normalizeTransaction({
  id: uid(),
  subscriptionId: changedSubscription.id,
  childId,
  type: 'manual_adjustment',
  amount: lessons,
  reason: `${direction === 'add' ? 'Добавлено' : 'Убрано'} вручную${note ? `: ${note}` : ''}`,
  createdAt: timestamp,
  createdBy: 'owner'
}))
```

Return `{ error: 'bad_request' }` for invalid input and
`{ error: 'adjustment_exceeds_balance' }` before any removal mutation when the
requested amount exceeds the remaining total.

- [ ] **Step 4: Add the authenticated route**

Match:

```js
const adjustmentMatch = pathname.match(/^\/api\/owner\/children\/([^/]+)\/subscription-adjustments$/)
```

On `POST`, require owner auth, confirm the child exists, call
`adjustSubscriptionBalance`, map helper errors through `badRequest`, save state,
and return the complete owner state.

- [ ] **Step 5: Run the server test and verify GREEN**

Run: `node --test server/index.test.js`

Expected: PASS for add, remove, excessive-removal atomicity, lesson capacity,
and educator capacity override behavior.

### Task 2: Owner Adjustment Controls

**Files:**
- Modify: `src/App.tsx:218-225`
- Modify: `src/App.tsx:468-481`
- Modify: `src/App.tsx:625-646`
- Modify: `src/App.tsx:1040-1212`

- [ ] **Step 1: Add the client mutation**

Add:

```ts
const adjustSubscription = async (childId: string, direction: 'add' | 'remove', form: FormData) => {
  const amount = Math.max(1, Number(form.get('amount')) || 0)
  const note = String(form.get('note') || '').trim()
  const nextState = await api<AppState>(`/api/owner/children/${encodeURIComponent(childId)}/subscription-adjustments`, {
    method: 'POST',
    body: JSON.stringify({ direction, amount, note })
  }, true)
  applyState(nextState)
}
```

Add the message:

```ts
adjustment_exceeds_balance: 'Нельзя убрать больше занятий, чем осталось.',
```

- [ ] **Step 2: Pass the action into the family screen**

Add `onAdjustSubscription` to `OwnerFamilies` props with this type:

```ts
onAdjustSubscription: (childId: string, direction: 'add' | 'remove', form: FormData) => void
```

Pass it from `App` using `run(() => adjustSubscription(...))`.

- [ ] **Step 3: Add compact add/remove forms**

Beside `Выдать абонемент`, add two secondary buttons opening one form at a time:
`+ Занятия` and `− Занятия`. Each form contains a required integer
`amount` input with `min="1"`, an optional `note`, and a submit button whose
text matches the direction. On submit, call `onAdjustSubscription`, reset the
form, and close it.

Do not change the existing household layout, subscription creation form, or
transaction list structure.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete successfully.

### Task 3: Combined Verification

**Files:**
- Verify: `server/index.js`
- Verify: `server/index.test.js`
- Verify: `src/App.tsx`
- Verify: `src/styles.css`

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all server integration and calendar tests pass.

- [ ] **Step 2: Check the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no unrelated generated files.
