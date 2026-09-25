/* Journeys — drive the tool the way a designer would, with real clicks.
 *
 *   node journeys.mjs                     (defaults to http://localhost:8829/index.html)
 *   node journeys.mjs http://host/page    (any URL)
 *
 * Each journey is a sequence, not a state: the point is what happens next —
 * can the change be seen, undone, and lived with. Exit code 1 if any fail.
 */
import { spawn } from 'node:child_process';

import { existsSync } from 'node:fs';
import { serve } from './serve.mjs';

/* Start our own server unless one was handed to us, so this runs anywhere Node
   does — including a CI box with nothing else installed. */
const SITE_PORT = Number(process.env.PORT || 8829);
const URL_ = process.argv[2] || `http://localhost:${SITE_PORT}/index.html`;
let ownServer = null;
if (!process.argv[2]) ownServer = await serve(SITE_PORT);

/* Chrome lives somewhere different on every machine */
const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(p => existsSync(p));
/* WebSocket became a global in Node 21; say so plainly rather than throwing
   a ReferenceError sixty lines later */
if (typeof WebSocket === 'undefined') {
  console.error(`This needs Node 22 or newer for its WebSocket; this is ${process.version}.`);
  process.exit(2);
}
if (!CHROME) {
  console.error('No Chrome found. Install one, or set CHROME=/path/to/chrome.');
  process.exit(2);
}
const PORT = 9350 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/journeys-${Date.now()}`, '--hide-scrollbars', '--window-size=1500,950', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
/* keep what Chrome says about itself; it is the only clue when it will not start */
let chromeSaid = '';
chrome.stderr.on('data', d => { chromeSaid += d.toString(); });
chrome.on('error', e => { chromeSaid += '\ncould not run ' + CHROME + ': ' + e.message; });

/* a cold CI box is slower to start a browser than a warm laptop */
let target;
for (let i = 0; i < 150; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch {}
  await sleep(200);
}
if (!target) {
  console.error(`Chrome never offered a page to drive on port ${PORT}, after 30 seconds.`);
  console.error(`Tried: ${CHROME}`);
  if (chromeSaid.trim()) console.error('Chrome said:\n' + chromeSaid.trim().split('\n').slice(-12).join('\n'));
  chrome.kill();
  process.exit(2);
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
  await evalJs(`localStorage.clear(); sessionStorage.clear()`);
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
/* the rail folds, so a section has to be open before its controls can be clicked */
const openSection = async (key) => {
  const needed = await evalJs(`!document.querySelector('fieldset[data-sec="${key}"]').hasAttribute('data-open')`);
  if (needed) await click(`fieldset[data-sec="${key}"] .sec-toggle`);
};

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
    const before = await evalJs(`document.getElementById('mapDemo').innerHTML`);
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

/* 8 — the hue turns along a ramp, in the right direction and not too far */
await journey('hue turns along the ramp, within bounds', async () => {
  const read = () => evalJs(`(() => {
    const rows = [...document.querySelectorAll('#rampsLight .ramp')];
    const label = i => rows[i].querySelector('.name small').textContent;
    const hues = i => [...rows[i].querySelectorAll('.sw')].map(sw => {
      const m = sw.title.match(/oklch\\([^ ]+ [^ ]+ ([0-9.]+)\\)/); return m ? parseFloat(m[1]) : null;
    });
    return { mainLabel: label(0), main: hues(0), warning: hues(6), neutral: hues(4) };
  })()`);

  let r = await read();
  const turn = arr => ((arr[arr.length - 1] - arr[0] + 540) % 360) - 180;
  assert(Math.abs(turn(r.main)) > 2, 'the main ramp holds a single hue');
  assert(Math.abs(turn(r.main)) < 40, 'the main ramp turns too far: ' + turn(r.main));
  assert(/turns/.test(r.mainLabel), 'the ramp label does not say how far it turns');
  assert(Math.abs(turn(r.neutral)) < 1, 'neutrals should not turn');

  /* a warning ramp sits in the yellows: its dark end must move toward orange, not green */
  assert(turn(r.warning) < 0, 'the yellow ramp turns the wrong way: ' + turn(r.warning));

  /* every step stays inside its own family */
  const spread = arr => Math.max(...arr) - Math.min(...arr);
  assert(spread(r.main) < 45, 'the main ramp leaves its hue family');

  /* zero holds one hue throughout */
  await setRange('cTwist', 0);
  r = await read();
  assert(Math.abs(turn(r.main)) < 0.6, 'hue turn did not switch off at zero');

  /* and the control scales it */
  await setRange('cTwist', 2);
  r = await read();
  assert(Math.abs(turn(r.main)) > 6, 'hue turn did not respond to the control');
});

/* 9 — the preview is dense enough to judge, and a mapping change moves it */
await journey('the preview shows every token and reacts to a mapping', async () => {
  await click('#tabs button', 5);
  const seen = () => evalJs(`[...document.querySelectorAll('#previewOut [data-token]')].map(el => el.dataset.token)`);
  const MUST = ['sidebar','sidebar-primary','sidebar-accent','primary','secondary','accent','destructive',
                'card','popover','input','ring','muted','muted-foreground','chart-1','chart-2','chart-3','chart-4','chart-5'];
  const have = await seen();
  for (const k of MUST) assert(have.includes(k), `the preview never uses ${k}`);

  /* the dense parts are there to be read, not implied */
  const parts = await evalJs(`(() => {
    const p = document.getElementById('previewOut');
    return { rows: p.querySelectorAll('.pv-table tbody tr').length,
             pills: [...p.querySelectorAll('.pv-pill')].map(x => x.dataset.func),
             bars: p.querySelectorAll('.pv-chart span').length,
             nav: p.querySelectorAll('.pv-nav').length,
             disabled: p.querySelectorAll('.pv-input[disabled]').length,
             sizes: [...new Set([...p.querySelectorAll('.pv-h1,.pv-p,.pv-small')].map(x => getComputedStyle(x).fontSize))].length };
  })()`);
  assert(parts.rows >= 6, 'the table is not dense enough');
  assert(new Set(parts.pills).size >= 6, 'the statuses do not cover the functional colours');
  assert(parts.bars === 5, 'the chart does not use all five chart tokens');
  assert(parts.nav >= 4, 'the sidebar has no navigation to mark active');
  assert(parts.disabled >= 1, 'no disabled field in the form');
  assert(parts.sizes === 3, 'text is not shown at three sizes');

  /* dark is a real second rendering, not the same colours */
  await click('#themeSeg button', 2);
  const both = await evalJs(`(() => {
    const p = [...document.querySelectorAll('#previewOut .preview')];
    return { n: p.length, bg: p.map(x => x.style.background) };
  })()`);
  assert(both.n === 2, 'Both does not show light and dark previews');
  assert(both.bg[0] !== both.bg[1], 'the dark preview uses the light background');

  /* moving the primary mapping repaints the primary button */
  await click('#themeSeg button', 0);
  const btn = () => evalJs(`document.querySelector('#previewOut [data-token="primary"]').style.background`);
  const before = await btn();
  await click('#tabs button', 1);                  /* the mapping lives on Roles & tokens */
  await evalJs(`(() => { const s = document.getElementById('map-primary');
    const other = [...s.options].find(o => o.value !== s.value);
    s.value = other.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await click('#tabs button', 5);                  /* back to the preview */
  assert(await btn() !== before, 'the primary mapping did not move the preview');
});

/* 10 — a palette can be kept, switched away from, and come back the same */
await journey('the library keeps palettes and switches between them', async () => {
  await openSection('name');
  await openSection('library');
  await type('pName', 'Harbour');
  await setRange('hMain', 200);
  await click('#btnLibSave');
  let state = await evalJs(`({ options: [...document.getElementById('libList').options].map(o => o.text),
                               meta: document.getElementById('libMeta').textContent })`);
  assert(state.options.includes('Harbour'), 'the palette was not kept');
  assert(/1 palette kept/.test(state.meta), 'the library line does not say what it holds: ' + state.meta);

  /* a second, clearly different palette */
  await type('pName', 'Ember');
  await setRange('hMain', 30);
  await click('#btnLibSave');
  state = await evalJs(`[...document.getElementById('libList').options].map(o => o.text)`);
  assert(state.includes('Harbour') && state.includes('Ember'), 'keeping a second palette lost the first');

  /* switching back brings its colours with it */
  await evalJs(`(() => { const s = document.getElementById('libList');
    s.value = [...s.options].find(o => o.text === 'Harbour').value;
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(320);
  let hue = await evalJs(`document.getElementById('hMain').value`);
  assert(hue === '200', 'switching back did not restore the hue, got ' + hue);

  /* changing it says so, rather than pretending it is still what you kept */
  await setRange('hMain', 120);
  let meta = await evalJs(`document.getElementById('libMeta').textContent`);
  assert(/changed since you kept it/.test(meta), 'the library did not notice the change: ' + meta);

  /* duplicate makes a separate copy under its own name */
  await click('#btnLibDup');
  state = await evalJs(`({ names: [...document.getElementById('libList').options].map(o => o.text),
                           name: document.getElementById('pName').value })`);
  assert(state.name === 'Harbour copy', 'the duplicate is not named as a copy: ' + state.name);
  assert(state.names.filter(n => /^Harbour/.test(n)).length === 2, 'the duplicate replaced the original');

  /* delete asks once, then removes only the saved copy */
  await click('#btnLibDel');
  const armed = await evalJs(`document.getElementById('btnLibDel').textContent`);
  assert(/for good/.test(armed), 'delete did not ask first');
  await click('#btnLibDel');
  state = await evalJs(`({ names: [...document.getElementById('libList').options].map(o => o.text),
                           hue: document.getElementById('hMain').value })`);
  assert(!state.names.includes('Harbour copy'), 'the copy was not deleted');
  assert(state.names.includes('Harbour') && state.names.includes('Ember'), 'delete took the wrong palettes');
  assert(state.hue === '120', 'deleting the saved copy also wiped the colours on screen');

  /* and the library survives a reload */
  await send('Page.navigate', { url: URL_ + '?r=' + Date.now() });
  await sleep(1500);
  state = await evalJs(`[...document.getElementById('libList').options].map(o => o.text)`);
  assert(state.includes('Harbour') && state.includes('Ember'), 'the library did not survive a reload');
});

/* 11 — changes can be walked back and forward, and a drag counts once */
await journey('undo and redo walk the last changes', async () => {
  let ui = await evalJs(`({ undo: document.getElementById('btnUndo').disabled,
                            redo: document.getElementById('btnRedo').disabled })`);
  assert(ui.undo && ui.redo, 'there is something to undo before anything happened');

  await setRange('hMain', 300);
  await sleep(600);
  await setRange('hMain', 40);
  await sleep(600);
  assert(await evalJs(`document.getElementById('hMain').value`) === '40', 'the hue did not move');

  await click('#btnUndo');
  assert(await evalJs(`document.getElementById('hMain').value`) === '300', 'undo did not go back one change');
  await click('#btnUndo');
  assert(await evalJs(`document.getElementById('hMain').value`) === '250', 'undo did not reach the start');
  ui = await evalJs(`document.getElementById('btnUndo').disabled`);
  assert(ui === true, 'undo is still offered at the start of history');

  await click('#btnRedo');
  assert(await evalJs(`document.getElementById('hMain').value`) === '300', 'redo did not come forward');

  /* the ramps really follow, not just the slider */
  const swatch = () => evalJs(`document.querySelectorAll('#rampsLight .ramp')[0].querySelectorAll('.sw span')[5].textContent`);
  const at300 = await swatch();
  await click('#btnUndo');
  assert(await swatch() !== at300, 'undo moved the control but not the colours');

  /* a new change after undoing drops the redo branch */
  await setRange('cMain', 0.24);
  ui = await evalJs(`document.getElementById('btnRedo').disabled`);
  assert(ui === true, 'redo still points at a branch that was written over');

  /* one drag is one change, not forty */
  const before = await evalJs(`document.getElementById('btnUndo').textContent`);
  for (const v of [100, 110, 120, 130, 140]) {
    await evalJs(`(() => { const el = document.getElementById('hMain'); el.value = '${v}';
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(60);
  }
  await sleep(600);
  await click('#btnUndo');
  assert(await evalJs(`document.getElementById('hMain').value`) !== '130', 'a drag left a step behind for every frame');

  /* and the keyboard does the same thing as the button */
  await setRange('cMain', 0.08);
  await sleep(600);
  const keyed = await evalJs(`document.getElementById('cMain').value`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 4 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 4 });
  await sleep(320);
  assert(await evalJs(`document.getElementById('cMain').value`) !== keyed, 'the keyboard shortcut did nothing');
});

/* 12 — a sister can be added, moved, and told apart from the parent */
await journey('a sister brand joins the family and stays distinct', async () => {
  await click('#tabs button', 6);
  let n = await evalJs(`document.querySelectorAll('#famList .card').length`);
  assert(n === 1, 'the family does not start at the parent alone');

  await click('#btnFamAdd');
  const state = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('#famList .card')];
    return { n: cards.length,
             hue: +document.querySelector('#famList [data-fam="h"]').value,
             parentHue: +document.getElementById('hMain').value,
             meta: document.getElementById('famMeta').textContent };
  })()`);
  assert(state.n === 2, 'adding a sister did not add a card');
  assert(/1 sister/.test(state.meta), 'the family line does not count the sister: ' + state.meta);
  const gap = h => { const d = Math.abs((h - state.parentHue + 360) % 360); return d > 180 ? 360 - d : d; };
  assert(gap(state.hue) >= 24, 'the new sister landed on top of the parent: ' + state.hue);

  /* it inherits the parent's neutrals and functional colours, and only those differ that should */
  const shared = await evalJs(`(() => {
    const css = document.getElementById('outFamily').textContent;
    const blocks = css.split('[data-brand=');
    const grab = (t, k) => (t.match(new RegExp('--' + k + ': ([^;]+);')) || [])[1];
    return { pBg: grab(blocks[0], 'background'), sBg: grab(blocks[1], 'background'),
             pDest: grab(blocks[0], 'destructive'), sDest: grab(blocks[1], 'destructive'),
             pPrim: grab(blocks[0], 'primary'), sPrim: grab(blocks[1], 'primary') };
  })()`);
  assert(shared.pBg && shared.sBg, 'the family export is missing a brand block');
  assert(shared.pBg === shared.sBg, 'the sister does not share the parent neutrals');
  assert(shared.pDest === shared.sDest, 'the sister does not share the functional colours');
  assert(shared.pPrim !== shared.sPrim, 'the sister has the same primary as the parent');

  /* moving it near the parent is called out rather than quietly allowed */
  await evalJs(`(() => { const el = document.querySelector('#famList [data-fam="h"]');
    el.value = String(+document.getElementById('hMain').value + 6);
    el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(320);
  let warn = await evalJs(`document.querySelectorAll('#famList .card')[1].innerHTML`);
  assert(/mistaken for each other/.test(warn), 'two brands 6° apart raised no warning');

  /* and landing on a functional hue is called out too */
  await evalJs(`(() => { const el = document.querySelector('#famList [data-fam="h"]');
    el.value = '27'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(320);
  warn = await evalJs(`document.querySelectorAll('#famList .card')[1].innerHTML`);
  assert(/spoken for/.test(warn), 'a sister sitting on Danger raised no warning');

  /* spacing them out clears it, and removing is undoable */
  await click('#shapeSeg button', 0);   /* spread them round the wheel */
  warn = await evalJs(`document.querySelectorAll('#famList .card')[1].innerHTML`);
  assert(!/mistaken for each other/.test(warn), 'spacing them evenly left them colliding');
  await click('[data-famdel]');
  assert(await evalJs(`document.querySelectorAll('#famList .card').length`) === 1, 'the sister was not removed');
  await click('#btnUndo');
  assert(await evalJs(`document.querySelectorAll('#famList .card').length`) === 2, 'undo did not bring the sister back');
});

/* 13 — every brand in the family reads as strongly as the parent */
await journey('the family holds its contrast parity', async () => {
  await click('#tabs button', 6);
  await click('#btnFamAdd');
  await click('#btnFamAdd');
  await click('#shapeSeg button', 0);   /* spread them round the wheel */
  const parity = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('#famParity tbody tr')];
    return rows.map(r => [...r.children].map(c => c.textContent.trim()));
  })()`);
  assert(parity.length === 3, 'the parity table does not cover every brand');
  assert(/measured against/.test(parity[0][3]), 'the parent is not the reference row');
  for (const row of parity.slice(1)) {
    const onFill = parseFloat(row[2]);
    assert(onFill >= 4.5, `${row[0]} cannot carry its own label: ${row[2]}`);
  }

  /* a sister pushed pale is reported, not passed */
  await evalJs(`(() => { const el = document.querySelector('#famList [data-fam="c"]');
    el.value = '0.02'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(340);
  const after = await evalJs(`[...document.querySelectorAll('#famParity tbody tr')].map(r => r.lastElementChild.textContent.trim())`);
  assert(after.length === 3, 'the parity table lost a row');

  /* every brand can be looked at, one at a time */
  const chooser = await evalJs(`[...document.querySelectorAll('#famStrip [data-showbrand]')].length`);
  assert(chooser === 3, 'the family strip cannot reach every brand: ' + chooser);
});

/* 14 — the image check measures the region you point at, by percentile */
await journey('the scrim check follows the caption box and ignores one glint', async () => {
  await click('#tabs button', 3);

  /* a test image made on the spot: dark left half, bright right half,
     and a single white pixel in the dark half to stand for a glint */
  const loaded = await evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#101418'; g.fillRect(0, 0, 170, 160);
    g.fillStyle = '#EFF3F7'; g.fillRect(170, 0, 70, 160);
    g.fillStyle = '#ffffff'; g.fillRect(20, 120, 1, 1);          /* the glint */
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'test.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('imgIn');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert(loaded, 'the test image was not handed to the tool');
  await sleep(700);

  const shot = await evalJs(`!!document.getElementById('region')`);
  assert(shot, 'no caption box appeared over the image');

  /* the box starts over the dark part: one glint must not drive the recommendation */
  const read = () => evalJs(`(() => {
    const rows = [...document.querySelectorAll('#scrimStats tbody tr')].map(r => [...r.children].map(c => c.textContent.trim()));
    return { rows, cap: document.querySelector('#scrimOut .cap').textContent };
  })()`);
  let r = await read();
  assert(r.rows.length === 3, 'the percentile table is missing');
  assert(/95th percentile/.test(r.rows[1][0]), 'there is no 95th percentile row');
  const p95 = parseInt(r.rows[1][2], 10), brightest = parseInt(r.rows[2][2], 10);
  assert(brightest > p95, 'the brightest pixel asks no more than the 95th percentile — percentiles are not being used');
  assert(/95%/.test(r.cap), 'the recommendation does not say what it covers: ' + r.cap);
  assert(/single brightest/.test(r.cap), 'the recommendation does not set the glint apart: ' + r.cap);

  /* drag the box across to the bright half: it must ask for much more scrim */
  const drag = async (toX) => {
    await evalJs(`document.getElementById('shot').scrollIntoView({ block: 'center' })`);
    await sleep(200);
    const geom = await evalJs(`(() => { const s = document.getElementById('shot').getBoundingClientRect();
      const b = document.getElementById('region').getBoundingClientRect();
      return { sx: s.left, sw: s.width, bx: b.left + b.width / 2, by: b.top + b.height / 2 }; })()`);
    const targetX = geom.sx + geom.sw * toX;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geom.bx, y: geom.by, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: geom.by, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: geom.by, button: 'left' });
    await sleep(400);
  };
  await drag(0.72);
  const after = await read();
  const movedTo = parseInt(after.rows[1][2], 10);
  assert(movedTo > p95 + 10, `the box moved onto the bright half but the scrim barely changed: ${p95}% then ${movedTo}%`);

  /* the box on screen wears the scrim it recommends */
  const worn = await evalJs(`document.getElementById('region').style.background`);
  assert(/rgba\(0, ?0, ?0, ?0?\.[0-9]+\)/.test(worn), 'the box does not show the scrim it recommends: ' + worn);

  /* and the five sample tiles say which of them clear it */
  const tiles = await evalJs(`[...document.querySelectorAll('#scrimOut figcaption')].map(f => f.textContent.trim())`);
  assert(tiles.length === 5, 'the scrim tiles are missing');
  assert(tiles.some(t => /too light/.test(t)), 'no tile is reported as too light over a bright picture');
});

/* 15 — every export is usable, and the link brings the palette with it */
await journey('the exports parse and the link round-trips', async () => {
  await type('pName', 'Harbour');
  await type('xMain', '#0075C9');
  await click('#tabs button', 7);

  /* the shadcn stylesheet carries every token name a shadcn project expects */
  const SHADCN = ['background','foreground','card','card-foreground','popover','popover-foreground',
    'primary','primary-foreground','secondary','secondary-foreground','muted','muted-foreground',
    'accent','accent-foreground','destructive','destructive-foreground','border','input','ring',
    'chart-1','chart-2','chart-3','chart-4','chart-5','sidebar','sidebar-foreground',
    'sidebar-primary','sidebar-primary-foreground','sidebar-accent','sidebar-accent-foreground',
    'sidebar-border','sidebar-ring'];
  const css = await evalJs(`document.getElementById('outCss').textContent`);
  for (const t of SHADCN) {
    assert(css.includes('  --' + t + ': '), `globals.css is missing --${t}`);
  }
  assert(/\.dark \{/.test(css), 'globals.css has no .dark block');
  assert((css.match(/oklch\(/g) || []).length > 60, 'the stylesheet is not in OKLCH');

  /* the browser itself is the parser: every declared colour must be a colour it accepts */
  const bad = await evalJs(`(() => {
    const css = document.getElementById('outCss').textContent;
    const el = document.createElement('div');
    const out = [];
    for (const [, name, value] of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
      if (!/^(oklch|#|rgb)/.test(value.trim())) continue;
      el.style.color = '';
      el.style.color = value.trim();
      if (!el.style.color) out.push(name + ': ' + value.trim());
    }
    return out;
  })()`);
  assert(bad.length === 0, 'the browser rejects these values: ' + bad.slice(0, 3).join(' | '));

  /* Tailwind v4, then v3 */
  let tw = await evalJs(`document.getElementById('outTw').textContent`);
  assert(/@theme inline \{/.test(tw), 'the v4 export has no @theme block');
  assert(/--color-primary: var\(--primary\);/.test(tw), 'the v4 export does not map the tokens');
  assert(/--color-main-500:/.test(tw), 'the v4 export does not carry the ramps');
  await click('#twSeg button', 1);
  tw = await evalJs(`document.getElementById('outTw').textContent`);
  assert(/module\.exports/.test(tw), 'the v3 export is not a config file');
  const v3ok = await evalJs(`(() => { const src = document.getElementById('outTw').textContent;
    const module = { exports: {} };
    try { new Function('module', 'exports', src)(module, module.exports); }
    catch (e) { return 'threw: ' + e.message; }
    const c = module.exports.theme.extend.colors;
    if (!c.primary) return 'no primary';
    if (!c.main || !c.main['500']) return 'no ramp steps';
    if (c['muted-foreground'] !== 'var(--muted-foreground)') return 'semantics do not point at the variables';
    return true; })()`);
  assert(v3ok === true, 'the v3 config does not run: ' + v3ok);

  /* Figma variables: real JSON, two modes, a hex per mode */
  const fig = await evalJs(`(() => { try {
      const d = JSON.parse(document.getElementById('outFigma').textContent);
      const sem = d.variables.filter(v => v.name.startsWith('semantic/'));
      const ramp = d.variables.filter(v => v.name.startsWith('ramp/'));
      const brand = d.variables.filter(v => v.name.startsWith('brand/'));
      const badHex = d.variables.filter(v => !/^#[0-9A-F]{6}$/.test(v.valuesByMode.Light) || !/^#[0-9A-F]{6}$/.test(v.valuesByMode.Dark));
      const differs = sem.filter(v => v.valuesByMode.Light !== v.valuesByMode.Dark).length;
      return { modes: d.modes, sem: sem.length, ramp: ramp.length, brand: brand.length, badHex: badHex.length, differs };
    } catch (e) { return 'not JSON: ' + e.message; } })()`);
  assert(typeof fig === 'object', String(fig));
  assert(fig.modes.join() === 'Light,Dark', 'the Figma export has the wrong modes: ' + fig.modes);
  assert(fig.sem === 32, 'the Figma export is missing semantic variables: ' + fig.sem);
  assert(fig.ramp === 121, 'the Figma export is missing ramp steps: ' + fig.ramp);
  assert(fig.brand === 1, 'the pasted brand colour is not exported as a variable');
  assert(fig.badHex === 0, fig.badHex + ' Figma values are not plain hex');
  assert(fig.differs > 10, 'the two Figma modes hold the same colours');

  /* the sheet is drawn, and is not a blank rectangle */
  const sheet = await evalJs(`(() => {
    const c = document.getElementById('sheet');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return { w: c.width, h: c.height, colours: seen.size };
  })()`);
  assert(sheet.w > 800 && sheet.h > 400, 'the sheet is the wrong size: ' + sheet.w + 'x' + sheet.h);
  assert(sheet.colours > 40, 'the sheet is nearly blank: ' + sheet.colours + ' colours');

  /* the link carries the whole palette, and loading it brings the palette back */
  const link = await evalJs(`document.getElementById('outLink').textContent`);
  assert(/#(z|j)=/.test(link), 'the link carries no palette: ' + link);
  assert(link.length < 4000, 'the link is too long to send: ' + link.length);

  await send('Page.navigate', { url: link });
  await sleep(1800);
  const back = await evalJs(`({ name: document.getElementById('pName').value,
                                hue: document.getElementById('hMain').value,
                                brand: document.getElementById('xMain').value,
                                hash: location.hash })`);
  assert(back.name === 'Harbour', 'the link lost the name: ' + back.name);
  assert(back.brand.toUpperCase() === '#0075C9', 'the link lost the brand colour: ' + back.brand);
  assert(back.hash === '', 'the link was not cleared from the address bar after loading');
});

/* 16 — the words are explained where they are used */
await journey('every unfamiliar word can be looked up', async () => {
  const terms = await evalJs(`[...document.querySelectorAll('.term')].map(b => b.dataset.term)`);
  assert(terms.length >= 6, 'the rail explains almost nothing: ' + terms.length + ' terms');

  await click('.term', 0);
  let g = await evalJs(`({ open: document.getElementById('gloss').open,
                           lit: (document.querySelector('#glossList .lit') || {}).id,
                           entries: document.querySelectorAll('#glossList dt').length })`);
  assert(g.open, 'the glossary did not open');
  assert(g.entries >= 12, 'the glossary is thin: ' + g.entries + ' entries');
  assert(g.lit === 'gloss-' + terms[0], 'the glossary did not land on the word that was asked about');

  /* every question mark in the rail has an entry behind it */
  const missing = await evalJs(`(() => {
    const ids = new Set([...document.querySelectorAll('#glossList > div')].map(d => d.id.replace('gloss-', '')));
    return [...document.querySelectorAll('.term')].map(b => b.dataset.term).filter(t => !ids.has(t));
  })()`);
  assert(missing.length === 0, 'these have no glossary entry: ' + missing.join(', '));

  /* and it closes again */
  await click('#glossClose');
  g = await evalJs(`document.getElementById('gloss').open`);
  assert(g === false, 'the glossary would not close');

  /* the jargon is not the label: the control says what it does */
  const labels = await evalJs(`[...document.querySelectorAll('.rail label')].map(l => l.textContent.trim().replace(/\\?$/, '').trim())`);
  for (const jargon of ['Chroma', 'Falloff', 'Twist', 'Gamut', 'Luminance']) {
    assert(!labels.includes(jargon), `the rail still calls a control “${jargon}”`);
  }
});

/* 17 — it stays usable with a family of ten brands */
await journey('ten brands and the tool still moves', async () => {
  await click('#tabs button', 6);
  for (let i = 0; i < 9; i++) await click('#btnFamAdd');
  await click('#shapeSeg button', 0);   /* spread them round the wheel */
  const n = await evalJs(`document.querySelectorAll('#famList .card').length`);
  assert(n === 10, 'the family did not reach ten brands: ' + n);

  /* a slider drag on the busiest view */
  const timeOn = async () => evalJs(`(() => {
    const el = document.getElementById('hMain');
    const t0 = performance.now();
    for (let i = 0; i < 6; i++) {
      el.value = String(200 + i * 5);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return Math.round(performance.now() - t0);
  })()`);
  const heavy = await timeOn();

  /* the same drag from the ramps tab, where the ten previews are not on screen */
  await click('#tabs button', 0);
  const light = await timeOn();
  assert(light < heavy, `leaving a view does not save any work: ${light}ms on ramps vs ${heavy}ms on family`);
  assert(light < 1400, `six slider steps take ${light}ms with ten brands — too slow to drag`);

  /* and the view left behind is brought up to date when you go back to it */
  await evalJs(`(() => { const el = document.getElementById('hMain'); el.value = '12';
    el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  await click('#tabs button', 6);
  const shown = await evalJs(`document.querySelector('#famList .card .muted.mono').textContent`);
  assert(/^12°/.test(shown), 'the family view was stale when it came back: ' + shown);

  /* every brand can still be reached, and the one chosen draws */
  const reach = await evalJs(`(() => ({ chooser: document.querySelectorAll('#famStrip [data-showbrand]').length,
    drawn: document.querySelectorAll('#famStrip .preview').length }))()`);
  assert(reach.chooser === 10, 'not every brand can be chosen: ' + reach.chooser);
  assert(reach.drawn >= 1, 'no brand is drawn at all');
});

/* 18 — a pinned brand colour is followed all the way into the interface */
await journey('the tool says whether the brand colour reaches the interface', async () => {
  await type('xSup', '#F4A300');          /* lands mid-ramp, where no token reads */
  await click('#tabs button', 1);

  let state = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('#brandReach > div')];
    return rows.map(r => ({ text: r.textContent, pill: (r.querySelector('.pill') || {}).textContent }));
  })()`);
  assert(state.length === 1, 'the brand reach check found the wrong number of pinned colours: ' + state.length);
  assert(state[0].pill === 'never appears', 'a colour no token uses is reported as reaching the interface');
  assert(/step 400/.test(state[0].text), 'the check does not say which step it landed on');

  /* the rail says the same thing, where the colour was pasted */
  const rail = await evalJs(`document.getElementById('anSup').textContent`);
  assert(/no token uses it/.test(rail), 'the rail does not warn that the colour is unused: ' + rail);

  /* and the offer is real: take it, and the colour is in the stylesheet as a token */
  await click('#brandReach [data-fixmap]');
  state = await evalJs(`(() => {
    const r = document.querySelector('#brandReach > div:nth-child(1)');
    return { pill: r.querySelector('.pill').textContent, text: r.textContent };
  })()`);
  assert(state.pill === 'reaches the interface', 'taking the offer did not make the colour reach anything');
  assert(/secondary/.test(state.text), 'the check does not name the token now using it: ' + state.text);

  await click('#tabs button', 7);
  const inCss = await evalJs(`(() => { const css = document.getElementById('outCss').textContent;
    const body = css.slice(css.indexOf(':root {', css.indexOf('--sup-50')));
    return /oklch/.test(body); })()`);
  assert(inCss, 'the stylesheet did not rebuild');
  const secondary = await evalJs(`(() => { const css = document.getElementById('outCss').textContent;
    const m = css.match(/--secondary: ([^;]+);/); return m ? m[1] : null; })()`);
  const step = await evalJs(`document.getElementById('map-tint').value`);
  assert(step === '400', 'the tint mapping did not move to the brand step: ' + step);
  assert(secondary, 'the stylesheet has no --secondary');
});

/* 19 — a failing pair names itself and can be fixed from where it is reported */
await journey('a failing contrast pair offers the fix that mends it', async () => {
  await click('#tabs button', 1);
  /* push the chart series pale enough to fail against the page */
  await evalJs(`(() => { const s = document.getElementById('map-chart');
    s.value = '400'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await click('#tabs button', 2);

  let audit = await evalJs(`(() => {
    const cap = document.querySelector('#ctTokens .cap');
    const fails = [...document.querySelectorAll('#ctTokens tr.row-fail')].map(r => r.textContent);
    const offer = document.querySelector('#ctTokens tr.row-fail [data-fixmap]');
    return { cap: cap.textContent, fails: fails.length,
             named: /chart-1/.test(cap.textContent),
             offer: offer ? offer.textContent : null };
  })()`);
  assert(audit.fails > 0, 'a pale chart series against the page is reported as passing');
  assert(audit.named, 'the summary does not name what fell short: ' + audit.cap);
  assert(audit.offer && /step/.test(audit.offer), 'the failing row offers no way out: ' + audit.offer);

  await click('#ctTokens tr.row-fail [data-fixmap]');
  audit = await evalJs(`(() => ({ cap: document.querySelector('#ctTokens .cap').textContent,
                                  fails: document.querySelectorAll('#ctTokens tr.row-fail').length }))()`);
  assert(audit.fails === 0, 'taking the offered step did not clear the failure');
  assert(/clears its level/.test(audit.cap), 'the summary still reports a failure: ' + audit.cap);

  /* and the mapping control moved with it, rather than the fix being invisible */
  await click('#tabs button', 1);
  const chart = await evalJs(`document.getElementById('map-chart').value`);
  assert(chart !== '400', 'the chart mapping did not move: ' + chart);

  /* the chart tokens are mappable at all — the audit cannot flag what it cannot fix */
  const fields = await evalJs(`[...document.querySelectorAll('[data-map]')].map(s => s.dataset.map)`);
  assert(fields.includes('chart') && fields.includes('chartDark'), 'the chart tokens have no mapping control');
});

/* 20 — the share sliders are checked against what is actually drawn */
await journey('share of surface is measured, not merely declared', async () => {
  await click('#tabs button', 5);
  const rows = await evalJs(`[...document.querySelectorAll('#previewShare tbody tr')]
    .map(r => [...r.children].map(c => c.textContent.trim()))`);
  assert(rows.length === 5, 'the share check does not cover every role: ' + rows.length);
  const asked = rows.map(r => parseInt(r[1], 10)), drawn = rows.map(r => parseInt(r[2], 10));
  assert(asked.reduce((a, b) => a + b, 0) === 100, 'the targets do not add up: ' + asked.join(','));
  const sum = drawn.reduce((a, b) => a + b, 0);
  assert(sum > 95 && sum < 105, 'the measured shares do not add up: ' + sum);

  /* it is a measurement, so it must disagree with the target when the target is wrong */
  assert(rows.some(r => /over by|under by/.test(r[3])), 'every role is reported as on target, which is not a measurement');

  /* and it must follow the preview: more neutral surface, more neutral measured */
  const neutralBefore = drawn[0];
  await click('#tabs button', 1);                  /* the mapping lives on Roles & tokens */
  await evalJs(`(() => { const s = document.getElementById('map-tint');
    s.value = '50'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await click('#tabs button', 5);
  const after = await evalJs(`[...document.querySelectorAll('#previewShare tbody tr')]
    .map(r => parseInt(r.children[2].textContent, 10))`);
  assert(after.reduce((a, b) => a + b, 0) > 95, 'the measurement broke after a mapping change');
  assert(typeof neutralBefore === 'number', 'nothing was measured the first time');

  /* the preview no longer claims a share it is not drawing */
  const claim = await evalJs(`document.getElementById('previewOut').textContent`);
  assert(!/% main/.test(claim), 'the preview still prints a share it does not draw');
});

/* 21 — state colours can be moved, and are checked against the brand */
await journey('state colours can be moved off the brand', async () => {
  await type('xMain', '#0B6E4F');          /* a green brand, next to a green Success */
  await click('#tabs button', 1);

  let state = await evalJs(`({ cap: document.querySelector('#funcTable .cap').textContent,
                               rows: [...document.querySelectorAll('#funcTable tr.row-fail td:first-child b')].map(b => b.textContent),
                               hues: [...document.querySelectorAll('#funcTable input[data-fx="h"]')].map(i => +i.value) })`);
  assert(state.hues.length === 6, 'the state colours have no controls: ' + state.hues.length);
  assert(state.rows.length > 0, 'a green brand beside six fixed states raises nothing: ' + state.cap);
  assert(/mistaken for it/.test(state.cap), 'the summary does not say what is wrong: ' + state.cap);

  /* moving one by hand is possible, and is reflected everywhere the hue is used */
  await evalJs(`(() => { const i = document.querySelector('#funcTable input[data-fx="h"]');
    i.value = '300'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  let moved = await evalJs(`(() => {
    const i = document.querySelector('#funcTable input[data-fx="h"]');
    const ramp = [...document.querySelectorAll('#rampsLight .ramp')][5];
    return { control: +i.value, label: ramp.querySelector('.name small').textContent,
             reset: !!document.querySelector('#funcTable [data-fxreset]') };
  })()`);
  assert(moved.control === 300, 'the control did not take the new hue');
  assert(/^30[01]/.test(moved.label.trim()), 'the Success ramp did not follow its control: ' + moved.label);
  assert(moved.reset, 'a moved state colour offers no way back to its default');

  /* and back */
  await click('#funcTable [data-fxreset]');
  moved = await evalJs(`+document.querySelector('#funcTable input[data-fx="h"]').value`);
  assert(moved === 145, 'the default was not restored: ' + moved);

  /* the one-click version clears what it can without changing what a colour means */
  await setRange('hSup', 300);            /* put Supporting somewhere that leaves room */
  await sleep(400);
  const before = await evalJs(`document.querySelectorAll('#funcTable tr.row-fail').length`);
  assert(before > 0, 'a green brand beside the default states raises nothing to clear');
  await click('#btnFuncClear');
  state = await evalJs(`({ cap: document.querySelector('#funcTable .cap').textContent,
                           rows: document.querySelectorAll('#funcTable tr.row-fail').length,
                           names: [...document.querySelectorAll('#funcTable tr.row-fail td:first-child b')].map(b => b.textContent),
                           hues: [...document.querySelectorAll('#funcTable input[data-fx="h"]')].map(i => +i.value) })`);
  assert(state.rows < before, `moving them off the brand cleared nothing: ${before} then ${state.rows}`);
  assert(new Set(state.hues).size === 6, 'two state colours ended on the same hue');
  /* nothing travels so far that it stops meaning what it means */
  const DEFAULTS_H = [145, 75, 27, 235, 295, 185];
  state.hues.forEach((h, i) => {
    const d = Math.abs(((h - DEFAULTS_H[i] + 540) % 360) - 180);
    assert(d <= 45, `a state colour moved ${Math.round(d)}° from its meaning`);
  });
  /* and whatever could not be freed is named rather than quietly left */
  if (state.rows > 0) {
    assert(state.names.every(n => state.cap.includes(n)), 'a remaining collision is not named: ' + state.cap);
  } else {
    assert(/far enough/.test(state.cap), 'the summary still reports a collision: ' + state.cap);
  }

  /* the moved hues survive a reload, and the export carries them */
  await click('#tabs button', 7);
  const css = await evalJs(`document.getElementById('outCss').textContent`);
  assert(/--success-500:/.test(css), 'the state ramps are missing from the export');
  await click('#tabs button', 1);
  await click('#btnFuncReset');
  const back = await evalJs(`[...document.querySelectorAll('#funcTable input[data-fx="h"]')].map(i => +i.value).join(',')`);
  assert(back === '145,85,25,220,310,185', 'Back to defaults did not restore every state colour: ' + back);
});

/* 22 — the rail folds, undo says what it undoes, the ramps show colour first,
        and the tabs have an order */
await journey('the tool is possible to get around', async () => {
  /* the rail arrives folded, so the whole of it is reachable */
  let rail = await evalJs(`(() => {
    const secs = [...document.querySelectorAll('fieldset[data-sec]')];
    return { total: secs.length,
             open: secs.filter(f => f.hasAttribute('data-open')).map(f => f.dataset.sec),
             summaries: secs.filter(f => !f.hasAttribute('data-open'))
               .map(f => f.querySelector('.sec-sum').textContent.trim()).filter(Boolean).length,
             railHeight: document.querySelector('.rail').scrollHeight };
  })()`);
  assert(rail.total >= 10, 'the rail lost its sections');
  assert(rail.open.length < rail.total, 'every section is open, so nothing was folded');
  const undoAlways = await evalJs(`(() => { const b = document.getElementById('btnUndo');
    return !!b && b.offsetParent !== null && !!b.closest('.quickbar'); })()`);
  assert(undoAlways, 'undo is not where it can always be reached');
  assert(rail.summaries >= 5, 'a folded section says nothing about what is inside it');

  /* folding is remembered across a reload */
  await click('fieldset[data-sec="shape"] .sec-toggle');
  let open = await evalJs(`document.querySelector('fieldset[data-sec="shape"]').hasAttribute('data-open')`);
  assert(open, 'the section did not open');
  await send('Page.navigate', { url: URL_ + '?f=' + Date.now() });
  await sleep(1500);
  open = await evalJs(`document.querySelector('fieldset[data-sec="shape"]').hasAttribute('data-open')`);
  assert(open, 'what was open was forgotten on reload');

  /* undo names the change rather than counting it */
  await setRange('hMain', 300);
  await sleep(600);
  let undo = await evalJs(`({ text: document.getElementById('btnUndo').textContent,
                              title: document.getElementById('btnUndo').title })`);
  assert(/hue/.test(undo.text), 'undo does not say what it would undo: ' + undo.text);
  await openSection('library');
  await click('#btnLibSave');
  await sleep(200);
  await click('#tabs button', 6);
  await click('#btnFamAdd');
  undo = await evalJs(`document.getElementById('btnUndo').textContent`);
  assert(/sister/.test(undo), 'undo does not name the last action: ' + undo);
  await click('#btnUndo');
  const redo = await evalJs(`document.getElementById('btnRedo').textContent`);
  assert(/sister/.test(redo), 'redo does not name what it would put back: ' + redo);

  /* the ramps lead with colour: the values are there but not shouting */
  await click('#tabs button', 0);
  let sw = await evalJs(`(() => {
    const s = document.querySelectorAll('#rampsLight .sw')[3];
    const cs = getComputedStyle(s.querySelector('span'));
    return { opacity: +cs.opacity, text: s.querySelector('span').textContent };
  })()`);
  assert(/^#/.test(sw.text), 'the value is gone from the markup, not merely quiet');
  assert(sw.opacity < 0.2, 'every hex is still shouting at full strength: ' + sw.opacity);
  await click('#showValues');
  sw = await evalJs(`+getComputedStyle(document.querySelectorAll('#rampsLight .sw')[3].querySelector('span')).opacity`);
  assert(sw > 0.5, 'the show-every-value switch does nothing: ' + sw);

  /* the work has an order, it reflects the state, and it goes somewhere */
  const steps = await evalJs(`[...document.querySelectorAll('#steps li')].map(li => ({
    cls: li.className, title: li.querySelector('.t').textContent, note: li.querySelector('.s').textContent.trim() }))`);
  assert(steps.length >= 4, 'there is still no suggested order: ' + steps.length);
  assert(/picture|look at|hex|chosen/.test(steps[0].note),
    'step one does not offer a way in: ' + steps[0].note);
  assert(!/^\u2192 paste a brand hex$/.test(steps[0].note),
    'step one still demands a commitment before offering anything: ' + steps[0].note);
  await type('xMain', '#0075C9');
  const after = await evalJs(`[...document.querySelectorAll('#steps li')].map(li => li.className)`);
  assert(after[0] === 'done', 'pasting a brand colour did not tick the first step');
  await click('#steps [data-goto="contrast"]');
  const view = await evalJs(`document.querySelector('section.view.on').dataset.view`);
  assert(view === 'contrast', 'a step does not take you to the tab that does it: ' + view);
});

/* 23 — the tool is held to the standard it holds your palette to */
await journey('the tool passes its own audit, in both themes', async () => {
  const measure = () => evalJs(`(() => {
    const hex = s => { const m = s.match(/([0-9]+), *([0-9]+), *([0-9]+)/);
      return m ? '#' + [1,2,3].map(i => (+m[i]).toString(16).padStart(2,'0')).join('') : null; };
    const bgOf = el => { let n = el; while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba[(]0, 0, 0, 0[)]/.test(c) && c !== 'transparent') return hex(c);
      n = n.parentElement; } return '#ffffff'; };
    const out = [];
    const sel = '.rail .hint, .sec-toggle, .sec-sum, #steps .s, .cap, .note, .muted, label, legend';
    [...document.querySelectorAll(sel)].forEach(el => {
      if (!el.textContent.trim() || el.offsetParent === null) return;
      const fg = hex(getComputedStyle(el).color), bg = bgOf(el);
      if (!fg || !bg) return;
      out.push({ what: el.className || el.tagName.toLowerCase(), fg, bg, r: +wcag(fg, bg).toFixed(2) });
    });
    return out;
  })()`);

  for (const [idx, name] of [[0, 'light'], [1, 'dark']]) {
    await click('#themeSeg button', idx);
    const rows = await measure();
    assert(rows.length > 8, `nothing measurable in ${name}: ${rows.length}`);
    const short = rows.filter(r => r.r < 4.5);
    assert(short.length === 0,
      `${name}: the tool's own text falls short — ` +
      short.slice(0, 3).map(r => `${r.what} ${r.fg} on ${r.bg} = ${r.r}`).join('; '));
  }
  await click('#themeSeg button', 0);

  /* the red it warns you with must itself be readable */
  const status = await evalJs(`(() => {
    const cs = getComputedStyle(document.documentElement);
    const hex = s => { const m = s.match(/([0-9]+), *([0-9]+), *([0-9]+)/);
      return m ? '#' + [1,2,3].map(i => (+m[i]).toString(16).padStart(2,'0')).join('') : s.trim(); };
    const panel = hex(getComputedStyle(document.querySelector('.rail')).backgroundColor);
    return { bad: wcag(cs.getPropertyValue('--bad').trim(), panel),
             ok:  wcag(cs.getPropertyValue('--ok').trim(), panel) };
  })()`);
  assert(status.bad >= 4.5, 'the warning colour is less readable than what it warns about: ' + status.bad.toFixed(2));
  assert(status.ok >= 4.5, 'the all-clear colour falls short: ' + status.ok.toFixed(2));
});

/* 24 — the defaults arrive clean */
await journey('a palette you have not touched passes its own checks', async () => {
  await click('#tabs button', 1);
  const states = await evalJs(`({ cap: document.querySelector('#funcTable .cap').textContent,
                                  rows: document.querySelectorAll('#funcTable tr.row-fail').length })`);
  assert(states.rows === 0, 'the shipped state colours clash with the shipped brand colours: ' + states.cap);

  await click('#tabs button', 2);
  for (const idx of [0, 1]) {
    await click('#themeSeg button', idx);
    const cap = await evalJs(`document.querySelector('#ctTokens .cap').textContent`);
    assert(/clears its level/.test(cap), `${idx ? 'dark' : 'light'} defaults fall short: ${cap}`);
  }
  await click('#themeSeg button', 0);

  const steps = await evalJs(`[...document.querySelectorAll('#steps li')].map(li => li.className)`);
  assert(!steps.includes('warn'), 'an untouched palette is already accusing you of something');
});

/* 25 — colour vision is checked, not assumed */
await journey('states that collapse for a colour-blind eye are found', async () => {
  await click('#tabs button', 2);
  const normal = await evalJs(`document.querySelector('#cvdOut .cap').textContent`);
  assert(/stays apart|come together/.test(normal), 'the colour-vision panel says nothing: ' + normal);

  await click('#cvdSeg button', 1);                 /* deuteranopia */
  const deut = await evalJs(`({ cap: document.querySelector('#cvdOut .cap').textContent,
                                rows: [...document.querySelectorAll('#cvdOut tbody tr')].map(r => r.children[0].textContent),
                                worst: [...document.querySelectorAll('#cvdOut tbody tr')]
                                  .map(r => [r.children[0].textContent, +r.children[1].textContent, +r.children[2].textContent])[0] })`);
  assert(deut.rows.length > 0, 'success and danger survive deuteranopia untouched, which is not true');
  assert(/Success/.test(deut.rows.join(' ')) && /Danger/.test(deut.rows.join(' ')),
    'the green and the red are not reported as colliding: ' + deut.rows.join(' | '));
  assert(deut.worst[1] > deut.worst[2] * 3,
    `the pair is not reported as much closer than it is normally: ${deut.worst[1]} then ${deut.worst[2]}`);
  assert(/shape|icon|word/.test(deut.cap), 'the panel does not say what to do about it: ' + deut.cap);

  /* the preview goes through the same eye */
  await click('#tabs button', 5);
  const filtered = await evalJs(`({ filter: document.querySelector('#previewOut .preview').style.filter,
                                    note: document.getElementById('cvdPreviewNote').textContent })`);
  assert(/cvd-deuter/.test(filtered.filter), 'the preview is not shown through the same eye: ' + filtered.filter);
  assert(/deuteranopia/i.test(filtered.note), 'nothing says the preview is being simulated: ' + filtered.note);

  /* and back to normal */
  await click('#tabs button', 2);
  await click('#cvdSeg button', 0);
  await click('#tabs button', 5);
  const back = await evalJs(`document.querySelector('#previewOut .preview').style.filter`);
  assert(!back, 'the simulation would not switch off: ' + back);
});

/* 26 — a keyboard reaches what a mouse reaches */
await journey('the ramps can be used without a mouse', async () => {
  const sw = await evalJs(`(() => { const s = document.querySelector('#rampsLight .sw');
    return { tabindex: s.getAttribute('tabindex'), role: s.getAttribute('role'), label: s.getAttribute('aria-label') }; })()`);
  assert(sw.tabindex === '0', 'a swatch cannot be reached by keyboard');
  assert(sw.role === 'button', 'a swatch does not announce itself as something you can press');
  assert(/step [0-9]+/.test(sw.label) && /#[0-9A-F]{6}/.test(sw.label), 'a swatch does not say what it is: ' + sw.label);

  /* Enter on a focused swatch opens the editor, as a click does */
  await evalJs(`document.querySelectorAll('#rampsLight .sw')[4].focus()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(400);
  const editor = await evalJs(`(() => { const e = document.getElementById('stepEditor');
    return { open: !!e.innerHTML.trim(), said: document.getElementById('say').textContent }; })()`);
  assert(editor.open, 'Enter on a swatch does nothing');
  assert(/Editing/.test(editor.said), 'nothing is announced when the editor opens: ' + editor.said);

  /* the tabs describe themselves as tabs */
  const aria = await evalJs(`(() => { const t = document.getElementById('tabs');
    const b = t.querySelector('button');
    const panel = document.getElementById(b.getAttribute('aria-controls'));
    return { list: t.getAttribute('role'), tab: b.getAttribute('role'),
             panel: panel && panel.getAttribute('role') }; })()`);
  assert(aria.list === 'tablist' && aria.tab === 'tab' && aria.panel === 'tabpanel',
    'the tabs are not announced as tabs: ' + JSON.stringify(aria));

  /* there is a focus style of the tool's own */
  const focusStyled = await evalJs(`[...document.styleSheets[0].cssRules].some(r => /focus-visible/.test(r.cssText || ''))`);
  assert(focusStyled, 'nothing in the tool says what focus looks like');
});

/* 27 — the small print reads like English, P3 is honest, and the tabs fit */
await journey('what the tool says about itself is true and readable', async () => {
  /* the gradient note is a sentence, and it agrees with the colours it describes */
  await click('#tabs button', 4);
  const notes = await evalJs(`[...document.querySelectorAll('#gradOut .card')].map(c => {
    const hints = [...c.querySelectorAll('.hint')].map(h => h.textContent.trim());
    return hints[hints.length - 1];
  })`);
  assert(notes.length >= 4, 'the gradients are missing');
  for (const n of notes) {
    assert(/^White text (holds|fails)/.test(n), 'the gradient note is not a sentence: ' + n);
    assert(!/: /.test(n), 'the gradient note is still a list of fragments: ' + n);
    assert(!/the light end the dark end/.test(n), 'the old broken phrasing is back: ' + n);
    if (/then/.test(n)) assert(/[0-9]+% of the band/.test(n), 'a partial pass does not say where it turns: ' + n);
  }

  /* Display P3: the export says what it could not carry, rather than quietly clipping */
  await click('#tabs button', 7);
  const figma = await evalJs(`(() => { const d = JSON.parse(document.getElementById('outFigma').textContent);
    return { space: d.space, note: d.note, wide: d.variables.filter(v => v.outsideSrgb).length }; })()`);
  assert(figma.space === 'srgb', 'the export does not say which space it is in: ' + figma.space);
  assert(/exact/.test(figma.note), 'the sRGB export does not say the hex is exact: ' + figma.note);
  assert(figma.wide === 0, 'values are marked as outside sRGB while working in sRGB');

  await evalJs(`(() => { const g = document.getElementById('gamut');
    g.value = 'p3'; g.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  await click('#tabs button', 7);
  const p3 = await evalJs(`(() => { const d = JSON.parse(document.getElementById('outFigma').textContent);
    const one = d.variables.filter(v => v.outsideSrgb)[0];
    return { space: d.space, note: d.note, wide: d.variables.filter(v => v.outsideSrgb).length,
             carries: one ? /oklch/.test(one.oklch.Light) : false,
             hexStill: one ? /^#[0-9A-F]{6}$/.test(one.valuesByMode.Light) : false,
             card: document.getElementById('figmaNote').textContent }; })()`);
  assert(p3.space === 'display-p3', 'the P3 export still claims sRGB');
  assert(p3.wide > 0, 'no value is marked as outside sRGB in a P3 palette');
  assert(/closest sRGB/.test(p3.note), 'the export does not say what happens to the wide values: ' + p3.note);
  assert(p3.carries, 'the wide value does not travel beside the hex');
  assert(p3.hexStill, 'the hex was replaced, which no importer would read');
  assert(/Display P3/.test(p3.card), 'the card says nothing about the clipping: ' + p3.card);

  /* the tab bar fits on one line on an ordinary laptop */
  for (const w of [1280, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 820, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const bar = await evalJs(`(() => { const t = document.getElementById('tabs');
      const kids = [...t.children].filter(c => c.offsetParent !== null);
      const tops = new Set(kids.map(c => Math.round(c.getBoundingClientRect().top)));
      return { rows: tops.size, height: t.offsetHeight }; })()`);
    assert(bar.rows === 1, `the tabs wrap onto ${bar.rows} rows at ${w}px`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });

  /* and the controls that moved out of the bar are still there and still work */
  const moved = await evalJs(`({ theme: !!document.querySelector('.rail #themeSeg'),
                                 words: !!document.querySelector('.rail #btnGloss') })`);
  assert(moved.theme && moved.words, 'the theme switch and the glossary went missing: ' + JSON.stringify(moved));
  await click('#themeSeg button', 1);
  const dark = await evalJs(`document.documentElement.getAttribute('data-ui')`);
  assert(dark === 'dark', 'the theme switch stopped working after moving: ' + dark);
});

/* 28 — two tabs do not write over each other, and a bad save cannot blank the tool */
await journey('two tabs keep their own work', async () => {
  await type('pName', 'Tab A work');
  await setRange('hMain', 210);
  await sleep(500);

  /* a second tab, writing its own palette to the shared key */
  await evalJs(`(() => {
    const other = { name: 'Tab B work', main: { h: 99, c: 0.2, brand: null, pin: true } };
    localStorage.setItem('palette-studio-v1', JSON.stringify(other));
    window.dispatchEvent(new StorageEvent('storage', { key: 'palette-studio-v1',
      newValue: JSON.stringify(other) }));
  })()`);
  await sleep(400);

  const held = await evalJs(`({ name: document.getElementById('pName').value,
                                hue: document.getElementById('hMain').value,
                                said: document.getElementById('notice').hidden ? '' : document.getElementById('notice').textContent })`);
  assert(held.name === 'Tab A work', 'another tab took this one over: ' + held.name);
  assert(held.hue === '210', 'another tab moved this one’s hue: ' + held.hue);
  assert(/own palette/.test(held.said), 'nothing said another tab was at work: ' + held.said);

  /* and a reload keeps this tab's own work, not the other one's */
  await send('Page.navigate', { url: URL_ + '?t=' + Date.now() });
  await sleep(1600);
  const after = await evalJs(`({ name: document.getElementById('pName').value,
                                 hue: document.getElementById('hMain').value })`);
  assert(after.name === 'Tab A work', 'this tab lost its work on reload: ' + after.name);
  assert(after.hue === '210', 'this tab lost its hue on reload: ' + after.hue);

  /* a fresh tab, with no working copy of its own, starts from what was last left */
  await evalJs(`sessionStorage.clear()`);
  await send('Page.navigate', { url: URL_ + '?t2=' + Date.now() });
  await sleep(1600);
  const fresh = await evalJs(`document.getElementById('pName').value`);
  assert(fresh === 'Tab A work', 'a new tab does not start from the last palette left: ' + fresh);
});

await journey('a broken saved palette never leaves a blank tool', async () => {
  const cases = [
    ['{not json at all', 'could not be read'],
    [JSON.stringify({ main: { h: 'banana', c: null }, name: 42 }), null],
    [JSON.stringify({ main: { h: 200, c: 0.1 }, map: { primary: 'x' }, share: 'no',
                      family: { sisters: 'lots' }, nudges: { main: 5 } }), null]
  ];
  for (const [payload, expect] of cases) {
    await evalJs(`sessionStorage.setItem('palette-tab-v1', ${JSON.stringify(payload)})`);
    await send('Page.navigate', { url: URL_ + '?b=' + Date.now() });
    await sleep(1600);
    const state = await evalJs(`({ swatches: document.querySelectorAll('#rampsLight .sw').length,
                                   hue: document.getElementById('hMain').value,
                                   notice: document.getElementById('notice').hidden ? '' : document.getElementById('notice').textContent })`);
    assert(state.swatches === 121, `a bad save left ${state.swatches} swatches on screen`);
    assert(/^[0-9]+$/.test(state.hue), 'a bad save left a control with no value: ' + state.hue);
    if (expect) assert(state.notice.includes(expect), 'nothing was said about the unreadable save: ' + state.notice);
    else assert(/set back to the default/.test(state.notice),
      'values were quietly replaced with no word about it: ' + state.notice);
  }

  /* a palette from a version that knows more than this one still opens */
  await evalJs(`sessionStorage.setItem('palette-tab-v1', JSON.stringify({
    name: 'From the future', main: { h: 12, c: 0.2 }, somethingNew: { deep: [1,2,3] },
    shape: { peak: 99, falloff: -5, gamut: 'quantum' } }))`);
  await send('Page.navigate', { url: URL_ + '?v=' + Date.now() });
  await sleep(1600);
  const future = await evalJs(`({ name: document.getElementById('pName').value,
                                  hue: document.getElementById('hMain').value,
                                  peak: document.getElementById('cPeak').value,
                                  gamut: document.getElementById('gamut').value,
                                  swatches: document.querySelectorAll('#rampsLight .sw').length })`);
  assert(future.name === 'From the future', 'what could be read was thrown away: ' + future.name);
  assert(future.hue === '12', 'a good value was lost with the bad ones');
  assert(+future.peak <= 10 && +future.peak >= 0, 'an out-of-range value survived: ' + future.peak);
  assert(future.gamut === 'srgb', 'an unknown gamut was accepted: ' + future.gamut);
  assert(future.swatches === 121, 'the tool did not draw');
});

/* 29 — the peak control says what it delivers */
await journey('the strongest step is the one the control reports', async () => {
  const peakOf = () => evalJs(`(() => {
    const sw = [...document.querySelectorAll('#rampsLight .ramp')[0].querySelectorAll('.sw')];
    const C = sw.map(s => { const m = s.title.match(/oklch[(][0-9.]+% ([0-9.]+)/); return m ? +m[1] : 0; });
    const at = C.indexOf(Math.max(...C));
    return { step: [50,100,200,300,400,500,600,700,800,900,950][at],
             says: +document.getElementById('ocPeak').textContent,
             note: document.getElementById('peakNote').textContent }; })()`);

  for (const v of [2, 6, 9]) {
    await setRange('cPeak', v);
    await sleep(350);
    const p = await peakOf();
    assert(p.says === p.step, `the control says ${p.says} but the strongest step is ${p.step}`);
    const asked = [50,100,200,300,400,500,600,700,800,900,950][v];
    if (p.step !== asked) {
      assert(/cannot hold that much colour/.test(p.note),
        `the control quietly delivered ${p.step} instead of ${asked}: "${p.note}"`);
      assert(p.note.includes(String(asked)) && p.note.includes(String(p.step)),
        'the note does not say what was asked for and what was delivered: ' + p.note);
    } else {
      assert(p.note === '', 'a note appeared when the ask was met: ' + p.note);
    }
  }
});

/* 31 — how the steps are spaced is visible, and it is a choice */
await journey('step spacing is shown, and can be changed', async () => {
  const read = () => evalJs(`(() => {
    const sw = [...document.querySelectorAll('#rampsLight .ramp')[4].querySelectorAll('.sw')]
      .map(s => s.querySelector('span').textContent.replace(' ▲','').trim());
    const ratios = [], gaps = [];
    for (let i = 1; i < sw.length; i++) ratios.push(+wcag(sw[i-1], sw[i]).toFixed(3));
    document.getElementById('gapsLight').querySelectorAll('span').forEach((s, i) => {
      if (i > 0) gaps.push(parseFloat(s.textContent));
    });
    return { ratios, gaps, note: document.getElementById('spacingNote').textContent,
             tight: document.querySelectorAll('#gapsLight .tight').length,
             strip: document.getElementById('gapsLight').textContent }; })()`);

  /* the default curve is uneven, and the tool now says so instead of implying otherwise */
  let d = await read();
  assert(d.gaps.length === 10, 'the gaps between steps are not shown: ' + d.gaps.length);
  const spread = Math.max(...d.gaps) / Math.min(...d.gaps);
  assert(spread > 2, 'the default curve looks even, which it is not: ' + spread.toFixed(2));
  assert(/Tailwind/.test(d.note) && /close together/.test(d.note),
    'the rail does not explain the default spacing: ' + d.note);
  assert(d.tight > 0, 'the steps that are nearly the same colour are not marked');
  assert(/Step spacing/.test(d.strip), 'the strip does not say where to change it');

  /* even lightness: equal gaps all the way down */
  await evalJs(`(() => { const s = document.getElementById('spacing');
    s.value = 'even'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  d = await read();
  const evenSpread = Math.max(...d.gaps) / Math.min(...d.gaps);
  assert(evenSpread < 1.05, 'even spacing is not even: ' + evenSpread.toFixed(3));
  assert(/same distance in lightness/.test(d.note), 'the note did not follow the choice: ' + d.note);
  assert(d.tight === 0, 'even spacing still marks steps as too close');

  /* even contrast: every neighbouring pair at the same ratio */
  await evalJs(`(() => { const s = document.getElementById('spacing');
    s.value = 'contrast'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  d = await read();
  const lo = Math.min(...d.ratios), hi = Math.max(...d.ratios);
  assert(hi - lo < 0.05, `contrast spacing is not even: ${lo} to ${hi}`);
  assert(lo > 1.2, 'contrast spacing left neighbours indistinguishable: ' + lo);
  assert(/same contrast/.test(d.note), 'the note did not follow the choice: ' + d.note);

  /* the choice survives a reload and reaches the export */
  await send('Page.navigate', { url: URL_ + '?sp=' + Date.now() });
  await sleep(1600);
  const kept = await evalJs(`document.getElementById('spacing').value`);
  assert(kept === 'contrast', 'the spacing was forgotten on reload: ' + kept);
  await click('#tabs button', 7);
  const css = await evalJs(`document.getElementById('outCss').textContent`);
  const ls = [...css.matchAll(/--neutral-[0-9]+: oklch[(]([0-9.]+)%/g)].map(m => +m[1]);
  assert(ls.length === 11, 'the neutral ramp is not in the export');
  const stepGaps = ls.slice(1).map((v, i) => +(ls[i] - v).toFixed(2));
  assert(Math.max(...stepGaps) / Math.min(...stepGaps) < 1.6,
    'the export still carries the old spacing: ' + stepGaps.join(', '));
});

/* 32 — a nudge says what it did to its neighbours */
await journey('the step editor reports the gaps a nudge creates', async () => {
  await click('#rampsLight .sw', 5);
  let ed = await evalJs(`document.getElementById('stepEditor').textContent`);
  assert(/in keeping with the rest/.test(ed), 'an untouched step is not reported as normal: ' + ed);

  /* push it most of the way to its lighter neighbour */
  await setRange('edL', 0.06);
  await sleep(400);
  ed = await evalJs(`(() => { const box = document.getElementById('stepEditor');
    return { text: box.textContent,
             pills: [...box.querySelectorAll('.pill')].map(p => p.className + ' ' + p.textContent) }; })()`);
  assert(ed.pills.length === 2, 'the editor does not report both neighbours: ' + ed.pills.length);
  assert(/points/.test(ed.pills[0]) && /:1/.test(ed.pills[0]),
    'the editor does not give the gap and the contrast: ' + ed.pills[0]);
  assert(/much wider|the same colour/.test(ed.text),
    'a lopsided ramp is reported as fine: ' + ed.text);
  assert(ed.pills.some(p => /fail|mid/.test(p)), 'neither neighbour is flagged after a big nudge');

  /* and putting it back clears the warning */
  await click('#edReset');
  await sleep(400);
  ed = await evalJs(`document.getElementById('stepEditor').textContent`);
  assert(/in keeping with the rest/.test(ed), 'the warning survived the reset: ' + ed);
});

/* 33 — looking costs nothing: candidates change the palette only when taken */
await journey('six candidates can be looked at before anything changes', async () => {
  const before = await evalJs(`({ hue: document.getElementById('hMain').value,
                                  css: document.getElementById('outCss') ? 1 : 1 })`);
  await click('#btnCandShow');
  let strip = await evalJs(`(() => ({ n: document.querySelectorAll('[data-cand]').length,
    hue: document.getElementById('hMain').value,
    hues: [...document.querySelectorAll('[data-cand] .cand-meta b')].map(b => parseInt(b.textContent, 10)),
    swatches: document.querySelectorAll('[data-cand] .cand-strip span').length }))()`);
  assert(strip.n === 6, 'six candidates were not offered: ' + strip.n);
  assert(strip.hue === before.hue, 'merely looking changed the palette: ' + strip.hue);
  assert(strip.swatches === 30, 'a candidate does not show a whole palette: ' + strip.swatches);
  assert(new Set(strip.hues).size >= 5, 'the candidates are nearly the same: ' + strip.hues.join(','));

  /* none of them sits on a state colour */
  const STATE = [145, 85, 25, 220, 310, 185];
  for (const h of strip.hues) {
    const near = STATE.some(f => { const d = Math.abs(((h - f + 540) % 360) - 180); return d < 20; });
    assert(!near, `a candidate at ${h}° sits on a state colour`);
  }

  /* taking one changes the palette, and it can be walked back */
  const chosen = strip.hues[2];
  await click('[data-cand]', 2);
  let after = await evalJs(`({ hue: +document.getElementById('hMain').value,
                               undo: document.getElementById('btnUndo').textContent,
                               stripGone: document.getElementById('candsOut').innerHTML === '' })`);
  assert(Math.abs(after.hue - chosen) < 2, `taking a candidate gave ${after.hue}, not ${chosen}`);
  assert(/suggestion/.test(after.undo), 'taking a candidate cannot be undone by name: ' + after.undo);
  assert(after.stripGone, 'the candidates stayed on screen after one was taken');
  await click('#btnUndo');
  after = await evalJs(`document.getElementById('hMain').value`);
  assert(after === before.hue, 'undo did not put the old palette back: ' + after);

  /* another six are different ones */
  await click('#btnCandShow');
  const firstSet = await evalJs(`[...document.querySelectorAll('[data-cand] .cand-meta b')].map(b => b.textContent).join()`);
  await click('#btnCandMore');
  const secondSet = await evalJs(`[...document.querySelectorAll('[data-cand] .cand-meta b')].map(b => b.textContent).join()`);
  assert(firstSet !== secondSet, 'More gave the same six back');
  await click('#btnCandClose');
  assert(await evalJs(`document.getElementById('candsOut').innerHTML === ''`), 'the strip would not close');
});

/* 34 — the family can be handled on a wheel, shaped, and given real colours */
await journey('a family can be explored rather than typed', async () => {
  await click('#tabs button', 6);
  await click('#btnFamSuggest');
  const sibs = await evalJs(`[...document.querySelectorAll('[data-sibling] .cand-meta b')].map(b => parseInt(b.textContent, 10))`);
  assert(sibs.length === 3, 'three siblings were not offered: ' + sibs.length);
  assert(new Set(sibs).size === 3, 'the same sibling was offered twice: ' + sibs.join(','));
  const parentHue = +(await evalJs(`document.getElementById('hMain').value`));
  const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  for (const h of sibs) assert(gap(h, parentHue) >= 26, `a suggested sibling at ${h}° is on top of the parent`);

  await click('[data-sibling]', 0);
  assert(await evalJs(`document.querySelectorAll('#famList .card').length`) === 2, 'taking a sibling did not add it');

  /* the wheel shows every brand, and a dot can be dragged */
  await click('#btnFamAdd');
  let wheel = await evalJs(`(() => ({ dots: document.querySelectorAll('#famWheel [data-wheel]').length,
    labels: document.querySelectorAll('#famWheel .wlabel').length,
    states: document.querySelectorAll('#famWheel path title').length }))()`);
  assert(wheel.dots === 3, 'the wheel does not show every brand: ' + wheel.dots);
  assert(wheel.labels === 3, 'the dots are not labelled: ' + wheel.labels);
  assert(wheel.states === 6, 'the wheel does not show what the states have taken: ' + wheel.states);

  await evalJs(`document.getElementById('famWheel').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  const geo = await evalJs(`(() => { const g = document.querySelectorAll('#famWheel [data-wheel]')[1];
    const r = g.getBoundingClientRect(), s = document.getElementById('famWheel').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2,
             cx: s.left + s.width / 2, cy: s.top + s.height / 2, w: s.width }; })()`);
  const wasHue = await evalJs(`document.querySelector('#famList [data-fam="h"]').value`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.x, y: geo.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.cx + geo.w * 0.18, y: geo.cy + geo.w * 0.10, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.cx + geo.w * 0.18, y: geo.cy + geo.w * 0.10, button: 'left' });
  await sleep(500);
  const nowHue = await evalJs(`document.querySelector('#famList [data-fam="h"]').value`);
  assert(nowHue !== wasHue, 'dragging the wheel did not move the sister: ' + nowHue);
  assert(/hue/.test(await evalJs(`document.getElementById('btnUndo').textContent`)), 'a wheel drag cannot be undone by name');

  /* the shapes are different arrangements, and none lands on the parent or a state */
  await click('#btnFamAdd');
  await click('#btnFamAdd');
  const arrange = async (i) => {
    await click('#shapeSeg button', i);
    return evalJs(`[...document.querySelectorAll('#famList [data-fam="h"]')].map(x => +x.value)`);
  };
  const shapes = [];
  for (const i of [0, 1, 2, 3]) shapes.push(await arrange(i));
  const STATE = [145, 85, 25, 220, 310, 185];
  shapes.forEach((hues, i) => {
    hues.forEach(h => {
      assert(gap(h, parentHue) >= 24, `shape ${i} put a sister ${Math.round(gap(h, parentHue))}° from the parent`);
      STATE.forEach(f => assert(gap(h, f) >= 18, `shape ${i} put a sister on a state colour at ${h}°`));
    });
    hues.forEach((h, a) => hues.forEach((k, b) => {
      if (a < b) assert(gap(h, k) >= 20, `shape ${i} put two sisters ${Math.round(gap(h, k))}° apart`);
    }));
  });
  assert(new Set(shapes.map(x => x.join())).size >= 3, 'the shapes all arrange the family the same way');

  /* a sister takes a brand hex and a purpose, and keeps its selector when renamed */
  await evalJs(`(() => { const i = document.querySelector('#famList [data-fam="hex"]');
    i.value = '#B5123E'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  let sis = await evalJs(`(() => ({ hue: +document.querySelector('#famList [data-fam="h"]').value,
    card: document.querySelectorAll('#famList .card')[1].textContent,
    ring: document.querySelectorAll('#famWheel [data-wheel]')[1].innerHTML })) ()`);
  assert(/pinned into this sister/.test(sis.card), 'the pasted colour is not reported as pinned');
  assert(/stroke=/.test(sis.ring), 'the wheel does not mark a pasted brand colour');

  await evalJs(`(() => { const i = document.querySelector('#famList [data-fam="note"]');
    i.value = 'the further-education arm'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await evalJs(`(() => { const i = document.querySelector('#famList [data-fam="name"]');
    i.value = 'Coastal'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  await click('#tabs button', 6);
  const css = await evalJs(`document.getElementById('outFamily').textContent`);
  assert(/\[data-brand="sister-1"\]/.test(css), 'renaming moved the selector a stylesheet keys on');
  assert(/Coastal/.test(css) && /further-education arm/.test(css), 'the export does not carry the name or the purpose');
  assert(/--main-brand: #b5123e/.test(css), 'the sister’s own brand colour is not exported');
});

/* 35 — a picture is a place to start, and the shelf catches what you replace */
await journey('colours can be taken from a picture', async () => {
  await click('#btnPickOpen');
  /* a picture with four clear colours and a grey ground */
  await evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e9ec'; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#14532d'; g.fillRect(0, 0, 160, 100);
    g.fillStyle = '#d97706'; g.fillRect(160, 0, 160, 100);
    g.fillStyle = '#1d4ed8'; g.fillRect(0, 100, 110, 100);
    g.fillStyle = '#be123c'; g.fillRect(110, 100, 90, 100);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    const f = new File([b], 'p.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    const i = document.getElementById('pickIn'); i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
  await sleep(900);

  const found = await evalJs(`(() => ({
    n: document.querySelectorAll('[data-pick]').length,
    hues: [...document.querySelectorAll('[data-pick] .cand-meta b')].map(b => b.textContent),
    shares: [...document.querySelectorAll('[data-pick] .cand-meta span')].map(s => s.textContent) }))()`);
  assert(found.n >= 4, 'the picture gave up fewer colours than it has: ' + found.n);
  assert(found.hues.includes('grey'), 'the grey ground of the picture was not offered');
  assert(found.shares.some(t => /% of the picture/.test(t)), 'the colours do not say how much of the picture they are');
  /* the four blocks are a quarter each, so the shares must be in that region */
  const pct = found.shares.map(t => parseInt(t, 10)).filter(n => !isNaN(n));
  assert(Math.max(...pct) < 45, 'the shares do not add up to a picture: ' + pct.join(','));

  /* taking one sets the role and keeps the exact hex */
  const before = await evalJs(`document.getElementById('hMain').value`);
  await click('[data-pick]', 0);
  await click('[data-pickuse="main"]');
  const after = await evalJs(`({ hue: document.getElementById('hMain').value,
                                 hex: document.getElementById('xMain').value,
                                 undo: document.getElementById('btnUndo').textContent })`);
  assert(after.hue !== before, 'taking a colour from the picture changed nothing');
  assert(/^#[0-9A-F]{6}$/.test(after.hex), 'the exact colour was not kept: ' + after.hex);
  assert(/from the picture/.test(after.undo), 'it cannot be undone by name: ' + after.undo);

  /* and it can seed six palettes rather than being taken whole */
  await click('[data-pickbuild]');
  const seeded = await evalJs(`[...document.querySelectorAll('[data-cand] .cand-meta b')].map(b => parseInt(b.textContent, 10))`);
  assert(seeded.length === 6, 'the picture did not seed six palettes: ' + seeded.length);
  const src = parseInt(after.hue, 10);
  const near = seeded.filter(h => { const d = Math.abs(((h - src + 540) % 360) - 180); return d < 30; });
  assert(near.length >= 4, 'the six ignore the colour they were seeded from: ' + seeded.join(','));
});

await journey('the shelf catches what gets replaced', async () => {
  await click('#btnShelfToggle');
  await setRange('hMain', 111);
  await sleep(500);
  let shelf = await evalJs(`document.querySelectorAll('[data-shelf]').length`);
  assert(shelf === 0, 'the shelf starts with something on it: ' + shelf);

  /* taking a suggestion puts the old palette on the shelf */
  await click('#btnCandShow');
  await click('[data-cand]', 0);
  await sleep(400);
  let state = await evalJs(`({ shelf: document.querySelectorAll('[data-shelf]').length,
                               hue: document.getElementById('hMain').value })`);
  assert(state.shelf === 1, 'the palette that was replaced was not caught: ' + state.shelf);
  assert(state.hue !== '111', 'the suggestion was not taken');

  /* and clicking it puts it back */
  await click('[data-shelf]');
  await sleep(500);
  state = await evalJs(`({ hue: document.getElementById('hMain').value,
                           shelf: document.querySelectorAll('[data-shelf]').length,
                           undo: document.getElementById('btnUndo').textContent })`);
  assert(state.hue === '111', 'the shelved palette did not come back: ' + state.hue);
  assert(state.shelf === 2, 'taking one off the shelf did not leave the other one there: ' + state.shelf);
  assert(/shelf/.test(state.undo), 'it cannot be undone by name: ' + state.undo);

  /* a reset is caught too, and one can be put there by hand */
  await click('#btnReset');
  await sleep(400);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 3, 'a reset threw the palette away');
  await click('#btnShelve');
  await sleep(300);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 4, 'putting one there by hand did nothing');
  /* the same thing twice is not two things */
  await click('#btnShelve');
  await sleep(300);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 4, 'the shelf filled up with the same palette');

  /* one can be dropped — it asks first — and the shelf survives a reload */
  await click('[data-shelfdrop]');
  await click('[data-shelfdrop]');
  await sleep(300);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 3, 'dropping one did nothing');
  await send('Page.navigate', { url: URL_ + '?sh=' + Date.now() });
  await sleep(1600);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 3, 'the shelf did not survive a reload');
  await click('#btnShelfClear');
  await click('#btnShelfClear');
  await sleep(300);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 0, 'the shelf would not clear');
});

/* 37 — the tool opens on its subject, and the ways in stay out of the way */
await journey('the ramps are the first thing on the page', async () => {
  const cold = await evalJs(`(() => {
    const ramps = document.getElementById('rampsLight');
    const cards = [...document.querySelectorAll('#view-ramps .card')].filter(c => c.offsetParent !== null);
    return { top: Math.round(ramps.getBoundingClientRect().top),
             viewport: window.innerHeight,
             cardsAbove: cards.filter(c => c.getBoundingClientRect().top < ramps.getBoundingClientRect().top).length,
             talkingEmpties: cards.filter(c => /nothing on it yet|Drop a photograph/.test(c.textContent)).length,
             band: document.querySelectorAll('.explore button').length }; })()`);
  assert(cold.top < cold.viewport / 2, `the ramps start ${cold.top}px down a ${cold.viewport}px screen`);
  assert(cold.cardsAbove <= 1, cold.cardsAbove + ' cards stand between the page and its subject');
  assert(cold.talkingEmpties === 0, 'an empty panel is lecturing before anything has been done');
  assert(cold.band >= 2, 'the ways in are gone rather than folded: ' + cold.band);

  /* each way in opens on its own, and only one at a time */
  await click('#btnCandShow');
  let band = await evalJs(`({ six: !document.getElementById('candsOut').hidden,
                              pic: !document.getElementById('pickDrop').hidden })`);
  assert(band.six && !band.pic, 'opening the suggestions did not open them alone');
  await click('#btnPickOpen');
  band = await evalJs(`({ six: !document.getElementById('candsOut').hidden,
                          pic: !document.getElementById('pickDrop').hidden })`);
  assert(band.pic && !band.six, 'two panels are open at once');
  await click('#btnPickOpen');
  assert(await evalJs(`document.getElementById('pickDrop').hidden`), 'the panel would not close again');

  /* one verb: the blind randomiser is gone */
  const verbs = await evalJs(`[...document.querySelectorAll('button')].map(b => b.textContent.trim())
    .filter(t => /surprise|shuffle/i.test(t))`);
  assert(verbs.length === 0, 'there is still a second word for the same idea: ' + verbs.join(', '));

  /* the shelf is reachable from every tab, with its count on the button */
  const tabs = await evalJs(`[...document.querySelectorAll('#tabs button')].length`);
  for (let i = 0; i < tabs; i++) {
    await click('#tabs button', i);
    const reach = await evalJs(`(() => { const b = document.getElementById('btnShelfToggle');
      return b && b.offsetParent !== null; })()`);
    assert(reach, 'the shelf cannot be reached from tab ' + i);
  }
  await click('#tabs button', 0);
  await click('#btnShelfToggle');            /* the panel holds the button that puts one there */
  await click('#btnShelve');
  const label = await evalJs(`document.getElementById('btnShelfToggle').textContent`);
  assert(/\(1\)/.test(label), 'the button does not say what is on the shelf: ' + label);
});

/* 38 — one picture serves both jobs, and reaches the sisters */
await journey('a picture loaded once is used everywhere', async () => {
  await click('#btnPickOpen');
  await evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 180;
    const g = c.getContext('2d');
    g.fillStyle = '#0f766e'; g.fillRect(0, 0, 150, 180);
    g.fillStyle = '#f59e0b'; g.fillRect(150, 0, 150, 180);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    const f = new File([b], 'one.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    const i = document.getElementById('pickIn'); i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
  await sleep(1000);
  assert(await evalJs(`document.querySelectorAll('[data-pick]').length >= 2`), 'the picture gave up no colours');

  /* the same picture is already loaded for the scrim check on another tab */
  await click('#tabs button', 3);
  const scrim = await evalJs(`(() => ({ box: !!document.getElementById('region'),
    stats: document.querySelectorAll('#scrimStats tbody tr').length })) ()`);
  assert(scrim.box, 'the picture was not handed to the scrim check as well');
  assert(scrim.stats === 3, 'the scrim check did not measure the same picture');

  /* and its colours are offered to a sister, not only to the parent */
  await click('#tabs button', 6);
  await click('#btnFamAdd');
  const dots = await evalJs(`document.querySelectorAll('#famList [data-sisterpick]').length`);
  assert(dots >= 2, 'the picture’s colours are not offered to a sister: ' + dots);
  const was = await evalJs(`document.querySelector('#famList [data-fam="h"]').value`);
  await click('[data-sisterpick]');
  const now = await evalJs(`({ hue: document.querySelector('#famList [data-fam="h"]').value,
                               hex: document.querySelector('#famList [data-fam="hex"]').value,
                               undo: document.getElementById('btnUndo').textContent })`);
  assert(now.hue !== was, 'giving a sister a colour from the picture did nothing');
  assert(/^#[0-9A-F]{6}$/.test(now.hex), 'the sister did not keep the exact colour: ' + now.hex);
  assert(/from the picture/.test(now.undo), 'it cannot be undone by name: ' + now.undo);
});

/* 39 — a family stays workable as it grows */
await journey('a family of six is not ten screens of scrolling', async () => {
  await click('#tabs button', 6);
  const height = () => evalJs(`Math.round(document.getElementById('view-family').scrollHeight)`);
  const one = await height();
  for (let i = 0; i < 6; i++) { await click('#btnFamAdd'); }
  const six = await height();
  const viewport = await evalJs(`window.innerHeight`);
  assert(six / viewport < 6, `six sisters is ${(six / viewport).toFixed(1)} screens of scrolling`);
  assert(six < one * 2.5, `each sister costs too much: ${one}px became ${six}px`);

  /* the previews are one brand at a time, chosen, not all of them at once */
  const strip = await evalJs(`(() => ({
    previews: document.querySelectorAll('#famStrip .preview').length,
    chooser: document.querySelectorAll('#famStrip [data-showbrand]').length })) ()`);
  assert(strip.previews <= 2, `${strip.previews} whole previews are drawn at once`);
  assert(strip.chooser >= 7, 'there is no way to choose which brand to look at: ' + strip.chooser);

  /* and choosing one actually changes what is drawn */
  const first = await evalJs(`document.querySelector('#famStrip .preview').style.background`);
  await click('#famStrip [data-showbrand]', 3);
  const second = await evalJs(`document.querySelector('#famStrip .preview').style.background`);
  const label = await evalJs(`document.querySelector('#famStrip [data-showbrand][aria-pressed="true"]').textContent`);
  assert(label.length > 0, 'the chosen brand is not marked');
  assert(typeof second === 'string', 'the preview disappeared');
});

/* 40 — nothing on the shelf is destroyed without asking */
await journey('the shelf cannot be emptied by accident', async () => {
  await click('#btnShelfToggle');
  await click('#btnShelve');
  await setRange('hMain', 120);
  await sleep(500);
  await click('#btnShelve');
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 2, 'two versions were not put on the shelf');

  /* clearing asks first, the way deleting a kept palette does */
  await click('#btnShelfClear');
  const armed = await evalJs(`document.getElementById('btnShelfClear').textContent`);
  assert(/for good|sure/i.test(armed), 'clearing the shelf does not ask: ' + armed);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 2, 'the first click already cleared it');
  await click('#btnShelfClear');
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 0, 'the second click did not clear it');

  /* dropping one asks too */
  await click('#btnShelve');
  await click('[data-shelfdrop]');
  const armed2 = await evalJs(`document.querySelector('[data-shelfdrop]').textContent`);
  assert(armed2.trim() !== '✕', 'dropping one does not ask: ' + armed2);
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 1, 'the first click already dropped it');
  await click('[data-shelfdrop]');
  assert(await evalJs(`document.querySelectorAll('[data-shelf]').length`) === 0, 'the second click did not drop it');
});

/* 41 — the wheel can be worked without a mouse */
await journey('the wheel answers the keyboard', async () => {
  await click('#tabs button', 6);
  await click('#btnFamAdd');
  const hue = () => evalJs(`+document.querySelector('#famList [data-fam="h"]').value`);
  const chroma = () => evalJs(`+document.querySelector('#famList [data-fam="c"]').value`);
  await evalJs(`document.querySelectorAll('#famWheel [data-wheel]')[1].focus()`);
  const h0 = await hue(), c0 = await chroma();

  const press = async (key, mods) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: 39, modifiers: mods || 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 39, modifiers: mods || 0 });
    await sleep(250);
  };
  await press('ArrowRight');
  const h1 = await hue();
  assert(h1 !== h0, 'an arrow key on a focused dot does nothing');
  assert(Math.abs(((h1 - h0 + 540) % 360) - 180) <= 5, `one press moved the hue ${h1 - h0}°, which is a jump not a nudge`);
  await press('ArrowLeft');
  assert(await hue() === h0, 'the opposite arrow did not come back');
  await press('ArrowUp');
  assert(await chroma() !== c0, 'up and down do not change how colourful it is');
  const undo = await evalJs(`document.getElementById('btnUndo').textContent`);
  assert(/hue|colourful/i.test(undo), 'a keyboard move cannot be undone by name: ' + undo);
});

/* 42 — the glossary keeps up with the tool */
await journey('every idea the tool uses has a word behind it', async () => {
  await click('#btnGloss');
  const have = await evalJs(`[...document.querySelectorAll('#glossList > div')].map(d => d.id.replace('gloss-',''))`);
  const MUST = ['oklch','ramp','chroma','peak','falloff','twist','tint','lift','gamut','anchor','token',
                'share','wcag','scrim','sister','spacing','shelf','wheel','shape','candidates','picture','family'];
  const missing = MUST.filter(k => !have.includes(k));
  assert(missing.length === 0, 'the glossary has fallen behind: ' + missing.join(', '));

  /* the entries are explanations, not labels */
  const thin = await evalJs(`[...document.querySelectorAll('#glossList dd')].filter(d => d.textContent.trim().length < 80).length`);
  assert(thin === 0, thin + ' entries are too short to explain anything');
  await click('#glossClose');
});

/* 43 — what is remembered comes back with its contents */
await journey('a panel left open comes back with something in it', async () => {
  await click('#btnCandShow');
  assert(await evalJs(`document.querySelectorAll('[data-cand]').length`) === 6, 'the six did not appear');
  await send('Page.navigate', { url: URL_ + '?mem=' + Date.now() });
  await sleep(1700);
  const back = await evalJs(`(() => ({ open: !document.getElementById('candsOut').hidden,
    items: document.querySelectorAll('[data-cand]').length,
    rampsTop: Math.round(document.getElementById('rampsLight').getBoundingClientRect().top) }))()`);
  assert(back.open, 'the panel was not remembered');
  assert(back.items === 6, 'the panel came back empty: ' + back.items);
  assert(back.rampsTop < 560, 'an empty panel is pushing the ramps down again: ' + back.rampsTop);
});

/* 44 — the checklist can be finished, and does not reproach you for exploring */
await journey('every step can be reached', async () => {
  const steps = () => evalJs(`[...document.querySelectorAll('#steps li')].map(li => ({
    cls: li.className, note: li.querySelector('.s').textContent.trim() }))`);

  /* taking a suggestion is a legitimate way to have your colours */
  await click('#btnCandShow');
  await click('[data-cand]', 1);
  await sleep(400);
  let st = await steps();
  assert(st[0].cls === 'done', 'taking a suggestion does not count as finding your colours');
  assert(st[1].cls !== 'warn', 'the tool marks you down for not pasting a hex: ' + st[1].note);
  assert(!/nothing pinned/.test(st[1].note) || st[1].cls === 'done',
    'step two reproaches a palette that never needed a pinned colour: ' + st[1].note);

  /* the last step completes when the palette has actually been handed over */
  await click('#tabs button', 7);
  await click('[data-copy="outCss"]');
  await sleep(400);
  st = await steps();
  assert(st[4].cls === 'done', 'the last step can never be finished: ' + st[4].note);
  assert(/copied|taken|css/i.test(st[4].note), 'the last step does not say what was handed over: ' + st[4].note);
});

/* 45 — the tool is quiet by default, and explains itself when asked */
await journey('the explaining is there when wanted and out of the way when not', async () => {
  await type('xMain', '#0B6E4F');
  await click('#tabs button', 6);
  await click('#btnFamAdd');

  const words = () => evalJs(`(() => {
    const w = t => t.trim() ? t.trim().split(/\s+/).length : 0;
    const out = { byView: {}, total: 0 };
    document.querySelectorAll('section.view').forEach(v => {
      const was = v.classList.contains('on'); v.classList.add('on');
      let n = 0;
      v.querySelectorAll('.note, .cap, .hint').forEach(el => { if (el.offsetParent !== null) n += w(el.innerText); });
      out.byView[v.dataset.view] = n; out.total += n;
      if (!was) v.classList.remove('on');
    });
    return out; })()`);

  /* quiet by default */
  const quiet = await words();
  assert(quiet.total < 40, `${quiet.total} words of explaining are on screen before anything is asked`);
  for (const [view, n] of Object.entries(quiet.byView)) {
    assert(n < 20, `the ${view} tab still explains itself in ${n} words`);
  }

  /* but what the tool has to SAY about your palette is not explaining, and stays */
  await click('#tabs button', 2);      /* the views are drawn when looked at */
  await click('#tabs button', 1);
  const verdicts = await evalJs(`(() => {
    const on = sel => { const e = document.querySelector(sel); return e ? e.textContent.trim() : ''; };
    document.querySelectorAll('section.view').forEach(v => v.classList.add('on'));
    return { audit: on('#ctTokens .cap'),
             reach: on('#brandReach .cap, #brandReach .fail-cap'),
             states: on('#funcTable .cap'),
             rail: on('#anMain'),
             shelf: document.getElementById('btnShelfToggle').textContent }; })()`);
  assert(/clears its level|fall short/.test(verdicts.audit), 'the audit verdict was hidden with the explaining: ' + verdicts.audit);
  assert(/step [0-9]+|no token/.test(verdicts.rail), 'the rail stopped saying where your colour landed: ' + verdicts.rail);
  assert(verdicts.states.length > 10, 'the state-colour verdict was hidden: ' + verdicts.states);
  assert(verdicts.reach.length > 10, 'the brand-reach verdict was hidden: ' + verdicts.reach);

  /* one switch brings the teaching back — all of it, not some of it */
  /* only the ones whose own surroundings are open: a folded rail section or a
     closed panel hides its contents for its own reasons */
  const teaching = () => evalJs(`(() => {
    const reachable = [...document.querySelectorAll('.teach')].filter(el => {
      const sec = el.closest('fieldset[data-sec]');
      if (sec && !sec.hasAttribute('data-open')) return false;
      if (el.closest('[hidden]')) return false;
      return true;
    });
    return { marked: document.querySelectorAll('.teach').length,
             reachable: reachable.length,
             shown: reachable.filter(el => getComputedStyle(el).display !== 'none').length }; })()`);
  const before = await teaching();
  assert(before.marked > 30, 'hardly any of the explaining is marked as such: ' + before.marked);
  assert(before.shown === 0, before.shown + ' lines of explaining are showing while it is turned off');
  assert(before.reachable > 8, 'almost nothing would come back: ' + before.reachable);

  await click('#btnExplain');
  const loud = await words();
  const after = await teaching();
  assert(after.shown === after.reachable, `${after.reachable - after.shown} lines stayed hidden when explaining was turned on`);
  assert(loud.total > quiet.total * 2.5, `turning explaining on barely changed anything: ${quiet.total} then ${loud.total}`);

  /* and it is remembered */
  await send('Page.navigate', { url: URL_ + '?x=' + Date.now() });
  await sleep(1700);
  const still = await evalJs(`document.getElementById('btnExplain').getAttribute('aria-pressed')`);
  assert(still === 'true', 'the choice to have things explained was forgotten');
  await click('#btnExplain');
  const off = await words();
  assert(off.total < 220, 'turning it off again did not quieten the tool: ' + off.total);

  /* with it off, a word can still be looked up one at a time */
  await click('.term', 0);
  const gloss = await evalJs(`(() => ({ open: document.getElementById('gloss').open,
    entries: document.querySelectorAll('#glossList dt').length }))()`);
  assert(gloss.open && gloss.entries > 20, 'the glossary went with the explaining');
});

const failed = results.filter(r => !r[1]);
console.log('');
results.forEach(([name, ok, why]) => console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${why ? ' — ' + why : ''}`));
console.log(`\n${results.length - failed.length}/${results.length} journeys passed`);
ws.close(); chrome.kill();
if (ownServer) ownServer.close();
process.exit(failed.length ? 1 : 0);
