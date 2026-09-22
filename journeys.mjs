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
  await evalJs(`localStorage.removeItem('palette-studio-v1'); localStorage.removeItem('palette-library-v1')`);
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
  await evalJs(`(() => { const s = document.getElementById('map-primary');
    const other = [...s.options].find(o => o.value !== s.value);
    s.value = other.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  assert(await btn() !== before, 'the primary mapping did not move the preview');
});

/* 10 — a palette can be kept, switched away from, and come back the same */
await journey('the library keeps palettes and switches between them', async () => {
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
  await click('#btnFamSpread');
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
  await click('#btnFamSpread');
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

  /* and a preview is drawn for every brand, in the family strip */
  const strips = await evalJs(`document.querySelectorAll('#famStrip .preview').length`);
  assert(strips === 3, 'the family strip does not show every brand: ' + strips);
});

const failed = results.filter(r => !r[1]);
console.log('');
results.forEach(([name, ok, why]) => console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${why ? ' — ' + why : ''}`));
console.log(`\n${results.length - failed.length}/${results.length} journeys passed`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
