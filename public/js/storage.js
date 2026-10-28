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
    if (!normalized || !normalized.includes("@")) throw new Error("A valid demo email is required to select local Glim data.");
    return normalized;
  }

  function defaultState(profile = {}) {
    const daysFromNow = (days) => {
      const date = new Date(); date.setDate(date.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    return {
      profile: { name: profile.name || "Glim member", email: profile.email || "" },
      debts: [
        { id: "sample-visa", name: "Rewards credit card", type: "Credit card", balance: 4200, apr: 20.99, minimum_payment: 126, due_date: daysFromNow(9), sample: true },
        { id: "sample-loc", name: "Personal line of credit", type: "Line of credit", balance: 2300, apr: 11.5, minimum_payment: 70, due_date: daysFromNow(16), sample: true }
      ],
      savingsGoals: [
        { id: "sample-emergency", name: "Emergency fund", target: 1000, current: 680, monthly_contribution: 50, sample: true },
        { id: "sample-buffer", name: "Monthly breathing room", target: 500, current: 0, monthly_contribution: 25, sample: true }
      ],
      monthlyBudget: 500,
      strategy: "avalanche",
      lastPlan: null,
      lastPlanComparison: null,
      baselineDebt: 6500,
      balanceHistory: [{ date: new Date().toISOString().slice(0, 10), total: 6500, source: "starting sample" }],
      milestones: [],
      claimedRewardMilestones: [],
      rewardClaimRequests: {},
      rewardPayouts: [],
      productComparisons: [],
      reminderEvents: [],
      coachInteractions: 0,
      prefs: { theme: "light", fontSize: "medium", reminderFrequency: "weekly", coachTone: "balanced", coachMode: "coach", browserNotifications: false },
      dismissedBanner: false,
      lastCoachQuestion: null,
      lastCoachAt: null,
      lastReminderAt: null,
      reminderDismissals: 0,
      snoozedReminderUntil: null,
      completedLessonIds: [],
      quizBestScore: null,
      quizAttempts: 0,
      quizLastCorrect: null,
      assessmentTopics: []
    };
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
        return state;
      }
      const state = defaultState({ ...profile, email: key });
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
      await saveState(email, state);
      return state;
    } catch (error) {
      throw customerSafeError("resetting the profile", error);
    }
  }

  window.GlimStorage = { getState, saveState, resetState, defaultState };
})();
