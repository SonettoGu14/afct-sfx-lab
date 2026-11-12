import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { encodeMp3FromSamples, encodeOggFromSamples } from '../lib/audioExport';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';
import { applyTargetPeak } from '../lib/mastering';
import {
  BARS_CHOICES,
  BPM_MAX,
  BPM_MIN,
  DEMO_SCORE,
  DRUM_PIECES,
  TONAL_INSTRUMENT_IDS,
  TRACK_BASE_PITCH,
  TRACK_IDS,
  TRACK_PITCH_ROWS,
  clampScore,
  createEmptyScore,
  deserializeScore,
  renderScore,
  secondsPerStep,
  serializeScore,
  stepsPerBar,
  totalSteps,
  type Score,
  type ScoreNote,
  type ScoreRender,
  type TimeSignature,
  type TonalInstrumentId,
  type TrackId,
} from '../lib/score';
import { encodeSfxWav } from '../lib/sfx';

const SCORE_STORAGE_KEY = 'afct-sfx-lab:score-v1';
const SAMPLE_RATE = 44100;
const RENDER_DEBOUNCE_MS = 250;
const CELL_WIDTH = 14;
const ROW_HEIGHT = 18;
const SECTION_HEIGHT = 22;
const OVERVIEW_ROW_HEIGHT = 20;
const TRACK_COLORS: Record<TrackId, string> = {
  lead: '#d3401d',
  bass: '#256d7b',
  chords: '#b07b1e',
  drums: '#6b5b95',
};

function trackRowCount(trackId: TrackId): number {
  return trackId === 'drums' ? DRUM_PIECES.length : TRACK_PITCH_ROWS;
}

function trackRowPitch(trackId: TrackId, row: number): number {
  return trackId === 'drums' ? row : TRACK_BASE_PITCH[trackId] + TRACK_PITCH_ROWS - 1 - row;
}

type OverviewRegion = { start: number; end: number };
type PaintState = { track: TrackId; pitch: number; anchor: number; end: number };

function mergeNoteRegions(notes: ScoreNote[], track: TrackId): OverviewRegion[] {
  const regions: OverviewRegion[] = [];
  for (const note of notes.filter((item) => item.track === track).sort((a, b) => a.start - b.start)) {
    const end = note.start + (track === 'drums' ? 1 : note.length);
    const last = regions[regions.length - 1];
    if (last && note.start <= last.end) last.end = Math.max(last.end, end);
    else regions.push({ start: note.start, end });
  }
  return regions;
}

function drawOverviewWave(canvas: HTMLCanvasElement | null, samples: Float32Array): void {
  if (!canvas) return;
  const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth || 640);
  const height = Math.max(1, canvas.clientHeight || OVERVIEW_ROW_HEIGHT);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const mid = height / 2;
  context.fillStyle = 'rgba(26, 24, 21, 0.07)';
  context.fillRect(0, 0, width, height);
  if (samples.length === 0) return;
  context.fillStyle = 'rgba(26, 24, 21, 0.45)';
  const columns = Math.max(1, Math.floor(width));
  for (let column = 0; column < columns; column += 1) {
    const from = Math.floor((column / columns) * samples.length);
    const to = Math.max(from + 1, Math.floor(((column + 1) / columns) * samples.length));
    let min = 1;
    let max = -1;
    for (let index = from; index < to; index += 1) {
      const value = samples[index] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (min > max) continue;
    const top = mid - max * mid * 0.92;
    const bottom = mid - min * mid * 0.92;
    context.fillRect(column, top, 1, Math.max(1, bottom - top));
  }
}

type ExportFormat = 'wav' | 'mp3' | 'ogg' | 'json';
type StatusMessage = { key: TranslationKey; vars?: Record<string, string | number> };
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function pitchName(midi: number): string {
  return `${PITCH_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function createNoteId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function loadScore(): Score {
  try {
    const raw = window.localStorage.getItem(SCORE_STORAGE_KEY);
    if (raw) {
      const parsed = deserializeScore(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // storage may be unavailable or hold a broken payload
  }
  return DEMO_SCORE;
}

function trackLabelKey(track: TrackId): TranslationKey {
  return `music.track.${track}`;
}

function drumLabelKey(piece: (typeof DRUM_PIECES)[number]): TranslationKey {
  return `music.drum.${piece}`;
}

type MusicWorkbenchProps = { active?: boolean };

export default function MusicWorkbench({ active = true }: MusicWorkbenchProps) {
  const { t } = useI18n();
  const [score, setScore] = useState<Score>(loadScore);
  const [activeTrack, setActiveTrack] = useState<TrackId>('lead');
  const [rendered, setRendered] = useState<ScoreRender | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({ key: 'music.status.ready' });
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [bpmDraft, setBpmDraft] = useState(() => String(score.bpm));

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const overviewPlayheadRef = useRef<HTMLDivElement | null>(null);
  const overviewLanesRef = useRef<HTMLDivElement | null>(null);
  const overviewWaveRef = useRef<HTMLCanvasElement | null>(null);
  const seekSecondsRef = useRef(0);
  const renderedRef = useRef<ScoreRender | null>(null);
  const isPlayingRef = useRef(false);
  const firstRenderRef = useRef(true);
  const rollCanvasRef = useRef<HTMLDivElement | null>(null);
  const paintRef = useRef<PaintState | null>(null);
  const paintCellsRef = useRef<HTMLElement[]>([]);
  const commitPaintRef = useRef<(paint: PaintState) => void>(() => {});

  const spb = stepsPerBar(score);
  const steps = totalSteps(score);
  const stepSeconds = secondsPerStep(score);
  const bpmFill = ((score.bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100;
  const rollHeight = TRACK_IDS.reduce(
    (total, trackId) => total + SECTION_HEIGHT + trackRowCount(trackId) * ROW_HEIGHT,
    0,
  );

  const notesByTrackPitch = useMemo(() => {
    const map = new Map<string, ScoreNote[]>();
    for (const note of score.notes) {
      const key = `${note.track}:${note.pitch}`;
      const list = map.get(key);
      if (list) list.push(note);
      else map.set(key, [note]);
    }
    return map;
  }, [score.notes]);
  const occupied = useMemo(() => {
    const map = new Map<string, ScoreNote>();
    for (const note of score.notes) {
      const span = note.track === 'drums' ? 1 : note.length;
      for (let step = note.start; step < note.start + span; step += 1) {
        map.set(`${note.track}:${note.pitch}:${step}`, note);
      }
    }
    return map;
  }, [score.notes]);
  const overviewRegions = useMemo(
    () => new Map<TrackId, OverviewRegion[]>(TRACK_IDS.map((trackId) => [trackId, mergeNoteRegions(score.notes, trackId)])),
    [score.notes],
  );

  useEffect(() => {
    renderedRef.current = rendered;
  }, [rendered]);

  useEffect(() => {
    const canvas = overviewWaveRef.current;
    if (!canvas) return undefined;
    const samples = rendered?.samples ?? new Float32Array(0);
    drawOverviewWave(canvas, samples);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => drawOverviewWave(canvas, samples));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rendered]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    setBpmDraft(String(score.bpm));
  }, [score.bpm]);

  useEffect(() => {
    let cancelled = false;
    setIsRendering(true);
    const delay = firstRenderRef.current ? 0 : RENDER_DEBOUNCE_MS;
    firstRenderRef.current = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const next = renderScore(score, { sampleRate: SAMPLE_RATE });
        if (cancelled) return;
        setRendered(next);
        setIsRendering(false);
      } catch {
        if (cancelled) return;
        setIsRendering(false);
        setStatus({ key: 'music.status.renderFailed' });
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [score]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SCORE_STORAGE_KEY, serializeScore(score));
      } catch {
        // ignore storage failures (private mode / quota)
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [score]);

  const stopPlayback = useCallback((resetPlayhead: boolean) => {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsPlaying(false);
    if (resetPlayhead) {
      seekSecondsRef.current = 0;
      if (playheadRef.current) playheadRef.current.style.left = '0%';
      if (overviewPlayheadRef.current) overviewPlayheadRef.current.style.left = '0%';
    }
  }, []);

  const setPlayheadRatio = (ratio: number): void => {
    const percent = `${ratio * 100}%`;
    if (playheadRef.current) playheadRef.current.style.left = percent;
    if (overviewPlayheadRef.current) overviewPlayheadRef.current.style.left = percent;
  };

  useEffect(() => {
    if (!active) stopPlayback(false);
  }, [active, stopPlayback]);

  useEffect(
    () => () => {
      stopPlayback(false);
      if (audioContextRef.current) void audioContextRef.current.close();
    },
    [stopPlayback],
  );

  const ensureAudioContext = async (): Promise<AudioContext> => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    return audioContextRef.current;
  };

  const handlePlay = async (): Promise<void> => {
    const current = renderedRef.current;
    if (!current) return;
    try {
      const audioContext = await ensureAudioContext();
      stopPlayback(false);
      const buffer = audioContext.createBuffer(1, current.samples.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(current.samples);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (sourceRef.current === source) {
          sourceRef.current = null;
          setIsPlaying(false);
        }
      };
      const loop = current.loopSeconds;
      const offset = loop > 0 ? seekSecondsRef.current % loop : 0;
      startedAtRef.current = audioContext.currentTime - offset;
      source.start(0, offset);
      sourceRef.current = source;
      setIsPlaying(true);
      setStatus({ key: 'music.status.playing' });

      const tick = (): void => {
        const context = audioContextRef.current;
        if (!context) return;
        const loop = current.loopSeconds;
        const elapsed = context.currentTime - startedAtRef.current;
        const ratio = loop > 0 ? (elapsed % loop) / loop : 0;
        setPlayheadRatio(ratio);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setStatus({ key: 'music.status.playFailed' });
    }
  };

  const handleSeek = (event: { clientX: number }): void => {
    const current = renderedRef.current;
    const lanes = overviewLanesRef.current;
    if (!current || !lanes) return;
    const rect = lanes.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seekSecondsRef.current = Math.min(ratio * current.loopSeconds, Math.max(0, current.loopSeconds - 1 / SAMPLE_RATE));
    if (isPlayingRef.current) {
      void handlePlay();
      return;
    }
    setPlayheadRatio(ratio);
  };

  const applyEdit = (next: Score): void => {
    if (isPlayingRef.current) stopPlayback(false);
    const clamped = clampScore(next);
    const dropped = next.notes.length - clamped.notes.length;
    setScore(clamped);
    setStatus(
      dropped > 0
        ? { key: 'music.status.notesDropped', vars: { count: dropped } }
        : { key: 'music.status.updated' },
    );
  };

  const commitBpm = (): void => {
    const value = Number(bpmDraft);
    if (!Number.isFinite(value)) {
      setBpmDraft(String(score.bpm));
      return;
    }
    applyEdit({ ...score, bpm: Math.round(value) });
  };

  const paintPreview = (from: number, to: number): void => {
    for (const cell of paintCellsRef.current) cell.classList.remove('is-paint');
    paintCellsRef.current = [];
    const paint = paintRef.current;
    const canvas = rollCanvasRef.current;
    if (!paint || !canvas) return;
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    for (const cell of canvas.querySelectorAll<HTMLElement>(
      `[data-track="${paint.track}"][data-pitch="${paint.pitch}"]`,
    )) {
      const step = Number(cell.dataset.step);
      if (step >= start && step <= end) {
        cell.classList.add('is-paint');
        paintCellsRef.current.push(cell);
      }
    }
  };

  const startPaint = (
    event: ReactPointerEvent<HTMLDivElement>,
    trackId: TrackId,
    pitch: number,
    step: number,
  ): void => {
    if (event.button > 0) return;
    setActiveTrack(trackId);
    const hit = occupied.get(`${trackId}:${pitch}:${step}`);
    if (hit) {
      applyEdit({ ...score, notes: score.notes.filter((note) => note.id !== hit.id) });
      return;
    }
    event.preventDefault();
    paintRef.current = { track: trackId, pitch, anchor: step, end: step };
    paintPreview(step, step);
  };

  const extendPaint = (trackId: TrackId, pitch: number, step: number): void => {
    const paint = paintRef.current;
    if (!paint || paint.track !== trackId || paint.pitch !== pitch || paint.end === step) return;
    paint.end = step;
    paintPreview(paint.anchor, paint.end);
  };

  const commitPaint = (paint: PaintState): void => {
    const start = Math.min(paint.anchor, paint.end);
    const span =
      paint.track === 'drums'
        ? 1
        : Math.min(Math.abs(paint.end - paint.anchor) + 1, steps - start);
    if (span < 1) return;
    const end = start + span;
    const notes = score.notes.filter((note) => {
      if (note.track !== paint.track || note.pitch !== paint.pitch) return true;
      const noteEnd = note.start + (note.track === 'drums' ? 1 : note.length);
      return noteEnd <= start || note.start >= end;
    });
    applyEdit({
      ...score,
      notes: [
        ...notes,
        { id: createNoteId(), track: paint.track, pitch: paint.pitch, start, length: span, velocity: 1 },
      ],
    });
  };
  commitPaintRef.current = commitPaint;

  useEffect(() => {
    const finish = (): void => {
      const paint = paintRef.current;
      if (!paint) return;
      paintRef.current = null;
      for (const cell of paintCellsRef.current) cell.classList.remove('is-paint');
      paintCellsRef.current = [];
      commitPaintRef.current(paint);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  const updateTrackGain = (trackId: TrackId, gain: number): void => {
    applyEdit({
      ...score,
      tracks: score.tracks.map((track) => (track.id === trackId ? { ...track, gain } : track)),
    });
  };

  const toggleMute = (trackId: TrackId): void => {
    applyEdit({
      ...score,
      tracks: score.tracks.map((track) => (track.id === trackId ? { ...track, mute: !track.mute } : track)),
    });
  };

  const updateInstrument = (trackId: TrackId, instrument: TonalInstrumentId): void => {
    applyEdit({
      ...score,
      tracks: score.tracks.map((track) =>
        track.id === trackId && track.kind === 'tonal' ? { ...track, instrument } : track,
      ),
    });
  };

  const handleExport = async (format: ExportFormat): Promise<void> => {
    if (!renderedRef.current || score.notes.length === 0) {
      setStatus({ key: 'music.status.empty' });
      return;
    }
    setExporting(format);
    setStatus({ key: 'music.status.exporting', vars: { format: format.toUpperCase() } });
    try {
      let blob: Blob;
      const stem = `afct-music-${score.bpm}bpm-${score.timeSignature.replace('/', '-')}-${score.bars}bars`;
      if (format === 'json') {
        blob = new Blob([serializeScore(score)], { type: 'application/json' });
      } else {
        const samples = applyTargetPeak(renderedRef.current.samples, -1);
        if (format === 'wav') blob = encodeSfxWav(samples, SAMPLE_RATE, 16);
        else if (format === 'mp3') blob = await encodeMp3FromSamples(samples, SAMPLE_RATE);
        else blob = await encodeOggFromSamples(samples, SAMPLE_RATE, stem);
      }
      downloadBlob(blob, `${stem}.${format}`);
      setStatus({ key: 'music.status.exported', vars: { format: format.toUpperCase() } });
    } catch {
      setStatus({ key: 'music.status.exportFailed', vars: { format: format.toUpperCase() } });
    } finally {
      setExporting(null);
    }
  };

  const signatureOptions: TimeSignature[] = ['4/4', '3/4', '2/4', '6/8'];
  const barStarts = Array.from({ length: score.bars }, (_, index) => index * spb);

  return (
    <section className="music" aria-label={t('music.workbenchLabel')}>
      <div className="music__transport" role="group" aria-label={t('music.transportLabel')}>
        <div className="transport__buttons">
          <button
            type="button"
            className={isPlaying ? 'btn btn--ghost music__play is-active' : 'btn btn--ghost music__play'}
            data-testid="music-play"
            onClick={() => {
              void handlePlay();
            }}
            disabled={!rendered || isRendering}
          >
            {t('music.play')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="music-stop"
            onClick={() => stopPlayback(true)}
            disabled={!isPlaying}
          >
            {t('music.stop')}
          </button>
        </div>

        <label className="transport__field">
          <span className="transport__label">{t('music.bpmShort')}</span>
          <span className="transport__control">
            <input
              type="number"
              className="music__input music__input--number"
              data-testid="music-bpm-number"
              min={BPM_MIN}
              max={BPM_MAX}
              value={bpmDraft}
              aria-label={t('music.bpm')}
              onChange={(event) => setBpmDraft(event.target.value)}
              onBlur={commitBpm}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitBpm();
              }}
            />
            <input
              type="range"
              className="param__range transport__range"
              data-testid="music-bpm-range"
              min={BPM_MIN}
              max={BPM_MAX}
              step={1}
              value={score.bpm}
              style={{ '--fill': `${bpmFill}%` } as CSSProperties}
              aria-label={t('music.bpm')}
              onChange={(event) => applyEdit({ ...score, bpm: Number(event.target.value) })}
            />
          </span>
        </label>
        <label className="transport__field">
          <span className="transport__label">{t('music.timeSignature')}</span>
          <select
            className="music__input music__input--select"
            data-testid="music-signature"
            value={score.timeSignature}
            aria-label={t('music.timeSignature')}
            onChange={(event) => applyEdit({ ...score, timeSignature: event.target.value as TimeSignature })}
          >
            {signatureOptions.map((signature) => (
              <option key={signature} value={signature}>
                {signature}
              </option>
            ))}
          </select>
        </label>
        <label className="transport__field">
          <span className="transport__label">{t('music.bars')}</span>
          <select
            className="music__input music__input--select"
            data-testid="music-bars"
            value={score.bars}
            aria-label={t('music.bars')}
            onChange={(event) => applyEdit({ ...score, bars: Number(event.target.value) })}
          >
            {BARS_CHOICES.map((bars) => (
              <option key={bars} value={bars}>
                {bars}
              </option>
            ))}
          </select>
        </label>
        <div className="transport__actions">
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            data-testid="music-load-demo"
            onClick={() => {
              applyEdit(clampScore(DEMO_SCORE));
              setStatus({ key: 'music.status.demoLoaded' });
            }}
          >
            {t('music.loadDemo')}
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            data-testid="music-clear"
            onClick={() => {
              applyEdit({
                ...createEmptyScore(),
                bpm: score.bpm,
                timeSignature: score.timeSignature,
                bars: score.bars,
                seed: score.seed,
              });
              setStatus({ key: 'music.status.cleared' });
            }}
          >
            {t('music.clear')}
          </button>
          <div className="transport__exports" role="group" aria-label={t('music.exportGroup')}>
            {(['wav', 'mp3', 'ogg', 'json'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="export-chip"
                data-testid={`music-export-${format}`}
                disabled={exporting !== null || !rendered || score.notes.length === 0}
                onClick={() => {
                  void handleExport(format);
                }}
              >
                {format === 'json' ? t('music.exportJson') : format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="music__meta">
        <span data-testid="music-duration">
          {t('music.duration')} {rendered ? `${rendered.loopSeconds.toFixed(2)} s` : '—'}
        </span>
        <span data-testid="music-notes">
          {t('music.notes')} {rendered ? rendered.noteCount : '—'}
        </span>
        <span data-testid="music-peak">
          {t('music.peak')}{' '}
          {rendered && rendered.peak > 0 ? `${(20 * Math.log10(rendered.peak)).toFixed(2)} dB` : '—'}
        </span>
        <span data-testid="music-grid-size">
          {score.bars} × {spb} · {stepSeconds.toFixed(3)} s / 16
        </span>
        <span className={isRendering ? 'music__status is-live' : 'music__status'} role="status">
          {isRendering ? t('music.status.rendering') : t(status.key, status.vars)}
        </span>
      </div>

      <div
        className="arrangement"
        data-testid="music-overview"
        role="group"
        aria-label={t('music.overviewLabel')}
        title={t('music.overviewHint')}
      >
        <div className="arrangement__ruler" aria-hidden="true">
          <span className="arrangement__ruler-spacer" />
          <div className="arrangement__ticks">
            {Array.from({ length: score.bars }, (_, index) => (
              <span
                key={index}
                className="arrangement__tick"
                data-testid="overview-tick"
                style={{ left: `${(index / score.bars) * 100}%` }}
              >
                {index + 1}
              </span>
            ))}
          </div>
        </div>
        <div className="arrangement__grid">
          <div className="arrangement__labels" aria-hidden="true">
            {TRACK_IDS.map((trackId) => (
              <div key={trackId} className="arrangement__label">
                <i className="arrangement__swatch" style={{ background: TRACK_COLORS[trackId] }} />
                {t(trackLabelKey(trackId))}
              </div>
            ))}
            <div className="arrangement__label">{t('music.overviewWaveShort')}</div>
          </div>
          <div className="arrangement__lanes" ref={overviewLanesRef} onClick={handleSeek}>
            {barStarts.map((start) => (
              <i
                key={start}
                className="arrangement__barline"
                style={{ left: `${(start / steps) * 100}%` }}
              />
            ))}
            {TRACK_IDS.map((trackId) => {
              const muted = score.tracks.some((track) => track.id === trackId && track.mute);
              return (
                <div key={trackId} className="arrangement__lane" data-testid={`overview-lane-${trackId}`}>
                  {(overviewRegions.get(trackId) ?? []).map((region, index) => (
                    <i
                      key={index}
                      className={muted ? 'arrangement__clip is-muted' : 'arrangement__clip'}
                      data-testid="overview-clip"
                      style={{
                        left: `${(region.start / steps) * 100}%`,
                        width: `${((region.end - region.start) / steps) * 100}%`,
                        background: TRACK_COLORS[trackId],
                      }}
                    />
                  ))}
                  {score.notes
                    .filter((note) => note.track === trackId)
                    .map((note) => {
                      const drums = trackId === 'drums';
                      const noteEnd = Math.min(steps, note.start + (drums ? 1 : note.length));
                      return (
                        <i
                          key={note.id}
                          className={muted ? 'arrangement__note is-muted' : 'arrangement__note'}
                          data-testid="overview-note"
                          style={{
                            left: `${(note.start / steps) * 100}%`,
                            width: `calc(${(Math.max(1, noteEnd - note.start) / steps) * 100}% - 1px)`,
                            background: TRACK_COLORS[trackId],
                            top: drums ? `${(note.pitch / DRUM_PIECES.length) * 100}%` : '25%',
                            height: drums ? `${100 / DRUM_PIECES.length}%` : '50%',
                          }}
                        />
                      );
                    })}
                </div>
              );
            })}
            <div className="arrangement__lane arrangement__lane--wave">
              <canvas
                ref={overviewWaveRef}
                className="arrangement__wave"
                data-testid="music-overview-wave"
                role="img"
                aria-label={t('music.overviewWave')}
              />
            </div>
            <div
              ref={overviewPlayheadRef}
              className="arrangement__playhead"
              data-testid="music-overview-playhead"
            />
          </div>
        </div>
      </div>

      <div className="music__body">
        <div className="track-list" role="group" aria-label={t('music.tracks')}>
          {TRACK_IDS.map((trackId) => {
            const track = score.tracks.find((item) => item.id === trackId);
            if (!track) return null;
            const label = t(trackLabelKey(trackId));
            return (
              <div
                key={trackId}
                className={trackId === activeTrack ? 'track-row is-active' : 'track-row'}
                data-testid={`track-row-${trackId}`}
                onClick={() => setActiveTrack(trackId)}
                role="presentation"
              >
                <span className="track-row__name">
                  <i className="track-row__swatch" style={{ background: TRACK_COLORS[trackId] }} />
                  {label}
                </span>
                <div className="track-row__main">
                  {track.kind === 'tonal' ? (
                    <select
                      className="music__input music__input--select track-row__instrument"
                      data-testid={`track-instrument-${trackId}`}
                      value={track.instrument}
                      aria-label={t('music.instrumentFor', { track: label })}
                      onChange={(event) => updateInstrument(trackId, event.target.value as TonalInstrumentId)}
                    >
                      {TONAL_INSTRUMENT_IDS.map((instrumentId) => (
                        <option key={instrumentId} value={instrumentId}>
                          {t(`instruments.${instrumentId}.label`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="track-row__kit">{t('music.drumKit')}</span>
                  )}
                  <span className="track-row__level">
                    <input
                      type="range"
                      className="param__range track-row__gain"
                      data-testid={`track-gain-${trackId}`}
                      min={0}
                      max={1}
                      step={0.01}
                      value={track.gain}
                      style={{ '--fill': `${track.gain * 100}%` } as CSSProperties}
                      aria-label={t('music.gainFor', { track: label })}
                      onChange={(event) => updateTrackGain(trackId, Number(event.target.value))}
                    />
                    <span className="track-row__value" aria-hidden="true">
                      {Math.round(track.gain * 100)}
                    </span>
                  </span>
                </div>
                <label className="track-row__mute">
                  <input
                    type="checkbox"
                    data-testid={`track-mute-${trackId}`}
                    checked={track.mute}
                    aria-label={t('music.muteFor', { track: label })}
                    onChange={() => toggleMute(trackId)}
                  />
                  <span>{t('music.mute')}</span>
                </label>
              </div>
            );
          })}
        </div>

        <div className="roll" role="grid" aria-label={t('music.rollLabel')}>
          <div className="roll__labels" aria-hidden="true">
            {TRACK_IDS.map((trackId) => (
              <div key={trackId}>
                <div className="roll__label roll__label--section" style={{ height: SECTION_HEIGHT }}>
                  <i className="roll__chip" style={{ background: TRACK_COLORS[trackId] }} />
                  <span>{t(trackLabelKey(trackId))}</span>
                </div>
                {Array.from({ length: trackRowCount(trackId) }, (_, row) => (
                  <div key={row} className="roll__label" style={{ height: ROW_HEIGHT }}>
                    {trackId === 'drums' ? t(drumLabelKey(DRUM_PIECES[row])) : pitchName(trackRowPitch(trackId, row))}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div
            ref={rollCanvasRef}
            className="roll__canvas"
            style={{ width: steps * CELL_WIDTH, height: rollHeight }}
          >
            {barStarts.map((barStart) => (
              <div
                key={barStart}
                className="roll__bar-line"
                style={{ left: barStart * CELL_WIDTH, height: rollHeight }}
              />
            ))}

            {TRACK_IDS.map((trackId) => {
              const color = TRACK_COLORS[trackId];
              const muted = score.tracks.some((track) => track.id === trackId && track.mute);
              return (
                <div key={trackId} className="roll__section" data-testid={`roll-section-${trackId}`}>
                  <div
                    className="roll__band"
                    style={{ height: SECTION_HEIGHT, background: `${color}1a`, borderTopColor: color }}
                  />
                  {Array.from({ length: trackRowCount(trackId) }, (_, row) => {
                    const pitch = trackRowPitch(trackId, row);
                    const rowNotes = notesByTrackPitch.get(`${trackId}:${pitch}`) ?? [];
                    return (
                      <div key={row} className="roll__row" style={{ height: ROW_HEIGHT }}>
                        {Array.from({ length: steps }, (_, step) => (
                          <div
                            key={step}
                            className="roll__cell"
                            data-testid={`roll-cell-${trackId}-${pitch}-${step}`}
                            data-track={trackId}
                            data-pitch={pitch}
                            data-step={step}
                            style={{ width: CELL_WIDTH, height: ROW_HEIGHT }}
                            onPointerDown={(event) => startPaint(event, trackId, pitch, step)}
                            onPointerMove={() => extendPaint(trackId, pitch, step)}
                          />
                        ))}
                        {rowNotes.map((note) => (
                          <div
                            key={note.id}
                            className={muted ? 'roll__note is-muted' : 'roll__note'}
                            data-testid="music-note"
                            style={{
                              left: note.start * CELL_WIDTH + 1,
                              width: Math.max(4, (trackId === 'drums' ? 1 : note.length) * CELL_WIDTH - 2),
                              height: ROW_HEIGHT - 4,
                              background: color,
                            }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div ref={playheadRef} className="roll__playhead" data-testid="music-playhead" />
          </div>
        </div>
      </div>
    </section>
  );
}
