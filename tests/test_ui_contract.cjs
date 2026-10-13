const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(p, 'utf8');
const landing = read('app/templates/landing.html');
const workspace = read('app/templates/workspace.html');
const base = read('app/templates/base.html');
const dashboard = read('app/templates/partials/dashboard.html');
const tabs = ['overview','savings','plan','coach','game','squad','learn','settings'];
const js = read('app/static/app.js');
const css = read('app/static/styles.css');

assert.match(landing, /Plan your savings and debt payoff in one place/);
assert.doesNotMatch(landing, /authForm|authEmail|landing-signin|One plan for savings and debt|Progress based on consistency|You stay in control|Saving and debt, in one economy|Instead of treating these goals separately/i);
assert.doesNotMatch(landing, /<ol|<li[^>]*>\s*<strong>0[1-9]/i, 'landing steps should not have redundant numbering');
assert.match(landing, /Savings buffer/);
assert.match(landing, /Debt payoff estimates/);
assert.match(landing, /Adjustable assumptions/);
assert.match(landing, /href="\/start"/);
assert.match(workspace, /id="authForm"/);
assert.match(workspace, /id="fontSmallBtn"/);
assert.match(workspace, /id="fontMediumBtn"/);
assert.match(workspace, /id="fontLargeBtn"/);
assert.match(base, /Jinja2|block content/);
assert.match(dashboard, /id="sectionBack"/);
assert.match(dashboard, /id="sectionNext"/);
for (const tab of tabs) {
  assert.match(dashboard, new RegExp(`href="/app/${tab}"`), `missing route link for ${tab}`);
  assert.match(js, new RegExp(`tab:'${tab}'`), `walkthrough does not explain ${tab}`);
  assert.ok(fs.existsSync(`app/templates/partials/tab_${tab}.html`), `missing template partial for ${tab}`);
}
assert.match(js, /window\.addEventListener\('popstate'/, 'browser back/forward needs route handling');
assert.match(js, /history\[method\]/, 'workspace routes should update browser history');
assert.match(css, /\.process-grid\s*\{/);
assert.match(css, /\.section-navigation\s*\{/);
assert.doesNotMatch(workspace + dashboard, /PayPal Sandbox|Demo preview|demo profile is ready|data-tab="trust"|invite code|pushEnableBtn/i);
assert.ok(!fs.existsSync('app/static/index.html'), 'HTML pages should be stored as Jinja templates, not static files');
console.log('UI contract tests passed');
