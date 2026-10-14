(() => {
  'use strict';
  const key = 'glim.uiPreferences.v1';
  const $ = (s) => document.querySelector(s);
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } })();
  const font = ['small', 'medium', 'large'].includes(prefs.font) ? prefs.font : 'medium';
  document.body.classList.toggle('font-small', font === 'small');
  document.body.classList.toggle('font-large', font === 'large');
  document.body.classList.toggle('dark', prefs.dark === true);
  function currentFont() { return document.body.classList.contains('font-small') ? 'small' : document.body.classList.contains('font-large') ? 'large' : 'medium'; }
  function sync() {
    const selected = currentFont();
    const pairs = { small: ['#fontSmallBtn', '#fontSmallSetting'], medium: ['#fontMediumBtn', '#fontMediumSetting'], large: ['#fontLargeBtn', '#fontLargeSetting'] };
    Object.entries(pairs).forEach(([size, selectors]) => selectors.forEach((sel) => { const el = $(sel); if (el) { el.classList.toggle('active', selected === size); el.setAttribute('aria-pressed', String(selected === size)); } }));
    const dark = document.body.classList.contains('dark');
    ['#themeToggle', '#themeToggleSetting'].forEach((sel) => { const el = $(sel); if (el) { el.setAttribute('aria-pressed', String(dark)); if (sel === '#themeToggle') el.textContent = dark ? 'Light mode' : 'Dark mode'; } });
  }
  function save() { try { localStorage.setItem(key, JSON.stringify({ dark: document.body.classList.contains('dark'), font: currentFont() })); } catch {} sync(); }
  function setFont(size) { document.body.classList.toggle('font-small', size === 'small'); document.body.classList.toggle('font-large', size === 'large'); save(); }
  function toggleTheme() { document.body.classList.toggle('dark'); save(); }
  const fontSelectors = { '#fontSmallBtn': 'small', '#fontMediumBtn': 'medium', '#fontLargeBtn': 'large', '#fontSmallSetting': 'small', '#fontMediumSetting': 'medium', '#fontLargeSetting': 'large' };
  Object.entries(fontSelectors).forEach(([sel, size]) => $(sel)?.addEventListener('click', () => setFont(size)));
  ['#themeToggle', '#themeToggleSetting'].forEach((sel) => $(sel)?.addEventListener('click', toggleTheme));
  sync();
})();
