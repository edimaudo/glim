const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const localValues = new Map();
const localStorage = {
  getItem: key => localValues.has(key) ? localValues.get(key) : null,
  setItem: (key, value) => localValues.set(key, String(value)),
  removeItem: key => localValues.delete(key),
};
const records = new Map();
const storeNames = new Set();
function fakeIndexedDb() {
  const db = {
    objectStoreNames: { contains: name => storeNames.has(name) },
    createObjectStore(name) { storeNames.add(name); return {}; },
    transaction(_name, _mode) {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      const schedule = action => setTimeout(() => { try { action(); tx.oncomplete?.(); } catch (error) { tx.error = error; tx.onerror?.(); } }, 0);
      const store = {
        get(key) { const request = { result: undefined, onsuccess: null, onerror: null }; schedule(() => { request.result = records.has(key) ? { key, value: structuredClone(records.get(key)) } : undefined; request.onsuccess?.(); }); return request; },
        put(record) { schedule(() => records.set(record.key, structuredClone(record.value))); },
        delete(key) { schedule(() => records.delete(key)); },
        clear() { schedule(() => records.clear()); },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
  return {
    open() {
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        request.result = db;
        if (!storeNames.has('records')) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}
const indexedDB = fakeIndexedDb();
const window = { GLIM_CONFIG: { storageMode: 'indexedDB' }, location: { origin: 'https://glim.example.test' }, indexedDB };
const context = { window, indexedDB, localStorage, crypto: nodeCrypto.webcrypto, console, URL, structuredClone, setTimeout, clearTimeout, fetch: async () => { throw new Error('Unexpected network request in IndexedDB mode'); } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('app/static/storage.js', 'utf8'), context, { filename: 'storage.js' });

(async () => {
  const adapter = window.GlimStorage.adapter;
  assert.equal(window.GlimStorage.mode, 'indexedDB');
  const open = await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'riley@example.test' }) });
  assert.equal(open.secure_authentication, false, 'local profile selection must not claim verified sign-in');
  assert.equal((await adapter.request('/api/auth/me')).authenticated, true);
  assert.equal((await adapter.request('/api/state')).user.display_name, '', 'email local-part must not become a display name');
  assert.ok(records.has('glim.prototype.v1.user.riley%40example.test'), 'user state is written to IndexedDB');
  assert.equal(localValues.size, 0, 'new app data is not written to localStorage');

  const legacy = adapter.read();
  legacy.profile = { name: 'Riley', persona: 'riley', sample_selected: true };
  legacy.user.display_name = 'Riley';
  adapter.cache = legacy;
  await adapter.save(legacy); await adapter.flush();
  const migrated = await adapter.request('/api/state');
  assert.equal(migrated.profile.name, '', 'legacy sample names must be cleared');
  assert.equal(migrated.user.display_name, '', 'legacy sample identity must be cleared');
  assert.equal(adapter.read().legacy_sample_cleared, true, 'sample cleanup marker must persist in IndexedDB');
  await assert.rejects(() => adapter.request('/api/personas/riley', { method: 'POST' }), /Example identities have been removed/);

  await adapter.request('/api/profile', { method: 'POST', body: JSON.stringify({
    name: '', persona: 'custom', country:'CA', currency:'CAD', monthly_income: 5200, average_monthly_expenses: 5100,
    savings_pct: 5, approval_mode: 'each', weekly_cap: 60, floor_balance: 1000,
    timezone: 'America/Toronto', notification_channel: 'in_app', quiet_start: '22:00',
    quiet_end: '08:00', notification_cap: 3,
    show_consistency: true, show_learning_tips: false, show_friend_support: false, show_plan_help: false,
  }) });
  await adapter.request('/api/debts', { method: 'POST', body: JSON.stringify({ name: 'Credit card', type: 'credit_card', balance: 1200, apr: 22.9, minimum: 45, due_day: 15 }) });
  await adapter.request('/api/debts', { method: 'POST', body: JSON.stringify({ name: 'Personal loan', type: 'personal_loan', balance: 5000, apr: 13.2, minimum: 100, due_day: 23 }) });

  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const month = date.slice(0,7);
  await adapter.request('/api/finance/transactions', { method: 'POST', body: JSON.stringify({ date, type: 'income', description: 'Paycheque', category: 'Income', amount: 5200 }) });
  await adapter.request('/api/finance/transactions', { method: 'POST', body: JSON.stringify({ date, type: 'expense', description: 'Groceries', category: 'Groceries', amount: 145.5 }) });
  const report = await adapter.request(`/api/finance/report?month=${month}`);
  assert.equal(report.income, 5200);
  assert.equal(report.expenses, 145.5);
  assert.equal(report.net_cash_flow, 5054.5);
  assert.equal(report.months.length, 6);
  assert.equal(report.currency, 'CAD');
  const imported = await adapter.request('/api/finance/import', { method: 'POST', body: JSON.stringify({ rows: [
    { date, type: 'expense', description: 'Groceries', category: 'Groceries', amount: 145.5 },
    { date, type: 'expense', description: 'Transit', category: 'Transport', amount: 6.5 },
    { date: 'invalid', type: 'expense', description: 'Bad row', amount: 10 },
  ] }) });
  assert.equal(imported.imported, 1);
  assert.equal(imported.skipped, 2);
  assert.ok((await adapter.request(`/api/finance/calendar?month=${month}`)).some(item => item.title === 'Credit card minimum payment'));
  const scenario = await adapter.request('/api/finance/scenarios', { method: 'POST', body: JSON.stringify({ name:'Higher payment', extra_monthly_payment:150, income_delta:0, expense_delta:0, unexpected_expense:300, lump_sum_payment:250, apr_delta:0.5, save:false }) });
  assert.ok(scenario.projection.months > 0);
  assert.equal(scenario.inputs.extra_monthly_payment, 150);
  assert.ok(scenario.savings_balance_after_unexpected_expense >= 0);
  const savedScenario = await adapter.request('/api/finance/scenarios', { method: 'POST', body: JSON.stringify({ name:'Saved plan', extra_monthly_payment:75, save:true }) });
  assert.ok(savedScenario.id);
  assert.equal((await adapter.request('/api/finance/scenarios')).length, 1);
  const reconciliation = await adapter.request('/api/finance/reconcile-debts', { method: 'POST', body: JSON.stringify({ rows:[{debt_id:1,statement_balance:1100,statement_date:date}],apply_changes:false }) });
  assert.equal(reconciliation.applied, false);
  assert.equal((await adapter.request('/api/state')).debts[0].balance, 1200, 'review-only reconciliation must not update the balance');
  await adapter.request('/api/finance/reconcile-debts', { method: 'POST', body: JSON.stringify({ rows:[{debt_id:1,statement_balance:1100,statement_date:date}],apply_changes:true }) });
  assert.equal((await adapter.request('/api/state')).debts[0].balance, 1100, 'confirmed reconciliation updates the tracked balance');
  const bankStatus = await adapter.request('/api/bank/status');
  assert.equal(bankStatus.country, 'CA');
  assert.equal(bankStatus.configured, false, 'direct bank linking must not appear configured without the provider credentials');

  const safetyAnswer = await adapter.request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'What is my safety floor?' }) });
  assert.match(safetyAnswer.message, /safety floor is/i);
  const avalancheAnswer = await adapter.request('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'How does the avalanche strategy work?' }) });
  assert.match(avalancheAnswer.message, /highest APR/i);

  const plan = await adapter.request('/api/plan', { method: 'POST', body: JSON.stringify({ strategy: 'avalanche', stash_pct: 65 }) });
  assert.ok(plan.projection.months > 0);
  await assert.rejects(() => adapter.request('/api/drip/approve', { method: 'POST', body: JSON.stringify({ approve: true }) }), /only be approved after a PayPal connection is active/);
  await assert.rejects(() => adapter.request('/api/cosmetics', { method: 'GET' }), /feature has been removed/i);

  await adapter.request('/api/stash/goals', { method: 'POST', body: JSON.stringify({ name: 'Laptop', target_amount: 500, monthly_target: 50 }) });
  assert.equal((await adapter.request('/api/stash/goals')).goals.length, 1);
  await adapter.request('/api/stash/balance', { method: 'POST', body: JSON.stringify({ balance: 500 }) });
  const contribution = await adapter.request('/api/savings/contributions', { method: 'POST', body: JSON.stringify({ amount: 500, contribution_date: date, goal_id: 1 }) });
  assert.equal(contribution.goals.find(g => g.id === 1).status, 'completed');
  assert.equal(contribution.recorded.monthly_target_met, true);
  const donation = await adapter.request('/api/savings/donations', { method: 'POST', body: JSON.stringify({ charity_name: 'Local Shelter', recipient_email: 'donations@example.test', amount: 20 }) });
  assert.equal(donation.status, 'planned', 'donation should become available only after a savings goal is completed');
  assert.equal((await adapter.request('/api/savings/progress')).savings_streak >= 0, true);

  const exported = await adapter.request('/api/data/export');
  assert.equal(exported.product, 'Glim');
  assert.equal(exported.storage_mode, 'indexedDB');
  assert.equal(exported.cash_transactions.length, 3);

  // Switching the selected email must open a separate browser-database namespace.
  await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'other@example.test' }) });
  assert.equal(Number((await adapter.request('/api/state')).profile.monthly_income || 0), 0);
  await adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: 'riley@example.test' }) });
  const restored = await adapter.request('/api/state');
  assert.equal(restored.profile.monthly_income, 5200);
  assert.equal(restored.profile.country, 'CA');
  assert.equal(restored.debts.length, 2);
  console.log('IndexedDB adapter and financial insights tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
