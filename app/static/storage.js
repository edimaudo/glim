/* Glim storage adapters. IndexedDB is the default client-side store; the database adapter supports verified sign-in and payment-provider APIs. */
(() => {
  'use strict';
  const STORAGE_KEY = 'glim.prototype.v1';
  const ACTIVE_EMAIL_KEY = 'glim.prototype.active-email';
  const DB_NAME = 'glim-finance';
  const DB_VERSION = 1;
  const DB_STORE = 'records';
  const accountKey = email => `${STORAGE_KEY}.user.${encodeURIComponent(String(email || '').trim().toLowerCase())}`;
  const COSMETICS = [
    { id: 1, name: 'Leaf trail', description: 'A subtle visual accent.', cost: 80, icon: 'leaf' },
    { id: 2, name: 'Acorn crown', description: 'A tiny crown for a consistent week.', cost: 120, icon: 'acorn' },
    { id: 3, name: 'Evening theme', description: 'A softer low-light appearance.', cost: 180, icon: 'moon' },
    { id: 101, name: 'Striped scarf', description: 'A soft scarf for your otter.', cost: 40, icon: 'scarf' },
    { id: 102, name: 'Rain hat', description: 'A small hat for rainy days.', cost: 70, icon: 'hat' },
    { id: 103, name: 'Shell glasses', description: 'Round shell-inspired glasses.', cost: 100, icon: 'glasses' },
    { id: 104, name: 'Blue float', description: 'A bright float for the river.', cost: 140, icon: 'float' },
  ];
  const LESSONS = [
    { id: 1, title: 'Protect your minimum balance', description: 'Keep your chosen safety amount available for essentials.', prompt: 'What should happen if a contribution would take your available balance below your minimum?', points: 15, accepted: ['pause', 'skip', 'not move', 'not breach', 'keep the floor'] },
    { id: 2, title: 'Choose a manageable amount', description: 'A target that fits your budget is easier to repeat than an ambitious amount.', prompt: 'What matters more than choosing the largest possible daily amount?', points: 15, accepted: ['consistency', 'manageable', 'repeat', 'afford'] },
    { id: 3, title: 'Compare interest rates', description: 'Paying the highest-rate debt first can reduce interest when minimum payments on other debts are covered.', prompt: 'Which repayment approach usually reduces interest cost the most?', points: 20, accepted: ['avalanche', 'highest rate', 'highest interest'] },
  ];
  const now = () => new Date().toISOString();
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const money = n => Number(n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const newState = () => ({
    schemaVersion: 1,
    mode: 'indexedDB',
    authenticated: false,
    user: null,
    profile: { country: 'CA', currency: 'CAD', timezone: 'America/Toronto' },
    paypal: { status: 'disconnected', mode: 'sandbox', country: 'CA', currency: 'CAD', scopes: [] },
    stash: { balance: 0, shield_threshold: 1000, goals: [] },
    game: { streak: 0 },
    plan: {}, paused: false, pending_redirect: null,
    debts: [], seeded_transactions: [], ledger: [], audit: [], points_events: [],
    cash_transactions: [], saved_scenarios: [], reconciliations: [],
    notifications: { quiet_start: '22:00', quiet_end: '08:00', daily_cap: 3, channel: 'in_app', consecutive_ignores: 0, debt_reminder_tone: 'zen' },
    inbox: [], nudge_history: [], debt_payment_events: [], savings_goal_events: [], donations: [],
    monthly_deposit: { enabled: false, amount: 0, income_pct: 0, duration_months: 6, goal_id: null, due_day: 1, consent: false, status: 'disabled' },
    squad: null, squad_members: [], cheers: [], squad_goals: [], squad_goal_events: [], unlocked_group_cosmetics: [],
    owned_cosmetics: [], completed_lessons: [], last_drip_date: null,
  });

  class BrowserIndexedDBAdapter {
    constructor(key = STORAGE_KEY) {
      this.baseKey = key;
      this.key = key;
      this.name = 'indexedDB';
      this.db = null;
      this.activeEmail = '';
      this.cache = null;
      this.pendingWrites = Promise.resolve();
      this.ready = this.initialize();
    }
    openDatabase() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('This browser does not support IndexedDB. Use a current version of Safari, Chrome, Firefox, or Edge.')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Glim could not open its secure browser database.'));
      });
    }
    getRecord(key) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error || new Error('Could not read saved financial information.'));
      });
    }
    putRecord(key, value) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Glim could not save your changes.'));
      });
    }
    deleteRecord(key) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Glim could not delete the saved data.'));
      });
    }
    async initialize() {
      this.db = await this.openDatabase();
      this.activeEmail = String(await this.getRecord('meta.activeEmail') || '').trim().toLowerCase();
      this.key = this.activeEmail ? accountKey(this.activeEmail) : this.baseKey;
      let stored = await this.getRecord(this.key);
      this.cache = this.normalizeState(stored || newState());
      if (!stored) await this.putRecord(this.key, this.cache);
      return true;
    }
    normalizeState(value) {
      const defaults = newState();
      const state = { ...defaults, ...(value || {}) };
      state.profile = { country: 'CA', currency: 'CAD', timezone: 'America/Toronto', ...(value?.profile || {}) };
      state.notifications = { ...defaults.notifications, ...(value?.notifications || {}) };
      state.game = { streak: Number(value?.game?.streak || 0) };
      state.monthly_deposit = { ...defaults.monthly_deposit, ...(value?.monthly_deposit || {}) };
      for (const key of ['debt_payment_events','savings_goal_events','donations','cash_transactions','saved_scenarios','reconciliations']) if (!Array.isArray(state[key])) state[key] = [];
      if (!state.legacy_sample_cleared && (state.profile?.sample_selected === true || ['riley','sam'].includes(String(state.profile?.persona || '')) || ['Riley','Sam','Credit-card payoff example','Loan and savings example'].includes(String(state.profile?.name || '')))) {
        state.profile = { country:'CA', currency:'CAD', timezone:'America/Toronto', name:'', persona:'custom' };
        state.debts=[]; state.plan={}; state.stash={balance:0,shield_threshold:1000,goals:[]};
        state.game={streak:0};
        state.seeded_transactions=[]; state.seeded_subscriptions=[]; state.ledger=[]; state.audit=[]; state.points_events=[];
        state.last_drip_date=null; if(state.user)state.user.display_name=''; state.legacy_sample_cleared=true;
      }
      return state;
    }
    read() { return this.cache || newState(); }
    save(state) {
      this.cache = this.normalizeState(state);
      const snapshot = clone(this.cache), key = this.key;
      this.pendingWrites = this.pendingWrites.catch(() => {}).then(() => this.putRecord(key, snapshot));
      return this.pendingWrites;
    }
    async flush() { await this.pendingWrites; }
    async selectAccount(email) {
      this.activeEmail = String(email || '').trim().toLowerCase();
      this.key = this.activeEmail ? accountKey(this.activeEmail) : this.baseKey;
      if (this.activeEmail) await this.putRecord('meta.activeEmail', this.activeEmail);
      this.cache = this.normalizeState((await this.getRecord(this.key)) || newState());
      if (!(await this.getRecord(this.key))) await this.putRecord(this.key, this.cache);
    }
    async clear() {
      await this.ready;
      await this.deleteRecord(this.key).catch(() => {});
      await this.deleteRecord('meta.activeEmail').catch(() => {});
      this.activeEmail = ''; this.key = this.baseKey; this.cache = newState();
      await this.putRecord(this.key, this.cache);
    }
    state(s) {
      return {
        profile: s.profile, paypal: s.paypal, stash: s.stash, game: { streak: Number(s.game?.streak || 0) }, plan: s.plan,
        paused: s.paused, pending_redirect: s.pending_redirect, user: s.user,
        debts: s.debts, daily_drip: this.dailyDrip(s.profile), paypal_configured: false,
        weekly_approved: this.weeklyTotal(s), standing_rule_today: this.canAutoApprove(s),
        stress_mode: this.stressMode(s), storage_mode: 'indexedDB', cash_transactions: s.cash_transactions || [],
        saved_scenarios: s.saved_scenarios || [], reconciliations: s.reconciliations || []
      };
    }
    addAudit(s, agent, inputRef, rationale, approval, result) {
      s.audit.unshift({ id: id(), created_at: now(), agent, input_ref: inputRef, proposal: {}, rationale, approval, result });
      s.audit = s.audit.slice(0, 100);
    }
    state(s) {
      return {
        profile: s.profile, paypal: s.paypal, stash: s.stash, game: { streak: Number(s.game?.streak || 0) }, plan: s.plan,
        paused: s.paused, pending_redirect: s.pending_redirect, user: s.user,
        debts: s.debts, daily_drip: this.dailyDrip(s.profile), paypal_configured: false,
        weekly_approved: this.weeklyTotal(s), standing_rule_today: this.canAutoApprove(s),
        stress_mode: this.stressMode(s), storage_mode: 'indexedDB',
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
    buildPlan(s, strategy = 'smart', stashPct = 65) {
      const debts = s.debts.filter(d => d.status === 'active');
      if (!debts.length) throw new Error('Add a debt before building the plan.');
      const daily = this.dailyDrip(s.profile), extra = daily * 30 * (1 - stashPct / 100);
      const minimumInterest = debts.reduce((sum, d) => sum + this.payoff(d, 0).interest_paid, 0);
      let resolved = strategy, smartSummary = null;
      if (strategy === 'smart') {
        const candidates = Object.fromEntries(['avalanche','snowball','hybrid'].map(k => [k, this.projection(debts, extra, k)]));
        const lowest = Object.keys(candidates).sort((a,b)=>candidates[a].interest_paid-candidates[b].interest_paid || candidates[a].months-candidates[b].months)[0];
        const snow = candidates.snowball, base = candidates[lowest];
        resolved = snow.months <= base.months + 1 && snow.interest_paid <= Math.max(1, base.interest_paid * 1.05) ? 'snowball' : lowest;
        const rationale = {avalanche:'it has the lowest modeled interest cost among the compared approaches.',snowball:'it clears a smaller balance sooner while keeping modeled interest close to the lowest-cost approach.',hybrid:'it balances modeled interest cost and the timing of debt payoffs.'};
        smartSummary = `Smart Strategy compared repayment approaches and recommends ${resolved[0].toUpperCase()+resolved.slice(1)} because ${rationale[resolved]}`;
      }
      const proj = this.projection(debts, extra, resolved);
      const reasons = { avalanche: 'Highest interest rate first to reduce interest cost.', snowball: 'Smallest balance first for earlier payoffs.', hybrid: 'Balances interest reduction with earlier milestones.' };
      s.plan = { strategy, resolved_strategy: resolved, smart_summary: smartSummary, stash_pct: Number(stashPct), boss_pct: 100 - Number(stashPct), daily_drip: daily, reason: smartSummary || reasons[resolved] || reasons.avalanche, projection: { months: proj.months, interest_paid: proj.interest_paid, interest_saved: round2(Math.max(0, minimumInterest - proj.interest_paid)) }, safe_to_move_daily: this.safeToMove(s.profile), attack_order: this.orderDebts(debts, resolved).map(d => d.name) };
      this.addAudit(s, 'Glim', 'build_plan', 'Calculated a repayment comparison from the entered profile and debt details.', 'Deterministic code calculation', s.plan);
      return s.plan;
    }
    safeToMove(p) {
      if (!p || !p.monthly_income) return 0;
      return round2(Math.max(0, Number(p.monthly_income) - Number(p.average_monthly_expenses ?? p.monthly_income * .75) - Number(p.floor_balance || 0)) / 30);
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
    debtProgress(s) {
      const today = new Date();
      const active = s.debts.filter(d => d.status === 'active');
      const rows = active.map(debt => {
        const dueDay = Math.min(31, Number(debt.due_day || 15));
        const month = today.toISOString().slice(0,7);
        const events = s.debt_payment_events.filter(e => Number(e.debt_id) === Number(debt.id) && String(e.payment_date).slice(0,7) === month);
        const paidByDue = events.filter(e => Number(String(e.payment_date).slice(8,10)) <= dueDay).reduce((sum,e)=>sum+Number(e.amount||0),0);
        const paid = paidByDue + .001 >= Number(debt.minimum||0);
        const streak = this.debtStreak(s, debt);
        return { id: Number(debt.id), name: debt.name, type: debt.type, due_day: dueDay, minimum: Number(debt.minimum||0), paid_this_month: round2(events.reduce((sum,e)=>sum+Number(e.amount||0),0)), paid_on_time_this_month: paid, payment_status: paid ? 'paid' : (today.getDate() >= dueDay ? 'due' : 'upcoming'), streak };
      });
      const streak = rows.length ? Math.min(...rows.map(r=>r.streak)) : 0;
      let nextDue = null;
      for (const debt of active) {
        const dueDay = Math.min(28, Number(debt.due_day || 15));
        const due = new Date(today.getFullYear(), today.getMonth(), dueDay);
        if (due < new Date(today.getFullYear(),today.getMonth(),today.getDate())) due.setMonth(due.getMonth()+1);
        if (!nextDue || due < nextDue) nextDue = due;
      }
      return { on_time_streak: streak, debts: rows, next_due_date: nextDue ? nextDue.toISOString().slice(0,10) : null, estimated_monthly_interest: round2(active.reduce((sum,d)=>sum+Number(d.balance||0)*Number(d.apr||0)/1200,0)) };
    }
    debtStreak(s, debt) {
      let count=0; const today=new Date(); const dueDay=Math.min(31,Number(debt.due_day||15));
      const currentMonthPaid=s.debt_payment_events.filter(e=>Number(e.debt_id)===Number(debt.id)&&String(e.payment_date).slice(0,7)===`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`&&Number(String(e.payment_date).slice(8,10))<=dueDay).reduce((sum,e)=>sum+Number(e.amount||0),0)>=Number(debt.minimum||0)-.001;
      const firstOffset=!currentMonthPaid&&today.getDate()<dueDay?1:0;
      for(let offset=firstOffset;offset<firstOffset+120;offset++){
        const date=new Date(today.getFullYear(),today.getMonth()-offset,1), key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
        const paid=s.debt_payment_events.filter(e=>Number(e.debt_id)===Number(debt.id)&&String(e.payment_date).slice(0,7)===key&&Number(String(e.payment_date).slice(8,10))<=Math.min(31,Number(debt.due_day||15))).reduce((sum,e)=>sum+Number(e.amount||0),0);
        if(paid+.001<Number(debt.minimum||0))break;
        count++;
      }
      return count;
    }
    savingsProgress(s) {
      const today=new Date(),monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,monthAt=n=>monthKey(new Date(today.getFullYear(),today.getMonth()-n,1)),totals={};
      s.savings_goal_events.forEach(e=>{const key=`${e.goal_id??'none'}:${String(e.contribution_date).slice(0,7)}`;totals[key]=(totals[key]||0)+Number(e.amount||0);});
      const goals=s.stash.goals.map(g=>{let streak=0,target=Number(g.monthly_target||0);if(target>0){let start=0;if((totals[`${g.id}:${monthKey(today)}`]||0)+.001<target&&today.getDate()<28)start=1;for(let i=start;i<120;i++){if((totals[`${g.id}:${monthAt(i)}`]||0)+.001<target)break;streak++;}}return {...g,monthly_streak:streak,current_month_contribution:round2(totals[`${g.id}:${monthKey(today)}`]||0)};});
      return {balance:Number(s.stash.balance||0),savings_streak:goals.reduce((m,g)=>Math.max(m,Number(g.monthly_streak||0)),0),goals,contributions:s.savings_goal_events.slice(-12).reverse()};
    }
    smartSavings(s) {
      const income=Number(s.profile.monthly_income||0),expenses=Number(s.profile.average_monthly_expenses??income*.75),surplus=Math.max(0,income-expenses),current=Number(s.profile.savings_pct||5),maxPct=income?surplus/income*100*.9:0,pct=round2(Math.max(0,Math.min(current,maxPct)));
      const debts=s.debts.filter(d=>d.status==='active'),highestApr=Math.max(0,...debts.map(d=>Number(d.apr||0))),target=Math.max(1,Number(s.stash.shield_threshold||500)),balance=Number(s.stash.balance||0),bufferPct=Math.max(0,Math.min(100,balance/target*100));
      const reason=debts.length&&bufferPct<100?`Smart Strategy recommends ${pct}% of income for savings while you build the ${money(target)} buffer. Keep debt minimums current, then use Debt plan to prioritize extra repayment by interest rate.`:debts.length?`Your savings buffer has reached its target. Smart Strategy recommends ${pct}% of income for savings and prioritizing extra debt payments toward the highest APR (${highestApr.toFixed(2)}%).`:`Smart Strategy keeps your savings percentage within the ${money(surplus)} monthly surplus you entered. Adjust it as your goals change.`;
      return {recommended_pct:pct,monthly_amount:round2(income*pct/100),monthly_surplus:round2(surplus),current_pct:current,active_debt_count:debts.length,highest_apr:highestApr,buffer_progress_pct:round2(bufferPct),reason};
    }
    normalizeCashTransaction(row) {
      const txnDate = String(row.date || row.transaction_date || row.txn_date || '').slice(0, 10);
      const amount = round2(Math.abs(Number(row.amount)));
      const type = String(row.type || row.transaction_type || row.txn_type || 'expense').toLowerCase();
      const allowed = ['income', 'expense', 'transfer'];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate) || Number.isNaN(Date.parse(txnDate))) throw new Error('Each transaction needs a valid date in YYYY-MM-DD format.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Each transaction needs a positive amount.');
      if (!allowed.includes(type)) throw new Error('Transaction type must be income, expense, or transfer.');
      const description = String(row.description || row.name || row.merchant || '').trim().slice(0, 160);
      if (!description) throw new Error('Each transaction needs a description.');
      const category = String(row.category || (type === 'income' ? 'Income' : type === 'transfer' ? 'Transfer' : 'Uncategorized')).trim().slice(0, 60);
      return { id: String(row.id || id()), date: txnDate, description, category, type, amount, source: String(row.source || 'manual').slice(0, 40), created_at: row.created_at || now() };
    }
    financeTransactions(s) { return [...(s.cash_transactions || [])].sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at))); }
    financeImport(s, rows) {
      if (!Array.isArray(rows) || !rows.length) throw new Error('Choose a CSV file with transaction rows first.');
      if (rows.length > 5000) throw new Error('Import up to 5,000 rows at a time.');
      const existing = new Set((s.cash_transactions || []).map(t => `${t.date}|${Number(t.amount).toFixed(2)}|${String(t.description).toLowerCase()}`));
      let imported = 0, skipped = 0;
      for (const raw of rows) {
        try {
          const txn = this.normalizeCashTransaction({ ...raw, source: raw.source || 'CSV import' });
          const fingerprint = `${txn.date}|${txn.amount.toFixed(2)}|${txn.description.toLowerCase()}`;
          if (existing.has(fingerprint)) { skipped++; continue; }
          existing.add(fingerprint); s.cash_transactions.push(txn); imported++;
        } catch (error) { skipped++; }
      }
      if (!imported) throw new Error('No new valid rows were imported. Check the date, amount, description, and type columns.');
      this.addAudit(s, 'Glim', 'transactions_imported', 'Import and deduplicate user-provided transaction records.', 'User initiated CSV import', { imported, skipped });
      return { imported, skipped, transactions: this.financeTransactions(s) };
    }
    financeCalendar(s, month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a month in YYYY-MM format.');
      const [year, mon] = month.split('-').map(Number), days = new Date(year, mon, 0).getDate(), today = new Date();
      const events = [];
      const dayDate = day => `${month}-${String(Math.max(1, Math.min(days, day))).padStart(2,'0')}`;
      for (const debt of (s.debts || []).filter(d => d.status === 'active')) {
        const dueDay = Math.min(days, Math.max(1, Number(debt.due_day || 15)));
        const paid = (s.debt_payment_events || []).filter(e => Number(e.debt_id) === Number(debt.id) && String(e.payment_date).slice(0,7) === month && Number(String(e.payment_date).slice(8,10)) <= dueDay).reduce((sum,e)=>sum+Number(e.amount||0),0) >= Number(debt.minimum||0)-.001;
        events.push({ date: dayDate(dueDay), kind: 'debt', title: `${debt.name} minimum payment`, amount: Number(debt.minimum||0), status: paid ? 'recorded' : 'upcoming', detail: paid ? 'Minimum recorded before the due day' : 'Check the due date and record the payment once made' });
      }
      const schedule = s.monthly_deposit || {};
      if (schedule.enabled && Number(schedule.amount) > 0) events.push({ date: dayDate(Number(schedule.due_day || 1)), kind: 'savings', title: 'Scheduled savings contribution', amount: Number(schedule.amount), status: 'scheduled', detail: 'Review your balance and authorization before transferring' });
      for (const goal of (s.stash?.goals || []).filter(g => g.status === 'active' && Number(g.monthly_target||0) > 0)) events.push({ date: dayDate(Math.min(28, days)), kind: 'savings', title: `${goal.name} monthly target`, amount: Number(goal.monthly_target), status: 'target', detail: 'Savings contribution target' });
      events.push({ date: dayDate(1), kind: 'review', title: 'Monthly budget review', amount: 0, status: 'reminder', detail: 'Review income, spending, upcoming bills, and savings allocation' });
      return events.sort((a,b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    }
    financeReport(s, month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a month in YYYY-MM format.');
      const txns = s.cash_transactions || [], txMonth = txns.filter(t => String(t.date).slice(0,7) === month);
      const sum = (rows, type) => round2(rows.filter(r => !type || r.type === type).reduce((a,r)=>a+Number(r.amount||0),0));
      const categories = {};
      txMonth.filter(t=>t.type==='expense').forEach(t=>{categories[t.category || 'Uncategorized']=(categories[t.category || 'Uncategorized']||0)+Number(t.amount||0)});
      const months=[]; const [y,m]=month.split('-').map(Number);
      for(let i=5;i>=0;i--){const d=new Date(y,m-1-i,1), key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;const rows=txns.filter(t=>String(t.date).slice(0,7)===key);const debt=(s.debt_payment_events||[]).filter(e=>String(e.payment_date).slice(0,7)===key);const savings=(s.savings_goal_events||[]).filter(e=>String(e.contribution_date).slice(0,7)===key);months.push({month:key,income:sum(rows,'income'),expenses:sum(rows,'expense'),debt_payments:round2(debt.reduce((a,e)=>a+Number(e.amount||0),0)),savings_contributions:round2(savings.reduce((a,e)=>a+Number(e.amount||0),0))});}
      const debtTotal=(s.debt_payment_events||[]).filter(e=>String(e.payment_date).slice(0,7)===month).reduce((a,e)=>a+Number(e.amount||0),0);
      const savingsTotal=(s.savings_goal_events||[]).filter(e=>String(e.contribution_date).slice(0,7)===month).reduce((a,e)=>a+Number(e.amount||0),0);
      const activeDebt=(s.debts||[]).filter(d=>d.status==='active').reduce((a,d)=>a+Number(d.balance||0),0);
      const estimatedInterest=s.plan?.projection?.interest_saved ?? s.plan?.projection?.interest_avoided ?? 0;
      return { month, currency:'CAD', income:sum(txMonth,'income'), expenses:sum(txMonth,'expense'), net_cash_flow:round2(sum(txMonth,'income')-sum(txMonth,'expense')), debt_payments:round2(debtTotal), savings_contributions:round2(savingsTotal), active_debt_balance:round2(activeDebt), savings_balance:round2(s.stash?.balance||0), modeled_interest_avoided:round2(estimatedInterest), categories:Object.entries(categories).map(([category,amount])=>({category,amount:round2(amount)})).sort((a,b)=>b.amount-a.amount), months };
    }
    projectDebtScenario(debts, extra, options = {}) {
      const rows = debts.map(d=>({...d,balance:Math.max(0,Number(d.balance||0)),apr:Math.max(0,Number(d.apr||0)+Number(options.aprDelta||0)),minimum:Math.max(0,Number(d.minimum||0))})).filter(d=>d.balance>0.01).sort((a,b)=>b.apr-a.apr||a.balance-b.balance);
      let interest=0,months=0,freed=0;
      while(rows.some(d=>d.balance>0.01)&&months<600){months++;let overpay=Math.max(0,Number(extra||0))+freed;freed=0;
        for(const d of rows){if(d.balance<=.01)continue;const charge=d.balance*d.apr/1200;interest+=charge;const min=Math.min(d.balance+charge,d.minimum);let paid=min;let surplus=Math.min(Math.max(0,d.balance+charge-min),overpay);paid+=surplus;overpay-=surplus;d.balance=Math.max(0,d.balance+charge-paid);if(d.balance<=.01)freed+=d.minimum;}
        if(rows.every(d=>d.balance>0.01&&d.minimum<=d.balance*d.apr/1200))return {months:600,interest_paid:round2(interest),stalled:true};
      }
      return {months,interest_paid:round2(interest),stalled:months>=600};
    }
    calculateScenario(s, input) {
      const debts=(s.debts||[]).filter(d=>d.status==='active');
      if(!debts.length)throw new Error('Add an active debt before modeling repayment scenarios.');
      const income=Number(s.profile?.monthly_income||0), expenses=Number(s.profile?.average_monthly_expenses||0), minimums=debts.reduce((a,d)=>a+Number(d.minimum||0),0);
      const incomeDelta=Number(input.income_delta||0), expenseDelta=Number(input.expense_delta||0), extra=Number(input.extra_monthly_payment||0), lump=Math.max(0,Number(input.lump_sum_payment||0)), unexpected=Math.max(0,Number(input.unexpected_expense||0)), aprDelta=Number(input.apr_delta||0);
      for(const [name,val] of Object.entries({incomeDelta,expenseDelta,extra,lump,unexpected,aprDelta}))if(!Number.isFinite(val))throw new Error('Enter valid amounts in all scenario fields.');
      const eligible = debts.map(d=>({...d})).sort((a,b)=>Number(b.apr)-Number(a.apr));
      let remainingLump=lump; eligible.forEach(d=>{const take=Math.min(Number(d.balance||0),remainingLump);d.balance=round2(Number(d.balance||0)-take);remainingLump-=take;});
      let unpaidShock=Math.max(0,unexpected-Number(s.stash?.balance||0));
      if(unpaidShock>0)eligible[0].balance=round2(Number(eligible[0].balance||0)+unpaidShock);
      const baselineExtra=Math.max(0,income-expenses-minimums);
      const changedExtra=Math.max(0,income+incomeDelta-(expenses+expenseDelta)-minimums)+Math.max(0,extra);
      const baseline=this.projectDebtScenario(debts,baselineExtra);
      const projection=this.projectDebtScenario(eligible,changedExtra,{aprDelta});
      const baselineBuffer=Number(s.stash?.balance||0), bufferAfter=Math.max(0,baselineBuffer-unexpected);
      return {name:String(input.name||'Scenario').slice(0,80),inputs:{extra_monthly_payment:extra,income_delta:incomeDelta,expense_delta:expenseDelta,unexpected_expense:unexpected,lump_sum_payment:lump,apr_delta:aprDelta},baseline,projection,months_saved:baseline.months-projection.months,interest_saved:round2(baseline.interest_paid-projection.interest_paid),available_monthly_surplus:round2(income+incomeDelta-expenses-expenseDelta),baseline_monthly_surplus:round2(income-expenses),savings_balance_after_unexpected_expense:round2(bufferAfter),unexpected_expense_from_debt:round2(unpaidShock),minimums_monthly:round2(minimums),created_at:now()};
    }
    reconcileDebts(s, rows, applyChanges) {
      if(!Array.isArray(rows)||!rows.length)throw new Error('Enter at least one statement balance to reconcile.');
      const results=[];
      for(const row of rows){const debt=s.debts.find(d=>Number(d.id)===Number(row.debt_id));if(!debt)continue;const statement=Number(row.statement_balance);if(!Number.isFinite(statement)||statement<0)throw new Error(`Enter a valid statement balance for ${debt.name}.`);const variance=round2(statement-Number(debt.balance||0));const result={debt_id:Number(debt.id),name:debt.name,tracked_balance:round2(debt.balance),statement_balance:round2(statement),variance,statement_date:String(row.statement_date||new Date().toISOString().slice(0,10)),applied:Boolean(applyChanges),created_at:now()};s.reconciliations.unshift(result);if(applyChanges){debt.balance=round2(statement);debt.status=statement<=0.01?'defeated':'active';if(row.apr!=null&&row.apr!==''&&Number.isFinite(Number(row.apr)))debt.apr=Number(row.apr);if(row.minimum_payment!=null&&row.minimum_payment!==''&&Number.isFinite(Number(row.minimum_payment)))debt.minimum=Number(row.minimum_payment);if(row.due_day!=null&&row.due_day!==''&&Number.isFinite(Number(row.due_day)))debt.due_day=Math.max(1,Math.min(31,Number(row.due_day)));}results.push(result);}
      if(!results.length)throw new Error('Select at least one debt for reconciliation.');
      this.addAudit(s,'Glim','debt_statement_reconciliation','Compare statement balances with Glim tracked balances and apply only when explicitly requested.',applyChanges?'User confirmed statement updates':'Review-only reconciliation',{count:results.length,applied:Boolean(applyChanges)});
      return { results, applied:Boolean(applyChanges) };
    }
    async request(path, opts = {}) {
      await this.ready;
      const method = (opts.method || 'GET').toUpperCase();
      const url = new URL(path, window.location.origin);
      const route = url.pathname;
      let body = {};
      try { body = typeof opts.body === 'string' ? JSON.parse(opts.body || '{}') : (opts.body || {}); } catch { body = {}; }
      // Email selects a browser-local profile; this is not verified authentication.
      if (route === '/api/auth/request' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
        await this.selectAccount(email);
        const accountState = this.read();
        accountState.user = { email, display_name: String(accountState.profile?.name || '') };
        accountState.authenticated = true;
        await this.save(accountState); await this.flush();
        return clone({ status: 'local_profile_opened', email, storage_mode: 'indexedDB', secure_authentication: false });
      }
      let s = this.read();
      const mustBeSignedIn = () => { if (!s.authenticated || !s.user?.email) throw new Error('Sign in to open your Glim plan.'); };
      const makeScout = () => ({ income_pattern: `Profile estimate: ${money(s.profile.monthly_income || 0)}/month`, safe_to_move_daily: this.safeToMove(s.profile), subscriptions: [], suggested_debts: [], debt_suggestions: [], source: 'No account activity is available to review yet. No recurring charges or debts have been assumed.' });
      let result;

      if (route === '/api/auth/me' && method === 'GET') result = { authenticated: Boolean(s.authenticated && s.user?.email) };
      else if (route === '/api/auth/logout' && method === 'POST') { s.authenticated = false; this.save(s); result = { status: 'signed_out' }; }
      else if (route === '/api/account' && method === 'DELETE') { await this.clear(); result = { status: 'deleted' }; }
      else if (route === '/api/data/export' && method === 'GET') { mustBeSignedIn(); const exported=this.state(s); result = clone({ product: 'Glim', exported_at: now(), storage_mode: 'indexedDB', state: exported, debts: s.debts, cash_transactions:s.cash_transactions||[], saved_scenarios:s.saved_scenarios||[], reconciliations:s.reconciliations||[], ledger:s.ledger, audit:s.audit }); }
      else if (route === '/api/state' && method === 'GET') { mustBeSignedIn(); result = this.state(s); }
      else if (route.startsWith('/api/personas/') && method === 'POST') throw new Error('Example identities have been removed. Enter your own profile and debt details.')
      else if (route === '/api/profile' && method === 'POST') {
        mustBeSignedIn();
        if (!(Number(body.monthly_income) > 0)) throw new Error('Enter a monthly income greater than zero.');
        if (body.notification_channel === 'web_push' || body.notification_channel === 'email') throw new Error('External reminders are not available in browser storage. Select In-app or enable the server adapter with channel credentials.');
        s.profile = { ...s.profile, ...body, setup_completed: true, monthly_income: Number(body.monthly_income), savings_pct: Number(body.savings_pct || 0), weekly_cap: Number(body.weekly_cap || 0), floor_balance: Number(body.floor_balance || 0), average_monthly_expenses: Number(body.average_monthly_expenses ?? Number(body.monthly_income) * .75), notification_cap: Number(body.notification_cap ?? 3) };
        s.stash.shield_threshold = s.debts.find(d => d.status === 'active')?.minimum || s.stash.shield_threshold || 1000;
        s.notifications = { ...s.notifications, quiet_start: s.profile.quiet_start || '22:00', quiet_end: s.profile.quiet_end || '08:00', daily_cap: s.profile.notification_cap, channel: s.profile.notification_channel || 'in_app', debt_reminder_tone:s.profile.debt_reminder_tone||s.notifications.debt_reminder_tone||'zen' };
        s.user.display_name = s.profile.name || s.user.display_name; this.save(s); result = this.state(s);
      }
      else if (route === '/api/debts' && method === 'POST') {
        mustBeSignedIn();
        if (!String(body.name || '').trim() || !(Number(body.balance) > 0) || !(Number(body.minimum) > 0) || Number(body.apr) < 0) throw new Error('Enter a debt name, positive balance and minimum, and a valid APR.');
        const debt = { id: Math.max(0, ...s.debts.map(d => d.id)) + 1, name: String(body.name).trim(), type: body.type || 'credit_card', balance: round2(body.balance), apr: Number(body.apr), minimum: round2(body.minimum), due_day: Number(body.due_day || 15), status: 'active' };
        s.debts.push(debt); s.plan = {}; if (!s.stash.shield_threshold) s.stash.shield_threshold = debt.minimum;
        this.addAudit(s, 'Glim', 'debt_created', 'Add the debt details you entered to your plan.', 'User entered debt details', debt); this.save(s); result = this.state(s);
      }
      else if ((route === '/api/debt-progress' || route === '/api/otter') && method === 'GET') { mustBeSignedIn(); result = this.debtProgress(s); }
      else if (/^\/api\/debts\/\d+\/payments$/.test(route) && method === 'POST') {
        mustBeSignedIn();const debtId=Number(route.split('/')[3]),debt=s.debts.find(d=>Number(d.id)===debtId&&d.status==='active'),amount=round2(body.amount),paidDate=String(body.payment_date||'').slice(0,10);
        if(!debt)throw new Error('That active debt could not be found.');if(!(amount>0)||!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)||Number.isNaN(new Date(`${paidDate}T12:00:00`).getTime()))throw new Error('Enter a positive amount and valid payment date.');
        const due=Number(debt.due_day||15),month=paidDate.slice(0,7),prior=s.debt_payment_events.filter(p=>Number(p.debt_id)===debtId&&String(p.payment_date).slice(0,7)===month&&Number(String(p.payment_date).slice(8,10))<=due).reduce((a,p)=>a+Number(p.amount||0),0),day=Number(paidDate.slice(8,10)),total=prior+(day<=due?amount:0),paidOnTime=total+.001>=Number(debt.minimum||0),crossed=paidOnTime&&prior+.001<Number(debt.minimum||0);
        s.debt_payment_events.push({debt_id:debtId,payment_date:paidDate,amount,created_at:now()});debt.balance=round2(Math.max(0,Number(debt.balance||0)-amount));let defeated=false;if(debt.balance<=.01){debt.balance=0;debt.status='defeated';defeated=true;s.pending_redirect={debt_name:debt.name,freed_payment:Number(debt.minimum||0),debt_id:debtId,user_reported:true};}
        this.addAudit(s,'Glim','debt_payment_recorded','Record a payment reported by the user and update the tracked balance.','User-reported; not independently verified',{debt_id:debtId,amount,payment_date:paidDate,paid_on_time:paidOnTime});this.save(s);result=this.debtProgress(s);result.recorded={debt_id:debtId,amount,payment_date:paidDate,paid_on_time:paidOnTime,balance_after:debt.balance};
      }
      else if (/^\/api\/(cosmetics|squads|lessons|game\/|otter\/items)/.test(route)) throw new Error('This feature has been removed. Glim now tracks payment and savings streaks only.');
      else if (/^\/api\/otter\/items\/\d+\/buy$/.test(route) && method === 'POST') {mustBeSignedIn();const itemId=Number(route.split('/')[4]),item=COSMETICS.find(c=>c.id===itemId&&c.id>=101);if(!item)throw new Error('Appearance item not found.');if(!s.owned_cosmetics.includes(itemId)){if(Number(s.game.points||0)<item.cost)throw new Error('You do not have enough in-app currency for this item.');s.game.points-=item.cost;s.owned_cosmetics.push(itemId);}this.save(s);result=this.debtProgress(s);}
      else if (/^\/api\/otter\/items\/\d+\/equip$/.test(route) && method === 'POST') {mustBeSignedIn();const itemId=Number(route.split('/')[4]);if(!s.owned_cosmetics.includes(itemId))throw new Error('Unlock this item before equipping it.');s.game.otter_equipped_id=itemId;this.save(s);result=this.debtProgress(s);}
      else if (route === '/api/otter/items/none/equip' && method === 'POST') {mustBeSignedIn();s.game.otter_equipped_id=null;this.save(s);result=this.debtProgress(s);}
      else if (route === '/api/debt/redirect' && method === 'POST') {
        mustBeSignedIn();if(!s.pending_redirect)throw new Error('No paid-off debt is awaiting a decision.');s.pending_redirect.destination=body.destination;s.pending_redirect=null;this.save(s);result={status:'redirected'};
      }
      else if (route === '/api/savings/progress' && method === 'GET') result=this.savingsProgress(s);
      else if (route === '/api/savings/recommendation' && method === 'GET') result=this.smartSavings(s);
      else if (route === '/api/savings/contributions' && method === 'POST') {
        mustBeSignedIn();const amount=round2(body.amount),paidDate=String(body.contribution_date||'').slice(0,10),goalId=body.goal_id==null||body.goal_id===''?null:Number(body.goal_id);if(!(amount>0)||!/^\d{4}-\d{2}-\d{2}$/.test(paidDate))throw new Error('Enter a positive amount and valid savings date.');const goal=goalId==null?null:s.stash.goals.find(g=>Number(g.id)===goalId&&g.status==='active');if(goalId!=null&&!goal)throw new Error('Choose an active savings goal.');
        s.stash.balance=round2(Number(s.stash.balance||0)+amount);if(goal){goal.saved_amount=round2(Number(goal.saved_amount||0)+amount);goal.status=goal.saved_amount+.001>=Number(goal.target_amount)?'completed':'active';if(goal.status==='completed')goal.completed_at=now();}
        s.savings_goal_events.push({goal_id:goalId,contribution_date:paidDate,amount,source:'self_reported',created_at:now()});const month=paidDate.slice(0,7),monthlyTotal=s.savings_goal_events.filter(x=>Number(x.goal_id)===goalId&&String(x.contribution_date).slice(0,7)===month).reduce((a,x)=>a+Number(x.amount||0),0),monthlyTargetMet=Boolean(goal&&Number(goal.monthly_target)>0&&monthlyTotal+.001>=Number(goal.monthly_target));
        this.addAudit(s,'Glim','savings_contribution_recorded','Record a contribution reported by the user.','User-reported; no money moved',{amount,goal_id:goalId,contribution_date:paidDate,monthly_target_met:monthlyTargetMet});this.save(s);result=this.savingsProgress(s);result.recorded={amount,goal_id:goalId,contribution_date:paidDate,monthly_target_met:monthlyTargetMet};
      }
      else if (route === '/api/savings/donations' && method === 'GET') result=s.donations.slice().reverse();
      else if (route === '/api/savings/donations' && method === 'POST') {mustBeSignedIn();const name=String(body.charity_name||'').trim(),email=String(body.recipient_email||'').trim(),amount=round2(body.amount);if(!name||!/^\S+@\S+\.\S+$/.test(email)||!(amount>0))throw new Error('Enter the charity name, recipient email and a positive amount.');if(!s.stash.goals.some(g=>g.status==='completed'))throw new Error('Complete at least one savings goal before donating.');if(amount>Number(s.stash.balance||0))throw new Error('The amount exceeds your recorded savings balance.');const item={id:id(),charity_name:name,recipient_email:email,amount,status:'planned',created_at:now(),note:'Donation request recorded. No payment was sent from this browser.'};s.donations.push(item);this.save(s);result=item;}
      else if (route === '/api/scout' && method === 'POST') { mustBeSignedIn(); result = makeScout(); this.addAudit(s, 'Scout', 'seeded_activity_review', 'Review available connected-account activity.', 'Activity refreshed', result); this.save(s); }
      else if (route === '/api/plan' && method === 'POST') { mustBeSignedIn(); result = this.buildPlan(s, body.strategy || 'smart', Number(body.stash_pct ?? 65)); this.save(s); }
      else if (route === '/api/what-if' && method === 'POST') {
        mustBeSignedIn(); if (!s.plan?.projection) this.buildPlan(s);
        const text = String(body.text || '').trim(), low = text.toLowerCase();
        let weekly = 0, label = 'I could not determine a quantified change from that sentence.', needs_clarification = false; const assumptions = [];
        const cadenceMatch = low.match(/\b(twice|two times|2x|once|one time|1x|three times|thrice|3x)\b/);
        const cadence = cadenceMatch ? (['twice','two times','2x'].includes(cadenceMatch[1]) ? 2 : (['three times','thrice','3x'].includes(cadenceMatch[1]) ? 3 : 1)) : 1;
        const amountMatch = low.match(/(?:\$\s*)?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:cad\s*)?(?:per\s+)?(week|weekly|month|monthly|day|daily|occasion|visit|meal)?\b/);
        if (amountMatch) {
          const amount=Number(amountMatch[1]),unit=amountMatch[2]||'',start=amountMatch.index||0;const hasCurrency=text.slice(Math.max(0,start-2),start+1).includes('$');
          if(amount>0&&unit){if(['week','weekly'].includes(unit))weekly=amount;else if(['month','monthly'].includes(unit))weekly=amount*12/52;else if(['day','daily'].includes(unit))weekly=amount*7;else{weekly=amount*cadence;assumptions.push(`Treating ${cadence} avoided occasion(s) each week as $${amount.toFixed(2)} each.`)}label=`Models an additional $${weekly.toFixed(2)} per week from the amount and period entered.`;}
          else if(hasCurrency&&amount>0&&/(takeout|dining|restaurant|coffee|lunch|delivery)/.test(low)){if(cadenceMatch){weekly=amount*cadence;assumptions.push(`Treating $${amount.toFixed(2)} as spend per avoided occasion, ${cadence} occasion(s) per week.`);label=`Models $${weekly.toFixed(2)}/week reclaimed from fewer occasions.`;}else{needs_clarification=true;label='I need to know whether that amount is per week, month or occasion.';}}
          else if(hasCurrency&&amount>0){needs_clarification=true;label='I need a time period (per week, month or day) before calculating that amount.';}
        }
        if(!weekly&&!needs_clarification&&/\b(skip|cut|avoid|drop|reduce)\b/.test(low)&&/(takeout|dining|restaurant|delivery)/.test(low)){weekly=10*cadence;assumptions.push('Planning placeholder: $10.00 per avoided occasion because actual takeout spend is not recorded.');label=`Uses a disclosed $10-per-occasion placeholder for ${cadence} fewer takeout occasion(s) each week.`;}
        if(!weekly&&!needs_clarification){const pct=low.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);if(pct&&/(expense|spend|budget|cost|spending)/.test(low)){const expense=Number(s.profile.average_monthly_expenses||0);if(Number(pct[1])>0&&expense>0){weekly=expense*Number(pct[1])/100*12/52;assumptions.push(`Applies ${pct[1]}% to all entered monthly expenses; category-level spend is not connected.`);label=`Models a ${pct[1]}% reduction in entered monthly expenses, about $${weekly.toFixed(2)}/week.`;}else{needs_clarification=true;label='Enter typical monthly expenses before estimating a percentage-based reduction.';}}}
        if(!weekly&&!needs_clarification){needs_clarification=true;label='Add an amount and period (for example, “save $25 per week”) so I do not assume a figure.';}
        weekly=round2(Math.max(0,weekly));
        const debts=s.debts.filter(d=>d.status==='active');const extraDaily=round2(this.dailyDrip(s.profile)+weekly/7);
        const projected=debts.length&&!needs_clarification?this.projection(debts,extraDaily*30*(1-Number(s.plan.stash_pct??65)/100),s.plan.strategy):null;
        result={parsed:{input:text,weekly_extra:weekly,label,assumptions,needs_clarification},baseline:s.plan?.projection||null,what_if:projected?{months:projected.months,interest_paid:projected.interest_paid,interest_saved_vs_baseline:round2(Number(s.plan.projection?.interest_paid||0)-Number(projected.interest_paid||0)),months_saved_vs_baseline:Number(s.plan.projection?.months||projected.months)-Number(projected.months)}:null,daily_drip:extraDaily};
        this.addAudit(s,'Tactician','what_if','Parse the phrase with explicit amount/period assumptions and compare deterministic projections.','Financial figures calculated by code; unknown amounts request clarification',result);this.save(s);
      }
      else if (route === '/api/drip/approve' && method === 'POST') {
        mustBeSignedIn();
        throw new Error('A daily contribution can only be approved after a PayPal connection is active in server mode. Browser-only mode can calculate a plan but cannot record a payment.');
      }
      else if (route === '/api/drip/settle' && method === 'POST') throw new Error('Real payments are disabled in browser-only mode. No payment was sent. A secure server payment integration is required.');
      else if (route === '/api/debt/redirect' && method === 'POST') {
        mustBeSignedIn(); if (!s.pending_redirect) throw new Error('No paid-off debt is awaiting a payment redirect decision.');
        s.pending_redirect.destination = body.destination; s.pending_redirect = null; this.addAudit(s, 'Tactician', 'freed_payment_redirect', 'Save the user-selected destination for the freed payment.', 'User choice', { destination: body.destination }); this.save(s); result = { status: 'redirected' };
      }
      else if (route === '/api/game/freeze' && method === 'POST') { mustBeSignedIn(); throw new Error('Streak freezes require the server-side daily streak history. Connect to a server-backed Glim account to use this control.'); }
      else if (route === '/api/pause' && method === 'POST') { s.paused = true; this.addAudit(s, 'Banker', 'pause', 'Pause new practice steps and streak tracking.', 'User control', { paused: true }); this.save(s); result = { paused: true }; }
      else if (route === '/api/resume' && method === 'POST') { s.paused = false; this.addAudit(s, 'Banker', 'resume', 'Allow practice steps to be recorded again.', 'User control', { paused: false }); this.save(s); result = { paused: false }; }
      else if (route === '/api/chat' && method === 'POST') {
        mustBeSignedIn(); const text = String(body.message || ''), low = text.toLowerCase(); let agent = 'Glim', message;
        if (/safety floor|minimum balance|floor/.test(low)) { message = `Your safety floor is ${money(s.profile.floor_balance)}. Glim's plan is designed to leave at least this amount available rather than allocating it to savings or debt.`; }
        else if (/how.*avalanche|avalanche.*work/.test(low)) { agent = 'Tactician'; message = 'Avalanche prioritizes the active debt with the highest APR first. It can reduce interest cost, though the first balance may take longer to clear.'; }
        else if (/how.*snowball|snowball.*work/.test(low)) { agent = 'Tactician'; message = 'Snowball prioritizes the smallest active balance first. It can create earlier payoff milestones, though total interest may be higher.'; }
        else if (/daily step|suggest.*step|why.*step/.test(low)) { message = `The suggested daily amount is calculated from your income, expenses, savings target and minimum balance.`; }
        else if (/what if|payoff|interest|avalanche|snowball|debt free/.test(low)) { agent = 'Tactician'; message = s.plan?.projection ? `Your ${s.plan.strategy} plan models about ${s.plan.projection.months} months to pay off the active debts, with approximately ${money(s.plan.projection.interest_paid)} in modeled interest. These are estimates from the local calculator.` : 'Add a debt and build a plan first. The calculator will produce projections.'; }
        else if (/subscription|scout|transaction/.test(low)) { message = 'No account activity is available to review yet. Glim will not invent recurring charges or debt suggestions.'; }
        else if (/saving|buffer|shield|stash/.test(low)) { message = `Your savings buffer is ${money(s.stash.balance)} toward a first target of ${money(s.stash.shield_threshold)}. Logging a step tracks consistency; it does not itself change these balances.`; }
        else { message = `A small step still counts. ${s.paused ? 'Practice steps are paused.' : 'Your safety floor and approval rules remain in place.'}`; }
        this.addAudit(s, agent, 'coach_chat', 'Answer using your current plan and the available guidance.', 'User asked Glim', { message }); this.save(s); result = { agent, message, mode: 'Deterministic fallback' };
      }
      else if (route === '/api/nudge' && method === 'GET') {
        mustBeSignedIn();
        const day = new Date().toISOString().slice(0, 10); const today = s.nudge_history.filter(n => n.created_at.slice(0,10) === day).length;
        if (today >= Number(s.notifications.daily_cap ?? 3)) throw new Error('Daily reminder limit reached. Adjust your reminder settings to change it.');
        const recent=s.nudge_history.slice().reverse().map(n=>n.response).filter(Boolean).slice(0,3);
        let tone=s.notifications.debt_reminder_tone||s.profile.debt_reminder_tone||'zen';if(tone==='adaptive')tone=recent.length&&['snoozed','dismissed','muted'].includes(recent[0])?'zen':'direct';
        const active=s.debts.filter(d=>d.status==='active');let message,why;
        if(active.length&&tone==='direct'){const interest=round2(active.reduce((a,d)=>a+Number(d.balance||0)*Number(d.apr||0)/1200,0));message=`Your balances added about ${money(interest)} in estimated interest over the past month. Review your plan and choose your next payment.`;why='Estimate based on the balances and APRs you entered, divided by 12. Confirm actual interest with your statement.';}
        else if(active.length){const dueFor=d=>{const dayDue=Math.min(Number(d.due_day||15),28),todayDate=new Date();let due=new Date(todayDate.getFullYear(),todayDate.getMonth(),dayDue);if(due<new Date(todayDate.getFullYear(),todayDate.getMonth(),todayDate.getDate()))due=new Date(todayDate.getFullYear(),todayDate.getMonth()+1,dayDue);return due};const d=active.slice().sort((a,b)=>dueFor(a)-dueFor(b))[0],due=dueFor(d),label=d.type==='credit_card'?'credit card':String(d.type||'debt').replaceAll('_',' ');message=`Try to get in your next ${label} payment! It's due ${due.toLocaleString('en-CA',{month:'long'})} ${due.getDate()}.`;why=`Based on the due day entered for ${d.name}. Check the date against your latest statement.`;}
        else {message='A small step still counts. Review your savings goal or repayment plan when you are ready.';why='No active debts were found, so this is a general planning reminder.';}
        const item = { id: id(), created_at: now(), message, tone, arm_key:`debt-${tone}`, why };
        s.nudge_history.push(item); s.inbox.unshift(item); s.inbox = s.inbox.slice(0, 50); this.save(s); result = item;
      }
      else if (route === '/api/nudge/response' && method === 'POST') {
        mustBeSignedIn(); const response = body.response; const reward = { acted: 1, opened: .3, snoozed: -.2, dismissed: -.5, muted: -1 }[response]; if (reward == null) throw new Error('Unsupported check-in response.');
        if (['acted', 'opened'].includes(response)) s.notifications.consecutive_ignores = 0; else s.notifications.consecutive_ignores = Number(s.notifications.consecutive_ignores || 0) + 1;
        if (response === 'muted') s.notifications.daily_cap = 0;
        const latest = s.inbox[0]; if (latest) { latest.response = response; latest.reward = reward; }
        this.addAudit(s, 'Glim', 'nudge_response', 'Save your check-in response so future prompts can be adjusted.', response, { response, reward, supportive_mode: this.stressMode(s) }); this.save(s); result = { status: 'saved', reward };
      }
      else if (route === '/api/push/config' && method === 'GET') result = { enabled: false, public_key: '', reason: 'External push subscriptions need a server-side endpoint; local-only prototype stores application data in this browser.' };
      else if (route === '/api/push/subscribe' && method === 'POST') throw new Error('Web Push subscription storage requires a server endpoint. It is unavailable in browser storage.');
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
        mustBeSignedIn(); if (!s.squad || String(body.invite_code || '').toUpperCase() !== s.squad.invite_code) throw new Error('Squad invites cannot sync between browsers in browser storage. Configure shared database storage to support cross-user invitations.');
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
        this.addAudit(s, 'Sage', 'lesson_complete', 'Check your answer against the lesson objective.', 'Answer matched lesson rubric', { lesson_id: lesson.id, points: lesson.points }); this.save(s); result = { status: 'complete', points: lesson.points, game: s.game };
      }
      else if (route === '/api/cosmetics' && method === 'GET') result = { points: s.game.points, items: COSMETICS.map(c => ({ ...c, owned: s.owned_cosmetics.includes(c.id) || s.unlocked_group_cosmetics.some(g => g.cosmetic_id === c.id) })) };
      else if (/^\/api\/cosmetics\/\d+\/buy$/.test(route) && method === 'POST') {
        mustBeSignedIn(); const cosmeticId = Number(route.split('/')[3]); const item = COSMETICS.find(c => c.id === cosmeticId); if (!item) throw new Error('Cosmetic not found.');
        if (!s.owned_cosmetics.includes(cosmeticId)) { if (s.game.points < item.cost) throw new Error('Not enough points. Points come from behavior, not dollar amounts.'); s.game.points -= item.cost; s.owned_cosmetics.push(cosmeticId); }
        this.save(s); result = { points: s.game.points, items: COSMETICS.map(c => ({ ...c, owned: s.owned_cosmetics.includes(c.id) })) };
      }
      else if (route === '/api/stash/balance' && method === 'POST') { mustBeSignedIn(); const balance=Number(body.balance); if(!Number.isFinite(balance)||balance<0)throw new Error('Enter a savings balance of zero or more.'); s.stash.balance=round2(balance); this.addAudit(s,'Glim','savings_balance_updated','Update the savings balance used in the plan.','User-entered balance',{balance:s.stash.balance}); this.save(s); result={stash_balance:s.stash.balance,goals:s.stash.goals}; }
      else if (route === '/api/stash/goals' && method === 'GET') result = { stash_balance: s.stash.balance, goals: s.stash.goals };
      else if (route === '/api/stash/goals' && method === 'POST') {
        mustBeSignedIn(); if (s.stash.goals.filter(g => g.status === 'active').length >= 6) throw new Error('You can keep up to six active savings goals.');
        if (!String(body.name || '').trim() || !(Number(body.target_amount) > 0)) throw new Error('Enter a goal name and a target amount greater than zero.');
        s.stash.goals.push({ id: Math.max(0, ...s.stash.goals.map(g => g.id)) + 1, name: String(body.name).trim().slice(0,60), target_amount: round2(body.target_amount), saved_amount: 0, monthly_target: round2(body.monthly_target || 0), status: 'active', created_at: now() });
        this.addAudit(s, 'Glim', 'stash_goal_created', 'Create a savings goal and assign future planned contributions in order.', 'User created goal', body); this.save(s); result = { stash_balance: s.stash.balance, goals: s.stash.goals };
      }
      else if (route === '/api/stash/auto-deposit' && method === 'GET') result = s.monthly_deposit;
      else if (route === '/api/stash/auto-deposit' && method === 'PUT') {
        mustBeSignedIn();const pct=Math.max(0,Math.min(50,Number(body.income_pct||0))),duration=Math.max(1,Math.min(60,Number(body.duration_months||6))),amount=round2(Number(s.profile.monthly_income||0)*pct/100),goalId=body.goal_id==null||body.goal_id===''?null:Number(body.goal_id);if(body.enabled&&!(amount>0))throw new Error('Choose a savings percentage that produces a positive monthly amount.');if(body.enabled&&!body.consent)throw new Error('Confirm your monthly savings schedule before saving it.');if(goalId!=null&&!s.stash.goals.some(g=>Number(g.id)===goalId&&g.status==='active'))throw new Error('Choose an active savings goal or general savings.');
        s.monthly_deposit={enabled:Boolean(body.enabled),amount,income_pct:pct,duration_months:duration,goal_id:goalId,due_day:Math.max(1,Math.min(28,Number(body.due_day||1))),consent:Boolean(body.consent),status:body.enabled?'saved':'disabled',note:body.enabled?'Schedule saved. Glim will remind you when it is due.':'Schedule disabled.'};this.addAudit(s,'Glim','monthly_deposit_preference','Save a percentage-based savings schedule with a defined duration.','User preference saved',s.monthly_deposit);this.save(s);result=s.monthly_deposit;
      }
      else if (route === '/api/stash/auto-deposit/run' && method === 'POST') throw new Error('The schedule is saved, but automatic transfers are not active.');
      else if (route === '/api/monthly-recap' && method === 'GET') {
        mustBeSignedIn(); const month = url.searchParams.get('month') || new Date().toISOString().slice(0,7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Month must use YYYY-MM format.');
        const rows = s.ledger.filter(x => x.kind === 'drip' && x.created_at.slice(0,7) === month); const amount = rows.reduce((a,x)=>a+Number(x.amount||0),0); const stash = rows.reduce((a,x)=>a+Number(x.stash_share||0),0); const debt = rows.reduce((a,x)=>a+Number(x.debt_share||0),0);
        result = { month, currency: 'CAD', drip_count: rows.length, active_days: new Set(rows.map(x=>x.created_at.slice(0,10))).size, total_moved: round2(amount), stash_contribution: round2(stash), debt_contribution: round2(debt), goals_completed: s.stash.goals.filter(g=>g.status==='completed' && (g.completed_at||'').slice(0,7)===month).length, current_stash_balance: s.stash.balance, current_active_debt: round2(s.debts.filter(d=>d.status==='active').reduce((a,d)=>a+d.balance,0)), streak: s.game.streak, bars: { stash_pct: amount ? round2(stash/amount*100) : 0, debt_pct: amount ? round2(debt/amount*100) : 0 }, note: 'Totals summarize recorded steps for the selected month. Current balances and streak are as of now, not month-end snapshots.' };
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
      else if (route === '/api/finance/transactions' && method === 'GET') { mustBeSignedIn(); result = this.financeTransactions(s); }
      else if (route === '/api/finance/transactions' && method === 'POST') { mustBeSignedIn(); const txn=this.normalizeCashTransaction(body); if(s.cash_transactions.some(t=>String(t.id)===String(txn.id)))throw new Error('This transaction was already recorded.');s.cash_transactions.push(txn);this.addAudit(s,'Glim','cash_transaction_recorded','Record a dated income, expense, or transfer entry.','User entered transaction',{transaction_id:txn.id,type:txn.type,amount:txn.amount});this.save(s);result=txn; }
      else if (route === '/api/finance/import' && method === 'POST') { mustBeSignedIn(); result=this.financeImport(s,body.rows); this.save(s); }
      else if (route === '/api/finance/report' && method === 'GET') { mustBeSignedIn(); result=this.financeReport(s,url.searchParams.get('month')||new Date().toISOString().slice(0,7)); }
      else if (route === '/api/finance/calendar' && method === 'GET') { mustBeSignedIn(); result=this.financeCalendar(s,url.searchParams.get('month')||new Date().toISOString().slice(0,7)); }
      else if (route === '/api/finance/scenarios' && method === 'GET') { mustBeSignedIn(); result=(s.saved_scenarios||[]).slice().reverse(); }
      else if (route === '/api/finance/scenarios' && method === 'POST') { mustBeSignedIn(); const scenario=this.calculateScenario(s,body); scenario.id=id(); if(body.save!==false){s.saved_scenarios.push(scenario);this.addAudit(s,'Glim','scenario_saved','Save a deterministic debt payoff what-if comparison.','User saved scenario',{scenario_id:scenario.id,name:scenario.name});this.save(s);} result=scenario; }
      else if (route === '/api/finance/reconcile-debts' && method === 'POST') { mustBeSignedIn(); result=this.reconcileDebts(s,body.rows,Boolean(body.apply_changes)); this.save(s); }
      else if (route === '/api/bank/status' && method === 'GET') result = { provider: 'Plaid', country: 'CA', configured: false, connected: false, institutions: [] };
      else if (route === '/api/bank/liabilities' && method === 'GET') result = [];
      else if (route === '/api/bank/link-token' && method === 'POST') throw new Error('Direct bank connection is not enabled for this account. Import a statement CSV instead.');
      else if (route === '/api/bank/exchange' && method === 'POST') throw new Error('Direct bank connection is not enabled for this account.');
      else if (route === '/api/bank/sync' && method === 'POST') throw new Error('Direct bank connection is not enabled for this account.');
      else if (route === '/api/bank/disconnect' && method === 'POST') result = { status: 'disconnected' };
      else if (route === '/api/paypal/health' && method === 'GET') result = { configured: false, authenticated: false, environment: 'sandbox', country: 'CA', currency: 'CAD', reason: 'Account connections are unavailable here.' };
      else if (route === '/api/paypal/connect' && method === 'POST') throw new Error('Account connections are unavailable from this session.');
      else if (route === '/api/paypal/disconnect' && method === 'POST') { s.paypal = { status: 'disconnected', mode: 'sandbox', country: 'CA', currency: 'CAD', scopes: [] }; this.save(s); result = s.paypal; }
      else throw new Error(`This action is not available in the browser adapter: ${method} ${route}`);

      await this.flush();
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

  const mode = String(window.GLIM_CONFIG?.storageMode || 'indexedDB').toLowerCase();
  const adapter = mode === 'database' ? new DatabaseApiAdapter() : new BrowserIndexedDBAdapter();
  window.GlimStorage = { adapter, mode: adapter.name, key: STORAGE_KEY };
})();
