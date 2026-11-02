# React Bits adaptations for Flowplan

These are application-specific adaptations, not a standalone component distribution.

Sources inspected:
- Catalogue: https://reactbits.dev/llms.txt
- Dock: https://reactbits.dev/r/Dock-TS-CSS
- RubberSegment: https://reactbits.dev/r/RubberSegment-TS-CSS
- Aurora: https://reactbits.dev/r/Aurora-TS-CSS
- SpotlightCard: https://reactbits.dev/r/SpotlightCard-TS-CSS
- GlareHover: https://reactbits.dev/r/GlareHover-TS-CSS
- License: https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md

Copyright (c) 2026 David Haz. Upstream uses **MIT + Commons Clause**, not plain MIT. The complete license is retained at `skills/diagram-plan/licenses/react-bits-LICENSE.md` and included in generated third-party notices. Application incorporation is permitted; selling/sublicensing/redistributing the components themselves is restricted. The project's MIT license does not replace these terms.

## Adaptations

- `NodeDock.tsx` retains Dock's cosine-squared proximity falloff. Motion springs animate only icon scale and lift (1–1.22×, 0–4px), not button width or position. Labels, hit areas and graph geometry remain stable. No auto-hide, launch bounce, context menus, badges or continuous RAF loop. Keyboard arrows/Home/End work locally. Touch/narrow layouts, disabled state and reduced motion use stationary icons.
- `FlowScope.tsx` retains RubberSegment's independently animated leading/trailing edges and rounded clip-path thumb. It is controlled by the real main/branch state. Drag, momentum, stretch and squash are removed; a 25ms handoff and non-bouncy 260ms spring remain. Native button clicks support pointer, Space, Enter and assistive technology; arrow/Home/End navigation is local. Resize observers remeasure without animation; interrupted animations are stopped; reduced motion jumps directly to the target.
- `Aurora.tsx` retains the current upstream native-WebGL2 simplex-noise shader, OKLCH ramp and premultiplied light-mode output. It uses two slow blue/teal layers, no intro/pointer-follow, at most 30 draws/sec and DPR ≤1 with a 1280px drawing-buffer width cap. Hidden/offscreen, graph pointer/wheel activity, text editing and modal/busy states stop RAF; the last frame is retained. Narrow/coarse-pointer/reduced-motion and user-disabled modes allocate no canvas/context. A persistent toolbar toggle (SunDim icon) controls background motion. CSS remains visible on GPU failure/context loss; cleanup handles partial allocation failures and fresh canvas lifetimes under StrictMode. This is the current free-library Aurora, not an OGL/Three.js dependency or a Pro asset.
- `SpotlightCard.tsx` retains upstream's smooth/Gaussian radial falloff and masked edge light on the existing dock and empty-state surface. Local pointer/focus handlers replace global proximity tracking, with at most one pending frame; there is no idle loop, noise, press flare or ambient drift. Decorative layers are pointer-transparent; toolbar semantics and fixed button geometry remain intact.
- `GlareHover.tsx` retains the sampled 33-stop sheen profile, replacing the generic RAF engine with a single 650ms CSS sweep on hover/keyboard focus. The root is a native button, preserving disabled state, label, callback and focus. No intro or looping mode; reduced motion hides the sheen. Peak white opacity is .136 over the darker interactive blue, retaining ≥4.5:1 label contrast.
- `../Motion.tsx` is Flowplan's shared selection/content motion, not an unmodified React Bits AnimatedList. The upstream list's demo data, extra icon dependency, hover-selection and global keyboard listeners are intentionally not imported.

The three atmosphere additions introduce no npm dependencies; they use React, native WebGL2 and CSS. All dependencies and artwork are bundled locally. No runtime requests to React Bits or a CDN are introduced.
