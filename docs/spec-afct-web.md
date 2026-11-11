# AFCT SFX Lab — Web Rebuild Spec (single source of truth)

Repo: `game-sfx-generator-web` (working tree = new project `afct-sfx-lab`).
Goal: rebrand the retro SFX tool as **XJTLU AFCT**'s sound-design workbench, English-first bilingual, dark cinema-tech theme, 28 presets, deploy to GitHub Pages.

Brand facts (verified from xjtlu.edu.cn, 2026-11):
- Department: **Academy of Film and Creative Technology (AFCT)** / 影视与创意科技学院, Xi'an Jiaotong-Liverpool University (XJTLU) / 西交利物浦大学.
- Official CSS tokens (`--xjtlu-*` in xjtlu.edu.cn global.css): primary `#010544`, secondary `#ce57c1`, cyan `#25c5f9`, green `#a7d500`, aqua `#22bdad`, orange `#fb7831`, dark `#1b1b23`, dark-2 `#474758`, grey `#757589`, grey-2 `#acacbf`, light `#f2f2f9`, light-2 `#e0e0ec`; brand gradients navy→magenta. Brand font: Gilroy (licensed, NOT shipped — declare it first in the stack, fall back to system sans).

## 1. Ownership (do not edit outside your scope)

| Owner | Files |
| --- | --- |
| Lead | `src/lib/sfx.ts`, `src/lib/sfx.test.ts`, `README.md`, `LICENSE`, `.github/workflows/*`, `package.json`, `docs/*`, git/gh ops, final integration |
| ui-i18n | `src/i18n/**` (new), `src/lib/presetCatalog.ts` (new), `src/App.tsx`, `src/main.tsx`, `src/components/GameSfxGenerator.tsx`, `src/components/GameSfxGenerator.test.tsx`, `src/test/setup.ts` |
| theme | `src/styles.css`, `index.html`, `public/afct-mark.svg` (new) |

Nobody runs `npm install`, `git`, or edits shared config. Don't fix files outside your scope — report instead.

## 2. Preset catalog — 28 ids (authoritative)

`SFX_PRESET_ORDER` order = table order. Categories: `ui`, `action`, `cinematic`, `footstep`, `utility`.

| id | cat | glyph | EN label | ZH label | EN detail | ZH detail |
| --- | --- | --- | --- | --- | --- | --- |
| random | utility | ? | Random | 随机 | Explore a new texture | 随机探索新音色 |
| mutate | utility | ~ | Mutate | 变异 | Nudge the current sound | 微调当前音色 |
| click | ui | • | Click | 点击 | Crisp UI tap | 清脆点击 |
| blipSelect | ui | ▸ | Select | 选择 | Menu confirm blip | 菜单确认 |
| hoverTick | ui | · | Hover | 悬停 | Soft cursor tick | 光标轻响 |
| notifyPop | ui | ! | Notify | 通知 | Toast notification pop | 通知弹出 |
| successChime | ui | ✓ | Success | 成功 | Task complete chime | 完成提示音 |
| errorBuzz | ui | × | Error | 错误 | Invalid action buzz | 操作失败 |
| pickupCoin | action | ¤ | Coin | 金币 | Reward pickup | 奖励拾取 |
| laserShoot | action | ↯ | Laser | 激光 | Energy weapon shot | 能量射击 |
| explosion | action | ✳ | Explosion | 爆炸 | Blast impact | 爆裂冲击 |
| powerup | action | ▲ | Power Up | 强化 | Level-up cue | 升级提示 |
| hitHurt | action | ✖ | Hit | 受击 | Damage feedback | 受击反馈 |
| jump | action | ↑ | Jump | 跳跃 | Take-off impulse | 起跳 |
| whoosh | cinematic | ≋ | Whoosh | 呼啸 | Transition sweep | 转场掠过 |
| riser | cinematic | ↗ | Riser | 上升 | Tension build | 情绪推进 |
| impact | cinematic | ◉ | Impact | 重击 | Cinematic slam | 影视重击 |
| glitch | cinematic | # | Glitch | 故障 | Digital artifacts | 数码故障 |
| synth | cinematic | ∿ | Synth | 合成 | Electronic tone | 电子音色 |
| tone | cinematic | ♪ | Tone | 音调 | Sustained pitch bed | 持续音底色 |
| footstepSnow | footstep | SN | Snow Step | 雪地脚步 | Crunchy snow | 松脆雪地 |
| footstepGrass | footstep | GR | Grass Step | 草地脚步 | Soft grass | 柔和草地 |
| footstepDirt | footstep | DT | Dirt Step | 泥土脚步 | Dry soil | 干燥泥土 |
| footstepGravel | footstep | GV | Gravel Step | 碎石脚步 | Loose stones | 碎石路面 |
| footstepMud | footstep | MD | Mud Step | 泥泞脚步 | Wet mud | 湿滑泥地 |
| footstepWood | footstep | WD | Wood Step | 木板脚步 | Hollow boards | 空洞地板 |
| footstepMetal | footstep | MT | Metal Step | 金属脚步 | Ringing metal | 金属回响 |
| footstepWater | footstep | WT | Water Step | 水洼脚步 | Splashy water | 水花飞溅 |

Category labels: `ui` UI/界面, `action` Action/动作, `cinematic` Cinematic/影视, `footstep` Footsteps/脚步, `utility` Utility/工具.

## 3. i18n contract

- `src/i18n/index.tsx`: `type Language = 'en' | 'zh'`; `STORAGE_KEY = 'afct-sfx-lab:language'`; `LanguageProvider`; `useI18n(): { language, setLanguage, t }`. `t(key, vars?)` supports `{name}` interpolation. Default = `en`; persisted choice wins. On change set `document.documentElement.lang`.
- `src/i18n/en.ts` is the source of truth (`as const`); `src/i18n/zh.ts` typed `Record<Key, string>` from `en` so missing translations fail the build. Flat dotted keys.
- Every user-visible string goes through `t()`: hero, panel headings, presets (label/detail), waveforms (label/detail), terrains, the 5 control sections (title/description), every field label + hint, buttons, export menu, history, JSON panel, status messages (interpolated, e.g. `status.saved`/`status.exported`), aria-labels, footer.
- Required namespaces: `app`, `hero`, `lang`, `presets`, `presetCategories`, `waveforms`, `terrain`, `sections`, `fields`, `controls`, `preview`, `export`, `history`, `json`, `advanced`, `status`, `footer`, `common`.
- No Chinese literals left in `src/App.tsx` / `src/components/**` / `src/lib/**` except `src/i18n/zh.ts`.
- Language switch in hero (see §4). Test: default EN, switching updates text and persists to localStorage, reload keeps choice.

## 4. Markup contract (ui-i18n writes exactly this; theme styles it)

Hero:
```tsx
<header className="hero">
  <div className="hero-top">
    <div className="hero-brand">
      <img className="hero-brand__mark" src={`${import.meta.env.BASE_URL}afct-mark.svg`} alt="" />
      <div className="hero-brand__text">
        <p className="hero-brand__eyebrow">{t('hero.department')}</p>
        <h1 className="hero-brand__title">AFCT SFX Lab</h1>
        <p className="hero-brand__sub">{t('hero.subtitle')}</p>
      </div>
    </div>
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      <button type="button" className={language === 'en' ? 'lang-switch__btn is-active' : 'lang-switch__btn'} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
      <button type="button" className={language === 'zh' ? 'lang-switch__btn is-active' : 'lang-switch__btn'} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
    </div>
  </div>
</header>
```

Presets grouped (keeps existing `.preset-rack` / `.preset-strip` / `.preset-button`):
```tsx
<div className="preset-groups">
  {PRESET_CATEGORIES.map((category) => (
    <section className="preset-group" key={category.id}>
      <div className="preset-group__head">
        <span className="preset-group__label">{t(`presetCategories.${category.id}`)}</span>
        <span className="preset-group__count">{category.presets.length}</span>
      </div>
      <div className="preset-strip">{/* preset-button per id */}</div>
    </section>
  ))}
</div>
```

Footer (replaces author's socials/avatar; keeps attribution + GPL):
```tsx
<footer className="app-footer">
  <p className="app-footer__credit">
    {t('footer.creditPrefix')} <a className="app-footer__credit-link" href="https://github.com/mowangblog/game-sfx-generator-web" target="_blank" rel="noreferrer">game-sfx-generator-web</a> · GPL-3.0 · {t('footer.creditSuffix')}
  </p>
  <p className="app-footer__note">{t('footer.note')}</p>
</footer>
```

New classes theme must style: `.hero-top`, `.hero-brand`, `.hero-brand__mark`, `.hero-brand__text`, `.hero-brand__eyebrow`, `.hero-brand__title`, `.hero-brand__sub`, `.lang-switch`, `.lang-switch__btn` (+ `.is-active`), `.preset-groups`, `.preset-group`, `.preset-group__head`, `.preset-group__label`, `.preset-group__count`, `.app-footer__credit`, `.app-footer__credit-link`, `.app-footer__note`. Remove styling for the old hero-title/hero-eyebrow/hero-meta/hero-actions/avatar/support-link blocks (they disappear from markup).

## 5. Theme direction (theme owner)

Dark "cinema darkroom / monitor wall": near-black navy canvas derived from `#010544` (e.g. `#030723` bg, `#071040` panel), magenta `#ce57c1` primary accent (active preset, primary button, focus ring), cyan `#25c5f9` secondary/live signal (waveform trace, playing state), aqua/green for success, orange for warnings. Off-white text `#f2f2f9`. Keep CRT/scanline ambience subtle (low opacity), heavy retro textures removed. Monospace tabular numerals for stats (`ui-monospace, "SF Mono", Menlo`), uppercase letterspaced section kickers. Waveform canvas: dark inset panel with grid + cyan trace + magenta playhead/peak. Must be responsive (<=1040px and <=720px breakpoints), keep all interactive states, and keep contrast >= 4.5:1 for body text. `index.html`: `lang="en"`, title `AFCT SFX Lab · XJTLU AFCT`, meta description, `theme-color #010544`, favicon `./afct-mark.svg`.

## 6. Acceptance

1. `npx tsc --noEmit` clean, `npm run build` clean, `npx vitest run` green.
2. Default language EN; switch to ZH updates every visible string; reload keeps ZH; `document.title`/`lang` consistent.
3. All 28 presets render grouped by category and are playable; footstep presets show the footstep control block.
4. No authored Chinese copy outside `src/i18n/zh.ts`.
5. Attribution to the original project visible in the footer and README; GPL-3.0 license retained.
6. No console errors on initial load; layout holds at 1440 / 1024 / 390 widths.

## 7. v1.1 effects rack (ui-i18n + theme)

The engine already ships the FX chain in `src/lib/effects.ts` and `src/lib/sfx.ts` (Lead-owned, done). Ten new `SfxParams` fields exist and are part of JSON import/export automatically:

| param | range | meaning |
| --- | --- | --- |
| `fxDrive` | 0..1 | tanh soft saturation (weight/punch) |
| `fxCrushRate` | 0..1 | sample-and-hold decimation (grit) |
| `fxCrushBits` | 0..1 | bit quantization (dirt) |
| `fxTone` | -1..1 (signed) | one-knob tilt around 1 kHz (dark ↔ bright) |
| `fxDelayTime` | 0..1 | echo spacing (0.03–0.40 s) |
| `fxDelayFeedback` | 0..1 | echo repeats |
| `fxDelayMix` | 0..1 | dry/wet of the echo |
| `fxReverbSize` | 0..1 | room size |
| `fxReverbMix` | 0..1 | dry/wet of the reverb |
| `fxNormalize` | 0/1 | peak ceiling at 0.995 when 1 |

Chain order is fixed: drive → bitcrush → tone → delay → reverb → peak ceiling → 6 ms fade-out. `applyFxChain` runs inside `renderSfx`, so canvas, stats, playback, WAV/MP3/OGG and ZIP all share one render. Rendering pads the buffer by `fxTailSeconds(params)` (0 for a fully dry chain), capped at 6 s total.

### 7.1 UI contract

1. Add one central control section before the existing five: `{ id: 'effects' }` rendered by the same `.control-section` markup as the rest. `ControlSection['id']` union must include `'effects'`, and `t()` keys `sections.effects.title` + `sections.effects.description` are required. Default `expandedSections.effects = false`.
2. Fields (all percent sliders via the existing `SliderField`, `step: 0.01`): `fxDrive`, `fxCrushRate`, `fxCrushBits`, `fxTone` (`signed: true`), `fxDelayTime`, `fxDelayFeedback`, `fxDelayMix`, `fxReverbSize`, `fxReverbMix`. `fxNormalize` is **not** a slider.
3. Below the slider grid add an extras row `.fx-extras`:
   - Normalize toggle: `.fx-toggle` button with `aria-pressed`, label `t('effects.normalize.label')`, hint `t('effects.normalize.hint')`; clicking flips `params.fxNormalize` between 1 and 0.
   - Bypass A/B: `.fx-bypass` button with `aria-pressed`; while active the **preview** (canvas, stats, play/auto-preview) renders `{...params, fxDrive:0, fxCrushRate:0, fxCrushBits:0, fxTone:0, fxDelayMix:0, fxReverbMix:0, fxNormalize:0}`; exports, JSON and history always use the real `params`. Status banner shows `t('status.fxBypassed')` while active.
   - Share link: `.fx-share` button → copies `${location.origin}${location.pathname}#s=${base64url(JSON.stringify({ v: 1, p: params, sr: sampleRate, bd: bitDepth }))}`; base64url = `btoa(unescape(encodeURIComponent(json))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`. Success → `t('status.shareCopied')`, failure → `t('status.shareCopyFailed')` (clipboard may be blocked; fall back to a temporary `<textarea>` + `document.execCommand('copy')` before reporting failure).
4. Load `#s=` on mount (once): decode base64url → JSON; accept only `v === 1`, `sr` in the existing sample-rate options, `bd` in `{8,16}`, `p` object; then `setParams(clampSfxParams(p))`, `setSampleRate`, `setBitDepth`, `setStatus(t('status.shareLoaded'))`. Any error → `setStatus(t('status.shareInvalid'))`; never throw or blank the app. Do not re-apply on re-render (use an init ref).

### 7.2 Required i18n keys (EN source text; ZH is yours)

- `sections.effects.title` = "FX rack" · `sections.effects.description` = "Shape the raw chip tone into something that sits in a mix."
- `fields.fxDrive.label` = "Drive" / hint "Soft saturation for weight and punch."
- `fields.fxCrushRate.label` = "Crush rate" / hint "Sample-rate reduction for a gritty, digital edge."
- `fields.fxCrushBits.label` = "Crush depth" / hint "Bit reduction; higher is dirtier."
- `fields.fxTone.label` = "Tone tilt" / hint "Darken or brighten the whole effect."
- `fields.fxDelayTime.label` = "Echo time" / hint "Spacing of the repeats."
- `fields.fxDelayFeedback.label` = "Echo feedback" / hint "How many repeats survive."
- `fields.fxDelayMix.label` = "Echo mix" / hint "How much echo you hear."
- `fields.fxReverbSize.label` = "Space size" / hint "Small room to large hall."
- `fields.fxReverbMix.label` = "Space mix" / hint "How much room sound you hear."
- `effects.normalize.label` = "Peak normalize" / `effects.normalize.hint` = "Keeps the loudest peak under the ceiling so exports never clip."
- `effects.bypass` = "Bypass FX" / `effects.bypassHint` = "Audition the raw engine output."
- `effects.share` = "Copy share link" / `effects.shareHint` = "Copy a link that restores these exact settings."
- `status.fxBypassed`, `status.shareCopied`, `status.shareCopyFailed`, `status.shareLoaded`, `status.shareInvalid`.

### 7.3 Tests to add (component suite)

- effects section renders 9 sliders + the normalize toggle.
- toggling bypass sets `aria-pressed` and shows the bypassed status copy.
- share button copies a `#s=` URL (mock `navigator.clipboard.writeText`) and a fresh mount with that hash restores `fxDelayMix` (assert the JSON panel value or the slider).
- `fxNormalize` toggle flips the params (assert via JSON panel text).

### 7.4 Theme

Style `.fx-extras`, `.fx-toggle`, `.fx-bypass`, `.fx-share` (inline row, wrap at 720 px, pressed state = magenta border/glow, focus-visible ring). No other layout change is required; the effects section reuses `.control-section`, `.slider-grid`, `.slider-card`.
