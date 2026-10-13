const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('app/static/index.html', 'utf8');
const js = fs.readFileSync('app/static/app.js', 'utf8');
const css = fs.readFileSync('app/static/styles.css', 'utf8');

for (const id of ['fontSmallBtn', 'fontMediumBtn', 'fontLargeBtn', 'fontSmallSetting', 'fontMediumSetting', 'fontLargeSetting']) {
  assert.match(html, new RegExp(`id="${id}"`), `missing text-size choice ${id}`);
}
for (const tab of ['overview','savings','plan','coach','game','squad','learn','settings']) {
  assert.match(html, new RegExp(`data-tab="${tab}"`), `missing section ${tab}`);
  assert.match(js, new RegExp(`tab:'${tab}'`), `walkthrough does not explain ${tab}`);
}
assert.doesNotMatch(html, /PayPal Sandbox|Demo preview|demo profile is ready|data-tab="trust"|data-tab="cards"|invite code|pushEnableBtn/i);
assert.doesNotMatch(js, /renderShop\(|visualIcon\(|Demo preview|profile is ready/i);
assert.match(html, /id="walkthroughBtn"/);
assert.match(html, /id="walkthroughSettingsBtn"/);
assert.match(html, /id="walkthroughDialog"/);
assert.match(js, /showModal\(\)/);
assert.match(js, /async function renderNotifications\(\)/, 'notifications need a working renderer');
assert.match(js, /api\('\/api\/notifications'\)/, 'notifications renderer must load saved preferences');
assert.match(js, /WALKTHROUGH_STEPS = \[/);
assert.match(html, /id="notifStart" type="time"/);
assert.match(html, /id="notifEnd" type="time"/);
assert.match(css, /\.compact-form\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css, /\.settings-grid input, \.settings-grid select/);
assert.doesNotMatch(html, /🌲|🌱|🌳|🌿|🪴|🐿️|🐿/u);
console.log('UI contract tests passed');
