# Music Mode — Score Contract

Music mode turns the SFX engine into an instrument: the same `renderSfx()` call that powers
the 28 presets is rendered once per note and mixed onto a loop grid. The engine itself is
untouched, so SFX presets, the FX chain and the Unity parity fixtures are unaffected.

This document is the contract for `src/lib/score.ts`. The Unity port of Music mode (not yet
written) should mirror the JSON shape below.

## Score JSON

```json
{
  "version": 1,
  "bpm": 110,
  "timeSignature": "4/4",
  "bars": 8,
  "stepsPerBeat": 4,
  "seed": 7,
  "tracks": [
    { "id": "lead", "kind": "tonal", "instrument": "leadSquare", "gain": 0.9, "mute": false },
    { "id": "bass", "kind": "tonal", "instrument": "bassSine", "gain": 0.6, "mute": false },
    { "id": "chords", "kind": "tonal", "instrument": "padWarm", "gain": 0.3, "mute": false },
    { "id": "drums", "kind": "percussive", "instrument": null, "gain": 0.7, "mute": false }
  ],
  "notes": [
    { "id": "n1", "track": "lead", "pitch": 69, "start": 0, "length": 4, "velocity": 1 }
  ]
}
```

- `pitch` is a MIDI note number (0–127) on tonal tracks and a drum-piece index (0–4) on the
  drums track. `start` and `length` are counted in sixteenth-note steps.
- `id` is a UI key only; it is regenerated on import if missing and never affects the render.
- `stepsPerBeat` is fixed at 4 (sixteenth-note grid).

## Time, tempo and signatures

- BPM always means **quarter notes per minute**, for every signature. A step is
  `60 / bpm / 4` seconds.
- `stepsPerBar = numerator * 16 / denominator`:

  | Signature | Quarter notes per bar | Steps per bar |
  | --------- | --------------------- | ------------- |
  | 4/4       | 4                     | 16            |
  | 3/4       | 3                     | 12            |
  | 2/4       | 2                     | 8             |
  | 6/8       | 3                     | 12            |

  Changing the signature keeps absolute note times and only changes bar boundaries and the
  loop length. Notes that fall outside the new loop are dropped by `clampScore` and the UI
  reports how many were removed.
- Loop length in samples is `round(totalSteps * stepSeconds * sampleRate)`; the sample boundary
  is computed once for the whole loop, never accumulated per note, so 4/4 × 8 bars at 110 BPM
  and 44.1 kHz is exactly 769,745 samples (17.4545 s).
- `bpm` is clamped to 40–240 and `bars` to 4 or 8.

## Instruments

Tonal instruments (`envelope: 'sustain'`) use a sustained source note that is tiled to the
requested length (see below). `pluck` uses `envelope: 'decay'` and lets the engine envelope
ring out naturally.

| id           | Kind       | Character                     |
| ------------ | ---------- | ----------------------------- |
| `leadSquare` | tonal      | square lead used by the demo  |
| `leadPulse`  | tonal      | thinner 25% pulse lead        |
| `bassSine`   | tonal      | sine bass used by the demo    |
| `bassSquare` | tonal      | square bass with more edge    |
| `padWarm`    | tonal      | slow sine pad                 |
| `pluck`      | tonal      | short decaying pluck          |
| `kick`       | percussive | sine drop kick                |
| `snare`      | percussive | filtered noise snare          |
| `hatClosed`  | percussive | short noise hat               |
| `hatOpen`    | percussive | long noise hat                |
| `tom`        | percussive | sine tom                      |

Two settings matter for the tonal presets: `lowPassResonance` is kept at 1.0 (at the default 0
the two-pole filter rings around 5 kHz and square leads turn into a piercing buzz), and
`fxNormalize` is disabled per note so the per-note peak ceiling cannot rescale notes by pitch.

## Render pipeline

1. Every note is rendered with `renderSfx(params, { seed })`. The tonal base parameters are
   `sustain = 1`, `decay = 0`, giving a source note of roughly 1.22 s.
2. **Long notes** (`length` beyond the source) are built from that source: the first 0.4 s is
   written directly, then a 0.25 s steady slice (taken at 0.4–0.65 s) is repeated with a 6 ms
   overlap-add crossfade. The tail gets a raised-cosine release of `min(60 ms, length / 3)`.
   The head is never overlapped: overlapping the first slice reintroduces a click.
3. `envelope: 'decay'` notes are rendered once and cut to the note length with the same
   release rule. Drums ignore `length` and play a single hit.
4. Notes are mixed with `gain × velocity` and the release tail **wraps around** the loop end
   modulo the loop length, so the loop point stays continuous.
5. The bus is peak-limited **downward only**: if the mix peaks above 0.995 the whole buffer is
   scaled to 0.995. It is never boosted automatically; per-track gain faders stay meaningful.
6. Each note seed is `(score.seed ^ imul(noteIndex + 1, 0x9e3779b1)) >>> 0`, so a score plus
   its seed is byte-for-byte reproducible. `Math.random()` is never called in the render path.

## Workbench layout

All four tracks are drawn in one stacked piano roll (lead, bass, chords, drums), each with its
own colour and a 22 px section header, so the arrangement can be read without switching tracks.
Clicking a cell selects that track and adds or removes a note there; muting a track dims its
notes. The roll scrolls horizontally and vertically inside a 560 px viewport and never widens
the page.

## Persistence and export

- The workbench stores the score under `afct-sfx-lab:score-v1` (300 ms debounce) and the mode
  under `afct-sfx-lab:mode-v1`. A broken payload falls back to the demo score.
- Export formats: WAV (16-bit / 44.1 kHz, mastered to −1 dBFS), MP3, OGG and the raw score
  JSON. File stem: `afct-music-<bpm>bpm-<sig>-<bars>bars`.
- The WAV is mono; stereo image, per-track sends and bus FX are out of scope for this version.

## Demo score

`DEMO_SCORE` is the 4/4, 8-bar, 110 BPM loop from the CAT105TC report (Am–F–C–G–Am–F–G–C),
plus a simple drum pattern: 26 lead notes, 16 bass notes, 48 pad notes and 64 drum hits
(154 notes total, 17.4545 s).
