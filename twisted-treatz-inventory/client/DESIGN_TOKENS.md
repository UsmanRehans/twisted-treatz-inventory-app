# Twisted Treatz — Design Tokens

The visual language for the admin dashboard, login, and iPad floor app. Twisted
Treatz is a candy maker; the UI should feel **warm, light, and calm** — sweet,
not clinical. This file is the source of truth; the implementation lives in
[`src/index.css`](src/index.css) as a Tailwind v4 `@theme` block.

**How it's applied:** every component styles through Tailwind utility classes
(there is no hardcoded hex in `.tsx`). So the language is set centrally by
remapping Tailwind's `gray` (neutral) and `indigo` (accent) ramps plus the
radius scale. Changing a token here re-skins the whole app — never reintroduce
raw hex in components.

## The one anchoring decision

Warm the light and keep a calm, *warmer* blue accent. This is a mood-lift, not
a color rebrand — we deliberately did **not** swap to a saturated candy accent
(raspberry/coral were considered and declined for restraint).

## Palette

### Neutral — warm paper → charcoal (Tailwind `gray-*`)
| Stop | Value | Role |
|---|---|---|
| `gray-50` | `#FBF7F2` | **Canvas** — warm paper page background |
| `gray-100` | `#F4EFE8` | Hover/inset surfaces |
| `gray-200` | `#ECE4DA` | Warm hairline borders (use sparingly) |
| `gray-300` | `#DDD3C7` | Stronger dividers, input borders |
| `gray-400` | `#B5A99C` | Disabled / faint |
| `gray-500` | `#756A60` | Muted text (AA on white) |
| `gray-600` | `#5E544B` | Secondary text |
| `gray-700` | `#4A4138` | — |
| `gray-900` | `#2A2320` | **Primary text** — warm charcoal |

Cards stay **white** (`#FFFFFF`) and lift off the warm canvas with a soft
shadow rather than a cold outline.

### Accent — calm warm slate-blue (Tailwind `indigo-*`)
| Stop | Value | Role |
|---|---|---|
| `indigo-50` | `#EEF1FA` | Active-tab fill, chip tint |
| `indigo-100` | `#DCE3F4` | Light fills |
| `indigo-600` | `#5B73C4` | **Primary** — CTAs, active states (white text ≈ 4.5:1) |
| `indigo-700` | `#4A60AC` | Hover, accent text on light tint |

Semantic colors (`green` / `amber` / `red`) are left as Tailwind defaults — they
already encode success / warning / danger correctly.

## Shape
| Token | Value | Use |
|---|---|---|
| `--radius-md` | `0.625rem` (10px) | Buttons, inputs |
| `--radius-lg` | `0.875rem` (14px) | Cards |
| `--radius-xl` | `1.125rem` (18px) | Large panels |
| `rounded-full` | pill | Chips, badges, segmented controls |

## Principles
- **Temperature is the mood.** The old palette wasn't dark — it was *cold*
  (slate gray + corporate indigo). Warmth, not darkness, is the lever.
- **One accent.** The warm slate-blue is the only saturated brand color. Don't
  add a second.
- **Accessibility is non-negotiable.** Keep muted/secondary grays dark enough
  for AA body text on white; verify any new accent against white at ≥4.5:1.
- **No raw hex in components.** Change the ramp here, not in a `.tsx`.
