<script>
(function(){
  var $ = function(s){ return document.querySelector(s); };
  var el = function(id){ return document.getElementById(id); };
  var STORE = 'palette-studio-v1';
  var LIB   = 'palette-library-v1';   /* named palettes kept in this browser */
  var THEME = 'light';   /* which theme the views show: light | dark | both */

  var DEFAULTS = {
    name:'Untitled',
    main:{h:250,c:0.16,brand:null,pin:true}, sup:{h:280,c:0.09,rel:'near',brand:null,pin:true},
    a1:{h:45,c:0.18,brand:null,pin:true}, a2:{h:20,c:0.20,brand:null,pin:true},
    neutral:{c:0.012, from:'main', h:250},
    shape:{peak:6, falloff:0.85, gamut:'srgb', twist:1},
    darkMode:{lift:0.055, boost:1},
    map:{ primary:700, primaryDark:400, tint:100, tintDark:900, border:200, borderDark:800, ring:600, ringDark:400 },
    nudges:{},
    share:{neutral:55, sup:22, main:15, a1:6, a2:2},
    family:{ sisters:[] }
  };
  var S = JSON.parse(JSON.stringify(DEFAULTS));

  /* ---------- state <-> controls ---------- */
  var BIND = [
    ['hMain','main.h','oMain',0],   ['cMain','main.c','ocMain',3],
    ['hSup','sup.h','oSup',0],      ['cSup','sup.c','ocSup',3],
    ['hA1','a1.h','oA1',0],         ['cA1','a1.c','ocA1',3],
    ['hA2','a2.h','oA2',0],         ['cA2','a2.c','ocA2',3],
    ['cNeu','neutral.c','ocNeu',3], ['hNeuOwn','neutral.h','oNeuOwn',0],
    ['cPeak','shape.peak','ocPeak',0], ['cFall','shape.falloff','ocFall',2], ['cTwist','shape.twist','ocTwist',2],
    ['dLift','darkMode.lift','odLift',3], ['dBoost','darkMode.boost','odBoost',2],
    ['sNeutral','share.neutral','osNeutral',0], ['sSup','share.sup','osSup',0],
    ['sMain','share.main','osMain',0], ['sA1','share.a1','osA1',0], ['sA2','share.a2','osA2',0]
  ];
  function get(path){ return path.split('.').reduce(function(o,k){ return o[k]; }, S); }
  function set(path,v){ var ks=path.split('.'), last=ks.pop(); ks.reduce(function(o,k){ return o[k]; },S)[last]=v; }

  function syncControls(){
    BIND.forEach(function(b){
      var input = el(b[0]); if(!input) return;
      input.value = get(b[1]);
      var out = el(b[2]);
      if(!out) return;
      if(b[0] === 'cPeak'){ out.textContent = STEPS[get(b[1])]; }
      else if(b[0].charAt(0) === 's'){ out.textContent = Math.round(get(b[1])) + '%'; }
      else { out.textContent = Number(get(b[1])).toFixed(b[3]).replace(/^0\./,'.'); }
    });
    el('pName').value = S.name;
    [['xMain','main',600],['xSup','sup',500],['xA1','a1',500],['xA2','a2',600]].forEach(function(p){
      var input = el(p[0]); if(!input || document.activeElement === input) return;
      input.placeholder = '#______';
    });
    el('relSup').value = S.sup.rel;
    el('hNeu').value = S.neutral.from;
    el('gamut').value = S.shape.gamut;
    [['pinMain','main'],['pinSup','sup'],['pinA1','a1'],['pinA2','a2']].forEach(function(p){
      var box = el(p[0]); if(!box) return;
      box.checked = S[p[1]].pin !== false;
      box.closest('.check').style.display = S[p[1]].brand ? '' : 'none';
    });
  }
  var SHARE_KEYS = ['neutral','sup','main','a1','a2'];
  var SHARE_INPUT = { neutral:'sNeutral', sup:'sSup', main:'sMain', a1:'sA1', a2:'sA2' };
  function balanceShares(changed){
    var v = clamp(Math.round(S.share[changed]), 0, 100);
    S.share[changed] = v;
    var others = SHARE_KEYS.filter(function(k){ return k !== changed; });
    var rest = 100 - v;
    var sum = others.reduce(function(a,k){ return a + S.share[k]; }, 0);
    if(sum <= 0){
      /* nothing left to scale — give the remainder to the neutrals */
      others.forEach(function(k){ S.share[k] = 0; });
      S.share[changed === 'neutral' ? 'sup' : 'neutral'] = rest;
    } else {
      others.forEach(function(k){ S.share[k] = Math.max(0, Math.round(S.share[k] / sum * rest)); });
      /* rounding can leave a point or two over or short — settle it on the biggest of the rest */
      var drift = 100 - SHARE_KEYS.reduce(function(a,k){ return a + S.share[k]; }, 0);
      if(drift !== 0){
        var big = others.slice().sort(function(a,b){ return S.share[b] - S.share[a]; })[0];
        S.share[big] = Math.max(0, S.share[big] + drift);
      }
    }
  }
  function readControls(){
    BIND.forEach(function(b){
      if(b[1].indexOf('share.') === 0) return;   /* shares are balanced, not read raw */
      var input = el(b[0]); if(input) set(b[1], parseFloat(input.value));
    });
    S.name = el('pName').value || 'Untitled';
    S.sup.rel = el('relSup').value;
    S.neutral.from = el('hNeu').value;
    S.shape.gamut = el('gamut').value;
    if(S.sup.rel === 'same') S.sup.h = S.main.h;
    if(S.sup.rel === 'near') S.sup.h = (S.main.h + 30) % 360;
    if(S.sup.rel === 'far')  S.sup.h = (S.main.h + 150) % 360;
  }

  /* ---------- the palette ---------- */
  function neutralHue(){
    return S.neutral.from === 'main' ? S.main.h : (S.neutral.from === 'sup' ? S.sup.h : S.neutral.h);
  }
  /* where a pasted colour lands, by lightness, on the shared steps */
  function anchorFor(key, dark){
    var b = S[key] && S[key].brand;
    if(!b || S[key].pin === false || dark) return null;
    var c = hexToOklch(b), idx = 0, best = 9;
    for(var i=0;i<STEPS.length;i++){
      var d = Math.abs(L_LIGHT[i] - c.L);
      if(d < best){ best = d; idx = i; }
    }
    return { index:idx, L:c.L, C:c.C, hex:b.toUpperCase() };
  }
  function nudgesFor(key){ return (S.nudges && S.nudges[key]) || {}; }
  function build(dark){
    var dm = S.darkMode || { lift:0.055, boost:1 };
    var tw = S.shape.twist === undefined ? 1 : S.shape.twist;
    var base = { dark:dark, space:S.shape.gamut, peak:S.shape.peak, falloff:S.shape.falloff, lift:dm.lift, boost:dm.boost };
    function opts(key, hue){
      var o = {}; for(var k in base) o[k] = base[k];
      o.anchor = anchorFor(key, dark); o.nudges = nudgesFor(key);
      o.twist = defaultTwist(hue) * tw;
      return o;
    }
    var nOpts = { dark:dark, space:base.space, peak:5, falloff:0.5, lift:dm.lift, boost:dm.boost, nudges:nudgesFor('neutral'), twist:0 };
    var p = {
      neutral: makeRamp(neutralHue(), S.neutral.c, nOpts),
      main:    makeRamp(S.main.h, S.main.c, opts('main', S.main.h)),
      sup:     makeRamp(S.sup.h,  S.sup.c,  opts('sup',  S.sup.h)),
      a1:      makeRamp(S.a1.h,   S.a1.c,   opts('a1',   S.a1.h)),
      a2:      makeRamp(S.a2.h,   S.a2.c,   opts('a2',   S.a2.h))
    };
    FUNCTIONAL.forEach(function(f){
      var fo = {}; for(var k in base) fo[k] = base[k];
      fo.nudges = nudgesFor(f.id);
      fo.twist = defaultTwist(f.hue) * tw;
      p[f.id] = makeRamp(f.hue, f.chroma, fo);
    });
    return p;
  }
  function stepOf(ramp, step){ return ramp[STEPS.indexOf(step)]; }
  /* the more readable of the palette's two extremes */
  function textOn(bgHex, p){
    var light = stepOf(p.neutral,50).hex, dark = stepOf(p.neutral,950).hex;
    return wcag(dark,bgHex) >= wcag(light,bgHex) ? dark : light;
  }

  /* which step lands closest to a given colour, by lightness */
  function nearestStep(ramp, hex){
    var t = hexToOklch(hex), best = ramp[0], d = 9;
    ramp.forEach(function(s){ var dd = Math.abs(s.L - t.L); if(dd < d){ d = dd; best = s; } });
    return best;
  }
  var ROLES = [
    ['main','Main','identity, primary action'],
    ['sup','Supporting','structure, navigation, secondary surfaces'],
    ['a1','Accent · frequent','a highlight you meet often'],
    ['a2','Accent · rare','the single strongest mark in a view'],
    ['neutral','Neutral','paper, panels, hairlines, ink']
  ];

  /* semantic tokens, shadcn names */
  /* light and dark read the ramp from opposite ends, so one set of hues serves both */
  function tokens(p, dark){
    var n = p.neutral;
    var m = S.map || {};
    var S_ = dark
      ? { paper:950, panel:900, hairline:m.borderDark||800, quiet:400, ink:50, fill:m.primaryDark||400, tint:m.tintDark||900, tintText:200, ring:m.ringDark||400 }
      : { paper:50,  panel:100, hairline:m.border||200,     quiet:700, ink:950, fill:m.primary||700,     tint:m.tint||100,    tintText:900, ring:m.ring||600 };
    function fillPair(ramp){
      var f = stepOf(ramp, S_.fill);
      return [f, { hex:textOn(f.hex,p) }];
    }
    var prim = fillPair(p.main), dest = fillPair(p.danger);
    return {
      'background': stepOf(n,S_.paper), 'foreground': stepOf(n,S_.ink),
      'card': stepOf(n, dark?900:50), 'card-foreground': stepOf(n,S_.ink),
      'popover': stepOf(n, dark?900:50), 'popover-foreground': stepOf(n,S_.ink),
      'primary': prim[0], 'primary-foreground': prim[1],
      'secondary': stepOf(p.sup,S_.tint), 'secondary-foreground': stepOf(p.sup,S_.tintText),
      'muted': stepOf(n,S_.panel), 'muted-foreground': stepOf(n,S_.quiet),
      'accent': stepOf(p.a1,S_.tint), 'accent-foreground': stepOf(p.a1,S_.tintText),
      'destructive': dest[0], 'destructive-foreground': dest[1],
      'border': stepOf(n,S_.hairline), 'input': stepOf(n,S_.hairline), 'ring': stepOf(p.main, S_.ring),
      'chart-1': stepOf(p.main,500), 'chart-2': stepOf(p.sup,500), 'chart-3': stepOf(p.a1,500),
      'chart-4': stepOf(p.a2,500), 'chart-5': stepOf(p.success,500),
      'sidebar': stepOf(n,S_.panel), 'sidebar-foreground': stepOf(n,S_.ink),
      'sidebar-primary': prim[0], 'sidebar-primary-foreground': prim[1],
      'sidebar-accent': stepOf(p.sup,S_.tint), 'sidebar-accent-foreground': stepOf(p.sup,S_.tintText),
      'sidebar-border': stepOf(n,S_.hairline), 'sidebar-ring': stepOf(p.main, S_.ring)
    };
  }
  /* four usable values per functional colour */
  function funcSet(ramp, dark){
    return {
      surface: stepOf(ramp, dark?950:50),
      border:  stepOf(ramp, dark?800:200),
      text:    stepOf(ramp, dark?300:700),
      fill:    stepOf(ramp, dark?500:600)
    };
  }

  /* ---------- rendering ---------- */
  function swatchHtml(s, dark, isBrand, role){
    var ink = wcag('#000000',s.hex) >= wcag('#ffffff',s.hex) ? '#000' : '#fff';
    var nudged = S.nudges && S.nudges[role] && S.nudges[role][s.step];
    var style = S.shape.gamut === 'p3' ? s.css : s.hex;   /* P3 swatches are painted in oklch, not the sRGB hex */
    return '<div class="sw'+(isBrand?' is-brand':'')+(nudged?' is-nudged':'')+'" style="background:'+style+';color:'+ink+'"'+
      ' data-role="'+role+'" data-step="'+s.step+'" data-value="'+s.css+'" title="'+s.css+(s.wide?' · outside sRGB':'')+'">'+
      '<b>'+s.step+'</b><span>'+s.hex.toUpperCase()+(s.wide?' ▲':'')+'</span></div>';
  }
  function rampsHtml(p, dark){
    var brandStep = {};
    ['main','sup','a1','a2'].forEach(function(k){
      if(S[k] && S[k].brand) brandStep[k] = nearestStep(p[k], S[k].brand).step;
    });
    var order = ROLES.map(function(r){ return r[0]; }).concat(FUNCTIONAL.map(function(f){ return f.id; }));
    var labels = {}; ROLES.forEach(function(r){ labels[r[0]] = [r[1], r[2]]; });
    FUNCTIONAL.forEach(function(f){ labels[f.id] = [f.name, f.note]; });
    return order.map(function(k){
      var hue = p[k][5].h, h0 = p[k][0].h, h9 = p[k][p[k].length-1].h;
      var turn = Math.round(((h9 - h0 + 540) % 360) - 180);
      return '<div class="ramp"><div class="name" style="'+(dark?'color:#E7ECF2':'')+'">'+labels[k][0]+
        '<small style="'+(dark?'color:#8A94A0':'')+'">'+Math.round(hue)+'°'+(turn ? ' · turns '+(turn>0?'+':'')+turn+'°' : '')+'</small></div>' +
        p[k].map(function(s){ return swatchHtml(s, dark, brandStep[k] === s.step, k); }).join('') + '</div>';
    }).join('');
  }
  function stepsHeadHtml(){
    return '<span></span>' + STEPS.map(function(s){ return '<span>'+s+'</span>'; }).join('');
  }

  function roleTableHtml(p){
    var rows = ROLES.map(function(r){
      var ramp = p[r[0]], mid = stepOf(ramp,500);
      var brand = S[r[0]] && S[r[0]].brand;
      return '<tr><td><span class="dot" style="background:'+mid.hex+'"></span><b>'+r[1]+'</b><div class="muted">'+r[2]+'</div></td>'+
        '<td class="mono">'+Math.round(ramp[5].h)+'° · C '+ramp[5].C.toFixed(3)+'</td>'+
        '<td class="mono">'+(brand ? '<span class="dot" style="background:'+brand+'"></span>'+brand.toUpperCase() : '<span class="muted">—</span>')+'</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Role</th><th>Hue</th><th>Brand hex</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function funcTableHtml(p, dark){
    var rows = FUNCTIONAL.map(function(f){
      var set = funcSet(p[f.id], dark);
      function cell(s){ return '<span class="dot" style="background:'+s.hex+'"></span><span class="mono">'+s.hex.toUpperCase()+'</span>'; }
      return '<tr><td><b>'+f.name+'</b><div class="muted">'+f.note+'</div></td>'+
        '<td>'+cell(set.surface)+'</td><td>'+cell(set.border)+'</td><td>'+cell(set.text)+'</td><td>'+cell(set.fill)+'</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Meaning</th><th>Surface</th><th>Border</th><th>Text</th><th>Fill</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function stateTableHtml(p, dark){
    var m = p.main, n = p.neutral;
    var rows = (dark ? [
      ['Default','main 500', stepOf(m,500)],
      ['Hover','main 400', stepOf(m,400)],
      ['Pressed','main 300', stepOf(m,300)],
      ['Selected surface','main 900', stepOf(m,900)],
      ['Focus ring','main 500 at 3px', stepOf(m,500)],
      ['Disabled','neutral 800 on neutral 900', stepOf(n,800)],
      ['Read-only','neutral 900 with neutral 400 text', stepOf(n,900)]
    ] : [
      ['Default','main 600', stepOf(m,600)],
      ['Hover','main 700', stepOf(m,700)],
      ['Pressed','main 800', stepOf(m,800)],
      ['Selected surface','main 100', stepOf(m,100)],
      ['Focus ring','main 500 at 3px', stepOf(m,500)],
      ['Disabled','neutral 200 on neutral 100', stepOf(n,200)],
      ['Read-only','neutral 100 with neutral 600 text', stepOf(n,100)]
    ]).map(function(r){
      return '<tr><td><b>'+r[0]+'</b></td><td class="muted">'+r[1]+'</td><td><span class="dot" style="background:'+r[2].hex+'"></span><span class="mono">'+r[2].hex.toUpperCase()+'</span></td></tr>';
    }).join('');
    return '<table><thead><tr><th>State</th><th>Step</th><th>Value</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }

  function badge(ratio, lc, large){
    var okW = ratio >= (large?3:4.5), okA = Math.abs(lc) >= (large?45:60);
    var cls = okW && okA ? 'pass' : (okW || okA ? 'mid' : 'fail');
    return '<span class="pill '+cls+'">'+ratio.toFixed(2)+' · Lc '+Math.round(lc)+'</span>';
  }
  function contrastTextHtml(p, dark){
    var surfaces = [['Paper', stepOf(p.neutral, dark?950:50)],['Panel', stepOf(p.neutral, dark?900:100)],['Main surface', stepOf(p.main, dark?900:100)],['Accent surface', stepOf(p.a1, dark?900:100)]];
    var texts = [['Ink', stepOf(p.neutral, dark?50:950)],['Quiet text', stepOf(p.neutral, dark?400:600)],['Main text', stepOf(p.main, dark?300:700)],['Danger text', stepOf(p.danger, dark?300:700)]];
    var head = '<tr><th>'+(dark?'Dark ':'')+'Text \\ Surface</th>' + surfaces.map(function(s){ return '<th>'+s[0]+'</th>'; }).join('') + '</tr>';
    var rows = texts.map(function(t){
      return '<tr><td><span class="dot" style="background:'+t[1].hex+'"></span>'+t[0]+'</td>' +
        surfaces.map(function(s){ return '<td>'+badge(wcag(t[1].hex,s[1].hex), apca(t[1].hex,s[1].hex), false)+'</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table><thead>'+head+'</thead><tbody>'+rows+'</tbody></table>';
  }
  /* the nearest step whose own label clears body-text contrast */
  function passingStep(ramp, p){
    for(var i=0;i<STEPS.length;i++){
      var s = stepOf(ramp, STEPS[i]);
      if(wcag(textOn(s.hex,p), s.hex) >= 4.5 && STEPS[i] >= 600) return STEPS[i];
    }
    return null;
  }
  /* the pairs the tokens actually create, checked at the level each one needs */
  var TOKEN_PAIRS = [
    ['foreground','background','text'],
    ['muted-foreground','muted','text'],
    ['card-foreground','card','text'],
    ['primary-foreground','primary','text'],
    ['secondary-foreground','secondary','text'],
    ['accent-foreground','accent','text'],
    ['destructive-foreground','destructive','text'],
    ['sidebar-foreground','sidebar','text'],
    ['border','background','edge'],
    ['border','card','edge'],
    ['ring','background','ui'],
    ['chart-1','background','ui'],
    ['chart-2','background','ui'],
    ['chart-3','background','ui']
  ];
  function tokenAuditHtml(p, dark){
    var t = tokens(p, dark);
    var rows = TOKEN_PAIRS.map(function(pair){
      var fg = t[pair[0]], bg = t[pair[1]];
      if(!fg || !bg) return '';
      var r = wcag(fg.hex,bg.hex), lc = apca(fg.hex,bg.hex), kind = pair[2];
      var need = kind === 'text' ? 4.5 : (kind === 'ui' ? 3 : 1.2);   /* hairlines are guidance, not a rule */
      var cls = r >= need ? 'pass' : (r >= need * 0.8 ? 'mid' : 'fail');
      return '<tr><td><span class="dot" style="background:'+fg.hex+'"></span><code>'+pair[0]+'</code></td>'+
        '<td><span class="dot" style="background:'+bg.hex+'"></span><code>'+pair[1]+'</code></td>'+
        '<td class="muted">'+need.toFixed(1)+' · '+(kind === 'text' ? 'text' : (kind === 'ui' ? 'UI mark' : 'hairline'))+'</td>'+
        '<td><span class="pill '+cls+'">'+r.toFixed(2)+' · Lc '+Math.round(lc)+'</span></td></tr>';
    }).join('');
    var fails = TOKEN_PAIRS.filter(function(pair){
      var fg = t[pair[0]], bg = t[pair[1]];
      if(!fg || !bg) return false;
      var need = pair[2] === 'text' ? 4.5 : (pair[2] === 'ui' ? 3 : 1.2);
      return wcag(fg.hex,bg.hex) < need;
    }).length;
    return '<p class="cap">' + (fails ? fails + ' of ' + TOKEN_PAIRS.length + ' token pairs fall short.' : 'Every token pair clears its level.') + '</p>' +
      '<table><thead><tr><th>Foreground</th><th>Background</th><th>Needs</th><th>Result</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function contrastFillHtml(p, dark){
    var base = dark ? 500 : 600;
    var fills = [['Primary', p.main],['Accent 1', p.a1],['Accent 2', p.a2]]
      .concat(FUNCTIONAL.map(function(f){ return [f.name, p[f.id]]; }));
    var rows = fills.map(function(f){
      var s = stepOf(f[1],base), t = textOn(s.hex,p), r = wcag(t,s.hex);
      var fix = r >= 4.5 ? '<span class="muted">—</span>' : (function(){
        var st = passingStep(f[1],p);
        return st ? '<span class="pill mid">use '+st+'</span>' : '<span class="muted">no step passes — pair with an outline</span>';
      })();
      return '<tr><td><span class="dot" style="background:'+s.hex+'"></span>'+f[0]+' '+base+'</td><td class="mono">'+s.hex.toUpperCase()+'</td>'+
        '<td><span class="dot" style="background:'+t+'"></span><span class="mono">'+t.toUpperCase()+'</span></td>'+
        '<td>'+badge(r, apca(t,s.hex), false)+'</td><td>'+fix+'</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Fill</th><th>Value</th><th>Label</th><th>Contrast</th><th>If it fails</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<p class="hint">Button labels are body text, so 4.5 applies. A fill that fails is usually fixed by taking the next step or two down the ramp.</p>';
  }

  var ALPHAS = [0.04,0.08,0.12,0.16,0.24,0.40,0.60,0.80];
  /* the nearest ramp step to a composited colour, so a tint can be swapped for a token */
  function matchStep(p, hex){
    var t = hexToOklch(hex), best = null, bestD = 9;
    Object.keys(p).forEach(function(k){
      p[k].forEach(function(s){
        var dh = Math.abs(((s.h - t.h + 540) % 360) - 180);
        var d = Math.abs(s.L - t.L) * 3 + Math.abs(s.C - t.C) * 2 + (180 - dh) / 360 * (t.C > 0.02 ? 0.4 : 0);
        if(d < bestD){ bestD = d; best = k + '-' + s.step; }
      });
    });
    return bestD < 0.06 ? best : null;
  }
  function alphaHtml(p, dark){
    var surfaces = dark
      ? [['Paper', stepOf(p.neutral,950)],['Panel', stepOf(p.neutral,900)],['Light ground', stepOf(p.neutral,50)]]
      : [['Paper', stepOf(p.neutral,50)],['Panel', stepOf(p.neutral,100)],['Ink', stepOf(p.neutral,950)]];
    var f = dark ? 500 : 600, a = dark ? 400 : 500;
    var sources = [['Main '+f, stepOf(p.main,f)],['Supporting '+f, stepOf(p.sup,f)],['Accent 1 '+a, stepOf(p.a1,a)],['Danger '+f, stepOf(p.danger,f)]];
    return surfaces.map(function(s){
      var rows = sources.map(function(src){
        var cells = ALPHAS.map(function(a){
          var c = composite(src[1].hex, a, s[1].hex);
          var ink = wcag('#000',c) >= wcag('#fff',c) ? '#000' : '#fff';
          var m = matchStep(p, c);
          return '<div class="alpha-cell" style="background:'+c+';color:'+ink+'" title="'+src[0]+' at '+Math.round(a*100)+'% on '+s[0]+' = '+c.toUpperCase()+(m?' ≈ '+m:'')+'" data-value="'+c+'">'+
            c.slice(1).toUpperCase() + (m ? '<br><span style="opacity:.75">≈ '+m+'</span>' : '') + '</div>';
        }).join('');
        return '<tr><td>'+src[0]+'</td><td><div class="alpha-grid" style="grid-template-columns:repeat('+ALPHAS.length+',minmax(0,1fr))">'+cells+'</div></td></tr>';
      }).join('');
      return '<h3 style="margin:14px 0 6px;font-size:.8rem">Over '+s[0]+' <span class="muted mono">'+s[1].hex.toUpperCase()+'</span></h3>'+
        '<table><thead><tr><th style="width:9em">Source</th><th>'+ALPHAS.map(function(a){ return Math.round(a*100)+'%'; }).join(' · ')+'</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }).join('');
  }

  function gradientsHtml(p){
    function stops(a,b,n){
      var A = hexToOklch(a), B = hexToOklch(b), out=[];
      var dh = ((B.h - A.h + 540) % 360) - 180;              /* shortest way round */
      for(var i=0;i<n;i++){
        var t=i/(n-1);
        out.push(oklchToHex(A.L+(B.L-A.L)*t, A.C+(B.C-A.C)*t, A.h+dh*t, S.shape.gamut));
      }
      return out;
    }
    var defs = [
      ['Main → Accent 1', stepOf(p.main,700).hex, stepOf(p.a1,400).hex, '160deg'],
      ['Main → Supporting', stepOf(p.main,600).hex, stepOf(p.sup,300).hex, '120deg'],
      ['Paper → Main tint', stepOf(p.neutral,50).hex, stepOf(p.main,200).hex, '180deg'],
      ['Ink → Main', stepOf(p.neutral,950).hex, stepOf(p.main,600).hex, '135deg']
    ];
    return defs.map(function(d){
      var s = stops(d[1],d[2],7);
      var css = 'linear-gradient(' + d[3] + ', ' + s.join(', ') + ')';
      var band = Math.abs(hexToOklch(d[1]).L - hexToOklch(d[2]).L) < 0.08;
      return '<div class="card"><div class="grad" style="background:'+css+'"><em>'+d[0]+'</em></div>'+
        '<pre style="max-height:120px">background: '+css+';</pre>'+
        (band ? '<p class="hint">Shallow lightness change — watch for banding on large areas.</p>' : '') +
        '<p class="hint">White text passes at: ' + (apca('#ffffff',s[0]) <= -60 ? 'the light end' : '') +
        (apca('#ffffff',s[s.length-1]) <= -60 ? ' the dark end' : '') +
        ((apca('#ffffff',s[0]) > -60 && apca('#ffffff',s[s.length-1]) > -60) ? 'neither end — use ink or a scrim' : '') + '.</p></div>';
    }).join('');
  }

  /* a dense screen built only from tokens, so a mapping change has somewhere to show */
  function previewHtml(p, dark){
    var t = tokens(p, dark);
    var sh = S.share, total = sh.neutral+sh.sup+sh.main+sh.a1+sh.a2;
    function T(k){ return t[k].hex; }
    function tk(k){ return ' data-token="'+k+'"'; }

    var NAV = [['Overview',1],['Schools',0],['Programmes',0],['Reports',0],['Settings',0]];
    var nav = NAV.map(function(n){
      return n[1]
        ? '<span class="pv-nav"'+tk('sidebar-accent')+' style="background:'+T('sidebar-accent')+';color:'+T('sidebar-accent-foreground')+';font-weight:650;box-shadow:inset 2px 0 0 '+T('sidebar-primary')+'">'+n[0]+'</span>'
        : '<span class="pv-nav" style="color:'+T('sidebar-foreground')+';opacity:.72">'+n[0]+'</span>';
    }).join('');

    var ROWS = [
      ['Northbridge Primary','success','Live'],
      ['Harbour Secondary','warning','Review due'],
      ['Ridgeway Academy','danger','Overdue'],
      ['Eastfield College','pending','Awaiting reply'],
      ['Lakeside Junior','fresh','New'],
      ['Old Mill School','info','Draft']
    ];
    var rows = ROWS.map(function(r, i){
      var fs = funcSet(p[r[1]], dark);
      return '<tr>'+
        '<td style="border-top-color:'+T('border')+'">'+r[0]+'</td>'+
        '<td style="border-top-color:'+T('border')+'"><span class="pv-pill" data-func="'+r[1]+'" style="background:'+fs.surface.hex+';border-color:'+fs.border.hex+';color:'+fs.text.hex+'"><i style="background:'+fs.fill.hex+'"></i>'+r[2]+'</span></td>'+
        '<td class="mono" style="border-top-color:'+T('border')+';color:'+T('muted-foreground')+';text-align:right">'+(112 - i*17)+'</td>'+
      '</tr>';
    }).join('');

    var CHART = [['chart-1',72],['chart-2',54],['chart-3',88],['chart-4',36],['chart-5',63]];
    var bars = CHART.map(function(c){
      return '<span'+tk(c[0])+' style="background:'+T(c[0])+';height:'+c[1]+'%"></span>';
    }).join('');
    var legend = CHART.map(function(c){
      return '<span style="color:'+T('muted-foreground')+'"><b style="background:'+T(c[0])+'"></b>'+c[0].replace('chart-','Series ')+'</span>';
    }).join('');

    var dangerText = stepOf(p.danger, dark?300:700).hex;

    return '<div class="preview" style="background:'+T('background')+';color:'+T('foreground')+'">'+
      '<div class="pv-app">'+
        '<div class="pv-side"'+tk('sidebar')+' style="background:'+T('sidebar')+';color:'+T('sidebar-foreground')+';border-right:1px solid '+T('sidebar-border')+'">'+
          '<span class="pv-brand"><span class="dot"'+tk('sidebar-primary')+' style="background:'+T('sidebar-primary')+'"></span>'+(dark?'Dark':'Light')+'</span>'+
          nav+
        '</div>'+
        '<div class="pv-main">'+

          '<div>'+
            '<h3 class="pv-h1">Programme health</h3>'+
            '<p class="pv-p" style="margin-top:4px">Three sizes of text on the page background, so you can see where reading gets hard.</p>'+
            '<p class="pv-small"'+tk('muted-foreground')+' style="color:'+T('muted-foreground')+';margin-top:3px">'+
              'Small print at muted-foreground — '+Math.round(sh.main/total*100)+'% main, '+Math.round(sh.neutral/total*100)+'% neutral by surface.</p>'+
          '</div>'+

          '<div class="pv-row">'+
            '<span class="pv-btn"'+tk('primary')+' style="background:'+T('primary')+';color:'+T('primary-foreground')+'">Publish</span>'+
            '<span class="pv-btn"'+tk('secondary')+' style="background:'+T('secondary')+';color:'+T('secondary-foreground')+'">Duplicate</span>'+
            '<span class="pv-btn"'+tk('accent')+' style="background:'+T('accent')+';color:'+T('accent-foreground')+'">Tag</span>'+
            '<span class="pv-btn"'+tk('destructive')+' style="background:transparent;color:'+T('destructive')+';border:1px solid '+T('destructive')+'">Delete</span>'+
          '</div>'+

          '<div class="pv-panel"'+tk('card')+' style="background:'+T('card')+';color:'+T('card-foreground')+';border:1px solid '+T('border')+'">'+
            '<h4 class="pv-h2">Schools</h4>'+
            '<table class="pv-table">'+
              '<thead><tr><th style="color:'+T('muted-foreground')+'">School</th><th style="color:'+T('muted-foreground')+'">Status</th><th style="color:'+T('muted-foreground')+';text-align:right">Pupils</th></tr></thead>'+
              '<tbody>'+rows+'</tbody>'+
            '</table>'+
          '</div>'+

          '<div class="pv-cols">'+
            '<div class="pv-panel"'+tk('popover')+' style="background:'+T('popover')+';color:'+T('popover-foreground')+';border:1px solid '+T('border')+'">'+
              '<h4 class="pv-h2">Add a school</h4>'+
              '<label class="pv-field"><span style="color:'+T('muted-foreground')+'">Name</span>'+
                '<input class="pv-input" readonly value="Northbridge Primary"'+tk('input')+' style="background:'+T('background')+';color:'+T('foreground')+';border-color:'+T('input')+'"></label>'+
              '<label class="pv-field"><span style="color:'+T('muted-foreground')+'">Contact (focused)</span>'+
                '<input class="pv-input" readonly value="head@northbridge.sch"'+tk('ring')+' style="background:'+T('background')+';color:'+T('foreground')+';border-color:'+T('ring')+';box-shadow:0 0 0 3px '+T('ring')+'55"></label>'+
              '<label class="pv-field"><span style="color:'+dangerText+'">Cohort size</span>'+
                '<input class="pv-input" readonly value="0" style="background:'+T('background')+';color:'+T('foreground')+';border-color:'+T('destructive')+'">'+
                '<span style="color:'+dangerText+'">Enter a number above zero.</span></label>'+
              '<label class="pv-field"><span style="color:'+T('muted-foreground')+'">Region (disabled)</span>'+
                '<input class="pv-input" disabled value="Set by your admin"'+tk('muted')+' style="background:'+T('muted')+';color:'+T('muted-foreground')+';border-color:'+T('border')+'"></label>'+
            '</div>'+
            '<div class="pv-panel" style="background:'+T('card')+';color:'+T('card-foreground')+';border:1px solid '+T('border')+'">'+
              '<h4 class="pv-h2">Enrolment by term</h4>'+
              '<div class="pv-chart">'+bars+'</div>'+
              '<div class="pv-legend">'+legend+'</div>'+
            '</div>'+
          '</div>'+

          '<div class="pv-row" style="gap:6px">'+
            [50,100,200,300,400,500,600,700,800,900,950].map(function(st){
              return '<span style="flex:1;height:14px;border-radius:3px;background:'+stepOf(p.main,st).hex+'"></span>';
            }).join('')+
          '</div>'+

        '</div>'+
      '</div></div>';
  }

  /* ---------- brand family ----------
     A sister sets its own main hue and colourfulness. Everything else is the
     parent's: neutrals, functional colours, steps, ramp shape, token mapping. */
  function sisters(){ return (S.family && S.family.sisters) || []; }
  function slug(n){ return String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'brand'; }

  /* run fn with the palette seen through a sister's eyes, then put the parent back */
  function asSister(sis, fn){
    if(!sis) return fn();
    var keep = S, nh = neutralHue();
    var alt = JSON.parse(JSON.stringify(S));
    alt.main = { h: sis.h, c: sis.c, brand: sis.brand || null, pin: !!sis.brand };
    if(alt.sup.rel === 'same')      alt.sup.h = sis.h;
    else if(alt.sup.rel === 'near') alt.sup.h = (sis.h + 30) % 360;
    else if(alt.sup.rel === 'far')  alt.sup.h = (sis.h + 150) % 360;
    alt.neutral = { c: keep.neutral.c, from:'own', h: nh };   /* the parent's neutrals, whatever they came from */
    S = alt;
    try { return fn(); } finally { S = keep; }
  }
  function famMembers(){
    return [{ id:'parent', name: S.name || 'Parent', h: S.main.h, c: S.main.c, parent:true }]
      .concat(sisters().map(function(x){ return x; }));
  }
  function hueGap(a, b){ var d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; }
  var FAM_MIN = 24;   /* two brands closer than this read as the same brand */

  /* the hue furthest from everything already spoken for */
  function freeHue(){
    var taken = famMembers().map(function(m){ return m.h; }).concat(RESERVED);
    var best = 0, bestD = -1;
    for(var h = 0; h < 360; h += 2){
      var d = Math.min.apply(null, taken.map(function(t){ return hueGap(h, t); }));
      if(d > bestD){ bestD = d; best = h; }
    }
    return best;
  }
  function famWarnings(m){
    var out = [];
    famMembers().forEach(function(o){
      if(o === m || o.id === m.id) return;
      var d = hueGap(m.h, o.h);
      if(d < FAM_MIN) out.push('Only ' + Math.round(d) + '° from ' + o.name + ' — they will be mistaken for each other.');
    });
    var clash = hueClash(m.h);
    if(clash) out.push('Reads close to ' + clash + ', which is spoken for across the whole family.');
    return out;
  }

  /* how loud a brand's primary button is against its own page */
  function famPrimary(m, dark){
    return asSister(m.parent ? null : m, function(){
      var p = build(dark), t = tokens(p, dark);
      return { fill: t.primary.hex, on: t['primary-foreground'].hex, bg: t.background.hex,
               onFill: wcag(t['primary-foreground'].hex, t.primary.hex),
               loud: wcag(t.primary.hex, t.background.hex) };
    });
  }

  function famListHtml(){
    var ms = famMembers();
    return ms.map(function(m){
      var warn = famWarnings(m);
      var strip = asSister(m.parent ? null : m, function(){
        var p = build(false);
        return STEPS.map(function(st){
          return '<span style="flex:1;height:26px;background:' + stepOf(p.main, st).hex + '"></span>';
        }).join('');
      });
      var controls = m.parent
        ? '<p class="hint" style="margin:0">The parent takes its hue from the Main control in the rail. Its neutrals and functional colours are the ones every sister inherits.</p>'
        : '<div class="row" style="margin-top:4px"><label>Hue</label><input type="range" data-fam="h" data-id="' + m.id + '" min="0" max="360" step="1" value="' + Math.round(m.h) + '"><output>' + Math.round(m.h) + '</output></div>' +
          '<div class="row"><label>Colourfulness</label><input type="range" data-fam="c" data-id="' + m.id + '" min="0.02" max="0.30" step="0.005" value="' + m.c + '"><output>' + m.c.toFixed(3).replace(/^0/,'') + '</output></div>';
      return '<div class="card">' +
        '<div class="pv-row" style="justify-content:space-between;align-items:baseline">' +
          (m.parent
            ? '<h3 style="margin:0">' + m.name + ' <span class="muted" style="font-weight:400">· parent</span></h3>'
            : '<input type="text" data-fam="name" data-id="' + m.id + '" value="' + m.name + '" style="font-weight:600;max-width:15em">') +
          '<span class="muted mono">' + Math.round(m.h) + '° · ' + (m.parent ? 'main' : slug(m.name)) + '</span>' +
        '</div>' +
        '<div style="display:flex;border-radius:8px;overflow:hidden;margin:10px 0 6px">' + strip + '</div>' +
        controls +
        (warn.length ? '<p class="hint" style="color:#d4423a">' + warn.join(' ') + '</p>' : '') +
        (m.parent ? '' : '<div class="btns" style="margin-top:8px"><button class="btn mini" data-famdel="' + m.id + '">Remove</button></div>') +
        '</div>';
    }).join('');
  }

  function famStripHtml(dark){
    return famMembers().map(function(m){
      var html = asSister(m.parent ? null : m, function(){ return previewHtml(build(dark), dark); });
      return '<div><p class="hint" style="margin:0 0 6px"><b>' + m.name + '</b> · ' + Math.round(m.h) + '°</p>' + html + '</div>';
    }).join('');
  }

  function famParityHtml(dark){
    var ms = famMembers(), base = famPrimary(ms[0], dark);
    var rows = ms.map(function(m){
      var v = famPrimary(m, dark);
      var drift = Math.abs(v.loud - base.loud);
      var note = m.parent ? 'the one the others are measured against'
        : (drift > 1.2 ? 'reads ' + (v.loud < base.loud ? 'weaker' : 'louder') + ' than the parent'
                       : (v.onFill < 4.5 ? 'its own label is short of 4.5' : 'in step'));
      var ok = m.parent || (drift <= 1.2 && v.onFill >= 4.5);
      return '<tr><td><span class="dot" style="background:' + v.fill + '"></span> ' + m.name + '</td>' +
        '<td class="mono">' + v.loud.toFixed(2) + ':1</td>' +
        '<td class="mono">' + v.onFill.toFixed(2) + ':1</td>' +
        '<td style="color:' + (ok ? 'inherit' : '#d4423a') + '">' + note + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Brand</th><th>Button against the page</th><th>Label on the button</th><th>Reading</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">A sister whose button is much quieter or much louder than the parent&rsquo;s will look like a different product, however close the hue is.</p>';
  }

  function famExport(){
    var ms = famMembers();
    return '/* ' + (S.name || 'Family') + ' — the family, generated by Palette (OKLCH) */\n' +
      '/* Neutrals and functional colours come from the parent and are the same in every block. */\n\n' +
      ms.map(function(m){
        var sel = m.parent ? ':root' : '[data-brand="' + slug(m.name) + '"]';
        return asSister(m.parent ? null : m, function(){
          var L = build(false), D = build(true);
          function block(p, s2, dark){
            var t = tokens(p, dark), lines = [];
            Object.keys(t).forEach(function(k){
              var v = t[k];
              lines.push('  --' + k + ': ' + (v.css || oklchCss(hexToOklch(v.hex).L, hexToOklch(v.hex).C, hexToOklch(v.hex).h, S.shape.gamut)) + ';');
            });
            return s2 + ' {\n' + lines.join('\n') + '\n}';
          }
          return '/* ' + m.name + ' — ' + Math.round(m.h) + '° */\n' +
            block(L, sel, false) + '\n\n' + block(D, (m.parent ? '.dark' : sel + '.dark, .dark ' + sel), true);
        });
      }).join('\n\n') + '\n';
  }

  function cssExport(){
    var L = build(false), D = build(true);
    function block(p, sel, dark){
      var t = tokens(p, dark), lines = [];
      Object.keys(t).forEach(function(k){
        var v = t[k];
        lines.push('  --' + k + ': ' + (v.css || oklchCss(hexToOklch(v.hex).L, hexToOklch(v.hex).C, hexToOklch(v.hex).h, S.shape.gamut)) + ';');
      });
      return sel + ' {\n' + lines.join('\n') + '\n  --radius: 0.625rem;\n}';
    }
    var ramps = ['main','sup','a1','a2','neutral'].concat(FUNCTIONAL.map(function(f){ return f.id; }));
    var prim = ':root {\n' + ramps.map(function(k){
      return L[k].map(function(s){ return '  --' + k + '-' + s.step + ': ' + s.css + ';'; }).join('\n');
    }).join('\n') + '\n}';
    var brands = ['main','sup','a1','a2'].filter(function(k){ return S[k] && S[k].brand; })
      .map(function(k){ return '  --' + k + '-brand: ' + S[k].brand.toLowerCase() + ';   /* the exact colour you gave */'; });
    var brandBlock = brands.length ? ':root {\n' + brands.join('\n') + '\n}\n\n' : '';
    return '/* ' + S.name + ' — generated by Palette (OKLCH) */\n\n' + brandBlock + prim + '\n\n' + block(L, ':root', false) + '\n\n' + block(D, '.dark', true) + '\n';
  }
  function jsonExport(){
    var L = build(false), D = build(true);
    function pack(p){
      var o = {};
      Object.keys(p).forEach(function(k){
        o[k] = {};
        p[k].forEach(function(s){ o[k][s.step] = { oklch:s.css, hex:s.hex }; });
      });
      return o;
    }
    return JSON.stringify({ name:S.name, settings:S, steps:STEPS, light:pack(L), dark:pack(D) }, null, 2);
  }

  /* ---------- scrim check ---------- */
  var imgData = null, imgUrl = null;
  var SCRIMS = [0, 0.2, 0.35, 0.5, 0.65];
  function scrimPreviewHtml(){
    if(!imgUrl) return '';
    return '<div class="grid3" style="margin:4px 0 14px">' + SCRIMS.map(function(a){
      var pass = imgData ? imgData.every(function(b){ return apca('#ffffff', composite('#000000', a, b.hex)) <= -60; }) : null;
      return '<figure style="margin:0">' +
        '<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--line);aspect-ratio:4/3">' +
          '<img src="' + imgUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block">' +
          '<div style="position:absolute;inset:0;background:rgba(0,0,0,' + a + ')"></div>' +
          '<span style="position:absolute;left:10px;bottom:10px;color:#fff;font-size:.82rem;font-weight:600;text-shadow:none">Caption text here</span>' +
        '</div>' +
        '<figcaption class="hint" style="margin-top:6px">' + Math.round(a*100) + '% black scrim ' +
          (pass === null ? '' : (pass ? '<span class="pill pass">passes</span>' : '<span class="pill fail">fails somewhere</span>')) +
        '</figcaption></figure>';
    }).join('') + '</div>';
  }
  function scrimHtml(){
    var p = build(false);
    var bands = imgData || [{ name:'light patch', hex:'#E9EDF2' }, { name:'dark patch', hex:'#1B222B' }];
    return bands.map(function(b){
      var need = null;
      for(var a=0; a<=0.9; a+=0.05){
        var c = composite('#000000', a, b.hex);
        if(apca('#ffffff', c) <= -60){ need = a; break; }
      }
      return '<div class="pv-row" style="margin:8px 0"><span class="dot" style="background:'+b.hex+';width:22px;height:22px"></span>'+
        '<b>'+b.name+'</b><span class="mono">'+b.hex.toUpperCase()+'</span>'+
        '<span class="pill '+(need===null?'fail':(need<=0.4?'pass':'mid'))+'">'+
        (need===null ? 'white text never passes' : 'white text passes at ' + Math.round(need*100) + '% black scrim') + '</span></div>';
    }).join('') + scrimPreviewHtml() + '<p class="hint">Measured with APCA Lc 60, the body-text level. A caption sitting over the brightest part of an image is the case that fails first.</p>';
  }
  el('imgIn').addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0]; if(!file) return;
    if(imgUrl) URL.revokeObjectURL(imgUrl);
    imgUrl = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function(){
      var c = document.createElement('canvas'), w = 120, h = Math.max(1, Math.round(120 * img.height / img.width));
      c.width = w; c.height = h;
      var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      /* sample the lower third, where captions usually sit */
      var d = ctx.getImageData(0, Math.floor(h*0.6), w, Math.max(1, Math.floor(h*0.4))).data;
      var lightest = null, darkest = null, lMax = -1, lMin = 2;
      for(var i=0;i<d.length;i+=4){
        var hex = '#' + [d[i],d[i+1],d[i+2]].map(function(v){ return (v<16?'0':'')+v.toString(16); }).join('');
        var Y = relLum(hex);
        if(Y > lMax){ lMax = Y; lightest = hex; }
        if(Y < lMin){ lMin = Y; darkest = hex; }
      }
      imgData = [{ name:'lightest pixel under the caption', hex:lightest }, { name:'darkest pixel under the caption', hex:darkest }];
      render();
    };
    img.src = imgUrl;
  });

  /* every view follows the Light / Dark / Both switch */
  function forThemes(L, D, fn){
    var list = THEME === 'dark' ? [['dark', D, true]] : (THEME === 'light' ? [['light', L, false]] : [['light', L, false], ['dark', D, true]]);
    return list.map(function(t){
      var head = list.length > 1 ? '<h3 style="margin:14px 0 8px;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)">' + (t[2] ? 'Dark' : 'Light') + '</h3>' : '';
      return '<div data-theme="' + t[0] + '">' + head + fn(t[1], t[2]) + '</div>';
    }).join('');
  }

  /* ---------- per-step editor ---------- */
  var EDITING = null;   /* { role, step } */
  function roleLabel(k){
    var r = ROLES.filter(function(x){ return x[0] === k; })[0];
    if(r) return r[1];
    var f = FUNCTIONAL.filter(function(x){ return x.id === k; })[0];
    return f ? f.name : k;
  }
  function editorHtml(L){
    var box = el('stepEditor');
    if(!EDITING){ box.hidden = true; box.innerHTML = ''; return; }
    var ramp = L[EDITING.role], sw = stepOf(ramp, EDITING.step);
    var n = (S.nudges[EDITING.role] && S.nudges[EDITING.role][EDITING.step]) || { dL:0, dC:0 };
    box.hidden = false;
    box.innerHTML =
      '<div class="top"><span class="sample" style="background:'+sw.hex+'"></span>' +
      '<b>'+roleLabel(EDITING.role)+' '+EDITING.step+'</b>' +
      '<code class="mono">'+sw.css+'</code><code class="mono muted">'+sw.hex.toUpperCase()+'</code>' +
      '<span style="flex:1"></span>' +
      '<button class="btn" id="edCopy">Copy</button>' +
      '<button class="btn" id="edReset">Reset step</button>' +
      '<button class="btn" id="edClose">Close</button></div>' +
      '<div class="row"><label for="edL">Lightness</label><input type="range" id="edL" min="-0.12" max="0.12" step="0.005" value="'+(n.dL||0)+'"><output>'+(n.dL>0?'+':'')+(n.dL||0).toFixed(3)+'</output></div>' +
      '<div class="row"><label for="edC">Colourfulness</label><input type="range" id="edC" min="-0.10" max="0.10" step="0.005" value="'+(n.dC||0)+'"><output>'+(n.dC>0?'+':'')+(n.dC||0).toFixed(3)+'</output></div>' +
      '<p class="hint">Nudges this one step only; the rest of the ramp stays where it is. A dashed outline marks steps you have moved.</p>';
    function setNudge(key, val){
      S.nudges[EDITING.role] = S.nudges[EDITING.role] || {};
      var cur = S.nudges[EDITING.role][EDITING.step] || { dL:0, dC:0 };
      cur[key] = parseFloat(val);
      if(!cur.dL && !cur.dC){ delete S.nudges[EDITING.role][EDITING.step]; }
      else { S.nudges[EDITING.role][EDITING.step] = cur; }
      render();
    }
    el('edL').addEventListener('input', function(){ dragging('nudge:L'); setNudge('dL', this.value); });
    el('edC').addEventListener('input', function(){ dragging('nudge:C'); setNudge('dC', this.value); });
    el('edCopy').addEventListener('click', function(){ navigator.clipboard && navigator.clipboard.writeText(sw.css); this.textContent = 'Copied'; });
    el('edReset').addEventListener('click', function(){
      if(S.nudges[EDITING.role]) delete S.nudges[EDITING.role][EDITING.step];
      render();
    });
    el('edClose').addEventListener('click', function(){ EDITING = null; render(); });
  }

  /* ---------- which step each token uses ---------- */
  var MAP_FIELDS = [
    ['primary','Primary · light', [400,500,600,700,800]],
    ['primaryDark','Primary · dark', [300,400,500,600,700]],
    ['tint','Tint surface · light', [50,100,200]],
    ['tintDark','Tint surface · dark', [800,900,950]],
    ['border','Hairline · light', [100,200,300]],
    ['borderDark','Hairline · dark', [700,800,900]],
    ['ring','Focus ring · light', [500,600,700]],
    ['ringDark','Focus ring · dark', [300,400,500]]
  ];
  /* which ramp each mapped token reads, so the control can show the colour it produces */
  var MAP_SOURCE = { primary:'main', primaryDark:'main', tint:'sup', tintDark:'sup',
                     border:'neutral', borderDark:'neutral', ring:'main', ringDark:'main' };
  function mapControlsHtml(L, D){
    return MAP_FIELDS.map(function(f){
      var dark = /Dark$/.test(f[0]);
      var sw = stepOf((dark ? D : L)[MAP_SOURCE[f[0]]], S.map[f[0]]);
      return '<div class="field" style="grid-template-columns:minmax(0,1fr)"><label for="map-'+f[0]+'">'+f[1]+'</label>' +
        '<select id="map-'+f[0]+'" data-map="'+f[0]+'">' +
        f[2].map(function(v){ return '<option value="'+v+'"'+(S.map[f[0]] === v ? ' selected' : '')+'>'+v+'</option>'; }).join('') +
        '</select>' +
        '<span class="swatch-inline" style="margin-top:6px"><span class="dot" style="background:'+sw.hex+'"></span><span class="mono">'+sw.hex.toUpperCase()+'</span></span>' +
        '</div>';
    }).join('');
  }
  /* the four things the mapping actually changes, drawn live */
  function mapDemoHtml(p, dark){
    var t = tokens(p, dark);
    return '<div class="preview" style="background:'+t.background.hex+';color:'+t.foreground.hex+';padding:16px">' +
      '<div class="pv-row" style="gap:14px;align-items:center">' +
        '<span class="pv-btn" style="background:'+t.primary.hex+';color:'+t['primary-foreground'].hex+'">Primary button</span>' +
        '<span class="pv-btn" style="background:'+t.secondary.hex+';color:'+t['secondary-foreground'].hex+'">Tinted surface</span>' +
        '<span style="display:inline-flex;align-items:center;gap:8px;font-size:.78rem">Hairline<span style="display:inline-block;width:64px;height:1px;background:'+t.border.hex+'"></span></span>' +
        '<span class="pv-btn" style="background:transparent;color:'+t.foreground.hex+';border:1px solid '+t.border.hex+';box-shadow:0 0 0 3px '+t.ring.hex+'">Focused field</span>' +
      '</div></div>';
  }

  /* ---------- render ---------- */
  function render(){
    readControls();
    syncControls();
    var L = build(false), D = build(true);

    [['chipMain','main',600,'xMain','anMain'],['chipSup','sup',500,'xSup','anSup'],
     ['chipA1','a1',500,'xA1','anA1'],['chipA2','a2',600,'xA2','anA2'],
     ['chipNeu','neutral',300,null,null]].forEach(function(c){
      var ramp = L[c[1]], brand = S[c[1]] && S[c[1]].brand;
      var node = el(c[0]); if(node) node.style.background = stepOf(ramp, c[2]).hex;
      var input = c[3] && el(c[3]);
      if(input && document.activeElement !== input) input.value = brand || '';
      var line = c[4] && el(c[4]);
      if(!line) return;
      if(!brand){ line.innerHTML = ''; return; }
      var near = nearestStep(ramp, brand);
      var pinned = S[c[1]].pin !== false;
      var bc = hexToOklch(brand);
      var drift = Math.abs(((S[c[1]].h - bc.h + 540) % 360) - 180);   /* how far the ramp has been moved */
      var off = drift > 4 || Math.abs(S[c[1]].c - bc.C) > 0.015;
      line.innerHTML =
        '<span class="pair"><span style="background:'+brand+'"></span>' + (pinned ? '' : '<span style="background:'+near.hex+'"></span>') + '</span>' +
        (off
          ? '<span>ramp moved off your colour</span><button class="btn mini" data-restore="'+c[1]+'">Back to ' + brand.toUpperCase() + '</button>'
          : (pinned
              ? '<span>your colour sits at <b>step ' + near.step + '</b>; the ramp is built around it</span>'
              : '<span>yours vs <b>step ' + near.step + '</b> ' + near.hex.toUpperCase() + '</span>')) +
        '<button class="btn mini" data-clearbrand="'+c[1]+'" title="Forget this brand colour">✕</button>';
    });
    var clash = hueClash(S.main.h);
    el('rampMeta').textContent = Math.round(S.main.h) + '° main · ' + STEPS.length + ' steps · one set of hues for both themes · ' + (S.shape.gamut === 'p3' ? 'Display P3' : 'sRGB') + (clash ? ' · reads close to ' + clash : '');

    el('stepsHead').innerHTML = stepsHeadHtml();
    el('stepsHeadDark').innerHTML = stepsHeadHtml();
    el('rampsLight').innerHTML = rampsHtml(L,false);
    el('rampsDark').innerHTML = rampsHtml(D,true);

    var sh = S.share, total = sh.neutral+sh.sup+sh.main+sh.a1+sh.a2 || 1;
    var parts = [['neutral',stepOf(L.neutral,200).hex],['sup',stepOf(L.sup,500).hex],['main',stepOf(L.main,600).hex],['a1',stepOf(L.a1,500).hex],['a2',stepOf(L.a2,600).hex]];
    var bar = parts.map(function(pt){ return '<span style="flex:'+sh[pt[0]]+';background:'+pt[1]+'"></span>'; }).join('');
    el('shareBar').innerHTML = bar;
    if(el('railShare')) el('railShare').innerHTML = bar;
    el('shareLegend').innerHTML = parts.map(function(pt,i){
      var names = ['Neutral','Supporting','Main','Accent 1','Accent 2'];
      return '<span class="swatch-inline"><span class="dot" style="background:'+pt[1]+'"></span><b>'+Math.round(sh[pt[0]]/total*100)+'%</b> '+names[i]+'</span>';
    }).join('');
    el('shareSum').textContent = 'Always totals 100% — moving one slider rebalances the others.';

    el('mapControls').innerHTML = mapControlsHtml(L, D);
    el('mapDemo').innerHTML = forThemes(L, D, function(p, dk){ return mapDemoHtml(p, dk); });
    el('roleTable').innerHTML = forThemes(L, D, function(p){ return roleTableHtml(p); });
    el('funcTable').innerHTML = forThemes(L, D, function(p, dk){ return funcTableHtml(p, dk); });
    el('stateTable').innerHTML = forThemes(L, D, function(p, dk){ return stateTableHtml(p, dk); });

    el('ctTokens').innerHTML = forThemes(L, D, function(p, dk){ return tokenAuditHtml(p, dk); });
    el('ctText').innerHTML = forThemes(L, D, function(p, dk){ return contrastTextHtml(p, dk); });
    el('ctFill').innerHTML = forThemes(L, D, function(p, dk){ return contrastFillHtml(p, dk); });
    el('contrastMeta').textContent = 'WCAG 2 · APCA Lc';

    el('alphaMatrix').innerHTML = forThemes(L, D, function(p, dk){ return alphaHtml(p, dk); });
    el('scrimOut').innerHTML = scrimHtml();
    el('gradOut').innerHTML = forThemes(L, D, function(p){ return '<div class="grid2">' + gradientsHtml(p) + '</div>'; });
    el('previewOut').innerHTML = forThemes(L, D, function(p, dk){ return previewHtml(p, dk); });

    el('famList').innerHTML = famListHtml();
    el('famStrip').innerHTML = forThemes(L, D, function(p, dk){ return famStripHtml(dk); });
    el('famParity').innerHTML = forThemes(L, D, function(p, dk){ return famParityHtml(dk); });
    el('outFamily').textContent = famExport();
    el('famMeta').textContent = sisters().length
      ? (sisters().length + (sisters().length === 1 ? ' sister' : ' sisters') + ' · shared neutrals and functional colours')
      : 'just the parent so far';

    el('outCss').textContent = cssExport();
    el('outJson').textContent = jsonExport();

    editorHtml(L);
    applyTheme();
    pushHistory();
    libUi();          /* so the library line always says whether this differs from what you kept */
    try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){}
  }

  /* ---------- history: the last 30 changes, with undo and redo ---------- */
  var HIST = [], HPOS = -1, RESTORING = false, LAST_PUSH = 0;
  var HIST_MAX = 30, COALESCE = 500;   /* one slider drag is one change, not forty */
  /* only a continuous drag folds into one step; a click is always its own change,
     so Remove then Undo works however fast the two come */
  var GESTURE = null, LAST_GESTURE = null;
  function dragging(tag){ GESTURE = tag; }

  function pushHistory(){
    if(RESTORING) return;
    var snap = JSON.stringify(S);
    if(HIST[HPOS] === snap) return;
    var now = Date.now();
    var same = GESTURE && GESTURE === LAST_GESTURE && now - LAST_PUSH < COALESCE;
    LAST_GESTURE = GESTURE; GESTURE = null;
    if(HPOS >= 0 && same){                         /* still the same drag — replace the top */
      HIST[HPOS] = snap; LAST_PUSH = now; histUi(); return;
    }
    HIST = HIST.slice(0, HPOS + 1);                /* a new change drops anything redone past here */
    HIST.push(snap);
    if(HIST.length > HIST_MAX + 1) HIST.shift();
    HPOS = HIST.length - 1; LAST_PUSH = now;
    histUi();
  }
  function goTo(i){
    if(i < 0 || i >= HIST.length || i === HPOS) return;
    HPOS = i; RESTORING = true;
    S = JSON.parse(HIST[i]); EDITING = null;
    syncControls(); render();
    RESTORING = false; LAST_PUSH = 0; GESTURE = null; LAST_GESTURE = null;
    try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){}
    histUi();
  }
  function histUi(){
    var back = HPOS, fwd = HIST.length - 1 - HPOS;
    el('btnUndo').disabled = back <= 0;
    el('btnRedo').disabled = fwd <= 0;
    el('btnUndo').textContent = 'Undo' + (back > 0 ? ' (' + back + ')' : '');
    el('btnRedo').textContent = 'Redo' + (fwd > 0 ? ' (' + fwd + ')' : '');
    el('histMeta').textContent = back === 0
      ? 'Nothing to undo yet.'
      : back + (back === 1 ? ' change' : ' changes') + ' back' + (fwd ? ', ' + fwd + ' forward' : '') + '.';
  }
  el('btnUndo').addEventListener('click', function(){ goTo(HPOS - 1); });
  el('btnRedo').addEventListener('click', function(){ goTo(HPOS + 1); });
  document.addEventListener('keydown', function(e){
    if(!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    var t = e.target;
    if(t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.type === 'text') return;   /* let a text field undo its own typing */
    e.preventDefault();
    goTo(e.shiftKey ? HPOS + 1 : HPOS - 1);
  });

  /* ---------- library: named palettes kept in this browser ---------- */
  var CURRENT = null;   /* id of the library entry this palette came from */

  function libRead(){
    try{ var d = JSON.parse(localStorage.getItem(LIB) || 'null'); return (d && d.items) ? d.items : []; }
    catch(e){ return []; }
  }
  function libWrite(items){
    try{ localStorage.setItem(LIB, JSON.stringify({ items: items })); }catch(e){}
  }
  function libId(){ return 'p' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36); }
  function libUi(){
    var items = libRead(), sel = el('libList');
    sel.innerHTML = '<option value="">— not saved —</option>' + items.map(function(it){
      return '<option value="' + it.id + '"' + (it.id === CURRENT ? ' selected' : '') + '>' + it.name + '</option>';
    }).join('');
    var here = items.filter(function(it){ return it.id === CURRENT; })[0];
    var dirty = here && JSON.stringify(here.settings) !== JSON.stringify(S);
    el('libMeta').textContent = items.length === 0
      ? 'Nothing kept yet. Keep this one and it stays here between visits.'
      : items.length + (items.length === 1 ? ' palette' : ' palettes') + ' kept'
        + (here ? ' · on “' + here.name + '”' + (dirty ? ', changed since you kept it' : '') : ' · this one is not among them') + '.';
    el('btnLibDel').disabled = !here;
    el('btnLibSave').textContent = here && !dirty ? 'Kept' : (here ? 'Update “' + here.name + '”' : 'Keep this one');
    resetDeleteButton();
  }
  function libLoad(id){
    var it = libRead().filter(function(x){ return x.id === id; })[0];
    if(!it) return;
    CURRENT = id;
    S = JSON.parse(JSON.stringify(it.settings));
    S.family = S.family || { sisters:[] };     /* palettes kept before families existed */
    EDITING = null;
    syncControls(); render();   /* a switch is a change, so it lands in history and can be undone */
    libUi();
  }
  el('btnLibSave').addEventListener('click', function(){
    var items = libRead();
    var here = items.filter(function(it){ return it.id === CURRENT; })[0];
    var byName = items.filter(function(it){ return it.name === S.name; })[0];
    /* a new name means a new palette: renaming should never quietly overwrite the one you had */
    var target = (here && here.name === S.name) ? here : byName;
    if(target){ target.name = S.name; target.settings = JSON.parse(JSON.stringify(S)); target.saved = Date.now(); CURRENT = target.id; }
    else { var it = { id: libId(), name: S.name, settings: JSON.parse(JSON.stringify(S)), saved: Date.now() }; items.push(it); CURRENT = it.id; }
    libWrite(items); libUi();
  });
  el('btnLibDup').addEventListener('click', function(){
    var items = libRead();
    var base = S.name.replace(/ copy( \d+)?$/, ''), name = base + ' copy', n = 2;
    while(items.some(function(it){ return it.name === name; })){ name = base + ' copy ' + (n++); }
    S.name = name;
    var it = { id: libId(), name: name, settings: JSON.parse(JSON.stringify(S)), saved: Date.now() };
    items.push(it); CURRENT = it.id;
    libWrite(items);
    syncControls(); render(); libUi();
  });
  /* deleting is the one thing here that cannot be undone, so it asks once */
  var ARMED = false;
  function resetDeleteButton(){
    ARMED = false;
    var b = el('btnLibDel');
    b.textContent = 'Delete'; b.classList.remove('danger');
  }
  el('btnLibDel').addEventListener('click', function(){
    var b = el('btnLibDel');
    if(!ARMED){ ARMED = true; b.textContent = 'Delete for good?'; b.classList.add('danger'); return; }
    libWrite(libRead().filter(function(it){ return it.id !== CURRENT; }));
    CURRENT = null;          /* the colours stay on screen; only the saved copy goes */
    libUi();
  });
  el('libList').addEventListener('change', function(){
    var v = el('libList').value;
    if(v) libLoad(v); else { CURRENT = null; libUi(); }
  });

  /* ---------- family controls ---------- */
  el('btnFamAdd').addEventListener('click', function(){
    S.family = S.family || { sisters:[] };
    var h = freeHue();
    S.family.sisters.push({ id:'s' + Date.now().toString(36), name:'Sister ' + (S.family.sisters.length + 1), h:h, c:S.main.c });
    render();
  });
  /* push the sisters apart so no two are mistaken for each other */
  el('btnFamSpread').addEventListener('click', function(){
    var ss = sisters(); if(!ss.length) return;
    var step = 360 / (ss.length + 1);
    ss.forEach(function(sis, i){
      var h = (S.main.h + step * (i + 1)) % 360, guard = 0;
      while(hueClash(h) && guard++ < 40) h = (h + 3) % 360;   /* step off a functional hue */
      sis.h = Math.round(h);
    });
    render();
  });
  el('famList').addEventListener('input', function(e){
    var i = e.target.closest('[data-fam]'); if(!i) return;
    var sis = sisters().filter(function(x){ return x.id === i.dataset.id; })[0]; if(!sis) return;
    if(i.dataset.fam === 'h'){ sis.h = +i.value; dragging('fam:' + i.dataset.id + ':h'); }
    else if(i.dataset.fam === 'c'){ sis.c = +i.value; dragging('fam:' + i.dataset.id + ':c'); }
    else return;                      /* the name is handled on change, so typing is not interrupted */
    render();
  });
  el('famList').addEventListener('change', function(e){
    var i = e.target.closest('[data-fam="name"]'); if(!i) return;
    var sis = sisters().filter(function(x){ return x.id === i.dataset.id; })[0]; if(!sis) return;
    sis.name = i.value.trim() || 'Sister';
    render();
  });
  el('famList').addEventListener('click', function(e){
    var b = e.target.closest('[data-famdel]'); if(!b) return;
    S.family.sisters = sisters().filter(function(x){ return x.id !== b.dataset.famdel; });
    render();          /* removing a sister is a change like any other, so undo brings it back */
  });

  /* which theme the views show; Both shows them side by side */
  function applyTheme(){
    /* the ramp cards are written into the page, so they are filtered here;
       every other view is already built for the chosen theme */
    document.querySelectorAll('.card[data-theme]').forEach(function(card){
      card.style.display = (THEME === 'both' || card.dataset.theme === THEME) ? '' : 'none';
    });
    document.documentElement.style.colorScheme = THEME === 'dark' ? 'dark' : 'light';
  }
  el('themeSeg').addEventListener('click', function(e){
    var b = e.target.closest('button[data-theme]'); if(!b) return;
    THEME = b.dataset.theme;
    [].forEach.call(el('themeSeg').children, function(x){ x.setAttribute('aria-selected', String(x === b)); });
    /* the tool itself follows the switch, so a dark palette is judged on a dark page */
    document.documentElement.setAttribute('data-ui', THEME === 'dark' ? 'dark' : 'light');
    render();   /* every view is built for the chosen theme, not just hidden */
  });

  [['pinMain','main'],['pinSup','sup'],['pinA1','a1'],['pinA2','a2']].forEach(function(p){
    var box = el(p[0]); if(!box) return;
    box.addEventListener('change', function(){ S[p[1]].pin = box.checked; render(); });
  });

  /* paste a brand hex: its hue and chroma drive the ramp, the lightness steps stay fixed */
  [['xMain','main'],['xSup','sup'],['xA1','a1'],['xA2','a2']].forEach(function(pair){
    var input = el(pair[0]); if(!input) return;
    input.addEventListener('change', function(){
      var v = input.value.trim();
      if(/^#?[0-9a-f]{6}$/i.test(v)){
        var hex = (v[0] === '#' ? v : '#' + v).toUpperCase();
        var c = hexToOklch(hex);
        S[pair[1]].brand = hex;               /* the colour you gave, kept exactly */
        S[pair[1]].h = c.h;
        S[pair[1]].c = Math.min(c.C, pair[1] === 'sup' ? 0.30 : 0.32);
        if(pair[1] === 'sup') S.sup.rel = 'custom';
        if(pair[1] === 'main' && S.neutral.from === 'own') S.neutral.h = c.h;
        syncControls(); render();
      } else if(v){ S[pair[1]].brand = null; input.value = ''; render(); }
    });
  });

  /* ---------- wiring ---------- */
  document.querySelectorAll('.rail input, .rail select').forEach(function(i){
    if(i.type === 'checkbox') return;   /* checkboxes own their state; a generic re-render would undo the click */
    var shareKey = SHARE_KEYS.filter(function(k){ return SHARE_INPUT[k] === i.id; })[0];
    function handle(ev){
      if(i.type === 'range' && ev && ev.type === 'input') dragging('rail:' + i.id);
      if(shareKey){
        S.share[shareKey] = parseFloat(i.value);
        balanceShares(shareKey);
        syncControls();
      }
      render();
    }
    i.addEventListener('input', handle);
    i.addEventListener('change', handle);
  });
  document.addEventListener('click', function(e){
    var back = e.target.closest('[data-restore]');
    if(back){
      var k = back.dataset.restore, c = hexToOklch(S[k].brand);
      S[k].h = c.h; S[k].c = Math.min(c.C, 0.32); S[k].pin = true;
      if(k === 'sup') S.sup.rel = 'custom';
      syncControls(); render(); return;
    }
    var clear = e.target.closest('[data-clearbrand]');
    if(clear){ S[clear.dataset.clearbrand].brand = null; syncControls(); render(); return; }
  });
  document.addEventListener('change', function(e){
    var sel = e.target.closest('[data-map]');
    if(!sel) return;
    S.map[sel.dataset.map] = parseInt(sel.value, 10);
    render();
  });
  el('tabs').addEventListener('click', function(e){
    var b = e.target.closest('button[data-view]'); if(!b) return;
    [].forEach.call(el('tabs').children, function(x){ x.setAttribute('aria-selected', String(x === b)); });
    document.querySelectorAll('section.view').forEach(function(s){ s.classList.toggle('on', s.dataset.view === b.dataset.view); });
  });
  document.addEventListener('click', function(e){
    var step = e.target.closest('.sw[data-role]');
    if(step){
      EDITING = { role:step.dataset.role, step:+step.dataset.step };
      render();
      var box = el('stepEditor'); if(box && box.scrollIntoView) box.scrollIntoView({ block:'nearest' });
      return;
    }
    var cell = e.target.closest('[data-value]');
    if(cell){ navigator.clipboard && navigator.clipboard.writeText(cell.dataset.value); cell.style.outline='2px solid var(--accent)'; setTimeout(function(){ cell.style.outline=''; },400); return; }
    var mapSel = e.target.closest('[data-map]');
    if(mapSel) return;
    var cp = e.target.closest('[data-copy]');
    if(cp){ navigator.clipboard && navigator.clipboard.writeText(el(cp.dataset.copy).textContent); cp.textContent='Copied'; setTimeout(function(){ cp.textContent='Copy'; },900); return; }
    var dl = e.target.closest('[data-dl]');
    if(dl){
      var kind = dl.dataset.dl;
      var text = kind === 'css' ? cssExport() : (kind === 'family' ? famExport() : jsonExport());
      var blob = new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/css' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = slug(S.name) + (kind === 'json' ? '.json' : (kind === 'family' ? '.family.css' : '.css'));
      a.click();
    }
  });
  el('btnSave').addEventListener('click', function(){
    var blob = new Blob([jsonExport()], { type:'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = S.name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '.palette.json'; a.click();
  });
  el('btnLoad').addEventListener('click', function(){ el('fileIn').click(); });
  el('fileIn').addEventListener('change', function(e){
    var f = e.target.files && e.target.files[0]; if(!f) return;
    var r = new FileReader();
    r.onload = function(){
      try{
        var d = JSON.parse(r.result);
        if(d.settings){ S = d.settings; S.family = S.family || { sisters:[] }; syncControls(); render(); }
      }catch(err){ alert('That file is not a palette export.'); }
    };
    r.readAsText(f);
  });
  el('btnRandom').addEventListener('click', function(){
    var h = Math.floor(Math.random()*360);
    while(hueClash(h)) h = Math.floor(Math.random()*360);
    S.main.h = h; S.main.c = 0.11 + Math.random()*0.10;
    S.sup.rel = ['same','near','far'][Math.floor(Math.random()*3)];
    S.a1.h = (h + 150 + Math.floor(Math.random()*60)) % 360;
    S.a2.h = (S.a1.h + 20 + Math.floor(Math.random()*40)) % 360;
    S.neutral.h = h;
    syncControls(); render();
  });
  el('btnReset').addEventListener('click', function(){
    S = JSON.parse(JSON.stringify(DEFAULTS)); EDITING = null; syncControls(); render();
  });

  try{
    var saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if(saved && saved.main){
      S = saved;
      S.map = S.map || JSON.parse(JSON.stringify(DEFAULTS.map));
      S.nudges = S.nudges || {};
      S.darkMode = S.darkMode || JSON.parse(JSON.stringify(DEFAULTS.darkMode));
      S.family = S.family || { sisters:[] };
    }
  }catch(e){}
  syncControls();
  render();
  histUi();
  libUi();
})();
</script>
</body>
</html>
