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
    { "id": "lead", "kind": "tonal", "instrument": "leadSquare", "basePitch": 60, "gain": 0.9, "mute": false },
    { "id": "bass", "kind": "tonal", "instrument": "bassSine", "basePitch": 36, "gain": 0.6, "mute": false },
    { "id": "chords", "kind": "tonal", "instrument": "padWarm", "basePitch": 48, "gain": 0.3, "mute": false },
    { "id": "drums", "kind": "percussive", "instrument": null, "gain": 0.7, "mute": false }
  ],
  "notes": [
    { "id": "n1", "track": "lead", "pitch": 69, "start": 0, "length": 4, "velocity": 1 }
  ]
}
```

- `pitch` is a MIDI note number (0–127) on tonal tracks and a drum-piece index (0–6) on
  percussive tracks. `start` and `length` are counted in sixteenth-note steps.
- Tracks are identified by unique string ids. A score holds 1–8 tracks; the workbench adds
  tonal or drum tracks (empty, with an id like `track-3`) and removes them together with their
  notes. `basePitch` is the MIDI pitch drawn at the top row of a tonal track's roll; new tracks
  derive it from the instrument family (bass 36, pads 48, everything else 60).
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

| id           | Kind       | Character                          |
| ------------ | ---------- | ---------------------------------- |
| `leadSquare` | tonal      | square lead used by the demo       |
| `leadPulse`  | tonal      | thinner 25% pulse lead             |
| `leadSaw`    | tonal      | bright sawtooth lead               |
| `leadSine`   | tonal      | hollow sine lead                   |
| `chipLead`   | tonal      | narrow pulse chip lead             |
| `bassSine`   | tonal      | sine bass used by the demo         |
| `bassSquare` | tonal      | square bass with more edge         |
| `bassSaw`    | tonal      | sawtooth bass                      |
| `subBass`    | tonal      | very low sine sub                  |
| `padWarm`    | tonal      | slow sine pad                      |
| `padGlass`   | tonal      | filtered saw glass pad             |
| `organ`      | tonal      | sustained square organ             |
| `bell`       | tonal      | decaying sine bell                 |
| `pluck`      | tonal      | short decaying pluck               |
| `kick`       | percussive | sine drop kick                     |
| `snare`      | percussive | filtered noise snare               |
| `hatClosed`  | percussive | short noise hat                    |
| `hatOpen`    | percussive | long noise hat                     |
| `tom`        | percussive | sine tom                           |
| `clap`       | percussive | short noise burst                  |
| `rim`        | percussive | high square click                  |

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

The workbench is split into an arrangement overview and a piano roll for one track at a time.
The overview always shows every track in the score, each with its own colour
in a tall lane that stacks notes by pitch, plus a waveform lane. Clicking a lane selects that
track for the roll and seeks to that point, so the overview doubles as the track switcher.
Clicking an existing note in the roll removes it as a whole; clicking an empty cell adds a
one-step note, and pressing and dragging horizontally draws a longer note in place, so any
length can be written without a brush control. Muting a track dims its notes. Each track row has
a delete button, and two buttons under the list add an empty tonal or drum track (up to eight
tracks); deleting a track removes its notes too. The roll scrolls horizontally inside a 560 px
viewport and never widens the page.

Above the roll sits the arrangement overview: one lane per track, with notes stacked by pitch
(24 rows for tonal tracks, five for drums) but no pitch labels. Each note is a solid tick sized
by its grid length, so melody contour, held chords and drum patterns are all readable at a
glance. The active track's lane is highlighted and drives which track the roll edits. A bar ruler, bar lines
and a rendered-waveform lane sit alongside; a playhead sweeps the overview in sync with the roll
during playback. Clicking anywhere on the overview seeks: while stopped it only moves the
playheads and sets the next start point, while playing it restarts the loop from that position.
The overview always fits the loop width (no horizontal scroll) and muted tracks are dimmed.

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
