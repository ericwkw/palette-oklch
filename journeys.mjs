/* Journeys — drive the tool the way a designer would, with real clicks.
 *
 *   node journeys.mjs                     (defaults to http://localhost:8829/index.html)
 *   node journeys.mjs http://host/page    (any URL)
 *
 * Each journey is a sequence, not a state: the point is what happens next —
 * can the change be seen, undone, and lived with. Exit code 1 if any fail.
 */
import { spawn } from 'node:child_process';

const URL_ = process.argv[2] || 'http://localhost:8829/index.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9350 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/journeys-${Date.now()}`, '--hide-scrollbars', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
};
/* a real click: find the element, scroll it into view, press and release a mouse button there */
const click = async (selector, nth = 0) => {
  const box = await evalJs(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error(`no element for ${selector} [${nth}]`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  await sleep(260);
};
const setRange = async (id_, value) => {
  await evalJs(`(() => { const el = document.getElementById(${JSON.stringify(id_)});
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(260);
};
const type = async (id_, value) => {
  await evalJs(`(() => { const el = document.getElementById(${JSON.stringify(id_)});
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
};
const reset = async () => {
  await send('Page.navigate', { url: URL_ + (URL_.includes('?') ? '&' : '?') + 'j=' + Date.now() });
  await sleep(1400);
  await evalJs(`localStorage.removeItem('palette-studio-v1')`);
  await send('Page.navigate', { url: URL_ + (URL_.includes('?') ? '&' : '?') + 'j=' + Date.now() });
  await sleep(1400);
};

const results = [];
async function journey(name, fn) {
  await reset();
  const before = errors.length;
  try {
    await fn();
    const thrown = errors.slice(before);
    if (thrown.length) results.push([name, false, 'page error: ' + thrown[0].split('\n')[0]]);
    else results.push([name, true, '']);
  } catch (err) {
    results.push([name, false, err.message]);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* 1 — paste a brand colour, keep working, find the way back */
await journey('brand colour survives being worked around', async () => {
  await type('xMain', '#0075C9');
  let ramp = await evalJs(`[...document.querySelectorAll('#rampsLight .ramp')[0].querySelectorAll('.sw span')].map(s => s.textContent.replace(' ▲',''))`);
  assert(ramp.includes('#0075C9'), 'pasted colour is not in the ramp');
  await setRange('hMain', 95);
  const line = await evalJs(`document.getElementById('anMain').textContent`);
  assert(/moved off/.test(line), 'no warning after the ramp was moved away');
  await click('[data-restore]');
  ramp = await evalJs(`[...document.querySelectorAll('#rampsLight .ramp')[0].querySelectorAll('.sw span')].map(s => s.textContent.replace(' ▲',''))`);
  assert(ramp.includes('#0075C9'), 'could not get back to the brand colour');
});

/* 2 — the pin can be turned off and on again, by clicking it */
await journey('pin toggles with a real click', async () => {
  await type('xMain', '#0EBFAE');
  await click('#pinMain');
  let state = await evalJs(`({ checked: document.getElementById('pinMain').checked,
    exact: [...document.querySelectorAll('#rampsLight .ramp')[0].querySelectorAll('.sw span')].some(s => s.textContent.includes('#0EBFAE')) })`);
  assert(state.checked === false, 'the checkbox ticked itself back on');
  assert(state.exact === false, 'the exact colour stayed in the ramp after unpinning');
  await click('#pinMain');
  state = await evalJs(`({ checked: document.getElementById('pinMain').checked,
    exact: [...document.querySelectorAll('#rampsLight .ramp')[0].querySelectorAll('.sw span')].some(s => s.textContent.includes('#0EBFAE')) })`);
  assert(state.checked && state.exact, 'the exact colour did not come back');
});

/* 3 — every token mapping changes something you can see */
await journey('token mapping moves something on screen', async () => {
  await click('#tabs button', 1);
  const fields = await evalJs(`[...document.querySelectorAll('[data-map]')].map(s => s.id)`);
  assert(fields.length >= 6, 'token mapping controls are missing');
  for (const fieldId of fields) {
    const before = await evalJs(`document.getElementById('mapDemo').innerHTML + document.getElementById('outCss').textContent`);
    const changed = await evalJs(`(() => { const s = document.getElementById(${JSON.stringify(fieldId)});
      const other = [...s.options].find(o => o.value !== s.value); if (!other) return false;
      s.value = other.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(280);
    if (!changed) continue;
    const after = await evalJs(`document.getElementById('mapDemo').innerHTML + document.getElementById('outCss').textContent`);
    assert(before !== after, `${fieldId} changed nothing visible`);
  }
});

/* 4 — a step can be nudged by hand and put back */
await journey('a step can be nudged and reset', async () => {
  await click('#rampsLight .sw', 7);
  const open = await evalJs(`!document.getElementById('stepEditor').hidden`);
  assert(open, 'clicking a swatch did not open the editor');
  const before = await evalJs(`document.querySelectorAll('#rampsLight .sw')[7].style.background`);
  await setRange('edL', -0.06);
  const after = await evalJs(`document.querySelectorAll('#rampsLight .sw')[7].style.background`);
  assert(before !== after, 'the nudge did not change the swatch');
  const marked = await evalJs(`document.querySelectorAll('#rampsLight .sw.is-nudged').length`);
  assert(marked === 1, 'a nudged step is not marked');
  await click('#edReset');
  const back = await evalJs(`({ bg: document.querySelectorAll('#rampsLight .sw')[7].style.background,
    marks: document.querySelectorAll('#rampsLight .sw.is-nudged').length })`);
  assert(back.bg === before && back.marks === 0, 'reset did not undo the nudge');
});

/* 5 — the theme switch reaches every tab */
await journey('theme switch reaches every tab', async () => {
  const tabs = await evalJs(`[...document.querySelectorAll('#tabs button[data-view]')].map(b => b.dataset.view)`);
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i] === 'export') continue;              /* export always writes both themes */
    await click('#tabs button', i);
    await click('#themeSeg button', 1);              /* Dark */
    /* only what is actually on screen counts — hidden nodes are not a view */
    const themes = await evalJs(`[...document.querySelectorAll('section.view.on [data-theme]')]
      .filter(d => d.offsetParent !== null).map(d => d.dataset.theme)`);
    assert(themes.length > 0, `${tabs[i]} shows nothing for the dark theme`);
    assert(themes.every(t => t === 'dark'), `${tabs[i]} still shows light content in dark mode`);
    await click('#themeSeg button', 0);              /* back to Light */
  }
});

/* 6 — work survives a reload, and a file can be loaded back */
await journey('work survives a reload', async () => {
  await type('pName', 'Journey test');
  await type('xMain', '#7A3FE4');
  await setRange('sMain', 32);
  const before = await evalJs(`JSON.parse(localStorage.getItem('palette-studio-v1'))`);
  await send('Page.navigate', { url: URL_ + (URL_.includes('?') ? '&' : '?') + 'j=' + Date.now() });
  await sleep(1500);
  const after = await evalJs(`({ name: document.getElementById('pName').value,
    brand: document.getElementById('xMain').value,
    share: document.getElementById('sMain').value })`);
  assert(after.name === 'Journey test', 'the name was lost on reload');
  assert(after.brand.toUpperCase() === '#7A3FE4', 'the brand colour was lost on reload');
  assert(Math.round(+after.share) === Math.round(before.share.main), 'the shares were lost on reload');
});

/* 7 — the defaults do not ship failing their own contrast rules */
await journey('defaults pass their own contrast audit', async () => {
  await click('#tabs button', 2);
  for (const themeIdx of [0, 1]) {
    await click('#themeSeg button', themeIdx);
    const note = await evalJs(`document.querySelector('#ctTokens .cap').textContent`);
    assert(/clears its level/.test(note), `${themeIdx ? 'dark' : 'light'} defaults: ${note}`);
  }
});

const failed = results.filter(r => !r[1]);
console.log('');
results.forEach(([name, ok, why]) => console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${why ? ' — ' + why : ''}`));
console.log(`\n${results.length - failed.length}/${results.length} journeys passed`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
