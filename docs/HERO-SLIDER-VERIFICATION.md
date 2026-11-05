# CELIBERY admin-controlled hero duration verification

Updated 2026-11-04. This request supersedes the previous fixed five-second image policy.

## Admin controls and persistence

The existing **Image duration (seconds)** field is reused for each Hero banner. Its counterpart on Homepage settings is **Hero image duration (seconds)**. Valid positive durations are saved and returned without truncation or a maximum playback cap; fractional seconds are accepted.

A **Video duration (seconds)** field was added to the same banner form, with **Hero video duration (seconds)** on legacy Homepage settings:

- `0` means play the original video to actual completion.
- A positive value advances when playback reaches that position, or earlier if the actual video ends. The video is not restarted or looped to fill a longer requested duration.

The existing video fallback field remains a separate failure-recovery window. It is not used as a normal presentation duration.

The persistence layer previously had no video presentation-duration field. One number was added to the existing Banner schema (`videoDurationSec`) and legacy homepage settings (`heroVideoDurationSec`), defaulting to zero for backward compatibility. Image settings reuse their existing fields. There are no new endpoints, collections or migrations.

Valid stored image values are no longer capped in the admin form, request validation, models, homepage API or frontend. The previous 300-second image validation maximum was also removed. Only missing/invalid image configuration receives the compatible five-second fallback; valid settings are never replaced by that fallback. API validation rejects zero/negative/non-finite image durations and negative/non-finite video durations. Video zero is valid and preserved with nullish defaults.

## Playback and progress

The active slide still owns one playback clock. Image progress is elapsed active display time divided by the saved image duration. Video progress reads the actual player's time against the earlier of a positive configured endpoint or the known natural duration. In zero mode, the denominator is the actual natural duration when available. Native ended events and official YouTube/Vimeo completion events/end-state checks handle natural completion. Vimeo's callback backup queries getEnded(); a changing progress ratio is never treated as proof of completion.

No fixed normal-video timeout was added. Zero-mode videos with unknown duration can keep playing to completion without fabricated progress. Failed/stalled streams or unavailable provider APIs use the existing, separate recovery path. If a provider SDK is blocked, exact playback progress/completion is unavailable; recovery skips the untrackable slide after its saved failure window instead of claiming that this was normal zero-mode completion. This exceptional path does not synthesize a configured video duration.

Automatic ordering/looping, restart from zero on each visit, responsive media, arrows, progress-line navigation, transitions, navbar and absence of Play/Pause controls are preserved. Reduced-motion/data-saving stills use the saved image duration.

## Actual tests

Tests use the existing admin form, API, storage and an isolated seeded database on port 4174. They do not replace the user's store settings or media. `e2e/hero-duration.check.cjs` records real video fixtures for 120 and 15 seconds; no synthetic duration metadata or accelerated playback is used in the native-duration acceptance cases. Their encoded natural durations were 119.792 and 14.793 seconds.

| Saved setting | Observed result |
|---|---|
| Image 3 seconds | Advanced at approximately 3 seconds |
| Image 10 seconds | Advanced at approximately 10 seconds |
| Image 30 seconds | Advanced at approximately 30 seconds |
| Video 20 seconds, approximately 120-second source | Advanced at the configured 20-second playback position |
| Video 45 seconds, approximately 120-second source | Advanced at the configured 45-second playback position |
| Video 0, approximately 15-second source | Natural completion at approximately 14.793 seconds |
| Video 20 seconds, approximately 15-second source | Natural completion at approximately 14.793 seconds; no restart to fill 20 seconds |

Elapsed DOM-observation samples were 2.941/10.005/30.002 seconds for the images. Video observation samples begin after playback has already started; assertions account for the sampled currentTime. Frame scheduling and DOM observation introduce small timing tolerances.

All seven cases were saved through the banner form, verified after an admin refresh, and checked against `/api/home`. Legacy Homepage image 30/video 90 settings survived refresh; zero was subsequently saved and returned as zero. Progress matched the effective image/video duration, all seven indicators remained present, the mixed sequence returned to the first image, mobile playback/visibility resume worked, and no React/runtime exceptions were observed.

Additional validation:

- Client production build/TypeScript: passed; the existing Vite mixed static/dynamic import warning remains.
- Server unit suite: 52 tests passed, including new duration validation cases for values beyond the old caps, fractions, zero and invalid inputs.
- Broad browser regression (`e2e/hero-slider.check.cjs`): passed after updating obsolete fixed-cap expectations. Automatic zero-mode MP4/WebM, unknown-duration playback, provider event contracts, image/video ordering, looping, progress, errors, keyboard/swipe, mobile layout and visibility handling passed. No Play/Pause controls appeared.
- Focused Vimeo integration (`e2e/hero-provider-state.check.cjs`): passed. A mocked official SDK reported a full progress ratio but getEnded=false; zero mode remained active. Returning true from the actual-end-state API advanced the slide even without the ended callback and cleaned up the player. This is a mocked contract check, not live playback.
- Live provider checks: custom-duration endpoints passed with the previously saved YouTube URL and a supported public Vimeo video, using a saved six-second setting. YouTube zero-mode completion also passed with a real provider event after seeking near the end. Final live Vimeo zero-mode verification could not complete: browser requests reported DNS failures, network changes and an internet disconnect. It is not counted as a successful live check. The later Vimeo end-state hardening is covered by the focused integration test above; a live recheck remains necessary when connectivity is available.
- Server build and typecheck: still fail on the existing Mongoose Settings/lean-result typing errors. No unrelated typing/model changes were made to hide them.

## Exact files changed

- client/src/admin/pages/Content.tsx
- client/src/lib/types.ts
- client/src/three-d/CinematicHero.tsx
- client/src/three-d/CampaignPlayback.tsx
- client/src/three-d/campaignPlayers.ts
- server/src/models/Content.ts
- server/src/models/Settings.ts
- server/src/modules/admin/admin.schemas.ts
- server/src/modules/admin/system.routes.ts
- server/src/modules/catalog/catalog.service.ts
- server/tests/unit/hero-duration.test.ts (new)
- e2e/hero-duration.check.cjs (new)
- e2e/hero-provider-state.check.cjs (new)
- e2e/hero-slider.check.cjs
- docs/HERO-SLIDER-VERIFICATION.md

Build output and ignored QA artifacts were generated. The workspace has no Git metadata, so a Git diff/history review is unavailable; source changes were reviewed directly.

## Repeat validation

Use only an isolated seeded e2e server. Build the client, start the existing helper with E2E_PORT=4174, then run these checks sequentially because both temporarily configure the same isolated homepage:

```powershell
npm.cmd run build -w client
# In a retained separate terminal:
$env:E2E_PORT='4174'
npx.cmd tsx e2e/server.ts
# In the testing terminal:
node e2e/hero-duration.check.cjs
node e2e/hero-slider.check.cjs
node e2e/hero-provider-state.check.cjs
npm.cmd run test:unit -w server
```

The duration check intentionally takes several minutes to record and naturally play its fixtures. Temporary credentials come from e2e/.artifacts/admin.json; HERO_TEST_BASE_URL and HERO_TEST_CREDENTIALS support a different isolated configuration. Test banners/settings are cleaned up/restored in finally.
