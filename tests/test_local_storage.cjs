const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const values = new Map();
const localStorage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
const window = { GLIM_CONFIG: { storageMode: 'localStorage' }, location: { origin: 'https://glim.example.test' } };
const context = { window, localStorage, crypto: nodeCrypto.webcrypto, console, URL, fetch: async () => { throw new Error('Unexpected network request in localStorage mode'); } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('app/static/storage.js', 'utf8'), context, { filename: 'storage.js' });

(async () => {
  const adapter = window.GlimStorage.adapter;
  assert.equal(window.GlimStorage.mode, 'localStorage');
  await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'riley@example.test' }) });
  assert.equal((await adapter.request('/api/auth/me')).authenticated, true);
  const seeded = await adapter.request('/api/personas/riley', { method: 'POST' });
  assert.equal(seeded.profile.name, 'Riley');
  assert.equal(seeded.daily_drip, 8.67);
  const plan = await adapter.request('/api/plan', { method: 'POST', body: JSON.stringify({ strategy: 'avalanche', stash_pct: 65 }) });
  assert.ok(plan.projection.months > 0);
  const before = await adapter.request('/api/state');
  const drip = await adapter.request('/api/drip/approve', { method: 'POST', body: JSON.stringify({ approve: true }) });
  assert.equal(drip.money_moved, false);
  assert.equal(drip.storage_mode, 'localStorage');
  const after = await adapter.request('/api/state');
  assert.equal(after.game.streak, before.game.streak + 1);
  assert.ok(after.stash.balance > before.stash.balance);
  assert.equal((await adapter.request('/api/ledger')).length, 1);
  await adapter.request('/api/stash/goals', { method: 'POST', body: JSON.stringify({ name: 'Laptop', target_amount: 500, monthly_target: 50 }) });
  assert.equal((await adapter.request('/api/stash/goals')).goals.length, 1);
  await adapter.request('/api/squads', { method: 'POST', body: JSON.stringify({ name: 'Glim Grove' }) });
  await adapter.request('/api/squads/goals', { method: 'POST', body: JSON.stringify({ title: 'One local drip-day', target_count: 1, reward_cosmetic_id: 1 }) });
  await adapter.request('/api/drip/approve', { method: 'POST', body: JSON.stringify({ approve: true }) });
  const squad = await adapter.request('/api/squads');
  assert.equal(squad.goals[0].status, 'completed');
  assert.equal(squad.unlocked_cosmetics[0].cosmetic_id, 1);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const recap = await adapter.request('/api/monthly-recap?month=' + currentMonth);
  assert.equal(recap.drip_count, 2);
  assert.ok(recap.total_moved > 0);
  const lesson = await adapter.request('/api/lessons/next');
  assert.ok(lesson.lesson && lesson.prompt);
  const completedLesson = await adapter.request('/api/lessons/complete', { method: 'POST', body: JSON.stringify({ lesson_id: lesson.lesson.id, answer: 'pause the drip' }) });
  assert.equal(completedLesson.status, 'complete');
  const shop = await adapter.request('/api/cosmetics');
  assert.ok(shop.items.length >= 3);
  await adapter.request('/api/stash/auto-deposit', { method: 'PUT', body: JSON.stringify({ enabled: true, amount: 25, due_day: 1, consent: true }) });
  assert.equal((await adapter.request('/api/stash/auto-deposit')).status, 'local_settings_only');
  await assert.rejects(() => adapter.request('/api/stash/auto-deposit/run', { method: 'POST' }), /No money moved/);
  await assert.rejects(() => adapter.request('/api/paypal/connect', { method: 'POST' }), /No token was created/);
  const beforeCappedAttempt = (await adapter.request('/api/ledger')).length;
  const state = await adapter.request('/api/state');
  await adapter.request('/api/profile', { method: 'POST', body: JSON.stringify({ ...state.profile, approval_mode: 'weekly_cap', weekly_cap: 1 }) });
  await assert.rejects(() => adapter.request('/api/drip/approve', { method: 'POST', body: JSON.stringify({ approve: true }) }), /Weekly cap/);
  assert.equal((await adapter.request('/api/ledger')).length, beforeCappedAttempt, 'failed cap check must not add a ledger record');
  const exported = await adapter.request('/api/data/export');
  assert.equal(exported.product, 'Glim');
  const sameBrowserAdapter = new (window.GlimStorage.adapter.constructor)();
  assert.equal((await sameBrowserAdapter.request('/api/state')).game.streak, (await adapter.request('/api/state')).game.streak);
  console.log('localStorage adapter tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
