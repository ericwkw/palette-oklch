# Palette — an OKLCH ramp studio

A single HTML file. Open `index.html` in a browser; nothing to install, nothing to build.

Colour is generated in OKLCH and stays there: every ramp sits on the same lightness steps, so a shade means the same weight whatever the hue, and chroma is fitted to the gamut step by step so no swatch is a lie.

## What it does

- **Light / dark switch** in the tab bar: Light, Dark or Both. It changes the tool's own page as well as which theme the ramps, contrast tables and preview show.
- **Start from a hex.** Paste a brand colour into any role's *From hex* field and its hue and colourfulness drive the ramp; the lightness steps stay fixed so it still lines up with the rest.

- **Ramps** on the shadcn / Tailwind scale — 50, 100 … 900, 950 — for main, supporting, an accent pair, neutrals, and six functional colours. Light and dark come from one set of hues.
- **Roles and tokens.** Roles say what a colour is for; tokens are the shadcn names a product uses. Ramp steps underneath are the primitives, so a palette swap never renames a token.
- **Share of surface.** Set how much of a screen each role should hold. The five always add up to 100% — move one and the rest rebalance in proportion, so there is no arithmetic to do.
- **Contrast.** WCAG 2 ratios with APCA alongside, for text on surfaces in both themes, and for every solid fill with its own label — including which step to use when one fails.
- **Opacity and overlays.** Every role at 4–80% over each surface, with the exact solid it composites to, so a tint can be matched back to a real step. Drop in an image and the lightest and darkest pixels under the caption area are measured, and the scrim needed for white text is reported.
- **Gradients** interpolated in OKLCH, with a banding note and where white text survives.
- **Export** as a shadcn `globals.css` (`:root` and `.dark`, all in OKLCH, plus the raw ramps as custom properties) or as JSON. Save and load a palette file; the last state is remembered in the browser.

## Functional colours

Success, warning, danger, info, pending and new. Their hues are fixed on purpose: in a brand family, meaning should not move when a sister brand changes its main colour. Brand hues that land within 18° of one of them are flagged.

## Planned

- **Brand family.** A registry of sister brands, each a hue and an intensity against a shared parent: shared neutrals, shared functional colours, spacing rules so no two siblings collide, and one export per brand.
- Palette comparison side by side, and colour-blind simulation.
