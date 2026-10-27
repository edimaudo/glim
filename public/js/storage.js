/* Browser-local state storage. Financial details never need to be sent to a database server. */
(function () {
  const DB_NAME = "glim-finance";
  const DB_VERSION = 1;
  const STORE = "profiles";
  let dbPromise;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
    });
  }

  function openDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("This browser does not support IndexedDB. Please use a current browser to save Glim data."));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
        request.onblocked = () => reject(new Error("Glim storage upgrade is blocked by another open Glim tab. Close other tabs and try again."));
      });
    }
    return dbPromise;
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
    const key = profileKey(email);
    const db = await openDb();
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
  }

  async function saveState(email, state) {
    const key = profileKey(email);
    const db = await openDb();
    const cleanState = typeof structuredClone === "function" ? structuredClone(state) : JSON.parse(JSON.stringify(state));
    cleanState.profile = { ...(cleanState.profile || {}), email: key };
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, state: cleanState, updatedAt: new Date().toISOString() });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not save Glim data in this browser."));
      tx.onabort = () => reject(tx.error || new Error("Saving Glim data was cancelled."));
    });
    return true;
  }

  async function resetState(email, profile = {}) {
    const state = defaultState({ ...profile, email: profileKey(email) });
    await saveState(email, state);
    return state;
  }



  window.GlimStorage = { getState, saveState, resetState, defaultState };
})();
