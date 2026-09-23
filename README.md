# Palette — an OKLCH ramp studio

A single HTML file. Open `index.html` in a browser; nothing to install. It is assembled from the parts in `build/` — edit those and run `./build.sh`.

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
- **Opacity and overlays.** Every role at 4–80% over each surface, with the exact solid it composites to and the ramp step it matches, so a tint can be swapped for a token. Drop in an image and a caption box appears over it: drag or resize the box to where the caption will really sit, and the pixels inside it are measured by percentile — the median, the 95th and the single brightest, each with the black scrim white text would need over it. The recommendation follows the 95th, so one glint of sunlight does not dictate a heavy scrim for the whole picture, and the box wears the scrim it recommends so you read the real thing.
- **Gradients** interpolated in OKLCH, with a banding note and where white text survives.
- **A preview worth trusting.** One dense screen rather than a few swatches: a sidebar with an active item, a table of six rows carrying all six functional statuses, a form with a focused field, an error and a disabled field, a five-series chart on the chart tokens, and body text at three sizes. Drawn only from tokens, in light and dark, so a mapping change has somewhere to show.
- **A library of palettes.** Keep the current palette under its name, switch between kept ones, duplicate, and delete. Kept in this browser, and the line under the list says whether what is on screen still matches what you kept. Renaming and keeping makes a new palette rather than overwriting the old one; deleting asks once and removes only the saved copy, never the colours on screen.
- **Undo and redo** over the last 30 changes, with ⌘Z and ⇧⌘Z. A whole slider drag counts as one change, a new change after undoing drops the branch ahead of it, and switching library palettes can be undone like anything else.
- **A brand family.** One parent and as many sisters as you need. A sister sets only its own main hue and colourfulness — it may travel a long way round the wheel — and inherits the parent's neutrals, the six functional colours, the lightness steps, the ramp shape and the token mapping, which is what keeps them reading as one family. Sisters closer than 24° to each other, or sitting on a functional hue, are called out; *Space them evenly* pushes them apart and steps off the reserved hues. A parity table asks whether every brand's button reads as strongly as the parent's, the preview is drawn once per brand side by side, and the family exports as one stylesheet with `:root` for the parent and `[data-brand="…"]` for each sister.
- **Export, in the shapes the next person needs.**
  - **A link** that carries the whole palette in its own hash — nothing is uploaded and nothing is stored on a server. Opening it brings the tool up exactly as it was, then clears the hash so a later reload shows your own work.
  - **shadcn `globals.css`** — `:root` and `.dark`, all thirty token names, in OKLCH, plus the raw ramps as custom properties. The token names were checked against a published shadcn theme.
  - **Tailwind**, either version: v4 as an `@theme inline` block whose colours follow `.dark` on their own, or v3 as a `tailwind.config.js` whose semantic colours point at the CSS variables and whose ramps are literal.
  - **Figma variables** — one collection with a Light and a Dark mode, so a token switches mode in Figma the way it switches class in the browser. Semantic tokens, every ramp step, and any pasted brand colour.
  - **A PNG sheet** of every ramp with its steps and hex values, and a token strip for each theme.
  - **JSON** of the ramps and settings. Save and load a palette file; the last state is remembered in the browser.

- **Nudge one step.** Click any swatch to open an editor and move that step's lightness or colourfulness on its own; nudged steps carry a dashed outline, and a reset puts them back.
- **Share of surface, measured.** The five sliders say what each role *should* cover. The tool then reads the preview it just drew — element by element, by area, attributing each background to the ramp it came from — and reports what that screen actually covers against what you asked for. One screen is not a whole product, so it is offered as a sanity check on the intention rather than a verdict; it is, at least, a measurement rather than a restatement of the sliders.
- **Choose what each token uses.** Primary, tint surface, hairline, focus ring and the chart series can each point at a different step, per theme. A step your pasted brand colour landed on is offered by name, even when it falls outside a control's usual range.
- **Does the brand colour actually reach the interface?** Pinning a hex into a ramp is not the same as a token using it: a colour pinned at step 400 while every token reads 100 and 700 appears nowhere in the product. The Roles tab names, for each pinned colour, the tokens that draw it — or says plainly that none do, and offers the control that would mend it. The rail carries the short version beside the colour you pasted.
- **A failing contrast pair says what would fix it.** The summary names the pairs that fall short rather than counting them, the rows are marked, and each carries the step that clears the level — one click, taken on the control that owns it.
- **Gamut, honestly.** In P3 the swatches are painted in OKLCH and a ▲ marks the values a plain sRGB screen cannot reach; the hex shown stays the closest sRGB fallback.

- **Plain words, with the jargon a click away.** The controls are named for what they do — *Colourfulness*, *Strongest at*, *Dark fade*, *Hue turn*, *Screen range* — and each carries a question mark that opens a glossary at that entry. Fifteen entries: OKLCH, ramp, chroma, peak, falloff, hue turn, tint, lift, gamut, pinned brand colour, token, share of surface, WCAG and APCA, scrim, sister brand.
- **Only what you are looking at is drawn.** The rail and the ramps are always current; the other views are marked stale and built when you open them. With a family of ten brands, six slider steps take about 13ms from the ramps tab instead of about 94ms.

## Checking it

`journeys.mjs` drives the tool with real clicks in headless Chrome and checks sequences, not states — what happens *next* after a change, whether it can be seen, and whether it can be undone.

```
python3 -m http.server 8829     # from this folder, in another terminal
node journeys.mjs               # or: node journeys.mjs http://host/page
```

Twenty-one journeys: a brand colour survives being worked around and can be recovered; the pin toggles with a real click; every token mapping moves something on screen; a step can be nudged and reset; the theme switch reaches every tab; work survives a reload; the defaults pass their own contrast audit; the hue turns along a ramp without leaving its family; the preview uses every token and reacts to a mapping; the library keeps, switches, duplicates and deletes without losing work; undo and redo walk the history, by button and by keyboard; a sister joins the family, shares the right things and is warned when it collides; the family holds its contrast parity; the scrim check follows the caption box across a generated test image and reports by percentile rather than by one bright pixel; every export parses — the browser is made to read back each colour, the v3 config is actually run, the Figma JSON is parsed — and the link round-trips through a real page load; every question mark in the rail has a glossary entry behind it and no control is labelled with jargon; with ten brands a drag stays fast and the view left behind is brought up to date when it comes back; a brand colour no token uses is reported as unused and the offered fix really mends it; a failing contrast pair names itself and is cleared from where it is reported; the share of surface is measured off the drawn preview and disagrees with the target when the target is wrong; and the state colours can be moved, warn when they read as brand, and are put back to their defaults. Exit code 1 if any fail.

Each of those exists because a spot check missed it. Anything added from here should come with a journey, and every new control should answer three questions: what does it change on screen, how is it undone, and what does it look like in a strange state.

## Functional colours

Success, warning, danger, info, pending and new. They start on fixed hues, because in a brand family meaning should not move when a sister changes its main colour — but they can be moved, each with its own hue and colourfulness, and put back to the default one at a time or all at once. Whatever they are set to is what the family shares.

The check that matters is whether a state can still be read *as a state*: any that sits within 25° of one of your brand colours, or within 18° of another state, is named. *Move them off the brand hues* walks each one outward until it is clear, but never further than 45° from where it started — a Danger that lands in the greens has stopped meaning danger — and anything it cannot free is reported rather than quietly left.

## Planned

- Palette comparison side by side, and colour-blind simulation.
