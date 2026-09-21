<script>
(function(){
  var $ = function(s){ return document.querySelector(s); };
  var el = function(id){ return document.getElementById(id); };
  var STORE = 'palette-studio-v1';
  var THEME = 'light';   /* which theme the views show: light | dark | both */

  var DEFAULTS = {
    name:'Untitled',
    main:{h:250,c:0.16}, sup:{h:280,c:0.09,rel:'near'},
    a1:{h:45,c:0.18}, a2:{h:20,c:0.20},
    neutral:{c:0.012, from:'main', h:250},
    shape:{peak:6, falloff:0.85, gamut:'srgb'},
    share:{neutral:55, sup:22, main:15, a1:6, a2:2}
  };
  var S = JSON.parse(JSON.stringify(DEFAULTS));

  /* ---------- state <-> controls ---------- */
  var BIND = [
    ['hMain','main.h','oMain',0],   ['cMain','main.c','ocMain',3],
    ['hSup','sup.h','oSup',0],      ['cSup','sup.c','ocSup',3],
    ['hA1','a1.h','oA1',0],         ['cA1','a1.c','ocA1',3],
    ['hA2','a2.h','oA2',0],         ['cA2','a2.c','ocA2',3],
    ['cNeu','neutral.c','ocNeu',3], ['hNeuOwn','neutral.h','oNeuOwn',0],
    ['cPeak','shape.peak','ocPeak',0], ['cFall','shape.falloff','ocFall',2],
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
      if(out) out.textContent = b[0]==='cPeak' ? STEPS[get(b[1])] : Number(get(b[1])).toFixed(b[3]).replace(/^0\./,'.');
    });
    el('pName').value = S.name;
    [['xMain','main',600],['xSup','sup',500],['xA1','a1',500],['xA2','a2',600]].forEach(function(p){
      var input = el(p[0]); if(!input || document.activeElement === input) return;
      input.placeholder = '#______';
    });
    el('relSup').value = S.sup.rel;
    el('hNeu').value = S.neutral.from;
    el('gamut').value = S.shape.gamut;
  }
  function readControls(){
    BIND.forEach(function(b){ var input = el(b[0]); if(input) set(b[1], parseFloat(input.value)); });
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
  function build(dark){
    var o = { dark:dark, space:S.shape.gamut, peak:S.shape.peak, falloff:S.shape.falloff };
    var p = {
      neutral: makeRamp(neutralHue(), S.neutral.c, { dark:dark, space:o.space, peak:5, falloff:0.5 }),
      main:    makeRamp(S.main.h, S.main.c, o),
      sup:     makeRamp(S.sup.h,  S.sup.c,  o),
      a1:      makeRamp(S.a1.h,   S.a1.c,   o),
      a2:      makeRamp(S.a2.h,   S.a2.c,   o)
    };
    FUNCTIONAL.forEach(function(f){ p[f.id] = makeRamp(f.hue, f.chroma, o); });
    return p;
  }
  function stepOf(ramp, step){ return ramp[STEPS.indexOf(step)]; }
  /* the more readable of the palette's two extremes */
  function textOn(bgHex, p){
    var light = stepOf(p.neutral,50).hex, dark = stepOf(p.neutral,950).hex;
    return wcag(dark,bgHex) >= wcag(light,bgHex) ? dark : light;
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
    var S_ = dark
      ? { paper:950, panel:900, hairline:800, quiet:400, ink:50, fill:500, tint:900, tintText:200 }
      : { paper:50,  panel:100, hairline:200, quiet:600, ink:950, fill:600, tint:100, tintText:900 };
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
      'border': stepOf(n,S_.hairline), 'input': stepOf(n,S_.hairline), 'ring': stepOf(p.main,500),
      'chart-1': stepOf(p.main,500), 'chart-2': stepOf(p.sup,500), 'chart-3': stepOf(p.a1,500),
      'chart-4': stepOf(p.a2,500), 'chart-5': stepOf(p.success,500),
      'sidebar': stepOf(n,S_.panel), 'sidebar-foreground': stepOf(n,S_.ink),
      'sidebar-primary': prim[0], 'sidebar-primary-foreground': prim[1],
      'sidebar-accent': stepOf(p.sup,S_.tint), 'sidebar-accent-foreground': stepOf(p.sup,S_.tintText),
      'sidebar-border': stepOf(n,S_.hairline), 'sidebar-ring': stepOf(p.main,500)
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
  function swatchHtml(s, dark){
    var ink = wcag('#000000',s.hex) >= wcag('#ffffff',s.hex) ? '#000' : '#fff';
    return '<div class="sw" style="background:'+s.hex+';color:'+ink+'" data-copy-value="'+s.css+'" title="'+s.css+'">'+
      '<b>'+s.step+'</b><span>'+s.hex.toUpperCase()+'</span></div>';
  }
  function rampsHtml(p, dark){
    var order = ROLES.map(function(r){ return r[0]; }).concat(FUNCTIONAL.map(function(f){ return f.id; }));
    var labels = {}; ROLES.forEach(function(r){ labels[r[0]] = [r[1], r[2]]; });
    FUNCTIONAL.forEach(function(f){ labels[f.id] = [f.name, f.note]; });
    return order.map(function(k){
      var hue = p[k][5].h;
      return '<div class="ramp"><div class="name" style="'+(dark?'color:#E7ECF2':'')+'">'+labels[k][0]+
        '<small style="'+(dark?'color:#8A94A0':'')+'">'+Math.round(hue)+'°</small></div>' +
        p[k].map(function(s){ return swatchHtml(s,dark); }).join('') + '</div>';
    }).join('');
  }
  function stepsHeadHtml(){
    return '<span></span>' + STEPS.map(function(s){ return '<span>'+s+'</span>'; }).join('');
  }

  function roleTableHtml(p){
    var rows = ROLES.map(function(r){
      var ramp = p[r[0]], mid = stepOf(ramp,500);
      var use = { main:'600 fill · 500 ring · 100 surface · 900 text',
                  sup:'100 surface · 200 border · 700 text · 600 fill',
                  a1:'500 mark · 100 surface · 700 text',
                  a2:'600 mark — one per view',
                  neutral:'50 paper · 100 panel · 200 hairline · 600 quiet text · 950 ink' }[r[0]];
      return '<tr><td><span class="dot" style="background:'+mid.hex+'"></span><b>'+r[1]+'</b><div class="muted">'+r[2]+'</div></td>'+
        '<td class="mono">'+Math.round(ramp[5].h)+'° · C '+ramp[5].C.toFixed(3)+'</td>'+
        '<td class="muted">'+use+'</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Role</th><th>Hue</th><th>Typical steps</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function funcTableHtml(p){
    var rows = FUNCTIONAL.map(function(f){
      var L = funcSet(p[f.id],false), D = funcSet(build(true)[f.id],true);
      function cell(s){ return '<span class="dot" style="background:'+s.hex+'"></span><span class="mono">'+s.hex.toUpperCase()+'</span>'; }
      return '<tr><td><b>'+f.name+'</b><div class="muted">'+f.note+'</div></td>'+
        '<td>'+cell(L.surface)+'</td><td>'+cell(L.border)+'</td><td>'+cell(L.text)+'</td><td>'+cell(L.fill)+'</td>'+
        '<td>'+cell(D.surface)+'</td><td>'+cell(D.fill)+'</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Meaning</th><th>Surface</th><th>Border</th><th>Text</th><th>Fill</th><th>Dark surface</th><th>Dark fill</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function stateTableHtml(p){
    var m = p.main, n = p.neutral;
    var rows = [
      ['Default','main 600', stepOf(m,600)],
      ['Hover','main 700', stepOf(m,700)],
      ['Pressed','main 800', stepOf(m,800)],
      ['Selected surface','main 100', stepOf(m,100)],
      ['Focus ring','main 500 at 3px', stepOf(m,500)],
      ['Disabled','neutral 200 on neutral 100', stepOf(n,200)],
      ['Read-only','neutral 100 with neutral 600 text', stepOf(n,100)]
    ].map(function(r){
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
  function contrastFillHtml(p){
    var fills = [['Primary', p.main],['Accent 1', p.a1],['Accent 2', p.a2]]
      .concat(FUNCTIONAL.map(function(f){ return [f.name, p[f.id]]; }));
    var rows = fills.map(function(f){
      var s = stepOf(f[1],600), t = textOn(s.hex,p), r = wcag(t,s.hex);
      var fix = r >= 4.5 ? '<span class="muted">—</span>' : (function(){
        var st = passingStep(f[1],p);
        return st ? '<span class="pill mid">use '+st+'</span>' : '<span class="muted">no step passes — pair with an outline</span>';
      })();
      return '<tr><td><span class="dot" style="background:'+s.hex+'"></span>'+f[0]+' 600</td><td class="mono">'+s.hex.toUpperCase()+'</td>'+
        '<td><span class="dot" style="background:'+t+'"></span><span class="mono">'+t.toUpperCase()+'</span></td>'+
        '<td>'+badge(r, apca(t,s.hex), false)+'</td><td>'+fix+'</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Fill</th><th>Value</th><th>Label</th><th>Contrast</th><th>If it fails</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<p class="hint">Button labels are body text, so 4.5 applies. A fill that fails is usually fixed by taking the next step or two down the ramp.</p>';
  }

  var ALPHAS = [0.04,0.08,0.12,0.16,0.24,0.40,0.60,0.80];
  function alphaHtml(p){
    var surfaces = [['Paper', stepOf(p.neutral,50)],['Panel', stepOf(p.neutral,100)],['Ink', stepOf(p.neutral,950)]];
    var sources = [['Main 600', stepOf(p.main,600)],['Supporting 600', stepOf(p.sup,600)],['Accent 1 500', stepOf(p.a1,500)],['Danger 600', stepOf(p.danger,600)]];
    return surfaces.map(function(s){
      var rows = sources.map(function(src){
        var cells = ALPHAS.map(function(a){
          var c = composite(src[1].hex, a, s[1].hex);
          var ink = wcag('#000',c) >= wcag('#fff',c) ? '#000' : '#fff';
          return '<div class="alpha-cell" style="background:'+c+';color:'+ink+'" title="'+src[0]+' at '+Math.round(a*100)+'% on '+s[0]+' = '+c.toUpperCase()+'" data-copy-value="'+c+'">'+c.slice(1).toUpperCase()+'</div>';
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

  function previewHtml(p, dark){
    var t = tokens(p, dark), n = p.neutral;
    var sh = S.share, total = sh.neutral+sh.sup+sh.main+sh.a1+sh.a2;
    return '<div class="preview" style="background:'+t.background.hex+';color:'+t.foreground.hex+'">'+
      '<div class="pv-bar" style="background:'+t.sidebar.hex+';color:'+t['sidebar-foreground'].hex+';border-bottom:1px solid '+t.border.hex+'">'+
        '<span class="dot" style="background:'+t.primary.hex+'"></span><b>'+(dark?'Dark':'Light')+'</b>'+
        '<span class="muted" style="margin-left:auto">'+Math.round(sh.main/total*100)+'% main · '+Math.round(sh.neutral/total*100)+'% neutral</span></div>'+
      '<div class="pv-body">'+
        '<div class="pv-card" style="background:'+t.card.hex+';border:1px solid '+t.border.hex+'">'+
          '<b>A card on the page</b>'+
          '<span class="muted" style="color:'+t['muted-foreground'].hex+'">Quiet supporting text sits at muted-foreground.</span>'+
          '<div class="pv-row">'+
            '<span class="pv-btn" style="background:'+t.primary.hex+';color:'+t['primary-foreground'].hex+'">Primary</span>'+
            '<span class="pv-btn" style="background:'+t.secondary.hex+';color:'+t['secondary-foreground'].hex+'">Secondary</span>'+
            '<span class="pv-btn" style="background:'+t.accent.hex+';color:'+t['accent-foreground'].hex+'">Accent</span>'+
            '<span class="pv-btn" style="background:transparent;color:'+t.destructive.hex+';border:1px solid '+t.destructive.hex+'">Delete</span>'+
          '</div>'+
        '</div>'+
        FUNCTIONAL.slice(0,3).map(function(f){
          var fs = funcSet(p[f.id], dark);
          return '<div class="pv-row" style="background:'+fs.surface.hex+';border:1px solid '+fs.border.hex+';border-radius:8px;padding:9px 12px;color:'+fs.text.hex+'">'+
            '<span class="dot" style="background:'+fs.fill.hex+'"></span><b>'+f.name+'</b><span style="opacity:.8">'+f.note+'</span></div>';
        }).join('')+
        '<div class="pv-row" style="gap:6px">'+
          [50,100,200,300,400,500,600,700,800,900,950].map(function(st){
            return '<span style="flex:1;height:20px;border-radius:4px;background:'+stepOf(p.main,st).hex+'"></span>';
          }).join('')+
        '</div>'+
      '</div></div>';
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
    return '/* ' + S.name + ' — generated by Palette (OKLCH) */\n\n' + prim + '\n\n' + block(L, ':root', false) + '\n\n' + block(D, '.dark', true) + '\n';
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

  /* ---------- render ---------- */
  function render(){
    readControls();
    syncControls();
    var L = build(false), D = build(true);

    [['chipMain','main',600,'xMain'],['chipSup','sup',500,'xSup'],['chipA1','a1',500,'xA1'],['chipA2','a2',600,'xA2'],['chipNeu','neutral',300,null]].forEach(function(c){
      var hex = stepOf(L[c[1]], c[2]).hex;
      var node = el(c[0]); if(node) node.style.background = hex;
      var input = c[3] && el(c[3]);
      if(input && document.activeElement !== input) input.value = hex.toUpperCase();
    });
    var clash = hueClash(S.main.h);
    el('rampMeta').textContent = Math.round(S.main.h) + '° main · ' + STEPS.length + ' steps · ' + (S.shape.gamut === 'p3' ? 'Display P3' : 'sRGB') + (clash ? ' · reads close to ' + clash : '');

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
    el('shareSum').textContent = 'Adds up to ' + total + ' — shown as ' + Math.round(sh.main/total*100) + '% main, ' + Math.round((sh.a1+sh.a2)/total*100) + '% accent.';

    el('roleTable').innerHTML = roleTableHtml(L);
    el('funcTable').innerHTML = funcTableHtml(L);
    el('stateTable').innerHTML = stateTableHtml(L);

    el('ctText').innerHTML = '<div data-theme="light">' + contrastTextHtml(L,false) + '</div>' +
                             '<div data-theme="dark">' + contrastTextHtml(D,true) + '</div>';
    el('ctFill').innerHTML = contrastFillHtml(L);
    el('contrastMeta').textContent = 'WCAG 2 · APCA Lc';

    el('alphaMatrix').innerHTML = alphaHtml(L);
    el('scrimOut').innerHTML = scrimHtml();
    el('gradOut').innerHTML = gradientsHtml(L);
    el('previewOut').innerHTML = '<div data-theme="light">' + previewHtml(L,false) + '</div>' +
                                 '<div data-theme="dark">' + previewHtml(D,true) + '</div>';

    el('outCss').textContent = cssExport();
    el('outJson').textContent = jsonExport();

    applyTheme();
    try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){}
  }

  /* which theme the views show; Both shows them side by side */
  function applyTheme(){
    document.querySelectorAll('[data-theme]').forEach(function(node){
      if(node.closest('#themeSeg')) return;
      node.style.display = (THEME === 'both' || node.dataset.theme === THEME) ? '' : 'none';
    });
    var dark = el('rampsDark') && el('rampsDark').closest('.card');
    var light = el('rampsLight') && el('rampsLight').closest('.card');
    if(light) light.style.display = (THEME === 'dark') ? 'none' : '';
    if(dark) dark.style.display = (THEME === 'light') ? 'none' : '';
    document.documentElement.style.colorScheme = THEME === 'dark' ? 'dark' : 'light';
  }
  el('themeSeg').addEventListener('click', function(e){
    var b = e.target.closest('button[data-theme]'); if(!b) return;
    THEME = b.dataset.theme;
    [].forEach.call(el('themeSeg').children, function(x){ x.setAttribute('aria-selected', String(x === b)); });
    /* the tool itself follows the switch, so a dark palette is judged on a dark page */
    document.documentElement.setAttribute('data-ui', THEME === 'dark' ? 'dark' : 'light');
    applyTheme();
  });

  /* paste a brand hex: its hue and chroma drive the ramp, the lightness steps stay fixed */
  [['xMain','main'],['xSup','sup'],['xA1','a1'],['xA2','a2']].forEach(function(pair){
    var input = el(pair[0]); if(!input) return;
    input.addEventListener('change', function(){
      var v = input.value.trim();
      if(/^#?[0-9a-f]{6}$/i.test(v)){
        var c = hexToOklch(v[0] === '#' ? v : '#' + v);
        S[pair[1]].h = c.h;
        S[pair[1]].c = Math.min(c.C, pair[1] === 'sup' ? 0.30 : 0.32);
        if(pair[1] === 'sup') S.sup.rel = 'custom';
        if(pair[1] === 'main' && S.neutral.from === 'own') S.neutral.h = c.h;
        syncControls(); render();
      } else if(v){ input.value = ''; }
    });
  });

  /* ---------- wiring ---------- */
  document.querySelectorAll('.rail input, .rail select').forEach(function(i){
    i.addEventListener('input', render);
    i.addEventListener('change', render);
  });
  el('tabs').addEventListener('click', function(e){
    var b = e.target.closest('button[data-view]'); if(!b) return;
    [].forEach.call(el('tabs').children, function(x){ x.setAttribute('aria-selected', String(x === b)); });
    document.querySelectorAll('section.view').forEach(function(s){ s.classList.toggle('on', s.dataset.view === b.dataset.view); });
  });
  document.addEventListener('click', function(e){
    var sw = e.target.closest('[data-copy-value]');
    if(sw){ navigator.clipboard && navigator.clipboard.writeText(sw.dataset.copyValue); sw.style.outline='2px solid var(--accent)'; setTimeout(function(){ sw.style.outline=''; },400); return; }
    var cp = e.target.closest('[data-copy]');
    if(cp){ navigator.clipboard && navigator.clipboard.writeText(el(cp.dataset.copy).textContent); cp.textContent='Copied'; setTimeout(function(){ cp.textContent='Copy'; },900); return; }
    var dl = e.target.closest('[data-dl]');
    if(dl){
      var isCss = dl.dataset.dl === 'css';
      var blob = new Blob([isCss ? cssExport() : jsonExport()], { type: isCss ? 'text/css' : 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = S.name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + (isCss ? '.css' : '.json');
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
        if(d.settings){ S = d.settings; syncControls(); render(); }
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
    S = JSON.parse(JSON.stringify(DEFAULTS)); syncControls(); render();
  });

  try{
    var saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if(saved && saved.main) S = saved;
  }catch(e){}
  syncControls();
  render();
})();
</script>
</body>
</html>
