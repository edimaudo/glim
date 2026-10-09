/* Glim storage adapters.
 * Prototype mode keeps user/application data in this browser only.
 * DatabaseApiAdapter preserves the same request contract for a future API/database migration.
 */
(() => {
  'use strict';
  const STORAGE_KEY = 'glim.prototype.v1';
  const COSMETICS = [
    { id: 1, name: 'Leaf trail', description: 'A calm trail effect for your forest path.', cost: 80, icon: '🍃' },
    { id: 2, name: 'Acorn crown', description: 'A tiny crown for a consistent week.', cost: 120, icon: '🌰' },
    { id: 3, name: 'Moonlit grove', description: 'A night look for the forest.', cost: 180, icon: '🌙' },
  ];
  const LESSONS = [
    { id: 1, title: 'Keep the safety floor', description: 'A safe plan leaves your chosen floor untouched.', prompt: 'What should Glim do if a drip would breach your safety floor?', points: 15, accepted: ['pause', 'skip', 'not move', 'not breach', 'keep the floor'] },
    { id: 2, title: 'Consistency beats amount', description: 'Points reward the habit, not the dollars moved.', prompt: 'What earns points in Glim: the amount moved or the consistency of the habit?', points: 15, accepted: ['consistency', 'habit', 'consistent'] },
    { id: 3, title: 'Know your strategy', description: 'Avalanche prioritizes the highest APR debt.', prompt: 'Which payoff strategy targets the highest APR first?', points: 20, accepted: ['avalanche'] },
  ];
  const now = () => new Date().toISOString();
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const money = n => Number(n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const newState = () => ({
    schemaVersion: 1,
    mode: 'localStorage',
    authenticated: false,
    user: null,
    profile: {},
    paypal: { status: 'disconnected', mode: 'sandbox', country: 'CA', currency: 'CAD', scopes: [] },
    stash: { balance: 0, shield_threshold: 1000, goals: [] },
    game: { streak: 0, freezes: 1, points: 0, level: 1, evolution_stage: 'Revolver' },
    plan: {}, paused: false, pending_redirect: null,
    debts: [], seeded_transactions: [], ledger: [], audit: [], points_events: [],
    notifications: { quiet_start: '22:00', quiet_end: '08:00', daily_cap: 3, channel: 'in_app', consecutive_ignores: 0 },
    inbox: [], nudge_history: [],
    monthly_deposit: { enabled: false, amount: 0, due_day: 1, consent: false, status: 'local_settings_only' },
    squad: null, squad_members: [], cheers: [], squad_goals: [], squad_goal_events: [], unlocked_group_cosmetics: [],
    owned_cosmetics: [], completed_lessons: [], last_drip_date: null,
  });

  class BrowserLocalStorageAdapter {
    constructor(key = STORAGE_KEY) { this.key = key; this.name = 'localStorage'; }
    read() {
      try {
        const raw = localStorage.getItem(this.key);
        if (!raw) return newState();
        const value = JSON.parse(raw);
        if (value.schemaVersion !== 1) return { ...newState(), ...value, schemaVersion: 1 };
        return { ...newState(), ...value };
      } catch (error) {
        console.warn('Glim local storage could not be read; starting an empty prototype state.', error);
        return newState();
      }
    }
    save(s) {
      try { localStorage.setItem(this.key, JSON.stringify(s)); }
      catch (error) { throw new Error('Glim could not save to this browser. Check available site storage or export your data before continuing.'); }
    }
    clear() { try { localStorage.removeItem(this.key); } catch {} }
    addAudit(s, agent, inputRef, rationale, approval, result) {
      s.audit.unshift({ id: id(), created_at: now(), agent, input_ref: inputRef, proposal: {}, rationale, approval, result });
      s.audit = s.audit.slice(0, 100);
    }
    state(s) {
      return {
        profile: s.profile, paypal: s.paypal, stash: s.stash, game: s.game, plan: s.plan,
        paused: s.paused, pending_redirect: s.pending_redirect, user: s.user,
        debts: s.debts, daily_drip: this.dailyDrip(s.profile), paypal_configured: false,
        weekly_approved: this.weeklyTotal(s), standing_rule_today: this.canAutoApprove(s),
        stress_mode: this.stressMode(s), storage_mode: 'localStorage',
      };
    }
    dailyDrip(profile) {
      if (!profile || !profile.monthly_income) return 0;
      const free = Math.max(0, Number(profile.monthly_income) - Number(profile.average_monthly_expenses ?? profile.monthly_income * 0.75) - Number(profile.floor_balance || 0));
      const target = Number(profile.monthly_income) * (Number(profile.savings_pct || 0) / 100) / 30;
      return round2(Math.max(0, Math.min(target, free / 30)));
    }
    weeklyTotal(s) {
      const cutoff = Date.now() - 6 * 86400000;
      return round2(s.ledger.filter(x => x.kind === 'drip' && new Date(x.created_at).getTime() >= cutoff).reduce((a, x) => a + Number(x.amount || 0), 0));
    }
    canAutoApprove(s) {
      const p = s.profile || {};
      return p.approval_mode === 'standing_rule' && this.dailyDrip(p) > 0 && this.weeklyTotal(s) + this.dailyDrip(p) <= Number(p.weekly_cap || 0);
    }
    stressMode(s) { return Boolean(s.paused || Number(s.notifications?.consecutive_ignores || 0) >= 3); }
    getDebts(s) { return [...s.debts].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.id - b.id); }
    activeDebts(s, strategy = 'avalanche') { return this.orderDebts(this.getDebts(s).filter(d => d.status === 'active'), strategy); }
    orderDebts(debts, strategy) {
      return [...debts].sort((a, b) => strategy === 'snowball' ? a.balance - b.balance || b.apr - a.apr : strategy === 'hybrid' ? (-(a.apr * .6) + a.balance * .0004) - (-(b.apr * .6) + b.balance * .0004) : b.apr - a.apr || a.balance - b.balance);
    }
    payoff(debt, monthlyExtra) {
      let balance = Number(debt.balance), interestTotal = 0, months = 0;
      const minimum = Number(debt.minimum), apr = Number(debt.apr) / 100 / 12, payment = minimum + Math.max(0, monthlyExtra);
      while (balance > 0.01 && months < 360) {
        months++; const interest = balance * apr; interestTotal += interest;
        const paid = Math.min(balance + interest, payment); balance = Math.max(0, balance + interest - paid);
        if (paid <= interest && balance > 0.01) return { months: 360, interest_paid: round2(interestTotal), interest_saved: 0, monthly_payment: round2(payment) };
      }
      let minimumBalance = Number(debt.balance), minimumInterest = 0, minimumMonths = 0;
      while (minimumBalance > 0.01 && minimumMonths < 360) {
        minimumMonths++; const interest = minimumBalance * apr; minimumInterest += interest;
        const paid = Math.min(minimumBalance + interest, minimum); minimumBalance = Math.max(0, minimumBalance + interest - paid);
        if (paid <= interest && minimumBalance > 0.01) break;
      }
      return { months, interest_paid: round2(interestTotal), interest_saved: round2(Math.max(0, minimumInterest - interestTotal)), monthly_payment: round2(payment) };
    }
    projection(debts, monthlyExtra, strategy) {
      const items = this.orderDebts(debts, strategy).map(d => ({ ...d, balance: Number(d.balance) }));
      let interest = 0, months = 0, freed = 0;
      while (items.some(d => d.balance > 0.01) && months < 360) {
        months++;
        let extra = Math.max(0, monthlyExtra) + freed; freed = 0;
        for (const d of items) {
          if (d.balance <= 0.01) continue;
          const i = d.balance * Number(d.apr) / 100 / 12; interest += i;
          const payment = Math.min(d.balance + i, Number(d.minimum) + extra);
          d.balance = Math.max(0, d.balance + i - payment); extra = Math.max(0, extra - Math.max(0, payment - Number(d.minimum)));
          if (d.balance <= 0.01) freed += Number(d.minimum);
        }
      }
      return { months, interest_paid: round2(interest) };
    }
    buildPlan(s, strategy = 'avalanche', stashPct = 65) {
      const debts = s.debts.filter(d => d.status === 'active');
      if (!debts.length) throw new Error('Add a debt before building the plan.');
      const daily = this.dailyDrip(s.profile), extra = daily * 30 * (1 - stashPct / 100);
      const proj = this.projection(debts, extra, strategy);
      const minimumInterest = debts.reduce((sum, d) => sum + this.payoff(d, 0).interest_paid, 0);
      const reasons = { avalanche: 'Highest APR first to reduce interest fastest.', snowball: 'Smallest balance first for faster visible wins.', hybrid: 'Balances interest reduction with milestone wins.' };
      s.plan = { strategy, stash_pct: Number(stashPct), boss_pct: 100 - Number(stashPct), daily_drip: daily, reason: reasons[strategy] || reasons.avalanche, projection: { months: proj.months, interest_paid: proj.interest_paid, interest_saved: round2(Math.max(0, minimumInterest - proj.interest_paid)) }, safe_to_move_daily: this.safeToMove(s.profile), attack_order: this.orderDebts(debts, strategy).map(d => d.name) };
      this.addAudit(s, 'Tactician', 'build_plan', 'Payoff math calculated locally from the profile and debt entries.', 'Deterministic code calculation', s.plan);
      return s.plan;
    }
    safeToMove(p) {
      if (!p || !p.monthly_income) return 0;
      return round2(Math.max(0, Number(p.monthly_income) - Number(p.average_monthly_expenses ?? p.monthly_income * .75) - Number(p.floor_balance || 0)) / 30);
    }
    seedPersona(s, key) {
      const personas = {
        riley: { key: 'riley', name: 'Riley', income: 5200, range: '$4,500–$6,000', expenses: 3900, pct: 5, floor: 1000, balance: 4200, apr: 19.99, min: 110, debt: 'Everyday Card', streak: 6, points: 180, level: 3, stash: 260, tx: [
          { date: '2026-04-02', merchant: 'ACME PAYROLL', amount: 2600, category: 'income' }, { date: '2026-04-03', merchant: 'Rent Co.', amount: -1650, category: 'housing' }, { date: '2026-04-05', merchant: 'Streamly', amount: -18.99, category: 'subscription' }, { date: '2026-04-06', merchant: 'Metro Market', amount: -96.2, category: 'groceries' }, { date: '2026-04-08', merchant: 'Foodly', amount: -28.4, category: 'dining' }, { date: '2026-04-15', merchant: 'ACME PAYROLL', amount: 2600, category: 'income' }, { date: '2026-04-18', merchant: 'Gym Club', amount: -54.99, category: 'subscription' }, { date: '2026-04-21', merchant: 'MusicBox', amount: -11.99, category: 'subscription' }, { date: '2026-04-24', merchant: 'Metro Market', amount: -112.8, category: 'groceries' }
        ], subs: [{ merchant: 'Streamly', monthly: 18.99, signal: 'Seeded recurring charge' }, { merchant: 'Gym Club', monthly: 54.99, signal: 'Seeded recurring charge' }, { merchant: 'MusicBox', monthly: 11.99, signal: 'Seeded recurring charge' }] },
        sam: { key: 'sam', name: 'Sam', income: 3800, range: '$3,000–$4,500', expenses: 2800, pct: 6, floor: 600, balance: 6800, apr: 7.2, min: 160, debt: 'Starter Loan', streak: 3, points: 90, level: 2, stash: 145, tx: [
          { date: '2026-04-01', merchant: 'Campus Payroll', amount: 1900, category: 'income' }, { date: '2026-04-03', merchant: 'Home Share', amount: -900, category: 'housing' }, { date: '2026-04-06', merchant: 'LearnHub', amount: -29, category: 'subscription' }, { date: '2026-04-08', merchant: 'Metro Market', amount: -74.1, category: 'groceries' }, { date: '2026-04-15', merchant: 'Campus Payroll', amount: 1900, category: 'income' }, { date: '2026-04-16', merchant: 'RideNow', amount: -39.2, category: 'transport' }, { date: '2026-04-19', merchant: 'MusicBox', amount: -11.99, category: 'subscription' }, { date: '2026-04-25', merchant: 'Metro Market', amount: -82.6, category: 'groceries' }
        ], subs: [{ merchant: 'LearnHub', monthly: 29, signal: 'Seeded recurring charge' }, { merchant: 'MusicBox', monthly: 11.99, signal: 'Seeded recurring charge' }] },
      };
      const p = personas[key]; if (!p) throw new Error('Unknown persona.');
      const identity = s.user;
      const fresh = newState();
      Object.keys(s).forEach(key => delete s[key]);
      Object.assign(s, fresh);
      s.authenticated = true; s.user = identity;
      s.profile = { name: p.name, persona: p.key, income_range: p.range, monthly_income: p.income, savings_pct: p.pct, approval_mode: 'each', weekly_cap: 60, floor_balance: p.floor, average_monthly_expenses: p.expenses, quiet_start: '22:00', quiet_end: '08:00', notification_cap: 3, notification_channel: 'in_app' };
      s.stash = { balance: p.stash, shield_threshold: p.min, goals: [] };
      s.game = { streak: p.streak, freezes: 1, points: p.points, level: p.level, evolution_stage: 'Sprout' };
      s.debts = [{ id: 1, name: p.debt, type: key === 'sam' ? 'loan' : 'credit_card', balance: p.balance, apr: p.apr, minimum: p.min, due_day: key === 'sam' ? 12 : 18, status: 'active' }];
      s.seeded_transactions = p.tx; s.seeded_subscriptions = p.subs;
      this.addAudit(s, 'Scout', 'persona_seed', 'Load realistic demo profile and seeded transaction examples.', 'Local demo data; no PayPal transaction search occurred', { persona: p.name, transaction_count: p.tx.length });
      return this.state(s);
    }
    allocateGoals(s, amount) {
      let left = round2(amount);
      for (const goal of (s.stash.goals || []).filter(g => g.status === 'active').sort((a, b) => a.id - b.id)) {
        if (left <= 0) break;
        const need = Math.max(0, round2(goal.target_amount - goal.saved_amount));
        const take = round2(Math.min(left, need));
        goal.saved_amount = round2(goal.saved_amount + take); left = round2(left - take);
        if (goal.saved_amount >= goal.target_amount - .001) { goal.status = 'completed'; goal.completed_at = now(); }
      }
    }
    updateEvolution(s) {
      const active = s.debts.filter(d => d.status === 'active');
      if (!active.length && s.stash.balance >= s.stash.shield_threshold) { s.game.evolution_stage = 'Transactor'; s.game.level = Math.max(s.game.level, 5); }
      else if (s.debts.some(d => d.status === 'defeated')) { s.game.evolution_stage = 'Boss Slayer'; s.game.level = Math.max(s.game.level, 4); }
      else if (s.stash.balance >= s.stash.shield_threshold) { s.game.evolution_stage = 'Shielded'; s.game.level = Math.max(s.game.level, 4); }
      else if (s.game.streak > 0) { s.game.evolution_stage = 'Sprout'; s.game.level = Math.max(s.game.level, 2); }
      else s.game.evolution_stage = 'Revolver';
    }
    weeklyCount(s) { return s.ledger.filter(x => x.kind === 'drip' && Date.now() - new Date(x.created_at).getTime() <= 6 * 86400000).length; }
    recordSquadDrip(s) {
      if (!s.squad) return;
      const date = new Date().toISOString().slice(0, 10);
      if (s.squad_goal_events.some(e => e.date === date)) return;
      s.squad_goal_events.push({ date });
      s.squad_goals.filter(g => g.status === 'active').forEach(g => {
        g.progress_count = Math.min(g.target_count, g.progress_count + 1);
        if (g.progress_count >= g.target_count) {
          g.status = 'completed'; g.completed_at = now();
          if (!s.unlocked_group_cosmetics.some(c => c.cosmetic_id === g.reward_cosmetic_id)) {
            const cosmetic = COSMETICS.find(c => c.id === g.reward_cosmetic_id);
            if (cosmetic) s.unlocked_group_cosmetics.push({ cosmetic_id: cosmetic.id, icon: cosmetic.icon, name: cosmetic.name, unlocked_at: now() });
          }
        }
      });
      const member = s.squad_members.find(m => m.email === s.user?.email);
      if (member) { member.streak = s.game.streak; member.level = s.game.level; member.goal_pct = s.profile.savings_pct; }
    }
    getSquad(s) {
      if (!s.squad) return { squad: null, members: [], cheers: [], goals: [], unlocked_cosmetics: [] };
      const members = s.squad_members.map(m => ({ ...m }));
      return { squad: s.squad, members, cheers: s.cheers.slice(-30).reverse(), goals: s.squad_goals, unlocked_cosmetics: s.unlocked_group_cosmetics };
    }
    async request(path, opts = {}) {
      const method = (opts.method || 'GET').toUpperCase();
      const url = new URL(path, window.location.origin);
      const route = url.pathname;
      let body = {};
      try { body = typeof opts.body === 'string' ? JSON.parse(opts.body || '{}') : (opts.body || {}); } catch { body = {}; }
      let s = this.read();
      const mustBeSignedIn = () => { if (!s.authenticated || !s.user?.email) throw new Error('Enter an email to start this browser-local prototype.'); };
      const makeScout = () => ({ income_pattern: `About ${money(s.profile.monthly_income || 0)}/month across the current profile`, safe_to_move_daily: this.safeToMove(s.profile), subscriptions: s.seeded_subscriptions || [], suggested_debts: this.getDebts(s), source: 'Seeded demo activity (local browser data; PayPal Transaction Search was not called)' });
      let result;

      if (route === '/api/auth/me' && method === 'GET') result = { authenticated: Boolean(s.authenticated && s.user?.email) };
      else if (route === '/api/auth/request' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
        if (s.user?.email && s.user.email !== email) { s = newState(); }
        s.user = { email, display_name: email.split('@')[0] }; s.authenticated = true; this.save(s);
        result = { status: 'local_session_created', email, storage_mode: 'localStorage' };
      }
      else if (route === '/api/auth/logout' && method === 'POST') { s.authenticated = false; this.save(s); result = { status: 'signed_out' }; }
      else if (route === '/api/account' && method === 'DELETE') { this.clear(); result = { status: 'deleted' }; }
      else if (route === '/api/data/export' && method === 'GET') { mustBeSignedIn(); result = clone({ product: 'Glim', exported_at: now(), storage_mode: 'localStorage', ...s }); }
      else if (route === '/api/state' && method === 'GET') { mustBeSignedIn(); result = this.state(s); }
      else if (route.startsWith('/api/personas/') && method === 'POST') { mustBeSignedIn(); result = this.seedPersona(s, route.split('/').pop()); this.save(s); }
      else if (route === '/api/profile' && method === 'POST') {
        mustBeSignedIn();
        if (!(Number(body.monthly_income) > 0)) throw new Error('Enter a monthly income greater than zero.');
        if (body.notification_channel === 'web_push') throw new Error('Web Push is not available in localStorage-only mode. Select In-app, or enable a server API adapter later.');
        s.profile = { ...s.profile, ...body, monthly_income: Number(body.monthly_income), savings_pct: Number(body.savings_pct || 0), weekly_cap: Number(body.weekly_cap || 0), floor_balance: Number(body.floor_balance || 0), average_monthly_expenses: Number(body.average_monthly_expenses ?? Number(body.monthly_income) * .75), notification_cap: Number(body.notification_cap ?? 3) };
        s.stash.shield_threshold = s.debts.find(d => d.status === 'active')?.minimum || s.stash.shield_threshold || 1000;
        s.notifications = { ...s.notifications, quiet_start: s.profile.quiet_start || '22:00', quiet_end: s.profile.quiet_end || '08:00', daily_cap: s.profile.notification_cap, channel: s.profile.notification_channel || 'in_app' };
        s.user.display_name = s.profile.name || s.user.display_name; this.save(s); result = this.state(s);
      }
      else if (route === '/api/debts' && method === 'POST') {
        mustBeSignedIn();
        if (!String(body.name || '').trim() || !(Number(body.balance) > 0) || !(Number(body.minimum) > 0) || Number(body.apr) < 0) throw new Error('Enter a debt name, positive balance and minimum, and a valid APR.');
        const debt = { id: Math.max(0, ...s.debts.map(d => d.id)) + 1, name: String(body.name).trim(), type: body.type || 'credit_card', balance: round2(body.balance), apr: Number(body.apr), minimum: round2(body.minimum), due_day: Number(body.due_day || 15), status: 'active' };
        s.debts.push(debt); s.plan = {}; if (!s.stash.shield_threshold) s.stash.shield_threshold = debt.minimum;
        this.addAudit(s, 'Glim', 'debt_created', 'Add a debt to the local prototype ledger.', 'User entered debt details', debt); this.save(s); result = this.state(s);
      }
      else if (route === '/api/scout' && method === 'POST') { mustBeSignedIn(); result = makeScout(); this.addAudit(s, 'Scout', 'seeded_activity_review', 'Summarize seeded demo transactions and subscription examples.', 'Read-only local demo scan', result); this.save(s); }
      else if (route === '/api/plan' && method === 'POST') { mustBeSignedIn(); result = this.buildPlan(s, body.strategy || 'avalanche', Number(body.stash_pct ?? 65)); this.save(s); }
      else if (route === '/api/what-if' && method === 'POST') {
        mustBeSignedIn(); if (!s.plan?.projection) this.buildPlan(s);
        const text = String(body.text || ''), moneyMatch = text.match(/\$(\d+(?:\.\d+)?)/); let weekly = 0, label = 'No quantified change';
        if (moneyMatch) { weekly = Number(moneyMatch[1]); label = `Adds ${money(weekly)}/week of capacity`; }
        else if (/(twice|two times|2x)/i.test(text) && /(takeout|dining|restaurant)/i.test(text)) { weekly = 20; label = 'Assumes $20/week reclaimed from two fewer takeout occasions'; }
        else if (/(once|one time|1x)/i.test(text) && /(takeout|dining|restaurant)/i.test(text)) { weekly = 10; label = 'Assumes $10/week reclaimed from one fewer takeout occasion'; }
        const debts = s.debts.filter(d => d.status === 'active'); const extraDaily = round2(this.dailyDrip(s.profile) + weekly / 7);
        const projected = debts.length ? this.projection(debts, extraDaily * 30 * (1 - Number(s.plan.stash_pct || 65) / 100), s.plan.strategy) : null;
        result = { parsed: { input: text, weekly_extra: weekly, label }, baseline: s.plan.projection, what_if: projected ? { months: projected.months, interest_paid: projected.interest_paid } : null, daily_drip: extraDaily };
        this.addAudit(s, 'Tactician', 'what_if', 'Parse a simple what-if locally, then use the deterministic payoff calculator.', 'Financial figures calculated by code', result); this.save(s);
      }
      else if (route === '/api/drip/approve' && method === 'POST') {
        mustBeSignedIn(); if (s.paused) throw new Error('Drips are paused.');
        const amount = this.dailyDrip(s.profile); if (amount <= 0) throw new Error('The current plan has no safe-to-move amount above your safety floor.');
        const mode = s.profile.approval_mode || 'each', cap = Number(s.profile.weekly_cap || 0);
        if (['weekly_cap', 'standing_rule'].includes(mode) && this.weeklyTotal(s) + amount > cap) throw new Error(`Weekly cap of ${money(cap)} would be exceeded. No drip was recorded.`);
        let stashPct = s.stash.balance < s.stash.shield_threshold ? 65 : 25;
        if (s.plan?.stash_pct != null) stashPct = Number(s.plan.stash_pct);
        let stashShare = round2(amount * stashPct / 100), debtShare = round2(amount - stashShare);
        const debt = this.activeDebts(s, s.plan?.strategy || 'avalanche')[0]; if (debtShare > 0 && !debt) { stashShare = amount; debtShare = 0; }
        const entry = { id: id(), created_at: now(), kind: 'drip', amount, stash_share: stashShare, debt_share: debtShare, debt_id: debt?.id || null, status: 'local_recorded', settlement_id: null, storage_mode: 'localStorage' };
        s.ledger.push(entry); s.stash.balance = round2(s.stash.balance + stashShare); this.allocateGoals(s, stashShare);
        let defeated = null;
        if (debt && debtShare > 0) { debt.balance = Math.max(0, round2(debt.balance - debtShare)); if (debt.balance <= .01) { debt.balance = 0; debt.status = 'defeated'; defeated = { debt_id: debt.id, debt_name: debt.name, freed_payment: debt.minimum }; s.pending_redirect = defeated; } }
        s.game.streak += 1; s.game.points += 20; s.points_events.push({ created_at: now(), points: 20, reason: 'daily drip' }); s.last_drip_date = new Date().toISOString().slice(0,10); this.updateEvolution(s); this.recordSquadDrip(s);
        this.addAudit(s, 'Banker', 'local_drip_recorded', 'Update the demo ledger and deterministic game values only. No PayPal request was made and no funds moved.', 'User approved local prototype action', entry);
        this.save(s); result = { status: 'approved', amount, stash_share: stashShare, debt_share: debtShare, streak: s.game.streak, points: s.game.points, debt_defeated: defeated, storage_mode: 'localStorage', money_moved: false };
      }
      else if (route === '/api/drip/settle' && method === 'POST') throw new Error('PayPal settlement is disabled in localStorage prototype mode. No payment was sent. Enable the server payment adapter only when a secure persistent backend is configured.');
      else if (route === '/api/debt/redirect' && method === 'POST') {
        mustBeSignedIn(); if (!s.pending_redirect) throw new Error('No defeated Boss is awaiting a redirect decision.');
        s.pending_redirect.destination = body.destination; s.pending_redirect = null; this.addAudit(s, 'Tactician', 'freed_payment_redirect', 'Save the user-selected destination for the freed payment.', 'User choice', { destination: body.destination }); this.save(s); result = { status: 'redirected' };
      }
      else if (route === '/api/game/freeze' && method === 'POST') { mustBeSignedIn(); if (s.game.freezes < 1) throw new Error('No streak freezes remain this month.'); s.game.freezes -= 1; this.addAudit(s, 'Glim', 'streak_freeze', 'Use one forgiveness freeze without resetting the streak.', 'User choice', s.game); this.save(s); result = { game: s.game }; }
      else if (route === '/api/pause' && method === 'POST') { s.paused = true; this.addAudit(s, 'Banker', 'pause', 'Pause future local drip actions.', 'User control', { paused: true }); this.save(s); result = { paused: true }; }
      else if (route === '/api/resume' && method === 'POST') { s.paused = false; this.addAudit(s, 'Banker', 'resume', 'Resume local drip actions.', 'User control', { paused: false }); this.save(s); result = { paused: false }; }
      else if (route === '/api/chat' && method === 'POST') {
        mustBeSignedIn(); const text = String(body.message || ''), low = text.toLowerCase(); let agent = 'Glim', message;
        if (/what if|payoff|interest|avalanche|snowball|debt free/.test(low)) { agent = 'Tactician'; message = s.plan?.projection ? `Your ${s.plan.strategy} plan models about ${s.plan.projection.months} months to pay off the active debts, with approximately ${money(s.plan.projection.interest_paid)} in modeled interest. These are estimates from the local calculator.` : 'Add a debt and build a plan first. The calculator will produce projections.'; }
        else if (/subscription|scout|transaction/.test(low)) { agent = 'Scout'; message = 'The current findings use seeded demo transactions stored in this browser. They are not retrieved from PayPal.'; }
        else if (/stash|saving|shield/.test(low)) { message = `Your local Stash is ${money(s.stash.balance)} toward a Shield of ${money(s.stash.shield_threshold)}. A drip in this prototype updates the local ledger only.`; }
        else { message = `A small step still counts. ${s.paused ? 'Your drips are paused.' : 'Your safety floor and approval rules remain in place.'}`; }
        this.addAudit(s, agent, 'coach_chat', 'Use a deterministic local response; no external LLM call was made.', 'User asked Glim', { message }); this.save(s); result = { agent, message, mode: 'Deterministic fallback' };
      }
      else if (route === '/api/nudge' && method === 'GET') {
        mustBeSignedIn();
        const day = new Date().toISOString().slice(0, 10); const today = s.nudge_history.filter(n => n.created_at.slice(0,10) === day).length;
        if (today >= Number(s.notifications.daily_cap ?? 3)) throw new Error('Daily check-in cap reached. You can change this in notification settings.');
        const messages = this.stressMode(s) ? ['A pause is allowed. Pick this up when you are ready.', 'Small steps count; there is no need to catch up today.'] : ['Your next small step counts more than a perfect week.', 'Your buffer and debt payoff work together. Keep the plan manageable.', 'Consistency earns points, not the amount moved.'];
        const item = { id: id(), created_at: now(), message: messages[today % messages.length], arm_key: this.stressMode(s) ? 'supportive-local' : 'calm-local', why: this.stressMode(s) ? 'Supportive mode is active because activity is paused or check-ins have been ignored.' : 'A calm check-in was selected within your local notification cap.' };
        s.nudge_history.push(item); s.inbox.unshift(item); s.inbox = s.inbox.slice(0, 50); this.save(s); result = item;
      }
      else if (route === '/api/nudge/response' && method === 'POST') {
        mustBeSignedIn(); const response = body.response; const reward = { acted: 1, opened: .3, snoozed: -.2, dismissed: -.5, muted: -1 }[response]; if (reward == null) throw new Error('Unsupported check-in response.');
        if (['acted', 'opened'].includes(response)) s.notifications.consecutive_ignores = 0; else s.notifications.consecutive_ignores = Number(s.notifications.consecutive_ignores || 0) + 1;
        if (response === 'muted') s.notifications.daily_cap = 0;
        const latest = s.inbox[0]; if (latest) { latest.response = response; latest.reward = reward; }
        this.addAudit(s, 'Glim', 'nudge_response', 'Record a local notification response and adjust supportive mode.', response, { response, reward, supportive_mode: this.stressMode(s) }); this.save(s); result = { status: 'saved', reward };
      }
      else if (route === '/api/push/config' && method === 'GET') result = { enabled: false, public_key: '', reason: 'External push subscriptions need a server-side endpoint; local-only prototype stores application data in this browser.' };
      else if (route === '/api/push/subscribe' && method === 'POST') throw new Error('Web Push subscription storage requires a server endpoint. It is unavailable in localStorage-only mode.');
      else if (route === '/api/notifications' && method === 'GET') result = { settings: s.notifications, items: s.inbox, stress_mode: this.stressMode(s) };
      else if (route === '/api/squads' && method === 'GET') result = this.getSquad(s);
      else if (route === '/api/squads' && method === 'POST') {
        mustBeSignedIn(); if (s.squad) throw new Error('This browser already has a squad.');
        const code = `GLIM-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
        s.squad = { id: 1, name: String(body.name || 'Glim Grove').slice(0,60), invite_code: code };
        s.squad_members = [{ id: 1, email: s.user.email, display_name: s.profile.name || s.user.display_name || 'You', streak: s.game.streak, level: s.game.level, goal_pct: Number(s.profile.savings_pct || 0), joined_at: now() }];
        this.save(s); result = this.getSquad(s);
      }
      else if (route === '/api/squads/join' && method === 'POST') {
        mustBeSignedIn(); if (!s.squad || String(body.invite_code || '').toUpperCase() !== s.squad.invite_code) throw new Error('Squad invites cannot sync between browsers in localStorage-only mode. Configure shared database storage to support cross-user invitations.');
        result = this.getSquad(s);
      }
      else if (route === '/api/squads/cheer' && method === 'POST') {
        mustBeSignedIn(); const member = s.squad_members.find(m => m.id === Number(body.member_id)); if (!member) throw new Error('That squad member is not available in this browser.');
        const cheers = ['Nice streak!', 'Keep going!', 'Tiny win, big habit.', 'Your consistency is showing.']; const cheer = cheers.includes(body.cheer) ? body.cheer : cheers[0];
        s.cheers.push({ id: id(), cheer, member_id: member.id, sender: s.profile.name || 'You', created_at: now() }); this.save(s); result = { status: 'sent' };
      }
      else if (route === '/api/squads/goals' && method === 'POST') {
        mustBeSignedIn(); if (!s.squad) throw new Error('Create a local squad first.'); if (s.squad_goals.filter(g => g.status === 'active').length >= 3) throw new Error('You can keep up to three active shared goals.');
        const reward = COSMETICS.find(c => c.id === Number(body.reward_cosmetic_id)); if (!reward) throw new Error('Select a valid cosmetic.');
        s.squad_goals.push({ id: id(), title: String(body.title || '').trim().slice(0,80), target_count: Number(body.target_count), progress_count: 0, reward_cosmetic_id: reward.id, reward_name: reward.name, reward_icon: reward.icon, status: 'active', created_at: now() }); this.save(s); result = this.getSquad(s);
      }
      else if (route === '/api/lessons/next' && method === 'GET') {
        mustBeSignedIn(); const lesson = LESSONS.find(l => !s.completed_lessons.includes(l.id));
        result = lesson ? { lesson: { id: lesson.id, title: lesson.title, description: lesson.description }, prompt: lesson.prompt, points: lesson.points } : { lesson: null };
      }
      else if (route === '/api/lessons/complete' && method === 'POST') {
        mustBeSignedIn(); const lesson = LESSONS.find(l => l.id === Number(body.lesson_id)); if (!lesson) throw new Error('Lesson not found.');
        const answer = String(body.answer || '').toLowerCase(); if (!answer || !lesson.accepted.some(word => answer.includes(word))) throw new Error('Not quite. Review the lesson, then try a short answer about its key idea.');
        if (!s.completed_lessons.includes(lesson.id)) { s.completed_lessons.push(lesson.id); s.game.points += lesson.points; s.points_events.push({ created_at: now(), points: lesson.points, reason: `lesson ${lesson.id}` }); }
        this.addAudit(s, 'Sage', 'lesson_complete', 'Check an applied lesson answer against a local rubric.', 'Answer matched lesson rubric', { lesson_id: lesson.id, points: lesson.points }); this.save(s); result = { status: 'complete', points: lesson.points, game: s.game };
      }
      else if (route === '/api/cosmetics' && method === 'GET') result = { points: s.game.points, items: COSMETICS.map(c => ({ ...c, owned: s.owned_cosmetics.includes(c.id) || s.unlocked_group_cosmetics.some(g => g.cosmetic_id === c.id) })) };
      else if (/^\/api\/cosmetics\/\d+\/buy$/.test(route) && method === 'POST') {
        mustBeSignedIn(); const cosmeticId = Number(route.split('/')[3]); const item = COSMETICS.find(c => c.id === cosmeticId); if (!item) throw new Error('Cosmetic not found.');
        if (!s.owned_cosmetics.includes(cosmeticId)) { if (s.game.points < item.cost) throw new Error('Not enough points. Points come from behavior, not dollar amounts.'); s.game.points -= item.cost; s.owned_cosmetics.push(cosmeticId); }
        this.save(s); result = { points: s.game.points, items: COSMETICS.map(c => ({ ...c, owned: s.owned_cosmetics.includes(c.id) })) };
      }
      else if (route === '/api/stash/goals' && method === 'GET') result = { stash_balance: s.stash.balance, goals: s.stash.goals };
      else if (route === '/api/stash/goals' && method === 'POST') {
        mustBeSignedIn(); if (s.stash.goals.filter(g => g.status === 'active').length >= 6) throw new Error('You can keep up to six active Stash goals.');
        if (!String(body.name || '').trim() || !(Number(body.target_amount) > 0)) throw new Error('Enter a goal name and a target amount greater than zero.');
        s.stash.goals.push({ id: Math.max(0, ...s.stash.goals.map(g => g.id)) + 1, name: String(body.name).trim().slice(0,60), target_amount: round2(body.target_amount), saved_amount: 0, monthly_target: round2(body.monthly_target || 0), status: 'active', created_at: now() });
        this.addAudit(s, 'Glim', 'stash_goal_created', 'Create a named goal in browser storage; future local Stash shares are earmarked without double counting.', 'User created goal', body); this.save(s); result = { stash_balance: s.stash.balance, goals: s.stash.goals };
      }
      else if (route === '/api/stash/auto-deposit' && method === 'GET') result = s.monthly_deposit;
      else if (route === '/api/stash/auto-deposit' && method === 'PUT') {
        mustBeSignedIn(); if (body.enabled && !(Number(body.amount) > 0)) throw new Error('Set a monthly preference amount greater than $0.00 CAD.'); if (body.enabled && !body.consent) throw new Error('Confirm the prototype monthly-deposit preference before enabling it.');
        s.monthly_deposit = { enabled: Boolean(body.enabled), amount: round2(body.amount || 0), due_day: Math.max(1, Math.min(28, Number(body.due_day || 1))), consent: Boolean(body.consent), status: body.enabled ? 'local_settings_only' : 'disabled', note: 'Saved locally only. No schedule, collection, or payout runs in localStorage mode.' };
        this.addAudit(s, 'Banker', 'monthly_deposit_preference', 'Store the opt-in preference locally only; no payment schedule is running.', 'User confirmed local preference', { ...s.monthly_deposit }); this.save(s); result = s.monthly_deposit;
      }
      else if (route === '/api/stash/auto-deposit/run' && method === 'POST') throw new Error('Monthly auto-deposit cannot initiate PayPal in localStorage mode. No money moved. This control requires a secure server payment adapter and persistent webhook processing.');
      else if (route === '/api/monthly-recap' && method === 'GET') {
        mustBeSignedIn(); const month = url.searchParams.get('month') || new Date().toISOString().slice(0,7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Month must use YYYY-MM format.');
        const rows = s.ledger.filter(x => x.kind === 'drip' && x.created_at.slice(0,7) === month); const amount = rows.reduce((a,x)=>a+Number(x.amount||0),0); const stash = rows.reduce((a,x)=>a+Number(x.stash_share||0),0); const debt = rows.reduce((a,x)=>a+Number(x.debt_share||0),0);
        const pts = s.points_events.filter(x => x.created_at.slice(0,7) === month).reduce((a,x)=>a+Number(x.points||0),0);
        result = { month, currency: 'CAD', drip_count: rows.length, active_days: new Set(rows.map(x=>x.created_at.slice(0,10))).size, total_moved: round2(amount), stash_contribution: round2(stash), debt_contribution: round2(debt), points_earned: pts, goals_completed: s.stash.goals.filter(g=>g.status==='completed' && (g.completed_at||'').slice(0,7)===month).length, current_stash_balance: s.stash.balance, current_active_debt: round2(s.debts.filter(d=>d.status==='active').reduce((a,d)=>a+d.balance,0)), streak: s.game.streak, bars: { stash_pct: amount ? round2(stash/amount*100) : 0, debt_pct: amount ? round2(debt/amount*100) : 0 }, note: 'Totals include local prototype drips only; no funds moved. Current balances and streak are as of now, not month-end snapshots.' };
      }
      else if (route === '/api/audit' && method === 'GET') result = s.audit.slice(0,40);
      else if (route === '/api/debt-chart' && method === 'GET') {
        const debt = s.debts.filter(d=>d.status==='active');
        if (!debt.length) result = { balances: [], minimum_only: [] };
        else {
          const current = debt.reduce((a,d)=>a+d.balance,0); const dr = this.dailyDrip(s.profile); const stashPct = Number(s.plan?.stash_pct ?? 65); const withPlan = [], minimums = [];
          let a = current, b = current;
          for (let i=0;i<13;i++) { withPlan.push(round2(a)); minimums.push(round2(b)); const monthlyI = a * debt[0].apr / 100 / 12; a = Math.max(0, a + monthlyI - debt.reduce((x,d)=>x+d.minimum,0) - dr*30*(1-stashPct/100)); const monthlyMinI = b * debt[0].apr / 100 / 12; b = Math.max(0, b + monthlyMinI - debt.reduce((x,d)=>x+d.minimum,0)); }
          result = { balances: withPlan, minimum_only: minimums };
        }
      }
      else if (route === '/api/ledger' && method === 'GET') result = s.ledger.filter(x=>x.kind==='drip').slice().reverse().slice(0,60);
      else if (route === '/api/paypal/health' && method === 'GET') result = { configured: false, authenticated: false, environment: 'sandbox', country: 'CA', currency: 'CAD', reason: 'PayPal server calls are disabled in browser-local storage mode.' };
      else if (route === '/api/paypal/connect' && method === 'POST') throw new Error('PayPal API calls are intentionally disabled in localStorage-only mode. No token was created. Switch to the server API adapter after configuring secure credentials and persistent webhook state.');
      else if (route === '/api/paypal/disconnect' && method === 'POST') { s.paypal = { status: 'disconnected', mode: 'sandbox', country: 'CA', currency: 'CAD', scopes: [] }; this.save(s); result = s.paypal; }
      else throw new Error(`This action is not available in the localStorage adapter: ${method} ${route}`);

      return clone(result);
    }
  }

  class DatabaseApiAdapter {
    constructor() { this.name = 'database-api'; }
    async request(path, opts = {}) {
      const response = await fetch(path, { headers: { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) }, ...opts });
      let data = {}; try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(data.detail || 'Something went wrong.');
      return data;
    }
  }

  const mode = String(window.GLIM_CONFIG?.storageMode || 'localStorage').toLowerCase();
  const adapter = mode === 'database' ? new DatabaseApiAdapter() : new BrowserLocalStorageAdapter();
  window.GlimStorage = { adapter, mode: adapter.name, key: STORAGE_KEY };
})();
