# AFCT SFX Lab

**A browser-based sound-design workbench built for the Academy of Film and Creative Technology (AFCT), Xi'an Jiaotong-Liverpool University.**

Sketch, mutate and export retro/procedural sound effects without leaving the browser: 28 presets, two synthesis engines, eight footstep terrains, a full parameter console and four export formats. Everything renders locally — no audio ever leaves the page.

- Live: <https://sonettogu14.github.io/afct-sfx-lab/>
- Based on: [mowangblog/game-sfx-generator-web](https://github.com/mowangblog/game-sfx-generator-web) (GPL-3.0)

## Highlights

- **28 presets in five groups** — UI feedback, action/combat, cinematic transitions, footstep terrains and utility randomizers.
- **Two engines** — an `sfxr`-style parameter synthesizer and a `footsteppr` footstep engine with 8 distinct terrains (snow, grass, dirt, gravel, mud, wood, metal, water).
- **Full parameter console** — envelope, frequency, modulation, texture and filter sections, plus 4 waveforms, duty cycle, phaser, low/high-pass sweeps and master volume.
- **Live preview** — waveform canvas, peak/clipping stats, duration and byte size; sample rate 8k–44.1k, 8/16-bit.
- **Auto-preview** — regenerates and plays ~140 ms after the last tweak, so you can hear while you drag.
- **Export** — WAV, MP3, OGG and JSON parameter snapshots; batch-export the whole history as a ZIP in any format.
- **Local history** — save, apply, play, rename, export and delete snapshots (persisted in `localStorage`).
- **Bilingual** — English and 中文, switchable in the header; the choice is remembered. English is the default.
- **Dark cinema-tech theme** — XJTLU/AFCT brand palette (navy `#010544`, magenta `#ce57c1`, cyan `#25c5f9`).

## Presets

| Group | Presets |
| --- | --- |
| UI | Click, Select, Hover, Notify, Success, Error |
| Action | Coin, Laser, Explosion, Power Up, Hit, Jump |
| Cinematic | Whoosh, Riser, Impact, Glitch, Synth, Tone |
| Footsteps | Snow, Grass, Dirt, Gravel, Mud, Wood, Metal, Water |
| Utility | Random, Mutate |

Footstep presets use the `footsteppr` engine (heel / roll / ball / swiftness controls); every other preset uses the `sfxr` parameter synth.

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
4. Export WAV/MP3/OGG/JSON, or save the snapshot to the history panel for later.

## Project structure

```text
src/
  i18n/                  # LanguageProvider, en.ts (source of truth), zh.ts
  lib/
    sfx.ts               # SfxParams, presets, both engines, terrain DSP, WAV encoder
    presetCatalog.ts     # the 28 presets grouped for the rack
    audioExport.ts       # MP3 (lamejs) / OGG (vorbis-encoder-js)
    zip.ts               # dependency-free ZIP writer for batch export
  components/
    GameSfxGenerator.tsx # workbench UI, preview, history, JSON panel
  App.tsx                # AFCT shell: hero, language switch, footer
  styles.css             # dark cinema-tech theme
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

AFCT SFX Lab 是为西交利物浦大学影视与创意科技学院（AFCT）改造的音效工作台：28 个预设、双引擎（sfxr 参数合成 + 8 种脚步地形）、中英双语界面、WAV/MP3/OGG/JSON 导出与本地历史记录，全部在浏览器内完成，不上传任何音频。

本项目基于 [mowangblog/game-sfx-generator-web](https://github.com/mowangblog/game-sfx-generator-web) 改造，遵循 GPL-3.0-only 许可，并保留原项目署名。
