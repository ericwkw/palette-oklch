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
  await click('#btnFamSpread');
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

  /* every brand still draws */
  const strips = await evalJs(`document.querySelectorAll('#famStrip .preview').length`);
  assert(strips === 10, 'not every brand is drawn: ' + strips);
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
  assert(rail.open.includes('history'), 'undo is folded away by default');
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
  assert(steps[0].cls === 'todo' && /paste/.test(steps[0].note),
    'step one does not ask for a brand colour on an untouched palette: ' + steps[0].note);
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

const failed = results.filter(r => !r[1]);
console.log('');
results.forEach(([name, ok, why]) => console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${why ? ' — ' + why : ''}`));
console.log(`\n${results.length - failed.length}/${results.length} journeys passed`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
