# Palette — an OKLCH ramp studio

A single HTML file. Open `index.html` in a browser; nothing to install, nothing to build.

Colour is generated in OKLCH and stays there: every ramp sits on the same lightness steps, so a shade means the same weight whatever the hue, and chroma is fitted to the gamut step by step so no swatch is a lie.

## What it does

- **Light / dark switch** in the tab bar: Light, Dark or Both. Every view follows it — ramps, roles, tokens, contrast, opacity, gradients and preview are rebuilt for the chosen theme, and the tool's own page follows too. Both shows them one under the other.
- **One set of hues serves both themes.** Hue and colourfulness are shared; only the lightness curve differs, and tokens read the ramp from the opposite end (paper is step 50 in light, 950 in dark). Two dark-mode controls adjust that curve: how far the deep end lifts, and how colourful the dark theme runs.
- **Start from a hex.** Paste a brand colour into a role's *Brand hex* field: the ramp is built around it, and by default your exact value replaces the step it lands on, marked *brand* in the ramp. Untick *Keep my exact colour in the ramp* to see the generated step instead, with yours beside it for comparison. Move the hue or colourfulness away and the line says the ramp has drifted, with a button to snap back to your colour; ✕ forgets it. The exact value is always exported as `--main-brand` and friends.

- **Hue turns along a ramp.** A single hue reads wrong at the extremes — dark yellows go acid, pale reds go pink. Each ramp turns its hue between the light and dark ends in the direction that family wants (yellows toward orange as they darken, blues toward indigo), scaled by one control, or held flat at zero. Neutrals never turn, and a pinned brand colour is the pivot the turn happens around.
- **Ramps** on the shadcn / Tailwind scale — 50, 100 … 900, 950 — for main, supporting, an accent pair, neutrals, and six functional colours. Light and dark come from one set of hues.
- **Roles and tokens.** Roles say what a colour is for; tokens are the shadcn names a product uses. Ramp steps underneath are the primitives, so a palette swap never renames a token.
- **Share of surface.** Set how much of a screen each role should hold. The five always add up to 100% — move one and the rest rebalance in proportion, so there is no arithmetic to do.
- **Contrast.** A token audit first: every pair the tokens actually create — foreground on background, muted-foreground on muted, border on card, ring and chart colours — checked at the level each needs (4.5 text, 3.0 marks, hairlines reported not failed). Then text on surfaces, and every solid fill with its own label, including which step to use when one falls short. Defaults pass in both themes.
- **Opacity and overlays.** Every role at 4–80% over each surface, with the exact solid it composites to and the ramp step it matches (so a tint can be swapped for a token), so a tint can be matched back to a real step. Drop in an image and the lightest and darkest pixels under the caption area are measured, and the scrim needed for white text is reported.
- **Gradients** interpolated in OKLCH, with a banding note and where white text survives.
- **Export** as a shadcn `globals.css` (`:root` and `.dark`, all in OKLCH, plus the raw ramps as custom properties) or as JSON. Save and load a palette file; the last state is remembered in the browser.

- **Nudge one step.** Click any swatch to open an editor and move that step's lightness or colourfulness on its own; nudged steps carry a dashed outline, and a reset puts them back.
- **Choose what each token uses.** Primary, tint surface, hairline and focus ring can each point at a different step, per theme.
- **Gamut, honestly.** In P3 the swatches are painted in OKLCH and a ▲ marks the values a plain sRGB screen cannot reach; the hex shown stays the closest sRGB fallback.

## Checking it

`journeys.mjs` drives the tool with real clicks in headless Chrome and checks sequences, not states — what happens *next* after a change, whether it can be seen, and whether it can be undone.

```
python3 -m http.server 8829     # from this folder, in another terminal
node journeys.mjs               # or: node journeys.mjs http://host/page
```

Seven journeys: a brand colour survives being worked around and can be recovered; the pin toggles with a real click; every token mapping moves something on screen; a step can be nudged and reset; the theme switch reaches every tab; work survives a reload; the defaults pass their own contrast audit. Exit code 1 if any fail.

Each of those exists because a spot check missed it. Anything added from here should come with a journey, and every new control should answer three questions: what does it change on screen, how is it undone, and what does it look like in a strange state.

## Functional colours

Success, warning, danger, info, pending and new. Their hues are fixed on purpose: in a brand family, meaning should not move when a sister brand changes its main colour. Brand hues that land within 18° of one of them are flagged.

## Planned

- **Brand family.** A registry of sister brands, each a hue and an intensity against a shared parent: shared neutrals, shared functional colours, spacing rules so no two siblings collide, and one export per brand.
- Palette comparison side by side, and colour-blind simulation.
