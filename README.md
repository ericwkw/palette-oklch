# Palette

An OKLCH colour studio for building a design system's palette — and the family of brands that share it.

**[Open it →](https://ericwkw.github.io/palette-oklch/)**

One HTML file. No dependencies, no build step to use it, no network: open the page and it works, offline included. Nothing you make leaves the browser.

---

## Why it exists

Most palettes are chosen by eye and then checked by nobody. A "step 600" in one hue turns out heavier than a step 600 in another, a brand colour gets pinned into a ramp and never actually appears in the product, and a green Success badge sits next to a green brand button where a colour-blind reader sees one colour.

This tool generates colour in OKLCH and keeps it there, so lightness means the same thing whatever the hue — and then checks the things that normally go unchecked.

## How you'd use it

1. **Find your colours.** Paste a brand hex, drop in a picture and take the colours it is made of, or ask for six palettes to look at — nothing changes until you pick one.
2. **Check they are used.** Pinning a hex into a ramp is not the same as a token using it; the tool says which tokens draw your colour, or that none do, and offers the mapping that would fix it.
3. **Clear the audit.** Every pair the tokens actually put together, at the level each one needs, with the step that would mend a failure.
4. **Keep the states distinct.** Status colours that read as brand, or as each other — including through each kind of colour blindness.
5. **Hand it over.** A stylesheet, a Tailwind theme, Figma variables, a printable sheet, or a link that carries the whole palette in its own URL.

A strip above the tabs tracks those five and takes you to whichever one you are on.

## The ideas worth knowing

**Fixed lightness steps.** Every ramp sits on the same eleven steps (50–950, the shadcn/Tailwind scale), so a shade means the same weight in any hue. Where those steps sit is a choice the tool makes visible: Tailwind's own curve, even lightness, or even contrast — the last one making a step number predict readability.

**Roles, then tokens.** A role says what a colour is *for* (main, supporting, two accents, neutrals). A token is the name a product asks for (`primary`, `border`, `chart-3`). Ramp steps are the primitives underneath, so swapping a palette never changes a token name.

**One set of hues, two themes.** Light and dark come from the same hues; only the lightness curve differs, and tokens read the ramp from opposite ends.

**A brand family.** One parent and as many sisters as you like. A sister sets only its own main colour and inherits the neutrals, the six state colours, the steps, the ramp shape and the token mapping — that inheritance is what makes a set of brands look related. The wheel shows the whole family at once; a sister can be kept on its own and brought into another palette later.

**Nothing is lost by exploring.** Anything that replaces your palette — a suggestion taken, a colour from a picture, a reset — leaves the old one on the shelf first. Undo covers the last 30 changes and names what it would undo.

**Quiet once you know it.** Three kinds of text, treated differently: what the tool has to *say about your palette* always shows; what tells you *what you can do* always shows, in a line; the *reasoning* is behind an **Explain** switch. A first visit explains itself, then remembers what you chose.

## Running and checking it

```bash
npm test
```

Builds the page, fails if the committed `index.html` is not what its parts make, refuses any backslash that a template literal would eat, then drives the tool through 50 journeys in headless Chrome. Needs Node 22+ and a Chrome; starts its own server; installs nothing.

- `npm start` — serve it locally
- `npm run journeys` — the journeys alone; `node journeys.mjs <url>` runs them against a deployed copy
- `npm run lint` — the escape check alone

The same steps run on every push and pull request, and `main` publishes to GitHub Pages only when they pass. The rail shows which build you are on, and every export names it.

### How the checks are written

The journeys drive the real tool with real clicks and assert on sequences, not states: what happens *next* after a change, whether it can be seen, and whether it can be undone. They exist because spot checks missed the things in them.

**The journey comes first.** Write it, run it, and watch it fail for the reason you expect before writing the code that makes it pass — a test that has never been red has not been shown to test anything. If a new one turns an old one red, that is old behaviour being deliberately replaced, and it is worth saying so out loud.

**Watch the backslash.** The journeys send JavaScript to the browser inside template literals, which eat escapes: `\s` is not an escape sequence, so the backslash is dropped and a whitespace regex quietly starts matching the letter *s*. Twice this made a test pass while measuring nothing. `npm run lint` refuses it; double the backslash.

Not everything is test-shaped — proportion, density and whether a screen reads well are still judged by looking. Once such a thing has a number it becomes an assertion: page height, contrast ratios and element counts all arrived that way.

## How it is built

`index.html` is assembled from four parts in `build/` — styles, markup, the colour engine, the interface — by `./build.sh`. Edit the parts, not the page; the pipeline fails if the two disagree.

```
build/01-head.html   styles
build/02-body.html   markup
build/03-core.js     OKLCH conversion, gamut fitting, contrast, colour vision
build/04-ui.js       state, rendering, every control
journeys.mjs         50 journeys in headless Chrome
check-build.mjs      the page must equal its parts
lint-escapes.mjs     backslashes that would not survive
serve.mjs            a static server, for the checks
```

## Deliberate choices

- **sRGB by default, P3 on request.** In P3 a ▲ marks values a plain screen cannot reach, the hex stays the closest sRGB fallback, and the Figma export says how many values were affected rather than clipping quietly.
- **WCAG and APCA together.** WCAG 2 is what standards still ask for; APCA models light and dark text differently and matches the eye better. Both are shown; neither is hidden.
- **The tool is held to its own standard.** Its own interface is measured with the same contrast function it measures your palette with, in both themes, and a journey fails if any of it falls short.
