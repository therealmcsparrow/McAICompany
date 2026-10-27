---
name: art-direction
description: Use when an aico artist Role creates or reviews any Asset (brand, illustration, image prompts, motion, game/3D). Covers style source, formats, delivery and licensing.
---

# Art direction

## 1. Style source
Read `## Art direction` in `.company/project.md`. If it's empty, only `aico:brand-artist` may propose one, as `status: needs-ceo` for the Plan Gate. Other artists **never pick palette, mood or style**, but may still deliver **style-neutral** work: structure, timing, sizes, and placeholder tokens (e.g. `--accent`) wired so the style can be swapped later. Mark it *provisional* and list "Art direction missing" under `## Blocking` for the Ship Gate.

## 2. Make it not look generic
Use `hallmark` if available (anti-AI-slop direction and audits), and `impeccable` for UI-adjacent visuals. Fallback: one strong idea per Asset, a limited palette from the Art direction, no default gradients or stock 3D blobs, and real content instead of lorem ipsum.

## 3. Formats (prefer editable source)
| Asset | Deliver |
|---|---|
| Logo, icons, illustrations | SVG source, plus PNG exports at the sizes needed |
| App icons | Windows `.ico` (16–256), macOS `.icns` (16–1024), Linux PNG set (16–512), web favicon and PWA sizes |
| Social, OG and store images | PNG/JPG at each platform's size |
| Motion | CSS/Lottie JSON or a storyboard, with durations and easing; respect `prefers-reduced-motion` |
| Image-gen | prompt plus negative prompt, model, aspect ratio and seed, so the CEO can run and reproduce it |
| Game/3D | sprite sheets with a frame map, or a 3D brief (poly budget, texture sizes, format such as glTF) |

Put files in `assets/<type>/` in the product repo, or wherever the Handoff names, and list every file in `## Did`.

## 4. Licensing (blocking if unclear)
- Fonts, stock material and third-party art: record the license per item. Anything not cleared for commercial use → `## Blocking`.
- Any AI-generated asset: record model, prompt and date, and flag it for `aico:legal`: AI output may not be protected by copyright, which matters most for a trademark or logo.
- Never imitate a living artist's style by name, or another company's brand.

## 5. Accessibility
Text in images also appears as real text or alt text. Contrast is WCAG AA. Motion has a reduced-motion variant, with no flashing more than 3 times per second.
