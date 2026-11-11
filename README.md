# AFCT SFX Lab

**A browser-based sound-design workbench built for the Academy of Film and Creative Technology (AFCT), Xi'an Jiaotong-Liverpool University.**

Sketch, mutate and export retro/procedural sound effects without leaving the browser: 28 presets, two synthesis engines, eight footstep terrains, a full parameter console, a 10-knob FX rack, four export formats and a game-ready package export. Everything renders locally — no audio ever leaves the page.

- Live: <https://sonettogu14.github.io/afct-sfx-lab/>
- Based on: [mowangblog/game-sfx-generator-web](https://github.com/mowangblog/game-sfx-generator-web) (GPL-3.0)

## Highlights

- **28 presets in five groups** — UI feedback, action/combat, cinematic transitions, footstep terrains and utility randomizers.
- **Two engines** — an `sfxr`-style parameter synthesizer and a `footsteppr` footstep engine with 8 distinct terrains (snow, grass, dirt, gravel, mud, wood, metal, water).
- **Full parameter console** — envelope, frequency, modulation, texture and filter sections, plus 4 waveforms, duty cycle, phaser, low/high-pass sweeps and master volume.
- **FX rack** — drive, bitcrush, tone tilt, feedback echo and a small Schroeder reverb, with peak normalization, one-click A/B bypass and shareable `#s=` permalinks that restore exact settings.
- **Live preview** — waveform canvas, peak/clipping stats, duration and byte size; sample rate 8k–48k, 8/16-bit.
- **Auto-preview** — regenerates and plays ~140 ms after the last tweak, so you can hear while you drag.
- **Export** — WAV, MP3, OGG and JSON parameter snapshots; batch-export the whole history as a ZIP in any format.
- **Game export** — optional silence trim and peak target, category folders, configurable name prefix, `manifest.json`, and five seeded variants per take.
- **Local history** — save, apply, play, rename, export and delete snapshots (persisted in `localStorage`).
- **Bilingual** — English and 中文, switchable in the header; the choice is remembered. English is the default.
- **Paper-lab interface** — one light sheet with hairline rules, a dark instrument monitor, a single signal-red accent, and self-hosted Archivo + IBM Plex Mono.

## Presets

| Group | Presets |
| --- | --- |
| UI | Click, Select, Hover, Notify, Success, Error |
| Action | Coin, Laser, Explosion, Power Up, Hit, Jump |
| Cinematic | Whoosh, Riser, Impact, Glitch, Synth, Tone |
| Footsteps | Snow, Grass, Dirt, Gravel, Mud, Wood, Metal, Water |
| Utility | Random, Mutate |

Footstep presets use the `footsteppr` engine (heel / roll / ball / swiftness controls); every other preset uses the `sfxr` parameter synth.

## FX rack (v1.1)

The effects chain runs after synthesis, so every preset, footstep terrain and randomizer passes through it:

| Control | What it does |
| --- | --- |
| Drive | `tanh` soft saturation for weight and punch. |
| Crush rate / depth | Sample-and-hold decimation and bit reduction for digital grit. |
| Tone tilt | One-knob tilt around 1 kHz: darken or brighten the whole effect. |
| Echo time / feedback / mix | Feedback delay (0.03–0.40 s) with damped repeats. |
| Space size / mix | Four damped combs + two allpasses; a small room to a large hall. |
| Peak normalize | When on, scales the loudest peak to 0.995 **only if** it would clip — it is a safety ceiling, not loudness normalization, so `masterVolume` still means something. |

The chain is fixed: drive → bitcrush → tone → delay → reverb → peak ceiling → 6 ms fade-out. Delay and reverb tails are appended to the buffer (0 ms when both mixes are zero, capped at 6 s total), so exported files keep their decay.

- **Bypass FX** auditions the dry engine output without touching your settings or exports.
- **Copy share link** encodes `{ version, params, sampleRate, bitDepth }` as base64url in the URL hash; opening the link restores the exact patch, FX included.

## Game engine export (v1.2)

Every audio export runs through an optional mastering step, and the history can be packaged as a folder a game project can import as-is.

| Control | What it does |
| --- | --- |
| Trim silence | Cuts leading/trailing silence, keeping a 5 ms pre-roll and a 20 ms tail so transients survive. |
| Peak | Scales the whole clip so its loudest sample sits at -3, -6 or -12 dBFS. Off by default. |
| Prefix | Prepended to every exported file name, e.g. `ui_`. |

**Game package** (history header) writes a ZIP:

```
sfx/ui/01-Click.wav
sfx/footstep/01-Snow-Step.wav
manifest.json
```

`manifest.json` records the schema version, generator, export time and, for every sound: file path, display name, category, preset id, sample rate, bit depth, duration, peak dBFS, seed and the full parameter set. Re-rendering a manifest entry with the same parameters reproduces the sound exactly.

**Five variants** (per-take export menu) re-rolls a saved take with five consecutive seeds and packs the results with a manifest, so one designed sound can become a small family of variations for a level.

### Importing into Unity

1. Unzip a game package and drop the `sfx/` folder into `Assets/Audio`.
2. For short effects use: **Force To Mono** on, **Load Type** `Decompress On Load`, **Preload Audio Data** on, **Compression Format** `PCM` for 16-bit sources (or `ADPCM` if size matters more than fidelity).
3. Keep 44.1 kHz for effects; use 48 kHz when mixing against linear media or when the project's audio setting is 48 kHz.
4. Godot: import as WAV, loop off for one-shots, and rely on the same manifest to script `AudioStreamPlayer` wiring.

## Getting started

```bash
npm install      # Node 18+
npm run dev      # local dev server
npm run build    # type-check + production build
npm run test     # Vitest suite
npm run preview  # preview the production build
```

## Workflow

1. Pick a preset (or hit **Random** / **Mutate** to explore).
2. Taste the result — it plays automatically; tweak sliders with the auto-preview on.
3. Inspect the waveform, duration, sample rate and bit depth in the preview dock.
4. Open the **FX rack** to add weight, grit, echo or space; use **Bypass FX** to A/B the dry engine and **Copy share link** to keep a patch.
5. Export WAV/MP3/OGG/JSON, or save the snapshot to the history panel for later.

## Project structure

```text
src/
  i18n/                  # LanguageProvider, en.ts (source of truth), zh.ts
  lib/
    sfx.ts               # SfxParams, presets, both engines, terrain DSP, WAV encoder, FX integration
    effects.ts           # drive, bitcrush, tone, delay, reverb, peak ceiling, tail math
    presetCatalog.ts     # the 28 presets grouped for the rack
    audioExport.ts       # MP3 (lamejs) / OGG (vorbis-encoder-js)
    zip.ts               # dependency-free ZIP writer for batch export
  components/
    GameSfxGenerator.tsx # workbench UI, preview, history, JSON panel
  App.tsx                # shell: masthead, language switch, colophon
  styles.css             # paper-lab visual system
docs/
  spec-afct-web.md       # design/preset/i18n contract used for this rebuild
```

### Adding a preset

1. Extend `SfxPresetId` and `SFX_PRESET_ORDER` in `src/lib/sfx.ts`.
2. Add a `case` in `createSfxPreset` (return `clampSfxParams({...})`).
3. Register it in `src/lib/presetCatalog.ts` (group order).
4. Add `presets.<id>.label` / `.detail` / `.glyph` to `src/i18n/en.ts` and `zh.ts` — `zh.ts` is typed against `en.ts`, so a missing key fails the build.
5. Cover it in `src/lib/sfx.test.ts` (bounded output is asserted for every preset).

### Adding a footstep terrain

Extend `SfxFootstepTerrain` + `isFootstepTerrain`, add a `render*Terrain` DSP function and a `renderFootstepTerrain` case, then a preset that selects it.

## Internationalization

- `src/i18n/index.tsx` — `LanguageProvider`, `useI18n()` → `{ language, setLanguage, t }`; `t('key', { name })` supports `{name}` interpolation.
- `src/i18n/en.ts` is the single source of truth; `src/i18n/zh.ts` is `Record<MessageKey, string>` so translations can't silently drift.
- The chosen language persists under `afct-sfx-lab:language` and is reflected on `<html lang>`.
- To add a language, copy `en.ts`, translate the values, and register it in the provider — missing keys are caught at compile time.

## Deployment

The included GitHub Actions workflow builds on every push to `main` and publishes `dist/` to GitHub Pages.

1. Push to `SonettoGu14/afct-sfx-lab`.
2. Repository → Settings → Pages → Source: **GitHub Actions**.
3. `vite.config.ts` uses `base: '/afct-sfx-lab/'` for builds (dev stays at `/`); change it if you fork under a different repository name.

Any static host works, provided the base path matches the deployment URL.

## Attribution & License

- Licensed **GPL-3.0-only** (see [LICENSE](LICENSE)); this project is a derivative work of [game-sfx-generator-web](https://github.com/mowangblog/game-sfx-generator-web), and the original copyright and license are retained.
- The synthesis model follows `sfxr` by Tomas Pettersson (DrPetter); the footstep engine follows the `footsteppr` approach.
- Brand colours come from XJTLU's public site stylesheet; the Gilroy brand typeface is **not** bundled (licensed) — the stack falls back to system sans.
- This is a course/project tool, not an official XJTLU product.

## 中文说明

AFCT SFX Lab 是为西交利物浦大学影视与创意科技学院（AFCT）改造的音效工作台：28 个预设、双引擎（sfxr 参数合成 + 8 种脚步地形）、10 旋钮效果器（过载、降比特、音色倾斜、延迟、混响、峰值归一化）、中英双语界面、WAV/MP3/OGG/JSON 导出与本地历史记录，全部在浏览器内完成，不上传任何音频。

v1.1 的两个实用功能：**Bypass FX** 可在不改参数的情况下试听干声做 A/B；**Copy share link** 会把当前参数、采样率与位深编码进 URL（`#s=...`），打开链接即可原样恢复，方便在课堂或小组之间传递音色。

本项目基于 [mowangblog/game-sfx-generator-web](https://github.com/mowangblog/game-sfx-generator-web) 改造，遵循 GPL-3.0-only 许可，并保留原项目署名。
