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
    map:{ primary:700, primaryDark:400, tint:100, tintDark:900, border:200, borderDark:800, ring:600, ringDark:400, chart:600, chartDark:400 },
    nudges:{},
    share:{neutral:55, sup:22, main:15, a1:6, a2:2},
    family:{ sisters:[] },
    func:{}          /* only what you have moved; the rest keep their defaults */
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
  /* a functional colour keeps its default hue and chroma until you move it */
  function funcOf(f){
    var over = (S.func || {})[f.id] || {};
    return { h: over.h === undefined ? f.hue : over.h,
             c: over.c === undefined ? f.chroma : over.c,
             moved: over.h !== undefined || over.c !== undefined };
  }
  function funcHues(){ return FUNCTIONAL.map(function(f){ return funcOf(f).h; }); }
  liveFunctionalHues = funcHues;   /* every clash check now reads where they really are */

  /* what a functional colour could be confused with, brand or each other */
  var BRAND_HUES = function(){
    return [['main','Main'],['sup','Supporting'],['a1','Accent 1'],['a2','Accent 2']]
      .map(function(r){ return { name:r[1], h:S[r[0]].h }; });
  };
  function funcWarnings(f){
    var me = funcOf(f).h, out = [];
    BRAND_HUES().forEach(function(b){
      var d = hueGapDeg(me, b.h);
      if(d < 20) out.push('Only ' + Math.round(d) + '° from your ' + b.name + ' colour — a ' + f.name.toLowerCase() + ' mark will read as brand, not as a state.');
    });
    FUNCTIONAL.forEach(function(o){
      if(o.id === f.id) return;
      var d = hueGapDeg(me, funcOf(o).h);
      if(d < 16) out.push('Only ' + Math.round(d) + '° from ' + o.name + '.');
    });
    return out;
  }
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
      var set = funcOf(f);
      fo.nudges = nudgesFor(f.id);
      fo.twist = defaultTwist(set.h) * tw;
      p[f.id] = makeRamp(set.h, set.c, fo);
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
      ? { paper:950, panel:900, hairline:m.borderDark||800, quiet:400, ink:50, fill:m.primaryDark||400, tint:m.tintDark||900, tintText:200, ring:m.ringDark||400, chart:m.chartDark||400 }
      : { paper:50,  panel:100, hairline:m.border||200,     quiet:700, ink:950, fill:m.primary||700,     tint:m.tint||100,    tintText:900, ring:m.ring||600,     chart:m.chart||600 };
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
      'chart-1': stepOf(p.main,S_.chart), 'chart-2': stepOf(p.sup,S_.chart), 'chart-3': stepOf(p.a1,S_.chart),
      'chart-4': stepOf(p.a2,S_.chart), 'chart-5': stepOf(p.success,S_.chart),
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
      var set = funcSet(p[f.id], dark), cur = funcOf(f), warn = funcWarnings(f);
      function cell(s){ return '<span class="dot" style="background:'+s.hex+'"></span><span class="mono">'+s.hex.toUpperCase()+'</span>'; }
      return '<tr' + (warn.length ? ' class="row-fail"' : '') + '><td><b>'+f.name+'</b><div class="muted">'+f.note+'</div>' +
        '<div class="func-ctl">' +
          '<label>Hue<input type="range" data-fx="h" data-id="'+f.id+'" min="0" max="360" step="1" value="'+Math.round(cur.h)+'"><output>'+Math.round(cur.h)+'\u00b0</output></label>' +
          '<label>Colour<input type="range" data-fx="c" data-id="'+f.id+'" min="0.04" max="0.26" step="0.005" value="'+cur.c+'"><output>'+cur.c.toFixed(3).replace(/^0/,'')+'</output></label>' +
          (cur.moved ? '<button class="btn mini" data-fxreset="'+f.id+'">Default</button>' : '') +
        '</div>' +
        (warn.length ? '<div class="hint" style="color:#b83029">'+warn.join(' ')+'</div>' : '') +
        '</td>'+
        '<td>'+cell(set.surface)+'</td><td>'+cell(set.border)+'</td><td>'+cell(set.text)+'</td><td>'+cell(set.fill)+'</td></tr>';
    }).join('');
    var clashing = FUNCTIONAL.filter(function(f){ return funcWarnings(f).length; });
    return '<p class="cap' + (clashing.length ? ' fail-cap' : '') + '">' +
        (clashing.length
          ? clashing.map(function(f){ return f.name; }).join(', ') +
            (clashing.length === 1 ? ' sits' : ' sit') + ' close enough to a brand colour, or to another state, to be mistaken for it.'
          : 'Every state colour is far enough from the brand colours, and from the others, to read as a state.') +
      '</p>' +
      '<p class="hint" style="margin:0 0 8px">A state colour is only useful if it cannot be read as brand. Moving one stays within 45° of where it started, because a Danger that lands in the greens has stopped meaning danger.</p>' +
      '<div class="btns" style="margin:0 0 10px"><button class="btn" id="btnFuncClear">Move them off the brand hues</button><button class="btn" id="btnFuncReset">Back to defaults</button></div>' +
      '<table><thead><tr><th style="width:38%">Meaning</th><th>Surface</th><th>Border</th><th>Text</th><th>Fill</th></tr></thead><tbody>'+rows+'</tbody></table>';
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
  /* ---------- share of surface, measured ----------
     The five sliders are an intention. This reads the preview that was just
     drawn and reports what it actually covers, so the intention can be
     checked against something rather than merely stated. */
  var SHARE_ROLES = ['neutral','sup','main','a1','a2'];
  function classify(hex, ramps){
    var t = hexToOklch(hex), best = null, bd = 9;
    SHARE_ROLES.forEach(function(k){
      ramps[k].forEach(function(st){
        var dh = Math.min(Math.abs(((st.h - t.h + 540) % 360) - 180), 180) / 180;
        var d = Math.abs(st.L - t.L) + Math.abs(st.C - t.C) * 2 + dh * (t.C < 0.02 ? 0.05 : 0.9);
        if(d < bd){ bd = d; best = k; }
      });
    });
    return bd < 0.09 ? best : null;   /* a colour far from every ramp is a state colour or an image */
  }
  function measureShare(root, ramps){
    if(!root) return null;
    var area = {}, total = 0;
    SHARE_ROLES.forEach(function(k){ area[k] = 0; });
    var nodes = [].slice.call(root.querySelectorAll('*'));
    var base = root.getBoundingClientRect();
    var baseArea = base.width * base.height;
    if(!baseArea) return null;
    nodes.forEach(function(n){
      var cs = getComputedStyle(n), bg = cs.backgroundColor;
      if(!bg || bg === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(bg)) return;
      var r = n.getBoundingClientRect();
      var own = r.width * r.height;
      if(own <= 0) return;
      /* a child with its own background covers part of its parent */
      [].forEach.call(n.children, function(ch){
        var ccs = getComputedStyle(ch);
        if(ccs.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(ccs.backgroundColor) && ccs.backgroundColor !== 'transparent'){
          var cr = ch.getBoundingClientRect();
          own -= Math.max(0, cr.width * cr.height);
        }
      });
      if(own <= 0) return;
      var m = bg.match(/(\d+), *(\d+), *(\d+)/);
      if(!m) return;
      var hex = '#' + [1,2,3].map(function(i){ var v = +m[i]; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
      var role = classify(hex, ramps);
      if(!role) return;
      area[role] += own; total += own;
    });
    /* the page itself, wherever nothing was drawn over it */
    var covered = 0;
    SHARE_ROLES.forEach(function(k){ covered += area[k]; });
    if(covered < baseArea) area.neutral += baseArea - covered;
    total = 0; SHARE_ROLES.forEach(function(k){ total += area[k]; });
    if(!total) return null;
    var out = {};
    SHARE_ROLES.forEach(function(k){ out[k] = area[k] / total * 100; });
    return out;
  }
  var MEASURED = null;
  function shareCheckHtml(){
    var names = { neutral:'Neutral', sup:'Supporting', main:'Main', a1:'Accent 1', a2:'Accent 2' };
    var sh = S.share, total = 0;
    SHARE_ROLES.forEach(function(k){ total += sh[k]; });
    if(!MEASURED){
      return '<p class="hint">Open the Preview once and this will say what that screen actually covers, against the shares you set.</p>';
    }
    var rows = SHARE_ROLES.map(function(k){
      var want = sh[k] / (total || 1) * 100, got = MEASURED[k];
      var off = got - want;
      var verdict = Math.abs(off) < 5 ? '<span class="pill pass">about right</span>'
        : '<span class="pill ' + (Math.abs(off) < 12 ? 'mid' : 'fail') + '">' + (off > 0 ? 'over by ' : 'under by ') + Math.round(Math.abs(off)) + '</span>';
      return '<tr><td>' + names[k] + '</td><td class="mono">' + Math.round(want) + '%</td>' +
        '<td class="mono">' + Math.round(got) + '%</td><td>' + verdict + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Role</th><th>You asked for</th><th>The preview draws</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">Measured off the preview screen by area, counting only what is drawn in a role colour. One screen is not a whole product, so read it as a sanity check on the intention — not as a verdict.</p>';
  }

  /* ---------- does the brand colour reach the interface? ----------
     Pinning a hex into a ramp is not the same as a token using it. A colour
     pinned at step 400 while every token reads 100 and 700 appears nowhere. */
  var BRAND_ROLES = [['main','Main'],['sup','Supporting'],['a1','Accent 1'],['a2','Accent 2']];
  function brandStepOf(role){
    var conf = S[role];
    if(!conf || !conf.brand || conf.pin === false) return null;
    return nearestStep(build(false)[role], conf.brand).step;
  }
  /* the mapping controls that can be pointed at a given role */
  var ROLE_FIELDS = { main: ['primary','primaryDark','ring','ringDark','chart','chartDark'],
                      sup:  ['tint','tintDark'], a1: [], a2: [] };

  function brandReach(){
    var L = build(false), D = build(true);
    var tl = tokens(L, false), td = tokens(D, true);
    return BRAND_ROLES.map(function(r){
      var conf = S[r[0]], hex = conf && conf.brand;
      if(!hex || conf.pin === false) return null;
      var up = hex.toUpperCase();
      var step = nearestStep(L[r[0]], hex).step;
      var used = [];
      TOKEN_NAMES.forEach(function(n){
        if(tl[n] && tl[n].hex.toUpperCase() === up) used.push(n);
        else if(td[n] && td[n].hex.toUpperCase() === up && used.indexOf(n + ' (dark)') === -1) used.push(n + ' (dark)');
      });
      /* which control could be pointed at this step, if none is already */
      var offers = (ROLE_FIELDS[r[0]] || []).map(function(f){
        var def = MAP_FIELDS.filter(function(x){ return x[0] === f; })[0];
        if(!def || fieldOptions(f).indexOf(step) === -1) return null;
        return { field: f, label: def[1], already: S.map[f] === step };
      }).filter(Boolean);
      return { key:r[0], name:r[1], hex:up, step:step, used:used, offers:offers };
    }).filter(Boolean);
  }

  function brandReachHtml(){
    var rows = brandReach();
    if(!rows.length){
      return '<p class="cap">No brand colour is pinned yet. Paste one into a role in the rail and this will say exactly where it ends up.</p>';
    }
    return rows.map(function(r){
      var body;
      if(r.used.length){
        body = '<p class="cap" style="margin:6px 0 0">Used by ' +
          r.used.map(function(n){ return '<code>' + n + '</code>'; }).join(', ') + '.</p>';
      } else {
        var offers = r.offers.filter(function(o){ return !o.already; });
        body = '<p class="cap fail-cap" style="margin:6px 0 0">No token uses this colour. It sits in the ramp at step ' + r.step +
          ', and nothing reads step ' + r.step + ' of ' + r.name + '.</p>' +
          (offers.length
            ? '<div class="btns" style="margin-top:8px">' + offers.map(function(o){
                return '<button class="btn mini" data-fixmap="' + o.field + '" data-fixstep="' + r.step + '">Point ' + o.label.toLowerCase() + ' at it</button>';
              }).join('') + '</div>'
            : '<p class="hint" style="margin-top:6px">' + (r.offers.length
                ? 'Every control that could reach it already points elsewhere on purpose.'
                : 'No token reads this role directly — ' + r.name + ' reaches the interface through tinted surfaces, which use the pale end. Move your colour to the pale end, or use it as artwork rather than as a token.') + '</p>');
      }
      return '<div style="padding:10px 0;border-top:1px solid var(--line)">' +
        '<div class="pv-row" style="gap:10px">' +
          '<span class="dot" style="background:' + r.hex + ';width:22px;height:22px"></span>' +
          '<b>' + r.name + '</b><span class="mono">' + r.hex + '</span>' +
          '<span class="muted">step ' + r.step + '</span>' +
          '<span class="pill ' + (r.used.length ? 'pass' : 'fail') + '" style="margin-left:auto">' +
            (r.used.length ? 'reaches the interface' : 'never appears') + '</span>' +
        '</div>' + body + '</div>';
    }).join('');
  }
  /* the short version, for the rail: does this one land anywhere? */
  function reachNote(key){
    var r = brandReach().filter(function(x){ return x.key === key; })[0];
    if(!r) return '';
    return r.used.length
      ? ' · used by <b>' + r.used[0] + (r.used.length > 1 ? '</b> and ' + (r.used.length - 1) + ' more' : '</b>')
      : ' · <b style="color:#b83029">no token uses it</b>';
  }

  /* which mapping control, if any, could rescue a failing pair */
  var PAIR_FIX = {
    'primary-foreground|primary': ['primary','primaryDark'],
    'secondary-foreground|secondary': ['tint','tintDark'],
    'accent-foreground|accent': ['tint','tintDark'],
    'ring|background': ['ring','ringDark'],
    'chart-1|background': ['chart','chartDark'],
    'chart-2|background': ['chart','chartDark'],
    'chart-3|background': ['chart','chartDark'],
    'border|background': ['border','borderDark'],
    'border|card': ['border','borderDark']
  };
  function needOf(kind){ return kind === 'text' ? 4.5 : (kind === 'ui' ? 3 : 1.2); }
  /* the first step offered by that control at which the pair clears its level */
  function stepThatFixes(pair, dark){
    var fix = PAIR_FIX[pair[0] + '|' + pair[1]];
    if(!fix) return null;
    var field = dark ? fix[1] : fix[0];
    var opts = fieldOptions(field);
    if(!opts.length) return null;
    var was = S.map[field], need = needOf(pair[2]), found = null;
    for(var i = 0; i < opts.length; i++){
      S.map[field] = opts[i];
      var t = tokens(build(dark), dark);
      if(t[pair[0]] && t[pair[1]] && wcag(t[pair[0]].hex, t[pair[1]].hex) >= need){ found = opts[i]; break; }
    }
    S.map[field] = was;
    return found === null ? null : { field: field, step: found };
  }

  function tokenAuditHtml(p, dark){
    var t = tokens(p, dark);
    var failed = [];
    var rows = TOKEN_PAIRS.map(function(pair){
      var fg = t[pair[0]], bg = t[pair[1]];
      if(!fg || !bg) return '';
      var r = wcag(fg.hex,bg.hex), lc = apca(fg.hex,bg.hex), kind = pair[2];
      var need = needOf(kind);
      var cls = r >= need ? 'pass' : (r >= need * 0.8 ? 'mid' : 'fail');
      var fix = '';
      if(r < need){
        failed.push(pair);
        var f = stepThatFixes(pair, dark);
        fix = f
          ? '<button class="btn mini" data-fixmap="' + f.field + '" data-fixstep="' + f.step + '">Take step ' + f.step + '</button>'
          : '<span class="muted">move the ramp itself</span>';
      }
      return '<tr' + (r < need ? ' class="row-fail"' : '') + '>' +
        '<td><span class="dot" style="background:'+fg.hex+'"></span><code>'+pair[0]+'</code></td>'+
        '<td><span class="dot" style="background:'+bg.hex+'"></span><code>'+pair[1]+'</code></td>'+
        '<td class="muted">'+need.toFixed(1)+' · '+(kind === 'text' ? 'text' : (kind === 'ui' ? 'UI mark' : 'hairline'))+'</td>'+
        '<td><span class="pill '+cls+'">'+r.toFixed(2)+' · Lc '+Math.round(lc)+'</span></td>'+
        '<td>'+fix+'</td></tr>';
    }).join('');
    var head = failed.length
      ? '<p class="cap fail-cap">' + failed.length + ' of ' + TOKEN_PAIRS.length + ' pairs fall short: ' +
          failed.map(function(f){ return '<code>' + f[0] + '</code> on <code>' + f[1] + '</code>'; }).join(', ') +
          '. Each row below says what would fix it.</p>'
      : '<p class="cap">Every token pair clears its level.</p>';
    return head +
      '<table><thead><tr><th>Foreground</th><th>Background</th><th>Needs</th><th>Result</th><th>If it fails</th></tr></thead><tbody>'+rows+'</tbody></table>';
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
              'Small print at muted-foreground. Every colour here comes from a token.</p>'+
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

  /* ---------- Tailwind ---------- */
  var TW = 'v4';
  var RAMP_KEYS = ['main','sup','a1','a2','neutral'].concat(FUNCTIONAL.map(function(f){ return f.id; }));
  /* the shadcn token names, checked against a published shadcn theme */
  var TOKEN_NAMES = ['background','foreground','card','card-foreground','popover','popover-foreground',
    'primary','primary-foreground','secondary','secondary-foreground','muted','muted-foreground',
    'accent','accent-foreground','destructive','destructive-foreground','border','input','ring',
    'chart-1','chart-2','chart-3','chart-4','chart-5','sidebar','sidebar-foreground',
    'sidebar-primary','sidebar-primary-foreground','sidebar-accent','sidebar-accent-foreground',
    'sidebar-border','sidebar-ring'];

  function twExport(){
    var L = build(false);
    if(TW === 'v4'){
      /* v4 reads the theme from CSS: every token becomes a --color-* so
         bg-primary, text-muted-foreground and friends resolve */
      var ramps = RAMP_KEYS.map(function(k){
        return L[k].map(function(st){ return '  --color-' + k + '-' + st.step + ': ' + st.css + ';'; }).join('\n');
      }).join('\n');
      var toks = TOKEN_NAMES.map(function(n){ return '  --color-' + n + ': var(--' + n + ');'; }).join('\n');
      return '/* Tailwind v4 — paste under your globals.css, after the :root and .dark blocks.\n' +
        '   The token colours follow the theme, so they change with .dark on their own. */\n\n' +
        '@theme inline {\n' + toks + '\n  --radius-lg: var(--radius);\n}\n\n' +
        '/* the raw ramps, for the times a step is wanted by name */\n@theme {\n' + ramps + '\n}\n';
    }
    var colors = RAMP_KEYS.map(function(k){
      return '        ' + k + ': {\n' + L[k].map(function(st){
        return '          ' + st.step + ": '" + st.hex + "',";
      }).join('\n') + '\n        },';
    }).join('\n');
    var semLines = TOKEN_NAMES.map(function(n){
      return "        '" + n + "': 'var(--" + n + ")',";
    }).join('\n');
    return '// Tailwind v3 — tailwind.config.js\n' +
      '// The semantic colours point at the CSS variables, so they follow .dark.\n' +
      '// The ramps are literal, for the times a step is wanted by name.\n\n' +
      'module.exports = {\n  darkMode: [\'class\'],\n  theme: {\n    extend: {\n      colors: {\n' +
      semLines + '\n' + colors + '\n      },\n    },\n  },\n};\n';
  }

  /* ---------- Figma variables ----------
     One collection, two modes. Hex with no alpha, which every importer reads. */
  function figmaExport(){
    var L = build(false), D = build(true);
    var tl = tokens(L, false), td = tokens(D, true);
    var vars = TOKEN_NAMES.map(function(n){
      return { name: 'semantic/' + n, type: 'COLOR',
               valuesByMode: { Light: tl[n].hex.toUpperCase(), Dark: td[n].hex.toUpperCase() } };
    });
    RAMP_KEYS.forEach(function(k){
      L[k].forEach(function(st, i){
        vars.push({ name: 'ramp/' + k + '/' + st.step, type: 'COLOR',
                    valuesByMode: { Light: st.hex.toUpperCase(), Dark: D[k][i].hex.toUpperCase() } });
      });
    });
    ['main','sup','a1','a2'].forEach(function(k){
      if(S[k] && S[k].brand) vars.push({ name: 'brand/' + k, type: 'COLOR',
        valuesByMode: { Light: S[k].brand.toUpperCase(), Dark: S[k].brand.toUpperCase() } });
    });
    return JSON.stringify({
      name: S.name || 'Palette',
      collection: S.name || 'Palette',
      modes: ['Light', 'Dark'],
      variables: vars
    }, null, 2);
  }

  /* ---------- a link that carries the whole palette ---------- */
  function b64url(bytes){
    var bin = '';
    for(var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function unb64url(str){
    var b = atob(str.replace(/-/g,'+').replace(/_/g,'/'));
    var out = new Uint8Array(b.length);
    for(var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function shareLink(){
    /* z: deflated, j: plain — the reader is told which it is getting */
    var json = JSON.stringify(S);
    var base = location.origin + location.pathname;
    return Promise.resolve().then(function(){
      if(typeof CompressionStream === 'undefined') throw 0;
      var cs = new CompressionStream('deflate-raw');
      var w = cs.writable.getWriter();
      w.write(new TextEncoder().encode(json)); w.close();
      return new Response(cs.readable).arrayBuffer();
    }).then(function(buf){
      return base + '#z=' + b64url(new Uint8Array(buf));
    }).catch(function(){
      return base + '#j=' + b64url(new TextEncoder().encode(json));
    });
  }
  function readLink(){
    var h = location.hash || '';
    var m = h.match(/[#&](z|j)=([A-Za-z0-9\-_]+)/);
    if(!m) return Promise.resolve(null);
    var bytes = unb64url(m[2]);
    if(m[1] === 'j') return Promise.resolve(new TextDecoder().decode(bytes));
    if(typeof DecompressionStream === 'undefined') return Promise.resolve(null);
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(ds.readable).arrayBuffer().then(function(buf){
      return new TextDecoder().decode(new Uint8Array(buf));
    }).catch(function(){ return null; });
  }

  /* ---------- a sheet to print ---------- */
  function drawSheet(){
    var c = el('sheet'); if(!c) return;
    var L = build(false), D = build(true);
    var pad = 28, rowH = 46, gap = 12, labelW = 132, stepW = 76;
    var rows = RAMP_KEYS.length;
    var w = pad*2 + labelW + stepW*STEPS.length;
    var h = pad*2 + 66 + rows*(rowH+gap) + 74;
    var dpr = 2;
    c.width = w*dpr; c.height = h*dpr;
    c.style.width = '100%';
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);

    g.fillStyle = '#111418';
    g.font = '600 22px ui-sans-serif, system-ui, sans-serif';
    g.fillText(S.name || 'Untitled', pad, pad + 20);
    g.fillStyle = '#6b7480';
    g.font = '13px ui-sans-serif, system-ui, sans-serif';
    g.fillText('OKLCH ramps on the shadcn steps · ' + Math.round(S.main.h) + '° main · ' +
      (S.shape.gamut === 'p3' ? 'Display P3' : 'sRGB'), pad, pad + 42);

    g.font = '11px ui-monospace, SFMono-Regular, monospace';
    STEPS.forEach(function(st, i){
      g.fillStyle = '#6b7480';
      g.fillText(String(st), pad + labelW + i*stepW + 4, pad + 62);
    });

    RAMP_KEYS.forEach(function(k, r){
      var y = pad + 72 + r*(rowH+gap);
      g.fillStyle = '#111418';
      g.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      g.fillText(roleLabel(k), pad, y + 20);
      g.fillStyle = '#6b7480';
      g.font = '11px ui-monospace, SFMono-Regular, monospace';
      g.fillText(Math.round(L[k][0].h) + '°', pad, y + 36);
      L[k].forEach(function(st, i){
        var x = pad + labelW + i*stepW;
        g.fillStyle = st.hex; g.fillRect(x, y, stepW - 4, rowH);
        /* whichever of ink or paper reads better on this step, rather than a guess at the middle */
        g.fillStyle = wcag('#111418', st.hex) >= wcag('#ffffff', st.hex) ? '#111418' : '#ffffff';
        g.font = '10px ui-monospace, SFMono-Regular, monospace';
        g.fillText(st.hex.toUpperCase(), x + 6, y + rowH - 8);
      });
    });

    /* the tokens that matter most, light and dark, as a footer strip */
    var fy = pad + 72 + rows*(rowH+gap) + 8;
    var tl = tokens(L, false), td = tokens(D, true);
    [['Light', tl], ['Dark', td]].forEach(function(pair, i){
      var y = fy + i*30;
      g.fillStyle = '#111418';
      g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      g.fillText(pair[0], pad, y + 16);
      ['background','foreground','primary','secondary','accent','destructive','border','ring'].forEach(function(n, j){
        var x = pad + 60 + j*84;
        g.fillStyle = pair[1][n].hex; g.fillRect(x, y, 18, 18);
        g.strokeStyle = '#d7dce2'; g.strokeRect(x + 0.5, y + 0.5, 17, 17);
        g.fillStyle = '#6b7480';
        g.font = '10px ui-sans-serif, system-ui, sans-serif';
        g.fillText(n, x + 24, y + 13);
      });
    });
    return c;
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

  /* ---------- scrim check ----------
     A caption over a photograph fails on the bright pixels behind it, and
     only on the ones it actually covers. So: a region you drag, and
     percentiles rather than the single brightest pixel in the picture. */
  var imgUrl = null, imgPx = null;                 /* { w, h, lum:Float32Array, hex:[] } */
  var REGION = { x:0.04, y:0.66, w:0.56, h:0.26 }; /* fractions of the image */
  var SCRIMS = [0, 0.2, 0.35, 0.5, 0.65];
  var LEVEL = -60;                                  /* APCA Lc 60 — body text */

  function hex3(r,g,b){
    return '#' + [r,g,b].map(function(v){ return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  /* the smallest black scrim at which white text clears the level over this colour */
  function scrimFor(hex){
    for(var a = 0; a <= 0.9; a += 0.01){
      if(apca('#ffffff', composite('#000000', a, hex)) <= LEVEL) return a;
    }
    return null;
  }
  /* what the region really looks like: the value at each percentile of its pixels */
  function regionStats(){
    if(!imgPx) return null;
    var x0 = Math.max(0, Math.floor(REGION.x * imgPx.w)), y0 = Math.max(0, Math.floor(REGION.y * imgPx.h));
    var x1 = Math.min(imgPx.w, Math.ceil((REGION.x + REGION.w) * imgPx.w));
    var y1 = Math.min(imgPx.h, Math.ceil((REGION.y + REGION.h) * imgPx.h));
    var list = [];
    for(var y = y0; y < y1; y++){
      for(var x = x0; x < x1; x++){
        var i = y * imgPx.w + x;
        list.push({ Y: imgPx.lum[i], hex: imgPx.hex[i] });
      }
    }
    if(!list.length) return null;
    list.sort(function(a, b){ return a.Y - b.Y; });
    function at(q){ return list[Math.min(list.length - 1, Math.round(q * (list.length - 1)))]; }
    return { n:list.length, p5:at(0.05), p50:at(0.5), p95:at(0.95), p100:at(1) };
  }

  function scrimStatsHtml(){
    var st = regionStats();
    if(!st) return '';
    var need95 = scrimFor(st.p95.hex), needMax = scrimFor(st.p100.hex), need50 = scrimFor(st.p50.hex);
    function pct(a){ return a === null ? 'never' : Math.round(a * 100) + '%'; }
    var rows = [
      ['Half the pixels are darker than', st.p50, need50],
      ['95th percentile — the bright end', st.p95, need95],
      ['The single brightest pixel', st.p100, needMax]
    ].map(function(r){
      return '<tr><td>' + r[0] + '</td>' +
        '<td><span class="dot" style="background:' + r[1].hex + '"></span> <span class="mono">' + r[1].hex.toUpperCase() + '</span></td>' +
        '<td class="mono">' + pct(r[2]) + '</td></tr>';
    }).join('');
    var head;
    if(need95 === null){
      head = '<p class="cap">White text never clears Lc 60 over this region, at any scrim. Use a panel behind the caption, or dark text on a light scrim.</p>';
    } else if(need95 === 0){
      head = '<p class="cap"><b>No scrim needed here.</b> White text clears Lc 60 over 95% of the pixels under the box as it is' +
        (needMax ? ', though the single brightest pixel would want ' + pct(needMax) + '' : '') + '.</p>';
    } else {
      head = '<p class="cap">Take a <b>' + Math.round(need95 * 100) + '% black scrim</b> for white text here. That covers 95% of the pixels under the box' +
        (needMax !== null && needMax > need95
          ? '; the single brightest would want ' + pct(needMax) + ', which is usually one glint rather than something anyone reads against'
          : '') + '.</p>';
    }
    return head +
      '<table id="scrimStats"><thead><tr><th>In the box</th><th>Colour</th><th>Scrim white text needs</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">' + st.n + ' pixels sampled from the box. Drag it to where the caption will really sit; the numbers follow.</p>';
  }

  function shotHtml(){
    if(!imgUrl) return '';
    var st = regionStats(), a = st ? scrimFor(st.p95.hex) : 0;
    if(a === null) a = 0.65;
    return '<div class="shot" id="shot">' +
        '<img src="' + imgUrl + '" alt="">' +
        '<div class="region" id="region" style="left:' + (REGION.x*100) + '%;top:' + (REGION.y*100) + '%;width:' + (REGION.w*100) + '%;height:' + (REGION.h*100) + '%;background:rgba(0,0,0,' + a + ')">' +
          '<span class="cap-demo">Caption text here</span><span class="grip"></span>' +
        '</div>' +
      '</div>' +
      '<p class="hint" style="margin:8px 0 14px">The box carries the scrim it recommends, so you are reading the real thing.</p>';
  }

  /* the same region at each scrim, to judge by eye as well as by number */
  function scrimPreviewHtml(){
    if(!imgUrl) return '';
    var st = regionStats();
    return '<div class="grid3" style="margin:4px 0 14px">' + SCRIMS.map(function(a){
      var pass = st ? apca('#ffffff', composite('#000000', a, st.p95.hex)) <= LEVEL : null;
      var worst = st ? apca('#ffffff', composite('#000000', a, st.p100.hex)) <= LEVEL : null;
      return '<figure style="margin:0">' +
        '<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--line);aspect-ratio:4/3">' +
          '<img src="' + imgUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block">' +
          '<div style="position:absolute;inset:0;background:rgba(0,0,0,' + a + ')"></div>' +
          '<span style="position:absolute;left:10px;bottom:10px;color:#fff;font-size:.82rem;font-weight:600">Caption text here</span>' +
        '</div>' +
        '<figcaption class="hint" style="margin-top:6px">' + Math.round(a*100) + '% black scrim ' +
          (pass === null ? '' : (pass ? '<span class="pill pass">' + (worst ? 'clear' : 'clear for 95%') + '</span>' : '<span class="pill fail">too light</span>')) +
        '</figcaption></figure>';
    }).join('') + '</div>';
  }

  function scrimHtml(){
    if(imgPx) return shotHtml() + scrimStatsHtml() + scrimPreviewHtml();
    /* no image: a light and a dark patch, so the panel still says something */
    return [{ name:'light patch', hex:'#E9EDF2' }, { name:'dark patch', hex:'#1B222B' }].map(function(b){
      var need = scrimFor(b.hex);
      return '<div class="pv-row" style="margin:8px 0"><span class="dot" style="background:'+b.hex+';width:22px;height:22px"></span>'+
        '<b>'+b.name+'</b><span class="mono">'+b.hex.toUpperCase()+'</span>'+
        '<span class="pill '+(need===null?'fail':(need<=0.4?'pass':'mid'))+'">'+
        (need===null ? 'white text never passes' : 'white text passes at ' + Math.round(need*100) + '% black scrim') + '</span></div>';
    }).join('') + '<p class="hint">Measured with APCA Lc 60, the body-text level. Drop an image in to measure its own pixels instead.</p>';
  }

  function readImage(src){
    var img = new Image();
    img.onload = function(){
      var w = 240, h = Math.max(1, Math.round(240 * img.height / img.width));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;
      var lum = new Float32Array(w * h), hexes = new Array(w * h);
      for(var i = 0, j = 0; i < d.length; i += 4, j++){
        var hx = hex3(d[i], d[i+1], d[i+2]);
        hexes[j] = hx; lum[j] = relLum(hx);
      }
      imgPx = { w:w, h:h, lum:lum, hex:hexes };
      render();
    };
    img.onerror = function(){ imgPx = null; };
    img.src = src;
  }
  el('imgIn').addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0]; if(!file) return;
    if(imgUrl) URL.revokeObjectURL(imgUrl);
    imgUrl = URL.createObjectURL(file);
    readImage(imgUrl);
  });

  /* drag the box, or its corner, and the measurement follows.
     The pointer leaves the box as soon as you drag it, so the move and the
     release are followed on the document; those two listeners are attached
     once, and only the box changes when the panel is rebuilt. */
  var DRAG = null;
  function wireRegion(){
    var box = el('region'); if(!box) return;
    box.addEventListener('pointerdown', function(e){
      var shot = el('shot'); if(!shot) return;
      DRAG = { mode: e.target.classList.contains('grip') ? 'size' : 'move',
               x:e.clientX, y:e.clientY, r:shot.getBoundingClientRect(),
               reg:{ x:REGION.x, y:REGION.y, w:REGION.w, h:REGION.h } };
      e.preventDefault();
    });
  }
  document.addEventListener('pointermove', function(e){
    if(!DRAG) return;
    var box = el('region'); if(!box){ DRAG = null; return; }
    var dx = (e.clientX - DRAG.x) / DRAG.r.width, dy = (e.clientY - DRAG.y) / DRAG.r.height;
    if(DRAG.mode === 'move'){
      REGION.x = Math.min(1 - DRAG.reg.w, Math.max(0, DRAG.reg.x + dx));
      REGION.y = Math.min(1 - DRAG.reg.h, Math.max(0, DRAG.reg.y + dy));
    } else {
      REGION.w = Math.min(1 - REGION.x, Math.max(0.05, DRAG.reg.w + dx));
      REGION.h = Math.min(1 - REGION.y, Math.max(0.04, DRAG.reg.h + dy));
    }
    /* the box moves with the pointer; the panel below is rebuilt when it is let go */
    box.style.left = (REGION.x*100) + '%'; box.style.top = (REGION.y*100) + '%';
    box.style.width = (REGION.w*100) + '%'; box.style.height = (REGION.h*100) + '%';
    var st = regionStats();
    if(st){
      var a = scrimFor(st.p95.hex);
      box.style.background = 'rgba(0,0,0,' + (a === null ? 0.65 : a) + ')';
    }
  });
  document.addEventListener('pointerup', function(){
    if(!DRAG) return;
    DRAG = null;
    el('scrimOut').innerHTML = scrimHtml();
    wireRegion();
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
    ['ringDark','Focus ring · dark', [300,400,500]],
    ['chart','Chart series · light', [400,500,600,700]],
    ['chartDark','Chart series · dark', [300,400,500,600]]
  ];
  /* which ramp each mapped token reads, so the control can show the colour it produces */
  var MAP_SOURCE = { primary:'main', primaryDark:'main', tint:'sup', tintDark:'sup',
                     border:'neutral', borderDark:'neutral', ring:'main', ringDark:'main',
                     chart:'main', chartDark:'main' };   /* the five series all take the same step */
  /* the steps a control offers: its usual range, plus the step a pinned brand
     colour landed on — otherwise a brand colour in the middle of the ramp can
     never be chosen, and the tool can only tell you it is unreachable */
  function fieldOptions(field){
    var def = MAP_FIELDS.filter(function(f){ return f[0] === field; })[0];
    if(!def) return [];
    var opts = def[2].slice();
    var role = MAP_SOURCE[field], conf = S[role];
    if(conf && conf.brand && conf.pin !== false){
      var step = nearestStep(build(false)[role], conf.brand).step;
      if(opts.indexOf(step) === -1){ opts.push(step); opts.sort(function(a,b){ return a-b; }); }
    }
    return opts;
  }
  function mapControlsHtml(L, D){
    return MAP_FIELDS.map(function(f){
      var dark = /Dark$/.test(f[0]);
      var sw = stepOf((dark ? D : L)[MAP_SOURCE[f[0]]], S.map[f[0]]);
      return '<div class="field" style="grid-template-columns:minmax(0,1fr)"><label for="map-'+f[0]+'">'+f[1]+'</label>' +
        '<select id="map-'+f[0]+'" data-map="'+f[0]+'">' +
        fieldOptions(f[0]).map(function(v){ return '<option value="'+v+'"'+(S.map[f[0]] === v ? ' selected' : '')+'>'+v+(v === brandStepOf(MAP_SOURCE[f[0]]) ? ' — your brand colour' : '')+'</option>'; }).join('') +
        '</select>' +
        '<span class="swatch-inline" style="margin-top:6px"><span class="dot" style="background:'+sw.hex+'"></span><span class="mono">'+sw.hex.toUpperCase()+'</span></span>' +
        '</div>';
    }).join('');
  }
  /* the things the mapping actually changes, drawn live */
  function mapDemoHtml(p, dark){
    var t = tokens(p, dark);
    return '<div class="preview" style="background:'+t.background.hex+';color:'+t.foreground.hex+';padding:16px">' +
      '<div class="pv-row" style="gap:14px;align-items:center">' +
        '<span class="pv-btn" style="background:'+t.primary.hex+';color:'+t['primary-foreground'].hex+'">Primary button</span>' +
        '<span class="pv-btn" style="background:'+t.secondary.hex+';color:'+t['secondary-foreground'].hex+'">Tinted surface</span>' +
        '<span style="display:inline-flex;align-items:center;gap:8px;font-size:.78rem">Hairline<span style="display:inline-block;width:64px;height:1px;background:'+t.border.hex+'"></span></span>' +
        '<span class="pv-btn" style="background:transparent;color:'+t.foreground.hex+';border:1px solid '+t.border.hex+';box-shadow:0 0 0 3px '+t.ring.hex+'">Focused field</span>' +
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:.78rem">Chart series' +
          [1,2,3,4,5].map(function(n){
            return '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:'+t['chart-'+n].hex+'"></span>';
          }).join('') + '</span>' +
      '</div></div>';
  }

  /* ---------- render ---------- */
  /* ---------- rendering ----------
     The rail and the ramps are always redrawn; the other views are marked
     stale and drawn when you look at them. With a family of ten brands that
     is the difference between a slider that moves and one that stutters. */
  var VIEW = 'ramps';
  var STALE = {};
  var PAINT = {
    ramps: function(L, D){
    el('stepsHead').innerHTML = stepsHeadHtml();
    el('stepsHeadDark').innerHTML = stepsHeadHtml();
    el('rampsLight').innerHTML = rampsHtml(L,false);
    el('rampsDark').innerHTML = rampsHtml(D,true);
    applyValues();

    },
    roles: function(L, D){
    el('brandReach').innerHTML = brandReachHtml();
    el('mapControls').innerHTML = mapControlsHtml(L, D);
    /* the mapping has a light and a dark control, so the demo always shows both —
       otherwise half the controls change nothing you can see */
    /* not data-theme: this pair is deliberately outside the Light / Dark switch,
       because the four controls above it are themselves per theme */
    el('mapDemo').innerHTML = [['light', L, false], ['dark', D, true]].map(function(t){
      return '<div data-map-theme="' + t[0] + '"><h4 style="margin:12px 0 6px;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)">' +
        (t[2] ? 'The dark mapping' : 'The light mapping') + '</h4>' + mapDemoHtml(t[1], t[2]) + '</div>';
    }).join('');
    el('roleTable').innerHTML = forThemes(L, D, function(p){ return roleTableHtml(p); });
    el('funcTable').innerHTML = forThemes(L, D, function(p, dk){ return funcTableHtml(p, dk); });
    el('stateTable').innerHTML = forThemes(L, D, function(p, dk){ return stateTableHtml(p, dk); });

    },
    contrast: function(L, D){
    el('ctTokens').innerHTML = forThemes(L, D, function(p, dk){ return tokenAuditHtml(p, dk); });
    el('ctText').innerHTML = forThemes(L, D, function(p, dk){ return contrastTextHtml(p, dk); });
    el('ctFill').innerHTML = forThemes(L, D, function(p, dk){ return contrastFillHtml(p, dk); });
    el('contrastMeta').textContent = 'WCAG 2 · APCA Lc';

    },
    alpha: function(L, D){
    el('alphaMatrix').innerHTML = forThemes(L, D, function(p, dk){ return alphaHtml(p, dk); });
    el('scrimOut').innerHTML = scrimHtml();
    wireRegion();
    },
    gradients: function(L, D){
    el('gradOut').innerHTML = forThemes(L, D, function(p){ return '<div class="grid2">' + gradientsHtml(p) + '</div>'; });
    },
    preview: function(L, D){
      el('previewOut').innerHTML = forThemes(L, D, function(p, dk){ return previewHtml(p, dk); });
      /* the screen is on the page now, so it can be measured rather than described */
      MEASURED = measureShare(el('previewOut').querySelector('.preview'), L) || MEASURED;
      el('shareCheck').innerHTML = shareCheckHtml();
      el('previewShare').innerHTML = shareCheckHtml();
    },
    family: function(L, D){
    el('famList').innerHTML = famListHtml();
    el('famStrip').innerHTML = forThemes(L, D, function(p, dk){ return famStripHtml(dk); });
    el('famParity').innerHTML = forThemes(L, D, function(p, dk){ return famParityHtml(dk); });
    el('outFamily').textContent = famExport();
    el('famMeta').textContent = sisters().length
      ? (sisters().length + (sisters().length === 1 ? ' sister' : ' sisters') + ' · shared neutrals and functional colours')
      : 'just the parent so far';

    },
    'export': function(L, D){
    el('outCss').textContent = cssExport();
    el('outJson').textContent = jsonExport();
    el('outTw').textContent = twExport();
    el('outFigma').textContent = figmaExport();
    el('twNote').textContent = TW === 'v4'
      ? 'Tailwind v4 reads its theme from CSS. Paste this under globals.css; the token colours follow .dark on their own.'
      : 'Tailwind v3 reads a config file. The semantic colours point at the CSS variables, so they follow .dark; the ramps are literal.';
    el('exportMeta').textContent = STEPS.length + ' steps · ' + RAMP_KEYS.length + ' ramps · ' + TOKEN_NAMES.length + ' shadcn tokens';
    drawSheet();
    shareLink().then(function(u){ var box = el('outLink'); if(box) box.textContent = u; });

    }
  };
  function paintView(L, D){
    if(!STALE[VIEW]) return;
    if(!L){ L = build(false); D = build(true); }
    PAINT[VIEW](L, D);
    STALE[VIEW] = false;
  }

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
              ? '<span>your colour sits at <b>step ' + near.step + '</b>' + reachNote(c[1]) + '</span>'
              : '<span>yours vs <b>step ' + near.step + '</b> ' + near.hex.toUpperCase() + '</span>')) +
        '<button class="btn mini" data-clearbrand="'+c[1]+'" title="Forget this brand colour">✕</button>';
    });
    var clash = hueClash(S.main.h);
    el('rampMeta').textContent = Math.round(S.main.h) + '° main · ' + STEPS.length + ' steps · one set of hues for both themes · ' + (S.shape.gamut === 'p3' ? 'Display P3' : 'sRGB') + (clash ? ' · reads close to ' + clash : '');

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
    if(el('shareCheck')) el('shareCheck').innerHTML = shareCheckHtml();


    railSummaries(L);
    el('steps').innerHTML = stepsHtml();
    Object.keys(PAINT).forEach(function(k){ STALE[k] = true; });
    PAINT.ramps(L, D);            /* the ramps are the tool's own subject, always current */
    STALE.ramps = false;
    paintView(L, D);

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
  /* what the next entry in the history should be called, so Undo can say it */
  var NEXT_LABEL = null;
  function describe(text){ NEXT_LABEL = text; }

  function pushHistory(){
    if(RESTORING) return;
    var snap = JSON.stringify(S);
    var label = NEXT_LABEL; NEXT_LABEL = null;
    if(HIST[HPOS] && HIST[HPOS].snap === snap) return;
    var now = Date.now();
    var same = GESTURE && GESTURE === LAST_GESTURE && now - LAST_PUSH < COALESCE;
    LAST_GESTURE = GESTURE; GESTURE = null;
    if(HPOS >= 0 && same){                         /* still the same drag — replace the top */
      HIST[HPOS] = { snap: snap, label: label || HIST[HPOS].label };
      LAST_PUSH = now; histUi(); return;
    }
    HIST = HIST.slice(0, HPOS + 1);                /* a new change drops anything redone past here */
    HIST.push({ snap: snap, label: label || 'a change' });
    if(HIST.length > HIST_MAX + 1) HIST.shift();
    HPOS = HIST.length - 1; LAST_PUSH = now;
    histUi();
  }
  function goTo(i){
    if(i < 0 || i >= HIST.length || i === HPOS) return;
    HPOS = i; RESTORING = true;
    S = JSON.parse(HIST[i].snap); EDITING = null;
    syncControls(); render();
    RESTORING = false; LAST_PUSH = 0; GESTURE = null; LAST_GESTURE = null;
    try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){}
    histUi();
  }
  function histUi(){
    var back = HPOS, fwd = HIST.length - 1 - HPOS;
    var undoing = back > 0 ? HIST[HPOS].label : null;      /* the change you are about to walk back out of */
    var redoing = fwd > 0 ? HIST[HPOS + 1].label : null;
    el('btnUndo').disabled = back <= 0;
    el('btnRedo').disabled = fwd <= 0;
    el('btnUndo').textContent = undoing ? 'Undo ' + undoing : 'Undo';
    el('btnRedo').textContent = redoing ? 'Redo ' + redoing : 'Redo';
    el('btnUndo').title = undoing ? 'Undo ' + undoing + ' — ' + back + ' to walk back through' : '';
    el('btnRedo').title = redoing ? 'Redo ' + redoing : '';
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
    S.func = S.func || {};
    EDITING = null;
    describe('switching to \u201c' + it.name + '\u201d');
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
    describe('adding a sister'); render();
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
    if(i.dataset.fam === 'h'){ sis.h = +i.value; dragging('fam:' + i.dataset.id + ':h'); describe(sis.name + '\u2019s hue'); }
    else if(i.dataset.fam === 'c'){ sis.c = +i.value; dragging('fam:' + i.dataset.id + ':c'); describe(sis.name + '\u2019s colourfulness'); }
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
    var gone = sisters().filter(function(x){ return x.id === b.dataset.famdel; })[0];
    S.family.sisters = sisters().filter(function(x){ return x.id !== b.dataset.famdel; });
    describe('removing ' + (gone ? gone.name : 'a sister')); render();          /* removing a sister is a change like any other, so undo brings it back */
  });

  /* ---------- the words ----------
     Every term the tool uses that a designer should not have to look up. */
  var GLOSSARY = [
    ['oklch', 'OKLCH', 'the colour notation used throughout',
      'Three numbers: lightness, how colourful, and which hue. Unlike RGB or HSL, a change in lightness means the same amount of change to the eye whatever the hue — which is why every ramp here can sit on the same lightness steps and still look even.'],
    ['ramp', 'Ramp', 'one colour, eleven shades',
      'A single hue drawn out across eleven fixed lightness steps, numbered 50 (palest) to 950 (deepest). Every ramp uses the same steps, so step 600 of one colour carries the same visual weight as step 600 of another.'],
    ['chroma', 'Colourfulness', 'chroma, in OKLCH',
      'How far the colour is from grey. Low is muted and dusty, high is vivid. It is capped by what the screen can actually show, so asking for more than a screen has simply gives you the closest it can reach.'],
    ['peak', 'Strongest at', 'where the ramp is most colourful',
      'Which step carries the most colour. Mid steps are the usual choice: the pale end has nowhere to put chroma, and the deep end goes muddy if you push it.'],
    ['falloff', 'Dark fade', 'how fast colour drains from the deep end',
      'Deep shades that keep full chroma look inky and artificial. A higher fade drains colour faster as the ramp darkens, which reads more like a real shadow.'],
    ['twist', 'Hue turn', 'how far the hue moves between the two ends',
      'One hue held across eleven steps reads wrong at the extremes — dark yellows go acid, pale reds go pink. The turn moves the hue slightly as the ramp darkens, in the direction that family wants: yellows toward orange, blues toward indigo. Zero holds a single hue.'],
    ['tint', 'Tint', 'a trace of colour in the greys',
      'Pure grey next to a coloured brand looks dead. A trace of the brand hue in the neutrals — far too little to name — makes the greys belong. Zero gives true grey.'],
    ['lift', 'Deep end lift', 'how far the dark theme lifts off black',
      'Dark surfaces that all sit near black become one flat mass. Lifting the deep end keeps a card apart from the page behind it.'],
    ['gamut', 'Screen range', 'sRGB or Display P3',
      'sRGB is what every screen can show. Display P3 reaches further into vivid greens and reds; on a P3 screen those swatches are painted in OKLCH, a ▲ marks the ones a plain screen cannot reach, and the hex stays the closest sRGB fallback.'],
    ['anchor', 'Pinned brand colour', 'your exact hex, kept',
      'Paste a brand hex and it is placed at the step its lightness belongs to, exactly as given, with the neighbouring steps refitted around it. Untick the pin to see the generated step instead, with yours beside it.'],
    ['token', 'Token', 'the name a colour is used under',
      'A component asks for “primary” or “border”, not for a hex. Tokens are the layer between the ramps and the interface, which is how one set of ramps serves both themes and every brand in a family.'],
    ['share', 'Share of surface', 'how much of a screen each role covers',
      'A palette is not only its colours but their proportions. Roughly: neutrals carry most of a screen, the main colour appears in small, decisive places, and the rare accent appears once.'],
    ['wcag', 'WCAG and APCA', 'two ways of measuring contrast',
      'WCAG 2 gives a ratio and is what most standards still ask for. APCA gives a number called Lc, models light and dark text differently, and matches what the eye does rather better — especially in dark mode. Both are shown, and neither is ignored.'],
    ['scrim', 'Scrim', 'the dim layer under text on an image',
      'A black layer at some opacity, laid over a photograph so text on top stays readable. How much is needed depends on the brightest pixels the text actually covers, which is what the caption box measures.'],
    ['sister', 'Sister brand', 'a second brand in the same family',
      'A brand that sets its own main hue and colourfulness but inherits the parent’s neutrals, functional colours, steps, ramp shape and token mapping. The inheritance is what makes a group of brands read as a family.']
  ];
  function glossHtml(hi){
    return GLOSSARY.map(function(g){
      return '<div id="gloss-' + g[0] + '"' + (g[0] === hi ? ' class="lit"' : '') + '>' +
        '<dt>' + g[1] + '<span>' + g[2] + '</span></dt><dd>' + g[3] + '</dd></div>';
    }).join('');
  }
  function openGloss(term){
    el('glossList').innerHTML = glossHtml(term);
    var d = el('gloss');
    if(d.showModal){ if(!d.open) d.showModal(); } else { d.setAttribute('open',''); }
    if(term){
      var node = el('gloss-' + term);
      if(node && node.scrollIntoView) node.scrollIntoView({ block:'nearest' });
    }
  }
  el('btnGloss').addEventListener('click', function(){ openGloss(null); });
  el('glossClose').addEventListener('click', function(){ var d = el('gloss'); if(d.close) d.close(); else d.removeAttribute('open'); });
  document.addEventListener('click', function(e){
    var t = e.target.closest('.term'); if(!t) return;
    e.preventDefault();
    openGloss(t.dataset.term);
  });

  /* the name a control goes by, for the history label */
  function controlName(input){
    var sec = input.closest('fieldset[data-sec]');
    var group = sec ? (sec.querySelector('.sec-name') || {}).textContent : '';
    group = (group || '').split('\u2014')[0].trim().toLowerCase();
    var wrap = input.closest('.row, .field');
    var lab = wrap && wrap.querySelector('label');
    var name = lab ? lab.textContent.replace(/\?$/, '').trim().toLowerCase() : input.id;
    if(input.id === 'pName') return 'the name';
    return group && group !== name ? name + ' on ' + group : name;
  }

  /* ---------- the order the work goes in ----------
     Eight tabs and no suggestion of a path. These four say what to do next and
     whether it has been done, and take you to the tab that does it. */
  function stepsHtml(){
    var pinned = BRAND_ROLES.filter(function(r){ return S[r[0]] && S[r[0]].brand; });
    var reach = brandReach();
    var unreached = reach.filter(function(r){ return !r.used.length; });
    var L = build(false), D = build(true);
    function fails(dark){
      var t = tokens(dark ? D : L, dark);
      return TOKEN_PAIRS.filter(function(pair){
        var fg = t[pair[0]], bg = t[pair[1]];
        return fg && bg && wcag(fg.hex, bg.hex) < needOf(pair[2]);
      }).length;
    }
    var bad = fails(false) + fails(true);
    var clashes = FUNCTIONAL.filter(function(f){ return funcWarnings(f).length; }).length;

    var steps = [
      { view:'ramps', title:'Give it your colours',
        state: pinned.length ? 'done' : 'todo',
        note: pinned.length ? pinned.length + ' pinned' : 'paste a brand hex' },
      { view:'roles', title:'Check they are used',
        state: !pinned.length ? 'todo' : (unreached.length ? 'warn' : 'done'),
        note: !pinned.length ? 'nothing pinned yet'
              : (unreached.length ? unreached.length + ' unused' : 'all in use') },
      { view:'contrast', title:'Clear the audit',
        state: bad ? 'warn' : 'done',
        note: bad ? bad + ' short' : 'all clear' },
      { view:'roles', title:'Keep states distinct',
        state: clashes ? 'warn' : 'done',
        note: clashes ? clashes + ' too close' : 'no clashes' },
      { view:'export', title:'Hand it over',
        state: 'todo', note: 'css, Tailwind, Figma' }
    ];
    return steps.map(function(st, i){
      var mark = st.state === 'done' ? '✓' : (st.state === 'warn' ? '!' : '→');
      return '<li class="' + st.state + '"><button data-goto="' + st.view + '">' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="t">' + st.title + '</span>' +
        '<span class="s">' + mark + ' ' + st.note + '</span>' +
        '</button></li>';
    }).join('');
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-goto]'); if(!b) return;
    var tab = document.querySelector('#tabs button[data-view="' + b.dataset.goto + '"]');
    if(tab) tab.click();
    var main = document.querySelector('.main');
    if(main && main.scrollIntoView) main.scrollIntoView({ block:'start' });
  });

  /* show every value at once, for the times you are reading rather than looking */
  var SHOW_VALUES = false;
  try{ SHOW_VALUES = localStorage.getItem('palette-values-v1') === '1'; }catch(e){}
  function applyValues(){
    document.querySelectorAll('.ramps').forEach(function(r){ r.classList.toggle('show-values', SHOW_VALUES); });
    var box = el('showValues'); if(box) box.checked = SHOW_VALUES;
  }
  el('showValues').addEventListener('change', function(){
    SHOW_VALUES = el('showValues').checked;
    try{ localStorage.setItem('palette-values-v1', SHOW_VALUES ? '1' : '0'); }catch(e){}
    applyValues();
  });

  /* ---------- the rail folds ----------
     Eleven sections in one column is a scroll-and-hunt. Each folds to a line
     that still says what is inside it, and what is open is remembered. */
  var RAIL_KEY = 'palette-rail-v1';
  function railState(){
    try{ return JSON.parse(localStorage.getItem(RAIL_KEY) || 'null') || null; }catch(e){ return null; }
  }
  function railSave(){
    var open = {};
    document.querySelectorAll('fieldset[data-sec]').forEach(function(f){ open[f.dataset.sec] = f.hasAttribute('data-open'); });
    try{ localStorage.setItem(RAIL_KEY, JSON.stringify(open)); }catch(e){}
  }
  function railRestore(){
    var open = railState(); if(!open) return;
    document.querySelectorAll('fieldset[data-sec]').forEach(function(f){
      var want = open[f.dataset.sec];
      if(want === undefined) return;
      if(want) f.setAttribute('data-open',''); else f.removeAttribute('data-open');
      var b = f.querySelector('.sec-toggle');
      if(b) b.setAttribute('aria-expanded', String(!!want));
    });
  }
  /* what a folded section says about itself */
  function railSummaries(L){
    function dot(hex){ return '<i style="background:' + hex + '"></i>'; }
    var moved = Object.keys(S.func || {}).length;
    var sum = {
      name: S.name || 'Untitled',
      library: (function(){ var n = libRead().length; return n ? n + ' kept' : 'none kept'; })(),
      history: (function(){ var b = HPOS > 0 ? HPOS : 0; return b ? b + ' to undo' : 'nothing to undo'; })(),
      main: dot(stepOf(L.main, 600).hex) + Math.round(S.main.h) + '°',
      sup:  dot(stepOf(L.sup, 500).hex) + Math.round(S.sup.h) + '°',
      a1:   dot(stepOf(L.a1, 500).hex) + Math.round(S.a1.h) + '°',
      a2:   dot(stepOf(L.a2, 600).hex) + Math.round(S.a2.h) + '°',
      neutral: dot(stepOf(L.neutral, 300).hex) + (S.neutral.c > 0.001 ? 'tinted' : 'true grey'),
      shape: 'peak ' + STEPS[S.shape.peak] + ' · ' + (S.shape.gamut === 'p3' ? 'P3' : 'sRGB'),
      dark: 'lift ' + S.darkMode.lift.toFixed(3).replace(/^0/,''),
      share: Math.round(S.share.neutral) + '% neutral · ' + Math.round(S.share.main) + '% main'
    };
    document.querySelectorAll('fieldset[data-sec]').forEach(function(f){
      var box = f.querySelector('.sec-sum');
      if(box) box.innerHTML = sum[f.dataset.sec] === undefined ? '' : sum[f.dataset.sec];
    });
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest('.sec-toggle'); if(!b) return;
    var f = b.closest('fieldset[data-sec]');
    var open = f.hasAttribute('data-open');
    if(open) f.removeAttribute('data-open'); else f.setAttribute('data-open','');
    b.setAttribute('aria-expanded', String(!open));
    railSave();
  });
  el('btnSecAll').addEventListener('click', function(){
    var any = document.querySelector('fieldset[data-sec]:not([data-open])');
    document.querySelectorAll('fieldset[data-sec]').forEach(function(f){
      if(any) f.setAttribute('data-open',''); else f.removeAttribute('data-open');
      var b = f.querySelector('.sec-toggle'); if(b) b.setAttribute('aria-expanded', String(!!any));
    });
    el('btnSecAll').textContent = any ? 'Fold every section' : 'Open every section';
    railSave();
  });

  /* ---------- functional colours ---------- */
  function setFunc(id, key, value){
    S.func = S.func || {};
    S.func[id] = S.func[id] || {};
    S.func[id][key] = value;
    dragging('fx:' + id + ':' + key);
    describe((FUNCTIONAL.filter(function(f){ return f.id === id; })[0] || {}).name + (key === 'h' ? '\u2019s hue' : '\u2019s colourfulness'));
    render();
  }
  document.addEventListener('input', function(e){
    var i = e.target.closest('input[data-fx]'); if(!i) return;
    setFunc(i.dataset.id, i.dataset.fx, +i.value);
  });
  document.addEventListener('click', function(e){
    var r = e.target.closest('[data-fxreset]');
    if(r){ if(S.func) delete S.func[r.dataset.fxreset]; describe('a state colour back to its default'); render(); return; }
    if(e.target.id === 'btnFuncReset'){ S.func = {}; describe('the state colours back to their defaults'); render(); return; }
    if(e.target.id === 'btnFuncClear'){
      /* walk each state colour outward from where it is until nothing is close */
      S.func = S.func || {};
      FUNCTIONAL.forEach(function(f){
        var from = funcOf(f).h, chosen = from;
        function clear(x){
          var brandNear = BRAND_HUES().some(function(b){ return hueGapDeg(x, b.h) < 26; });
          var stateNear = FUNCTIONAL.some(function(o){ return o.id !== f.id && hueGapDeg(x, funcOf(o).h) < 19; });
          return !brandNear && !stateNear;
        }
        /* stay within 45° of where it was: a Danger that lands in the greens
           has stopped meaning danger, which is worse than sitting near the brand */
        for(var step = 0; step <= 45 && !clear(chosen); step += 2){
          var up = (from + step) % 360, down = (from - step + 360) % 360;
          if(clear(up)){ chosen = up; break; }
          if(clear(down)){ chosen = down; break; }
        }
        if(clear(chosen)){
          S.func[f.id] = S.func[f.id] || {};
          S.func[f.id].h = Math.round(chosen);
        }
      });
      describe('moving the state colours off the brand');
      render();
      return;
    }
  });


  /* a failing pair, fixed by the control that owns it */
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-fixmap]'); if(!b) return;
    S.map[b.dataset.fixmap] = +b.dataset.fixstep;
    describe('taking step ' + b.dataset.fixstep); render();
  });

  /* ---------- export controls ---------- */
  el('twSeg').addEventListener('click', function(e){
    var b = e.target.closest('button[data-tw]'); if(!b) return;
    TW = b.dataset.tw;
    [].forEach.call(el('twSeg').children, function(x){ x.setAttribute('aria-selected', String(x === b)); });
    el('outTw').textContent = twExport();
    el('twNote').textContent = TW === 'v4'
      ? 'Tailwind v4 reads its theme from CSS. Paste this under globals.css; the token colours follow .dark on their own.'
      : 'Tailwind v3 reads a config file. The semantic colours point at the CSS variables, so they follow .dark; the ramps are literal.';
  });
  el('btnLink').addEventListener('click', function(){
    var b = el('btnLink');
    shareLink().then(function(u){
      el('outLink').textContent = u;
      if(navigator.clipboard) navigator.clipboard.writeText(u);
      b.textContent = 'Link copied';
      setTimeout(function(){ b.textContent = 'Copy link'; }, 1200);
    });
  });
  el('btnLinkOpen').addEventListener('click', function(){
    shareLink().then(function(u){ window.open(u, '_blank'); });
  });
  el('btnSheet').addEventListener('click', function(){
    var c = drawSheet(); if(!c) return;
    c.toBlob(function(blob){
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = slug(S.name) + '-palette.png';
      a.click();
    });
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
    box.addEventListener('change', function(){
      S[p[1]].pin = box.checked;
      describe(box.checked ? 'pinning your exact colour' : 'unpinning your exact colour');
      render();
    });
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
        describe('pasting ' + hex);
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
      describe(controlName(i));
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
      describe('going back to ' + S[k].brand.toUpperCase());
      if(k === 'sup') S.sup.rel = 'custom';
      syncControls(); render(); return;
    }
    var clear = e.target.closest('[data-clearbrand]');
    if(clear){ S[clear.dataset.clearbrand].brand = null; describe('forgetting a brand colour'); syncControls(); render(); return; }
  });
  document.addEventListener('change', function(e){
    var sel = e.target.closest('[data-map]');
    if(!sel) return;
    S.map[sel.dataset.map] = parseInt(sel.value, 10);
    describe('what ' + (MAP_FIELDS.filter(function(f){ return f[0] === sel.dataset.map; })[0] || [0,'a token'])[1].toLowerCase() + ' uses');
    render();
  });
  el('tabs').addEventListener('click', function(e){
    var b = e.target.closest('button[data-view]'); if(!b) return;
    [].forEach.call(el('tabs').children, function(x){ x.setAttribute('aria-selected', String(x === b)); });
    document.querySelectorAll('section.view').forEach(function(s){ s.classList.toggle('on', s.dataset.view === b.dataset.view); });
    VIEW = b.dataset.view;
    paintView();      /* drawn now if it went stale while you were elsewhere */
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
      var text = { css: cssExport, family: famExport, tw: twExport, figma: figmaExport, json: jsonExport }[kind]();
      var type = (kind === 'json' || kind === 'figma') ? 'application/json'
               : (kind === 'tw' && TW === 'v3') ? 'text/javascript' : 'text/css';
      var blob = new Blob([text], { type: type });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      var ext = { json:'.json', family:'.family.css', figma:'.figma-variables.json',
                  tw: TW === 'v4' ? '.theme.css' : '.tailwind.config.js', css:'.css' }[kind];
      a.download = slug(S.name) + ext;
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
        if(d.settings){ S = d.settings; S.family = S.family || { sisters:[] }; S.func = S.func || {}; syncControls(); render(); }
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
    S = JSON.parse(JSON.stringify(DEFAULTS)); EDITING = null; describe('the reset'); syncControls(); render();
  });

  try{
    var saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if(saved && saved.main){
      S = saved;
      S.map = S.map || JSON.parse(JSON.stringify(DEFAULTS.map));
      if(S.map.chart === undefined){ S.map.chart = DEFAULTS.map.chart; S.map.chartDark = DEFAULTS.map.chartDark; }
      S.nudges = S.nudges || {};
      S.darkMode = S.darkMode || JSON.parse(JSON.stringify(DEFAULTS.darkMode));
      S.family = S.family || { sisters:[] };
      S.func = S.func || {};
    }
  }catch(e){}
  railRestore();
  syncControls();
  render();
  histUi();
  libUi();

  /* a shared link wins over what is remembered here, and is then cleared from
     the address bar so a later reload shows your own work, not the snapshot */
  readLink().then(function(json){
    if(!json) return;
    try{
      var d = JSON.parse(json);
      if(!d || !d.main) return;
      S = d;
      S.map = S.map || JSON.parse(JSON.stringify(DEFAULTS.map));
      S.nudges = S.nudges || {};
      S.darkMode = S.darkMode || JSON.parse(JSON.stringify(DEFAULTS.darkMode));
      S.family = S.family || { sisters:[] };
      S.func = S.func || {};
      EDITING = null;
      syncControls(); render(); histUi(); libUi();
      if(history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    }catch(e){}
  });
})();
</script>
</body>
</html>
