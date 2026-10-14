(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const form = $('#authForm');
  const result = $('#signinResult');
  const safeNavigate = async () => {
    if (window.GlimStorage?.mode !== 'localStorage') return;
    try {
      const me = await window.GlimStorage.adapter.request('/api/auth/me');
      if (!me.authenticated) return;
      const state = await window.GlimStorage.adapter.request('/api/state');
      window.location.replace(Number(state.profile?.monthly_income) > 0 ? '/app/overview' : '/setup');
    } catch {}
  };
  safeNavigate();
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const email = $('#authEmail').value.trim();
    button.disabled = true;
    button.textContent = 'Continuing…';
    try {
      const r = await window.GlimStorage.adapter.request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email }) });
      if (window.GlimStorage.mode === 'localStorage') {
        window.location.assign('/setup');
        return;
      }
      result.classList.remove('hidden');
      result.replaceChildren();
      const message = document.createElement('p');
      message.textContent = r.message || (r.demo_magic_link ? 'Development sign-in link created.' : 'Check your email for the sign-in link, then return to Glim.');
      result.appendChild(message);
      if (r.demo_magic_link) {
        const link = document.createElement('a');
        link.href = r.demo_magic_link;
        link.textContent = 'Open sign-in link';
        link.className = 'text-link';
        result.appendChild(link);
      }
    } catch (error) {
      result.classList.remove('hidden');
      result.textContent = error.message || 'Unable to start your session.';
    } finally {
      button.disabled = false;
      button.textContent = 'Continue';
    }
  });
})();
