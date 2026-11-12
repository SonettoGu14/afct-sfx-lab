import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type ExportFormat = 'wav' | 'mp3' | 'ogg' | 'json';
type StatusMessage = { key: TranslationKey; vars?: Record<string, string | number> };
type BrushId = '1_16' | '1_8' | '1_4' | '1_2' | '1_bar';

const BRUSHES: Array<{ id: BrushId; steps: number; key: TranslationKey }> = [
  { id: '1_16', steps: 1, key: 'music.noteLength.1_16' },
  { id: '1_8', steps: 2, key: 'music.noteLength.1_8' },
  { id: '1_4', steps: 4, key: 'music.noteLength.1_4' },
  { id: '1_2', steps: 8, key: 'music.noteLength.1_2' },
  { id: '1_bar', steps: 0, key: 'music.noteLength.1_bar' },
];

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
  const [brush, setBrush] = useState<BrushId>('1_4');
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
  const renderedRef = useRef<ScoreRender | null>(null);
  const isPlayingRef = useRef(false);
  const firstRenderRef = useRef(true);

  const spb = stepsPerBar(score);
  const steps = totalSteps(score);
  const stepSeconds = secondsPerStep(score);
  const rows = activeTrack === 'drums' ? DRUM_PIECES.length : TRACK_PITCH_ROWS;
  const brushSteps = brush === '1_bar' ? spb : (BRUSHES.find((option) => option.id === brush)?.steps ?? 4);

  const trackNotes = useMemo(
    () => score.notes.filter((note) => note.track === activeTrack),
    [activeTrack, score.notes],
  );
  const notesByPitch = useMemo(() => {
    const map = new Map<number, ScoreNote[]>();
    for (const note of trackNotes) {
      const list = map.get(note.pitch);
      if (list) list.push(note);
      else map.set(note.pitch, [note]);
    }
    return map;
  }, [trackNotes]);
  const occupied = useMemo(() => {
    const map = new Map<string, ScoreNote>();
    for (const note of trackNotes) {
      const span = activeTrack === 'drums' ? 1 : note.length;
      for (let step = note.start; step < note.start + span; step += 1) {
        map.set(`${note.pitch}:${step}`, note);
      }
    }
    return map;
  }, [activeTrack, trackNotes]);

  useEffect(() => {
    renderedRef.current = rendered;
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
    if (resetPlayhead && playheadRef.current) {
      playheadRef.current.style.left = '0%';
    }
  }, []);

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
      startedAtRef.current = audioContext.currentTime;
      source.start();
      sourceRef.current = source;
      setIsPlaying(true);
      setStatus({ key: 'music.status.playing' });

      const tick = (): void => {
        const context = audioContextRef.current;
        const element = playheadRef.current;
        if (!context || !element) return;
        const loop = current.loopSeconds;
        const elapsed = context.currentTime - startedAtRef.current;
        const ratio = loop > 0 ? (elapsed % loop) / loop : 0;
        element.style.left = `${ratio * 100}%`;
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setStatus({ key: 'music.status.playFailed' });
    }
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

  const handleCell = (pitch: number, step: number): void => {
    const hit = occupied.get(`${pitch}:${step}`);
    if (hit) {
      applyEdit({ ...score, notes: score.notes.filter((note) => note.id !== hit.id) });
      return;
    }
    const length = activeTrack === 'drums' ? 1 : Math.min(brushSteps, steps - step);
    if (length < 1) return;
    applyEdit({
      ...score,
      notes: [
        ...score.notes,
        { id: createNoteId(), track: activeTrack, pitch, start: step, length, velocity: 1 },
      ],
    });
  };

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
  const activeLabel = t(trackLabelKey(activeTrack));

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
          <span>{t('music.bpmShort')}</span>
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
        </label>
        <input
          type="range"
          className="transport__range"
          data-testid="music-bpm-range"
          min={BPM_MIN}
          max={BPM_MAX}
          step={1}
          value={score.bpm}
          aria-label={t('music.bpm')}
          onChange={(event) => applyEdit({ ...score, bpm: Number(event.target.value) })}
        />
        <label className="transport__field">
          <span>{t('music.timeSignature')}</span>
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
          <span>{t('music.bars')}</span>
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
        <label className="transport__field">
          <span>{t('music.noteLength')}</span>
          <select
            className="music__input music__input--select"
            data-testid="music-brush"
            value={brush}
            aria-label={t('music.noteLength')}
            onChange={(event) => setBrush(event.target.value as BrushId)}
          >
            {BRUSHES.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.key)}
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
          {(['wav', 'mp3', 'ogg', 'json'] as const).map((format) => (
            <button
              key={format}
              type="button"
              className="btn btn--quiet btn--sm"
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
                <span className="track-row__name">{label}</span>
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
                <input
                  type="range"
                  className="track-row__gain"
                  data-testid={`track-gain-${trackId}`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={track.gain}
                  aria-label={t('music.gainFor', { track: label })}
                  onChange={(event) => updateTrackGain(trackId, Number(event.target.value))}
                />
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

        <div className="roll" role="grid" aria-label={t('music.gridLabel', { track: activeLabel })}>
          <div className="roll__labels" aria-hidden="true">
            {Array.from({ length: rows }, (_, row) => {
              const pitch = activeTrack === 'drums' ? row : TRACK_BASE_PITCH[activeTrack] + TRACK_PITCH_ROWS - 1 - row;
              return (
                <div key={row} className="roll__label" style={{ height: ROW_HEIGHT }}>
                  {activeTrack === 'drums' ? t(drumLabelKey(DRUM_PIECES[row])) : pitchName(pitch)}
                </div>
              );
            })}
          </div>

          <div
            className="roll__canvas"
            style={{ width: steps * CELL_WIDTH, height: rows * ROW_HEIGHT }}
          >
            {barStarts.map((barStart) => (
              <div
                key={barStart}
                className="roll__bar-line"
                style={{ left: barStart * CELL_WIDTH, height: rows * ROW_HEIGHT }}
              />
            ))}

            {Array.from({ length: rows }, (_, row) => {
              const pitch = activeTrack === 'drums' ? row : TRACK_BASE_PITCH[activeTrack] + TRACK_PITCH_ROWS - 1 - row;
              const rowNotes = notesByPitch.get(pitch) ?? [];
              return (
                <div key={row} className="roll__row" style={{ height: ROW_HEIGHT }}>
                  {Array.from({ length: steps }, (_, step) => (
                    <div
                      key={step}
                      className="roll__cell"
                      data-testid={`roll-cell-${activeTrack}-${pitch}-${step}`}
                      style={{ width: CELL_WIDTH, height: ROW_HEIGHT }}
                      onClick={() => handleCell(pitch, step)}
                    />
                  ))}
                  {rowNotes.map((note) => (
                    <div
                      key={note.id}
                      className="roll__note"
                      data-testid="music-note"
                      style={{
                        left: note.start * CELL_WIDTH + 1,
                        width: Math.max(4, (activeTrack === 'drums' ? 1 : note.length) * CELL_WIDTH - 2),
                        height: ROW_HEIGHT - 4,
                      }}
                    />
                  ))}
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
