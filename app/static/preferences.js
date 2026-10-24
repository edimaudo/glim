(() => {
  'use strict';
  const DB_NAME = 'glim-finance';
  const DB_VERSION = 1;
  const STORE = 'records';
  const PREF_KEY = 'pref.uiPreferences';
  const GUIDE_KEY = 'pref.guideCompleted';
  const $ = (selector) => document.querySelector(selector);
  let dbPromise;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB is not supported in this browser.')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open saved preferences.'));
    });
    return dbPromise;
  }
  async function read(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error);
    });
  }
  async function write(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value });
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save preferences.'));
    });
  }
  async function remove(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  let state = { dark: false, font: 'medium' };
  const validFont = value => ['small', 'medium', 'large'].includes(value) ? value : 'medium';
  function applyFont(font) {
    const percent = { small: 90, medium: 100, large: 112 }[validFont(font)];
    // Root font sizing scales rem-based text and components; zoom scales fixed-size UI too.
    document.documentElement.style.setProperty('--ui-scale-percent', `${percent}%`);
    document.documentElement.style.fontSize = `${percent}%`;
    document.body.style.zoom = `${percent}%`;
    document.body.classList.toggle('font-small', font === 'small');
    document.body.classList.toggle('font-large', font === 'large');
  }
  function sync() {
    const pairs = { small: ['#fontSmallBtn', '#fontSmallSetting'], medium: ['#fontMediumBtn', '#fontMediumSetting'], large: ['#fontLargeBtn', '#fontLargeSetting'] };
    Object.entries(pairs).forEach(([size, selectors]) => selectors.forEach(selector => {
      const button = $(selector); if (!button) return;
      button.classList.toggle('active', state.font === size); button.setAttribute('aria-pressed', String(state.font === size));
    }));
    ['#themeToggle', '#themeToggleSetting'].forEach(selector => {
      const button = $(selector); if (!button) return;
      button.setAttribute('aria-pressed', String(state.dark));
      if (selector === '#themeToggle') button.textContent = state.dark ? 'Light mode' : 'Dark mode';
    });
  }
  async function save() { await write(PREF_KEY, state); sync(); }
  async function setFont(font) { state.font = validFont(font); applyFont(state.font); sync(); try { await save(); } catch {} }
  async function toggleTheme() { state.dark = !state.dark; document.body.classList.toggle('dark', state.dark); sync(); try { await save(); } catch {} }
  async function boot() {
    try {
      let stored = await read(PREF_KEY);
      if (stored && typeof stored === 'object') state = { ...state, ...stored, font: validFont(stored.font) };
      const guide = await read(GUIDE_KEY);
      window.GlimPreferences = { get: async key => read(key === 'guideCompleted' ? GUIDE_KEY : `pref.${key}`), set: async (key, value) => write(key === 'guideCompleted' ? GUIDE_KEY : `pref.${key}`, value) };
      document.body.classList.toggle('dark', state.dark === true);
      applyFont(state.font); sync();
      if (!guide) window.dispatchEvent(new CustomEvent('glim-preferences-ready', { detail: { guideCompleted: false } }));
    } catch (error) {
      window.GlimPreferences = { get: async () => null, set: async () => {} };
      applyFont(state.font); sync();
    }
  }
  const fontSelectors = { '#fontSmallBtn': 'small', '#fontMediumBtn': 'medium', '#fontLargeBtn': 'large', '#fontSmallSetting': 'small', '#fontMediumSetting': 'medium', '#fontLargeSetting': 'large' };
  Object.entries(fontSelectors).forEach(([selector, font]) => $(selector)?.addEventListener('click', () => setFont(font)));
  ['#themeToggle', '#themeToggleSetting'].forEach(selector => $(selector)?.addEventListener('click', toggleTheme));
  applyFont(state.font); sync();
  window.GlimPreferencesReady = boot();
})();
