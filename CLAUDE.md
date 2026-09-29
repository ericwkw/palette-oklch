# Working on this repo

An OKLCH colour studio, shipped as one HTML file with no dependencies and no
network calls. Live at https://ericwkw.github.io/palette-oklch/ — GitHub repo
`ericwkw/palette-oklch`, published from `main` by GitHub Actions.

Read `README.md` first: it explains what the tool is for and the ideas behind it.
This file covers the things the README does not — how to change it without
breaking it, and the traps that have already cost time.

## The one rule that matters most

**`index.html` is generated. Never edit it by hand.**

The source lives in `build/`, in four parts that are concatenated in order:

| File | What it holds |
| --- | --- |
| `build/01-head.html` | all the CSS, including the theme tokens |
| `build/02-body.html` | the markup: rail, tabs, quickbar, preview |
| `build/03-core.js` | the colour engine — OKLCH maths, gamut fitting, contrast, colour-vision simulation |
| `build/04-ui.js` | all state, rendering and controls |

`./build.sh` assembles them. `index.html` is *committed* anyway, because the
point of the tool is that you can open it straight from the repo — so there are
two copies of the truth, and `check-build.mjs` fails the build when they
disagree. Edit a part, run `npm run build`, commit both.

## Write the test first

This project is test-driven, at the user's explicit instruction (2026-09-25).

The order is: **add the failing journey, run it, report the red result, then
write the code.** Not the other way round, and not "I'll add a test after". When
a bug is reported, the first artefact is a journey that reproduces it.

`journeys.mjs` holds 50 journeys. They drive a real headless Chrome over the
DevTools protocol with real `Input.dispatchMouseEvent` clicks, because the
question is never "is this value correct" but "can a designer do this, see it,
and undo it". Each journey is a *sequence*, not a snapshot.

```
npm test          # build, then check, then lint, then all 50 journeys
npm run journeys  # just the journeys
npm start         # serve it at localhost:8829
```

Needs **Node ≥ 22** (`WebSocket` became a global in 21) and a Chrome on disk;
both failures print a sentence rather than a stack trace.

## Watch the backslash

This trap has bitten three times, and twice it made a test pass while measuring
nothing at all.

The journeys send JavaScript to the browser inside template literals, and a
template literal eats backslashes on the way. `\s` is not an escape sequence, so
the backslash is dropped and a whitespace regex silently starts matching the
letter s — "Coastal" became "Coa tal". `\b` became a backspace character, and a
journey passed while matching nothing. **Double every backslash** in a regex
inside a template literal.

`lint-escapes.mjs` now catches this, and it runs in `npm test` and in CI. If it
fires, it is right.

## When a test disagrees with the product

Roughly a third of the failures on this project were bugs in the *test*, not the
tool: reading a tab before its lazy render had run, a threshold guessed rather
than measured, a regex matching the noun "drag" as well as the verb. Before
changing product behaviour to make a journey pass, prove the journey is asking
for the right thing.

Equally: do not trust a remembered reference value over the code. An APCA
"discrepancy" turned out to be my memory; the implementation matched the W3
0.1.9 spec exactly when checked properly.

## State lives in the browser

Nothing leaves it. Keys, all versioned:

| Key | Scope | Holds |
| --- | --- | --- |
| `palette-tab-v1` | `sessionStorage` | the working palette, so two tabs do not fight |
| `palette-studio-v1` | `localStorage` | the palette last left, for the next visit |
| `palette-library-v1` | `localStorage` | saved palettes |
| `palette-shelf-v1` | `localStorage` | the shelf (swap semantics — taking one puts the current one back) |
| `palette-sisters-v1` | `localStorage` | kept sisters, portable between palettes |
| `palette-explain-v1`, `palette-values-v1`, `palette-rail-v1`, `palette-explore-v1`, `palette-shelf-open-v1` | `localStorage` | the Explain switch, and which sections are folded |

Anything read back from storage goes through `normalise()` first. Corrupt state
used to blank the tool; now it is repaired and counted.

## Things decided on purpose — don't quietly undo them

- **Explainer text is a switch, not a default.** The user asked for a quieter
  tool once they knew it. But the split is *reporting and affordances always
  visible, rationale hidden* — hiding the lines that tell you a dot can be
  dragged or a picture dropped was a regression, and was reverted. If you add
  copy, classify it before you hide it.
- **One preview at a time.** Drawing every sister's preview at once put the page
  at 9,599px. Chooser chips render one brand's preview; keep it that way.
- **The tool is held to its own standard.** The shipped defaults must pass the
  tool's own contrast audit and hue-clash check. If you retune a default hue,
  run the journeys — one of them asserts exactly this.
- **Both WCAG 2 and APCA are reported**, because they disagree and the
  disagreement is informative.

## Git

- GitHub account for this repo is **`ericwkw`** (personal). The machine's git
  user may be `edcity-ericwu` for work projects — check `gh auth status` and
  switch before pushing, then switch back.
- Commit messages: a sentence saying what changed for the person using the tool,
  not a list of files. Omit Claude attribution trailers.
- `npm test` must pass before a commit. CI runs the same checks and then
  publishes to Pages from `main`.

## Where things stand

Seven build batches and several critique-and-fix rounds are done; 50 journeys
pass; CI is green. The user is **testing the tool and will report findings** —
so prefer fixing what they report over starting new features unprompted.

When a bug arrives, ask for what they did, what they expected, and what
happened. The build date in the rail (`#buildStamp`) says which version they were
on.
