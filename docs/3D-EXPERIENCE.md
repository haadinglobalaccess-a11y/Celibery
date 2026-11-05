# CELIBERY immersive 3D layer — design system & developer guide

Added 3 November 2026. Storefront only: the admin dashboard does not import any of this.

## 1. What it is (and what it is not)

- **Real WebGL** is used where it adds something you can't get otherwise: the homepage hero's
  **studio**. It's a raymarched scene with a two-tier satin pedestal, a glossy floor that reflects
  the pedestal, a volumetric key light and orbiting light rings with moving highlights. It follows
  the mouse on desktop and orbits slowly by itself on phones.
- **Products are the client's own photos.** In the hero they stand on the pedestal as dimensional
  slabs (stacked CSS 3D layers give them thickness, plus a moving glare and a reflection). They are
  never presented as 3D models, and no product imagery is generated or invented.
- **Everywhere else**, depth comes from CSS 3D and small pointer/scroll hooks: tilting product
  photo panels, spatial carousels, layered campaign panels, dimensional icons, scroll scenes,
  directional gallery turns and fly-to-cart. All of it is cheap enough for every page.

## 2. Why there is no Three.js / React Three Fiber / GSAP

- The hero scene is a single full-screen shader: one draw call, no meshes, no textures. A ~3 KB host
  (`ThreeDScene.tsx`) does the job; Three.js would add roughly 600 KB for no visual gain.
- Every other effect is transform/opacity, driven by CSS custom properties, so a motion library isn't
  needed.
- Adding dependencies without a lockfile, and without being able to install and test them, would
  have been a risk to a production store. The npm registry was blocked in the environment this
  was built in.
- **When real GLB product models arrive**, add `three` + `@react-three/fiber` + `@react-three/drei`
  and use them for that stage only (see §6).

## 3. Components (`client/src/three-d/`)

| Component / hook | What it does | Used on |
|---|---|---|
| `ThreeDScene` | Dependency-free WebGL host for a fragment-shader scene. Lazy, adaptive resolution, renders only while on screen and while the tab is visible, 30 fps cap in `lite`, handles context loss and compile failure, releases GPU resources, and gives each mount a fresh canvas (safe under React StrictMode). | hero |
| `studio.ts` | The studio shader plus the shared camera/projection maths, so DOM layers land exactly on the pedestal. Follows Admin → Brand accent at runtime. | hero |
| `Product3DStage` | WebGL studio as the full-bleed hero environment, with product slabs and the product card. Fits itself to a layout slot, so the pedestal sits right (LTR), left (RTL) or above the copy (phones). Own lazy chunk (~13 KB). | hero |
| `FloatingProduct` | Catalogue photo as a dimensional slab (thickness, glare, reflection). | hero |
| `CinematicHero` | The previous hero, moved here with all its behaviour intact (video → banners → products order, rotation, CTAs, chips, dots) and the 3D stage added. | home |
| `TiltCard` / `useTilt` | Pointer tilt + glare via CSS variables (`--rx --ry --gx --gy --px --py --tz`). Touch gets a short press-tilt that releases when scrolling starts. Holds still while the pointer is over a control inside, so buttons never move under the cursor. | cards, categories, campaigns, lifestyle banners, why panels, category rail, gallery |
| `SpatialCarousel` | Product rail with perspective: items turn toward the centre. Native scroll/snap kept; mouse drag (which never triggers the link underneath); previous/next buttons. | featured, best sellers, explore tabs, use cases, related |
| `ScrollScene` / `useScrollProgress` | One shared passive rAF scroll loop. Exposes `--p` (0..1) and `--pc` (-1..1) for depth parallax. | brand story |
| `PremiumButton` / `useMagnetic` | `.btn` with bevel depth, magnetic hover and a pointer-following light. Renders a router `Link` or a native `button` (all props pass through). | hero CTAs, bundles, newsletter |
| `DimensionalIcon` | Line icon as a bevelled, extruded tile. | service strip, why, product info rows, empty states |
| `InteractiveProductGallery` | Product gallery on a lit stage: hover tilt + light, **click/Enter to zoom** (same cursor-following zoom as before), swipe on touch, arrow keys, directional 3D turn between photos (mirrored in Arabic), photo counter. | product page |
| `flyToCart` | The product photo flies to the header cart, which then bumps. Visual only; the cart is updated before it runs. | product cards, product page |
| `MotionReveal` (`lib/motion.tsx`) | `Reveal` with new `depth` and `rise` variants. | bundles, newsletter |

### Hero opening sequence ("The future is here")

`heroIntro.ts` holds the timeline (portal → emergence → mechanical transformation → digital
reconstruction → reveal, ~10.4 s) and the particle shaders; `introFlag.ts` makes it play once per page
load. `Product3DStage` drives the studio shader uniforms (`uPortal`, `uPortalFade`, `uFlash`,
`uShock`), the particle pass and the DOM variables from one frame clock. See
`docs/HERO-INTRO-REPORT-2026-11-03.md`.

## 4. Motion & depth rules (`client/src/styles/immersive.css`)

- **Easing:** `--ease-cinema` (cubic-bezier(.22,1,.36,1)) for spatial moves; the existing
  `--ease-spring` for presses. Tilt settles in `--dur-tilt` (700 ms) and follows the pointer in 160 ms.
- **Depth scale:** `--depth-1` resting → `--depth-4` floating hero objects; `--edge-light` is the top
  highlight that makes panels read as solid.
- **Perspective:** `--persp-near` (900 px) for small objects, `--persp-far` (1600 px) for sections.
- **Only transform / opacity / filter animate.** Hooks write CSS variables, so nothing re-renders
  React per frame.
- **Direction:** pointer maths are physical; entrances and gallery turns use `--dir`, so Arabic mirrors.
- **No constant motion near reading:** the only idle loops are the hero studio, the slab float, two
  slow rings in the newsletter panel and the footer grid drift.

## 5. Performance & accessibility

| Situation | Behaviour |
|---|---|
| Desktop / tablet with a mouse | `full`: WebGL at adaptive resolution (0.5–0.9 × CSS px × DPR ≤ 1.5); quality steps down if frames exceed ~22 ms |
| Phones, ≤4 cores, ≤4 GB RAM, Data Saver | `lite`: lower resolution, fewer raymarch steps, 30 fps cap, no pointer tracking |
| `prefers-reduced-motion` | `static`: no WebGL. The previous CSS stage is shown; tilt, parallax, carousel depth, float and entrances are all off (depth stays as a still look) |
| No WebGL / context lost / shader failure | Falls back to the CSS stage automatically (tested with WebGL disabled) |
| Hero off screen or tab hidden | Render loop stops (tested: 0 frames while scrolled away) |
| Before WebGL is ready | The CSS stage shows and cross-fades out; the 3D layer can't receive focus until it is shown |
| Bundle | WebGL code is a separate lazy chunk (~13 KB). Main JS +4 KB, CSS +30 KB raw (~6 KB gzip) |
| CSP | Works under the production policy: 0 violations (no inline styles/scripts, no eval) |

## 6. Adding real 3D product models later

1. Export each product as a **GLB** (Draco or Meshopt compressed, ≤ 2 MB, ≤ 50k triangles, PBR materials, real-world scale, origin at the base centre).
2. Store the model URL per product. This needs a new optional field (e.g. `product.model3dUrl`) plus
   an admin field, which is a deliberate schema change for later. Nothing was changed now.
3. `npm i three @react-three/fiber @react-three/drei` in `client/`.
4. In `Product3DStage`, render a R3F `<Canvas>` with a `useGLTF` model for products that have a
   model, and keep `FloatingProduct` for those that don't. The studio shader can stay as the
   backdrop (camera maths in `studio.ts`), or be swapped for a drei `Environment` + `ContactShadows`.
5. Keep the same rules: lazy chunk, `useImmersiveLevel()` gate, CSS fallback, dispose on unmount.

## 7. Photography that works best

The slab and gallery use `mix-blend-mode: multiply`, so **white or light-grey backgrounds** blend
naturally into the lit surfaces, and transparent PNGs work too. Square photos, product centred with
about 8% padding, 1600 px or larger (WebP variants are generated by the media library already).
