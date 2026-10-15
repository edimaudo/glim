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
  const open = await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'riley@example.test' }) });
  assert.equal(open.secure_authentication, false, 'local profile selector must not claim verified sign-in');
  assert.equal((await adapter.request('/api/auth/me')).authenticated, true);
  assert.equal((await adapter.request('/api/state')).user.display_name, '', 'email local-part must not become a display name');

  const accountKey = 'glim.prototype.v1.user.riley%40example.test';
  const legacy = JSON.parse(values.get(accountKey));
  legacy.profile = { name: 'Riley', persona: 'riley', sample_selected: true };
  legacy.user.display_name = 'Riley';
  values.set(accountKey, JSON.stringify(legacy));
  const migrated = await adapter.request('/api/state');
  assert.equal(migrated.profile.name, '', 'legacy sample names must be cleared');
  assert.equal(migrated.user.display_name, '', 'legacy sample identity must be cleared');
  assert.equal(JSON.parse(values.get(accountKey)).legacy_sample_cleared, true, 'sample cleanup marker must persist');
  await assert.rejects(() => adapter.request('/api/personas/riley', { method: 'POST' }), /Example identities have been removed/);

  await adapter.request('/api/profile', { method: 'POST', body: JSON.stringify({
    name: '', persona: 'custom', monthly_income: 5200, average_monthly_expenses: 3900,
    savings_pct: 5, approval_mode: 'each', weekly_cap: 60, floor_balance: 1000,
    timezone: 'America/Toronto', notification_channel: 'in_app', quiet_start: '22:00',
    quiet_end: '08:00', notification_cap: 3,
    show_habits: false, show_squad: false, show_lessons: true, show_coach: false,
  }) });
  const savedPrefs = (await adapter.request('/api/state')).profile;
  assert.equal(savedPrefs.show_habits, false, 'supporting-card preferences persist per profile');
  assert.equal(savedPrefs.show_squad, false, 'squad visibility preference persists');
  assert.equal(savedPrefs.show_lessons, true, 'lesson visibility preference persists');
  assert.equal(savedPrefs.show_coach, false, 'coach visibility preference persists');
  await adapter.request('/api/debts', { method: 'POST', body: JSON.stringify({ name: 'Credit card', type: 'credit_card', balance: 1200, apr: 22.9, minimum: 45, due_day: 15 }) });

  const safetyAnswer = await adapter.request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What is my safety floor?' }) });
  assert.match(safetyAnswer.message, /safety floor is/i);
  const avalancheAnswer = await adapter.request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'How does the avalanche strategy work?' }) });
  assert.match(avalancheAnswer.message, /highest APR/i);
  const dailyStepAnswer = await adapter.request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'Why a daily step?' }) });
  assert.match(dailyStepAnswer.message, /suggested daily amount/i);

  const plan = await adapter.request('/api/plan', { method: 'POST', body: JSON.stringify({ strategy: 'avalanche', stash_pct: 65 }) });
  assert.ok(plan.projection.months > 0);
  const whatIf = await adapter.request('/api/what-if', { method: 'POST', body: JSON.stringify({ text: 'save $25 per week' }) });
  assert.equal(whatIf.parsed.weekly_extra, 25);
  assert.equal(whatIf.parsed.needs_clarification, false);
  assert.ok(whatIf.what_if.months > 0);
  const ambiguous = await adapter.request('/api/what-if', { method: 'POST', body: JSON.stringify({ text: 'save $25' }) });
  assert.equal(ambiguous.parsed.needs_clarification, true, 'an amount without a period must not be presented as a projection');

  const scout = await adapter.request('/api/scout', { method: 'POST' });
  assert.equal(scout.subscriptions.length, 0, 'no synthetic recurring activity may be generated in local mode');
  assert.match(scout.source, /No account activity to review yet/);

  const before = await adapter.request('/api/state');
  await assert.rejects(() => adapter.request('/api/drip/approve', { method: 'POST', body: JSON.stringify({ approve: true }) }), /Automatic contributions are not set up for this account yet/);
  const after = await adapter.request('/api/state');
  assert.equal(after.game.streak, before.game.streak, 'a failed local-only payment must not increment a streak');
  assert.equal(after.game.points, before.game.points, 'a failed local-only payment must not award points');
  assert.equal(after.stash.balance, before.stash.balance, 'browser-only mode must not imply money moved');
  assert.equal((await adapter.request('/api/ledger')).length, 0, 'failed payment approval must not add a ledger record');

  await adapter.request('/api/stash/goals', { method: 'POST', body: JSON.stringify({ name: 'Laptop', target_amount: 500, monthly_target: 50 }) });
  assert.equal((await adapter.request('/api/stash/goals')).goals.length, 1);
  await adapter.request('/api/squads', { method: 'POST', body: JSON.stringify({ name: 'My local challenge' }) });
  await adapter.request('/api/squads/goals', { method: 'POST', body: JSON.stringify({ title: 'One practice day', target_count: 1, reward_cosmetic_id: 1 }) });
  const squad = await adapter.request('/api/squads');
  assert.equal(squad.goals[0].progress_count, 0, 'a practice goal must not progress from a rejected payment');
  assert.equal(squad.goals[0].status, 'active');
  assert.equal(squad.unlocked_cosmetics.length, 0, 'rejected payment must not issue a reward');

  const lesson = await adapter.request('/api/lessons/next');
  assert.ok(lesson.lesson && lesson.prompt);
  const completedLesson = await adapter.request('/api/lessons/complete', { method: 'POST', body: JSON.stringify({ lesson_id: lesson.lesson.id, answer: 'pause the drip' }) });
  assert.equal(completedLesson.status, 'complete');
  const shop = await adapter.request('/api/cosmetics');
  assert.ok(shop.items.length >= 3);
  await assert.rejects(() => adapter.request('/api/stash/auto-deposit/run', { method: 'POST' }), /Automatic monthly contributions are not set up for this account yet/);
  await assert.rejects(() => adapter.request('/api/paypal/connect', { method: 'POST' }), /Account connections are unavailable in this session/);
  const exported = await adapter.request('/api/data/export');
  assert.equal(exported.product, 'Glim');
  assert.equal(exported.storage_mode, 'localStorage');

  // Switching the selected email must open a separate local namespace, not the first profile.
  await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'other@example.test' }) });
  const other = await adapter.request('/api/state');
  assert.equal(Number(other.profile.monthly_income || 0), 0);
  await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'riley@example.test' }) });
  const restored = await adapter.request('/api/state');
  assert.equal(restored.profile.monthly_income, 5200);
  assert.equal(restored.debts.length, 1);
  console.log('localStorage adapter tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
