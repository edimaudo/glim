/* Browser-local financial state. This module repairs older IndexedDB schemas and
   keeps low-level browser/database errors out of the visible interface. */
(function () {
  const DB_NAME = "glim-finance";
  // Version 2 migrates databases created by older builds that may lack `profiles`.
  const DB_VERSION = 2;
  const STORE = "profiles";
  let dbPromise;
  let activeDb;

  const SAFE_STORAGE_MESSAGE = "Glim couldn't access your saved information right now. Please refresh the page and try again.";

  function customerSafeError(operation, error) {
    // Preserve diagnostics for developers without exposing browser exceptions to users.
    console.error(`[Glim storage] ${operation} failed`, error);
    return new Error(SAFE_STORAGE_MESSAGE);
  }

  function ensureSchema(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: "key" });
    }
  }

  function attachDatabaseHandlers(db) {
    db.onversionchange = () => {
      db.close();
      if (activeDb === db) activeDb = null;
      // Allow the next operation to reopen against the newest schema.
      dbPromise = null;
    };
    activeDb = db;
    return db;
  }

  function openAtVersion(version) {
    return new Promise((resolve, reject) => {
      let request;
      let settled = false;
      let blockedTimer = null;
      const finishResolve = (db) => {
        if (settled) {
          db?.close?.();
          return;
        }
        settled = true;
        if (blockedTimer) window.clearTimeout(blockedTimer);
        resolve(db);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        if (blockedTimer) window.clearTimeout(blockedTimer);
        reject(error);
      };

      try {
        request = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
      } catch (error) {
        finishReject(error);
        return;
      }

      request.onupgradeneeded = () => {
        // This runs for a new database, a version upgrade, or a repair upgrade.
        ensureSchema(request.result);
      };
      request.onerror = () => finishReject(request.error || new Error("IndexedDB could not be opened."));
      request.onblocked = () => {
        // An older Glim tab can hold the old schema open. Do not leave the sign-in
        // button spinning indefinitely; the caller will show a generic retry message.
        if (!blockedTimer) {
          blockedTimer = window.setTimeout(
            () => finishReject(new Error("Browser storage upgrade is blocked by another tab.")),
            8000
          );
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        if (!db.objectStoreNames.contains(STORE)) {
          // Some older builds created the database without the expected object store.
          // Upgrade again instead of calling transaction() against a missing store.
          const repairVersion = db.version + 1;
          db.close();
          openAtVersion(repairVersion).then(finishResolve, finishReject);
          return;
        }
        finishResolve(attachDatabaseHandlers(db));
      };
    });
  }

  function openDb() {
    if (!("indexedDB" in window)) {
      return Promise.reject(new Error("Glim needs browser storage enabled to save your progress. Please use a current browser and try again."));
    }
    if (!dbPromise) {
      dbPromise = openAtVersion(DB_VERSION)
        .catch((error) => {
          // If an older/newer build has already set a higher version, inspect the current
          // database without forcing a lower version, then repair it if the store is absent.
          if (error && error.name === "VersionError") return openAtVersion(null);
          throw error;
        })
        .catch((error) => {
          dbPromise = null;
          throw customerSafeError("opening browser storage", error);
        });
    }
    return dbPromise;
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
    });
  }

  function profileKey(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) throw new Error("A valid email is required to select Glim data.");
    return normalized;
  }

  function defaultState(profile = {}) {
    return {
      profile: { name: profile.name || "Glim member", email: profile.email || "" },
      debts: [],
      savingsGoals: [],
      starterPortfolioVersion: 0,
      monthlyBudget: 0,
      strategy: "avalanche",
      lastPlan: null,
      lastPlanComparison: null,
      baselineDebt: 0,
      balanceHistory: [],
      milestones: [],
      claimedRewardMilestones: [],
      rewardClaimRequests: {},
      rewardPayouts: [],
      productComparisons: [],
      reminderEvents: [],
      coachInteractions: 0,
      prefs: { theme: "light", fontSize: "medium", reminderFrequency: "weekly", coachTone: "balanced", coachMode: "coach", browserNotifications: false },
      lastCoachQuestion: null,
      lastCoachAt: null,
      lastReminderAt: null,
      reminderDismissals: 0,
      snoozedReminderUntil: null,
      completedLessonIds: [],
      quizBestScore: 0,
      quizAttempts: 0,
      quizLastCorrect: null,
      quizLastScore: null,
      quizLastLevel: null,
      quizHistory: [],
      literacyLevel: null,
      literacyAssessmentScore: null,
      literacyAssessmentAt: null,
      assessmentTopics: []
    };
  }

  function applyStarterPortfolio(state) {
    const today = new Date().toISOString().slice(0, 10);
    let addedDebt = false;

    // Fill only empty categories. Existing user-entered records are never overwritten.
    if (!Array.isArray(state.debts) || state.debts.length === 0) {
      state.debts = [{
        id: "glim-starter-credit-card",
        name: "Credit card debt",
        type: "Credit card",
        balance: 10000,
        // APR and minimum payment are deliberately blank until confirmed by the user.
        apr: null,
        minimum_payment: null,
        due_date: null,
        starter: true,
        details_confirmed: false,
        source: "starter-profile"
      }];
      state.baselineDebt = 10000;
      addedDebt = true;
    }

    if (!Array.isArray(state.savingsGoals) || state.savingsGoals.length === 0) {
      state.savingsGoals = [{
        id: "glim-starter-savings-goal",
        name: "Savings",
        target: 10000,
        current: 1300,
        monthly_contribution: 0,
        starter: true,
        source: "starter-profile"
      }];
    }

    if (addedDebt && (!Array.isArray(state.balanceHistory) || state.balanceHistory.length === 0)) {
      state.balanceHistory = [{ date: today, total: 10000, source: "starting balance" }];
    }
    state.starterPortfolioVersion = 1;
    return state;
  }

  async function getState(email, profile = {}) {
    try {
      const key = profileKey(email);
      const db = await openDb();
      // Defensive validation after a database version change in another tab.
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        activeDb = null;
        dbPromise = null;
        return getState(email, profile);
      }
      const tx = db.transaction(STORE, "readonly");
      const record = await requestToPromise(tx.objectStore(STORE).get(key));
      if (record?.state) {
        const state = record.state;
        state.profile = { ...(state.profile || {}), ...profile, email: key };
        // Remove the seeded balances shipped by earlier demo builds. They were examples,
        // not user-entered accounts, and should not appear as a signed-in person's finances.
        const previousDebts = Array.isArray(state.debts) ? state.debts : [];
        const previousGoals = Array.isArray(state.savingsGoals) ? state.savingsGoals : [];
        const hadSeededRecords = previousDebts.some((item) => item.sample) || previousGoals.some((item) => item.sample);
        if (hadSeededRecords) {
          state.debts = previousDebts.filter((item) => !item.sample);
          state.savingsGoals = previousGoals.filter((item) => !item.sample);
          const remaining = state.debts.reduce((sum, item) => sum + Math.max(0, Number(item.balance) || 0), 0);
          state.baselineDebt = remaining;
          state.balanceHistory = state.debts.length ? [{ date: new Date().toISOString().slice(0, 10), total: remaining, source: "user-entered starting balance" }] : [];
          state.lastPlan = null;
          state.lastPlanComparison = null;
          if (state.debts.length === 0) state.monthlyBudget = 0;
        }
        state.debts ||= [];
        state.savingsGoals ||= [];
        // One-time starter-profile migration for existing empty demo profiles.
        // It fills only empty categories and preserves all existing user-entered data.
        if (Number(state.starterPortfolioVersion || 0) < 1) {
          applyStarterPortfolio(state);
          await saveState(key, state);
        }
        state.completedLessonIds ||= [];
        state.quizHistory ||= [];
        state.quizBestScore = Number(state.quizBestScore || 0);
        if (hadSeededRecords) await saveState(key, state);
        return state;
      }
      const state = applyStarterPortfolio(defaultState({ ...profile, email: key }));
      await saveState(key, state);
      return state;
    } catch (error) {
      throw customerSafeError("loading the profile", error);
    }
  }

  async function saveState(email, state) {
    try {
      const key = profileKey(email);
      const db = await openDb();
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        activeDb = null;
        dbPromise = null;
        return saveState(email, state);
      }
      const cleanState = typeof structuredClone === "function" ? structuredClone(state) : JSON.parse(JSON.stringify(state));
      cleanState.profile = { ...(cleanState.profile || {}), email: key };
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, state: cleanState, updatedAt: new Date().toISOString() });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Could not save browser data."));
        tx.onabort = () => reject(tx.error || new Error("Browser data save was cancelled."));
      });
      return true;
    } catch (error) {
      throw customerSafeError("saving the profile", error);
    }
  }

  async function resetState(email, profile = {}) {
    try {
      const state = defaultState({ ...profile, email: profileKey(email) });
      state.starterPortfolioVersion = 1;
      await saveState(email, state);
      return state;
    } catch (error) {
      throw customerSafeError("resetting the profile", error);
    }
  }

  window.GlimStorage = { getState, saveState, resetState, defaultState, applyStarterPortfolio };
})();
