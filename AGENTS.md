# AGENTS.md — AFCT SFX Lab (web)

Guidance for automation and maintenance work in this repository. Read it before changing
engine behaviour; the Unity port depends on this code being the source of truth.

## What this is

A browser workbench for generating retro and cinematic game sound effects. It is the web
half of a two-project family:

| | This repository | Sibling |
| --- | --- | --- |
| Project | AFCT SFX Lab (web) | AFCT SFX Lab for Unity |
| Local path | `~/GitHubProjects/game-sfx-generator-web` | `~/GitHubProjects/afct-sfx-unity` |
| Remote | https://github.com/SonettoGu14/afct-sfx-lab | https://github.com/SonettoGu14/afct-sfx-unity |
| Live / artifact | https://sonettogu14.github.io/afct-sfx-lab/ | UPM package `com.afct.sfxlab` |
| Stack | React 18 + TypeScript + Vite 5 + Vitest 2 | C# (netstandard2.1) + Unity Editor IMGUI |

Note the local folder name (`game-sfx-generator-web`) predates the rebrand and differs from the
GitHub repository name (`afct-sfx-lab`). Both refer to the same project.

These are two independent projects with independent releases, but they share one audio engine
contract. **This repository owns the engine semantics. The Unity repository is a port of it.**
See "Cross-project protocol" at the end.

## Quick start

```bash
npm install --registry=https://registry.npmmirror.com --cache ./.npm-cache
npm run dev            # Vite dev server
npx vitest run         # all tests
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json   # typecheck
npm run build          # tsc -b && vite build, base /afct-sfx-lab/
```

Environment quirks (verified in this workspace):

- npm 12 fails with `EALLOWREMOTE` against the default registry. Always pass
  `--registry=https://registry.npmmirror.com --cache ./.npm-cache` for installs.
- A bare `npx tsc --noEmit` is a no-op: the root `tsconfig.json` is solution-style
  (`"files": []` plus project references). Use `npx tsc -b` or the command above.
- `git push` to GitHub needs the local proxy exported:
  `http_proxy=http://127.0.0.1:7897 https_proxy=… all_proxy=socks5://127.0.0.1:7897`,
  with `no_proxy` covering localhost.

## Where things live

```
src/lib/sfx.ts            parameters, 28 presets, sfxr synth loop, 8 footstep terrains, WAV header
src/lib/effects.ts        six-stage FX chain (drive, bitcrush, tone, delay, reverb, peak ceiling)
src/lib/prng.ts           mulberry32 seeding; render is reproducible when a seed is supplied
src/lib/mastering.ts      trim silence, peak targeting, export mastering
src/lib/gameExport.ts     game package ZIP: category folders, manifest.json, variants
src/lib/audioExport.ts    MP3 (lamejs) and OGG (vorbis-encoder-js)
src/lib/zip.ts            dependency-free ZIP writer (UTF-8 filename flag)
src/lib/presetCatalog.ts  preset categories and ids used by the UI
src/components/GameSfxGenerator.tsx   all workbench state and markup
src/i18n/en.ts            English copy, `as const`, single source of truth for keys
src/i18n/zh.ts            Chinese copy, typed as Record<TranslationKey, string>
src/styles.css            the paper production-sheet visual system
tools/generate-golden.test.ts  writes the Unity parity fixtures (see below)
docs/spec-afct-web.md     the v1.0/v1.1 build contract
```

## Engine invariants — do not break these casually

- **28 presets in contract order**, five categories (UI, Action, Cinematic, Footsteps, Utility).
  `SFX_PRESET_ORDER` is the order the Unity package mirrors.
- **Parameter names are the public API.** The C# port uses the exact same field names
  (`startFrequency`, `deltaSlide`, `lowPassCutoff`, …). Renaming a field requires a matching
  change in `~/GitHubProjects/afct-sfx-unity/Runtime/Core/SfxParams.cs`, the JSON round trip, and
  `Docs/CONTRACT.md` there.
- **FX chain order is fixed**: drive → bitcrush → tone → delay → reverb → peak ceiling → fade.
  Tails are padded from the wet mix, capped at 6 seconds.
- **Peak normalize is a ceiling (0.995), not loudness normalization.** It must not flatten
  `masterVolume` differences.
- **Seeded renders must stay deterministic.** Never call `Math.random()` inside the render path;
  use the seeded source. `renderSfx` accepts `options.seed` and runs inside `withRandomSource`.
- **Float, not 8-bit.** Bit depth is an export option (8 or 16). The engine is a float synth;
  "8-bit" describes the genre, not the math.
- **No Chinese text outside `src/i18n/zh.ts`.** `en.ts` is the key truth; `zh.ts` must be a full
  `Record`, so a missing translation fails the typecheck.
- Do not add new dependencies without a strong reason; the bundle is already ~1.6 MB (lamejs and
  vorbis dominate) and the site must stay fully client-side.

## Testing gates (definition of done)

1. `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json` clean.
2. `npx vitest run` green (library tests plus component tests; the component suite fixes the
   accessible names, roles and `data-testid`/`data-preset-*` attributes the UI must preserve).
3. `npm run build` succeeds.
4. If the engine changed: regenerate the Unity fixtures and re-run the Unity parity suite
   (see below). A change that only passes here is not done.
5. For UI work: verify in a real browser at 1440, 1024 and 390 CSS pixels with no horizontal
   overflow, and no console or network errors.

## Regenerating the Unity parity fixtures

`tools/generate-golden.test.ts` renders 84 preset cases (28 presets × seeds 1234, 42, 987654321)
and 12 audio cases at seed 1234, then writes them into the sibling repository:

```
Tests/EditMode/Golden/PresetFixtures.g.cs
Tests/EditMode/Golden/Fixtures.g.cs
Tests/EditMode/Golden/*.f32
```

Run it from this repository:

```bash
npx vitest run tools/generate-golden.test.ts
```

Caveat: the output path is currently hardcoded to `/Users/gyk/GitHubProjects/afct-sfx-unity/...`.
If the sibling checkout moves, update `OUT` or set the Unity repo in the expected place. The Unity
side has `Tools/generate-golden.sh`, which simply invokes this test with `WEB_REPO` pointing here.

## Build, deploy and versioning

- Version lives in `package.json` (currently 1.2.0) and is shown in the UI.
- Pushing to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages, Actions build with
  `npm ci`, artifact `dist/`). Verify the run and the live URL afterwards.
- `vite.config.ts` uses base `/afct-sfx-lab/` for builds and `/` in dev; do not break that
  or the deployed assets 404.
- The deployed page is the only build users see; there is no server side.

## Known traps

- `npm ci` in Actions works because `package-lock.json` already resolves to the npmmirror registry;
  keep it that way if you regenerate the lockfile offline.
- History and language live in `localStorage` under `afct-sfx-lab:history-v1` and
  `afct-sfx-lab:language`; export settings under `afct-sfx-lab:export-v1`. Changing a schema
  without a migration will break returning users.
- The default preset legitimately clips before the FX chain and is fixed by the peak ceiling;
  a restored "clipped > 0" default means the chain regressed.
- Full-page screenshots can show a grey rectangle behind the masthead; that is a capture stitching
  artifact, not CSS (a clipped capture and a computed-style probe both come back clean).

## Cross-project protocol

This repository is the reference implementation. The sibling repository documents its own side at
`~/GitHubProjects/afct-sfx-unity/AGENTS.md` (and
https://github.com/SonettoGu14/afct-sfx-unity/blob/main/AGENTS.md); read it before changing the
contract, the fixtures or the package layout.

When touching engine behaviour:

1. Change `src/lib/**` here first, with tests.
2. Regenerate the fixtures (command above).
3. Open `~/GitHubProjects/afct-sfx-unity`, update the matching C# code and `Docs/CONTRACT.md`
   if the contract changed, then run `bash Tools/verify.sh` (must be 18/18) and
   `dotnet build Tools/CompileCheck` (0 warnings, 0 errors).
4. Only then release either side.

If the Unity port finds an engine bug, fix it here and let the fixture regeneration carry the
correction into C#. Never patch C# to match a wrong web result, and never let the two drift.

Shared licensing: both repositories are GPL-3.0-only (the synth derives from sfxr, MIT). Any
distributed derivative, including a Unity plugin, must stay GPL-3.0.

## Open work

- Unity branch `native-inspector-ui` (IMGUI editor window rewrite) is implemented and pushed but
  not merged; it needs a visual review before it lands on `main`.
- A window screenshot for the Unity README is still missing.
- Deferred ideas: layering/sample import, stereo, 24-bit, loop points, teaching recipe cards,
  a Node CLI renderer, `presets.json` for external tooling.
