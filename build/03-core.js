<script>
/* ============================================================
   Colour maths — OKLCH is the source of truth.
   ============================================================ */
var STEPS = [50,100,200,300,400,500,600,700,800,900,950];
/* lightness targets, light theme; dark theme mirrors them */
var L_LIGHT = [0.977,0.949,0.897,0.830,0.748,0.652,0.558,0.472,0.395,0.325,0.255];
var L_DARK  = L_LIGHT;  /* the dark curve is derived from the light one in makeRamp */

function clamp(x,a,b){ return x<a?a:(x>b?b:x); }
function srgbFromLinear(c){ return c<=0.0031308 ? 12.92*c : 1.055*Math.pow(c,1/2.4)-0.055; }
function linearFromSrgb(c){ return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }

function oklchToLinearSrgb(L,C,h){
  var hr = h*Math.PI/180, a = C*Math.cos(hr), b = C*Math.sin(hr);
  var l_ = L + 0.3963377774*a + 0.2158037573*b;
  var m_ = L - 0.1055613458*a - 0.0638541728*b;
  var s_ = L - 0.0894841775*a - 1.2914855480*b;
  var l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  return [
    +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
  ];
}
/* Display P3 uses the same OKLab, different primaries */
function oklchToLinearP3(L,C,h){
  var rgb = oklchToLinearSrgb(L,C,h); /* linear sRGB */
  var r=rgb[0],g=rgb[1],b=rgb[2];
  return [
    0.8224621*r + 0.1775380*g + 0.0000000*b,
    0.0331941*r + 0.9668058*g + 0.0000000*b,
    0.0170827*r + 0.0723974*g + 0.9105199*b
  ];
}
function inGamut(L,C,h,space){
  var rgb = space==='p3' ? oklchToLinearP3(L,C,h) : oklchToLinearSrgb(L,C,h);
  for(var i=0;i<3;i++){ if(rgb[i] < -0.0005 || rgb[i] > 1.0005) return false; }
  return true;
}
/* largest chroma that still fits the gamut, by bisection */
function fitChroma(L,C,h,space){
  if(inGamut(L,C,h,space)) return C;
  var lo=0, hi=C;
  for(var i=0;i<24;i++){ var mid=(lo+hi)/2; if(inGamut(L,mid,h,space)) lo=mid; else hi=mid; }
  return lo;
}
function oklchToHex(L,C,h,space){
  var c = fitChroma(L,C,h,space||'srgb');
  var lin = oklchToLinearSrgb(L,c,h);
  var out = '#';
  for(var i=0;i<3;i++){
    var v = Math.round(clamp(srgbFromLinear(clamp(lin[i],0,1)),0,1)*255);
    out += (v<16?'0':'') + v.toString(16);
  }
  return out;
}
function oklchCss(L,C,h,space){
  var c = fitChroma(L,C,h,space||'srgb');
  return 'oklch(' + (L*100).toFixed(1) + '% ' + c.toFixed(3) + ' ' + h.toFixed(1) + ')';
}
function hexToRgb(hex){
  return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}
function relLum(hex){
  var c = hexToRgb(hex).map(function(v){ return linearFromSrgb(v/255); });
  return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
}
function wcag(a,b){
  var la = relLum(a), lb = relLum(b);
  var hi = Math.max(la,lb), lo = Math.min(la,lb);
  return (hi+0.05)/(lo+0.05);
}
/* APCA (W3 draft, 0.1.9 constants) — Lc, positive for dark text on light */
function apcaY(hex){
  var c = hexToRgb(hex).map(function(v){ return Math.pow(v/255,2.4); });
  return 0.2126729*c[0] + 0.7151522*c[1] + 0.0721750*c[2];
}
function apca(textHex, bgHex){
  var Ytxt = apcaY(textHex), Ybg = apcaY(bgHex);
  var B = 0.022, P = 1.414, sc = 1.14, off = 0.027, lo = 0.1;
  function soft(Y){ return Y > B ? Y : Y + Math.pow(B - Y, P); }
  Ytxt = soft(Ytxt); Ybg = soft(Ybg);
  var C;
  if(Ybg > Ytxt){ C = (Math.pow(Ybg,0.56) - Math.pow(Ytxt,0.57)) * sc; C = C < lo ? 0 : C - off; }
  else { C = (Math.pow(Ybg,0.65) - Math.pow(Ytxt,0.62)) * sc; C = C > -lo ? 0 : C + off; }
  return C * 100;
}
/* alpha over a solid background → the exact solid it composites to */
function composite(fgHex, alpha, bgHex){
  var f = hexToRgb(fgHex), b = hexToRgb(bgHex), out='#';
  for(var i=0;i<3;i++){
    var v = Math.round(f[i]*alpha + b[i]*(1-alpha));
    out += (v<16?'0':'') + v.toString(16);
  }
  return out;
}
function hexToOklch(hex){
  var c = hexToRgb(hex).map(function(v){ return linearFromSrgb(v/255); });
  var l = 0.4122214708*c[0] + 0.5363325363*c[1] + 0.0514459929*c[2];
  var m = 0.2119034982*c[0] + 0.6806995451*c[1] + 0.1073969566*c[2];
  var s = 0.0883024619*c[0] + 0.2817188376*c[1] + 0.6299787005*c[2];
  l = Math.cbrt(l); m = Math.cbrt(m); s = Math.cbrt(s);
  var L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
  var a = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s;
  var b = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s;
  return { L:L, C:Math.hypot(a,b), h:(Math.atan2(b,a)*180/Math.PI+360)%360 };
}

/* ============================================================
   Ramps
   ============================================================ */
/* chroma envelope: peaks at the chosen step, eases to the ends */
function chromaAt(i, peakIdx, peakC, falloff){
  var d = Math.abs(i - peakIdx) / Math.max(peakIdx, STEPS.length-1-peakIdx);
  var k = Math.pow(1 - Math.min(d,1), 1.1);
  return peakC * (0.30 + 0.70*k) * (1 - falloff*0.18*Math.pow(Math.max(0,(i-peakIdx))/Math.max(1,STEPS.length-1-peakIdx),1.4));
}
/* does this colour need more than sRGB? */
function outsideSrgb(L,C,h){ return !inGamut(L,C,h,'srgb'); }

/* How far a hue turns from the light end to the dark end.
   Left alone, a single hue reads wrong at the extremes: dark yellows look acid,
   pale reds look pink. These are the natural directions, in degrees across the
   whole ramp, and the tool scales them with one control. */
function defaultTwist(h){
  h = ((h % 360) + 360) % 360;
  if(h >= 40  && h < 105) return -26;   /* yellow · dark end turns toward orange */
  if(h >= 105 && h < 175) return -10;   /* green · dark end warms slightly */
  if(h >= 175 && h < 265) return  10;   /* cyan and blue · dark end deepens toward indigo */
  if(h >= 265 && h < 320) return  -8;   /* violet · dark end pulls back to blue */
  return 8;                             /* red and pink · dark end turns toward crimson */
}
function twistedHue(hue, i, steps, twist, pivot){
  if(pivot === undefined) pivot = (steps - 1) / 2;
  var span = Math.max(pivot, steps - 1 - pivot) || 1;
  var t = (i - pivot) / span;            /* 0 at the pivot step, ±1 at the far end */
  return ((hue + (twist / 2) * t) % 360 + 360) % 360;   /* twist is the turn across the whole ramp */
}

function makeRamp(hue, chroma, opts){
  opts = opts || {};
  var dark = !!opts.dark, space = opts.space || 'srgb';
  var Ls = dark ? L_DARK : L_LIGHT;
  var peak = opts.peak === undefined ? 6 : opts.peak;
  var fall = opts.falloff === undefined ? 0.85 : opts.falloff;
  var lift = opts.lift === undefined ? 0.055 : opts.lift;     /* how far the dark end lifts */
  var boost = opts.boost === undefined ? 1 : opts.boost;      /* dark-theme colourfulness */
  var twist = opts.twist === undefined ? defaultTwist(hue) : opts.twist;
  var anchor = opts.anchor || null;
  var pivot = anchor ? anchor.index : (STEPS.length - 1) / 2;   /* the step whose hue is exactly `hue` */      /* { index, L, C } — an exact colour to build around */
  var nudges = opts.nudges || {};        /* { step: {dL, dC} } — per-step adjustments */
  var scale = 1, shift = 0;
  if(anchor){
    var baseC = chromaAt(anchor.index, peak, chroma, fall) * (dark ? boost : 1);
    scale = baseC > 0.0005 ? anchor.C / baseC : 1;
    shift = anchor.L - (dark ? lift + Ls[anchor.index] * (1 - lift * 2.1) : Ls[anchor.index]);
  }
  var out = [];
  for(var i=0;i<STEPS.length;i++){
    var exact = null;
    /* 50 is the lightest step in both themes; the dark curve lifts the deep end
       so dark surfaces stay separable, and pulls the light end down a little */
    var L = dark ? lift + Ls[i] * (1 - lift * 2.1) : Ls[i];
    var C = chromaAt(i, peak, chroma, fall) * (dark ? boost : 1);
    if(anchor){
      /* the anchor pulls its neighbours with it, fading out over three steps,
         so an exact brand colour does not leave a bump in the ramp */
      var w = Math.max(0, 1 - Math.abs(i - anchor.index) / 3.2);
      L += shift * w;
      C *= 1 + (scale - 1) * w;
      if(i === anchor.index){ L = anchor.L; C = anchor.C; exact = anchor.hex || null; }
    }
    var n = nudges[STEPS[i]];
    if(n){ L = clamp(L + (n.dL || 0), 0.02, 0.995); C = Math.max(0, C + (n.dC || 0)); }
    var hi = twistedHue(hue, i, STEPS.length, twist, pivot);
    var wide = outsideSrgb(L,C,hi);
    C = fitChroma(L, C, hi, space);
    out.push({ step:STEPS[i], L:L, C:C, h:hi, wide:wide && space === 'p3',
               hex:(exact && !n) ? exact : oklchToHex(L,C,hi,space),
               css:oklchCss(L,C,hi,space) });
  }
  return out;
}
/* functional hues stay put across a brand family */
var FUNCTIONAL = [
  { id:'success', name:'Success', hue:145, chroma:0.14, note:'done, adopted, on track' },
  { id:'warning', name:'Warning', hue:75,  chroma:0.15, note:'needs attention, not urgent' },
  { id:'danger',  name:'Danger',  hue:27,  chroma:0.18, note:'destructive, failed, overdue' },
  { id:'info',    name:'Info',    hue:235, chroma:0.13, note:'neutral explanation' },
  { id:'pending', name:'Pending', hue:295, chroma:0.11, note:'waiting on someone else' },
  { id:'fresh',   name:'New',     hue:185, chroma:0.13, note:'unread, newly added' }
];
var RESERVED = FUNCTIONAL.map(function(f){ return f.hue; });
function hueClash(h){
  for(var i=0;i<RESERVED.length;i++){
    var d = Math.abs(((h - RESERVED[i] + 540) % 360) - 180);  /* shortest way round */
    if(d < 18) return FUNCTIONAL[i].name;
  }
  return null;
}
</script>
