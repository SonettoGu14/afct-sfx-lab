import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { encodeMp3FromSamples, encodeOggFromSamples } from '../lib/audioExport';
import { createZipArchive } from '../lib/zip';
import {
  DEFAULT_SFX_PARAMS,
  clampSfxParams,
  createSfxPreset,
  deserializeSfxParams,
  encodeSfxWav,
  renderSfx,
  serializeSfxParams,
  type SfxBitDepth,
  type SfxParams,
  type SfxPresetId,
  type SfxSampleRate,
  type SfxWaveform,
} from '../lib/sfx';
import { PRESET_CATEGORIES, isFootstepPresetId, isPresetId } from '../lib/presetCatalog';
import { useI18n, type Translate, type TranslationKey } from '../i18n';

const HISTORY_STORAGE_KEY = 'afct-sfx-lab:history-v1';
const SAMPLE_RATE_OPTIONS: SfxSampleRate[] = [44100, 22050, 11025, 8000];
const BIT_DEPTH_OPTIONS: SfxBitDepth[] = [16, 8];
const DEFAULT_EXPANDED_SECTIONS = {
  envelope: true,
  frequency: true,
  modulation: false,
  texture: false,
  filter: false,
} as const;
const EXPORT_FORMATS = ['wav', 'json', 'mp3', 'ogg'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type SavedSfxHistoryItem = {
  id: string;
  name: string;
  savedAt: string;
  presetId: SfxPresetId | null;
  params: SfxParams;
  sampleRate: SfxSampleRate;
  bitDepth: SfxBitDepth;
  waveform: SfxWaveform;
};

type ControlSectionId = keyof typeof DEFAULT_EXPANDED_SECTIONS;
type SliderKey = {
  [K in keyof SfxParams]: SfxParams[K] extends number ? K : never;
}[keyof SfxParams];
type Snapshot = Omit<SavedSfxHistoryItem, 'id' | 'savedAt'>;
type SliderConfig = {
  key: SliderKey;
  min: number;
  max: number;
  step?: number;
  signed?: boolean;
};
type ControlSection = {
  id: ControlSectionId;
  fields: SliderConfig[];
};
type FootstepSliderKey = 'footstepHeel' | 'footstepRoll' | 'footstepBall' | 'footstepSwiftness';
type StatusMessage = { key: TranslationKey; vars?: Record<string, string | number> };

const WAVEFORM_OPTIONS: Array<{ value: SfxWaveform; glyph: string }> = [
  { value: 'square', glyph: '[]' },
  { value: 'sawtooth', glyph: '/|' },
  { value: 'sine', glyph: '~' },
  { value: 'noise', glyph: '::' },
];
const CONTROL_SECTIONS: ControlSection[] = [
  {
    id: 'envelope',
    fields: [
      { key: 'attack', min: 0, max: 1 },
      { key: 'sustain', min: 0, max: 1 },
      { key: 'sustainPunch', min: 0, max: 1 },
      { key: 'decay', min: 0, max: 1 },
    ],
  },
  {
    id: 'frequency',
    fields: [
      { key: 'startFrequency', min: 0, max: 1 },
      { key: 'minFrequency', min: 0, max: 1 },
      { key: 'slide', min: -1, max: 1, signed: true },
      { key: 'deltaSlide', min: -1, max: 1, signed: true },
    ],
  },
  {
    id: 'modulation',
    fields: [
      { key: 'vibratoDepth', min: 0, max: 1 },
      { key: 'vibratoSpeed', min: 0, max: 1 },
      { key: 'changeAmount', min: -1, max: 1, signed: true },
      { key: 'changeSpeed', min: 0, max: 1 },
    ],
  },
  {
    id: 'texture',
    fields: [
      { key: 'squareDuty', min: 0, max: 1 },
      { key: 'dutySweep', min: -1, max: 1, signed: true },
      { key: 'repeatSpeed', min: 0, max: 1 },
      { key: 'phaserOffset', min: -1, max: 1, signed: true },
      { key: 'phaserSweep', min: -1, max: 1, signed: true },
    ],
  },
  {
    id: 'filter',
    fields: [
      { key: 'lowPassCutoff', min: 0, max: 1 },
      { key: 'lowPassSweep', min: -1, max: 1, signed: true },
      { key: 'lowPassResonance', min: 0, max: 1 },
      { key: 'highPassCutoff', min: 0, max: 1 },
      { key: 'highPassSweep', min: -1, max: 1, signed: true },
      { key: 'masterVolume', min: 0, max: 1 },
    ],
  },
];
const FOOTSTEP_CONTROL_FIELDS: FootstepSliderKey[] = [
  'footstepHeel',
  'footstepRoll',
  'footstepBall',
  'footstepSwiftness',
];

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isSampleRate(value: unknown): value is SfxSampleRate { return value === 44100 || value === 22050 || value === 11025 || value === 8000; }
function isBitDepth(value: unknown): value is SfxBitDepth { return value === 16 || value === 8; }
function isWaveform(value: unknown): value is SfxWaveform { return value === 'square' || value === 'sawtooth' || value === 'sine' || value === 'noise'; }
function formatPercent(value: number): string { return `${Math.round(value * 100)}%`; }
function formatSignedPercent(value: number): string { return `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`; }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(2)} MB`; }
function formatSampleRateChip(value: SfxSampleRate): string { return value >= 1000 ? `${value / 1000}k` : `${value}`; }
function formatSampleRateMeta(value: SfxSampleRate): string { return value % 1000 === 0 ? `${value / 1000}kHz` : `${(value / 1000).toFixed(2)}kHz`; }
function pad2(value: number): string { return value.toString().padStart(2, '0'); }
function formatHistoryDetail(savedAt: string, t: Translate): string { const date = new Date(savedAt); return Number.isNaN(date.getTime()) ? t('history.unknownTime') : `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`; }
function presetLabel(t: Translate, presetId: SfxPresetId): string { return t(`presets.${presetId}.label`); }
function waveformLabel(t: Translate, waveform: SfxWaveform): string { return t(`waveforms.${waveform}.label`); }
function terrainLabel(t: Translate, terrain: SfxParams['footstepTerrain']): string { return t(`terrain.${terrain}`); }
function getPreviewMeta(params: SfxParams, sampleRate: SfxSampleRate, bitDepth: SfxBitDepth, t: Translate): string {
  return params.engine === 'footsteppr'
    ? t('preview.metaFootstep', { terrain: terrainLabel(t, params.footstepTerrain), rate: formatSampleRateMeta(sampleRate), bitDepth })
    : t('preview.metaWaveform', { waveform: waveformLabel(t, params.waveform), rate: formatSampleRateMeta(sampleRate), bitDepth });
}
function createId(): string { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sfx-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function createDefaultHistoryName(presetId: SfxPresetId | null, savedAt: string, t: Translate): string { const date = new Date(savedAt); const label = presetId ? presetLabel(t, presetId) : t('common.custom'); return `${label} / ${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`; }
function createSnapshotName(presetId: SfxPresetId | null, t: Translate): string { return presetId ? presetLabel(t, presetId) : t('common.custom'); }
function sanitizeFileStem(value: string): string { return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-') || 'afct-sfx'; }
function downloadBlob(blob: Blob, fileName: string): void { const objectUrl = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = objectUrl; link.download = fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
function drawWaveform(canvas: HTMLCanvasElement | null, samples: Float32Array): void {
  if (!canvas) return;
  const width = 720;
  const height = 180;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#050b2e');
  background.addColorStop(1, '#030723');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(37, 197, 249, 0.09)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= width; x += 36) {
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += 36) {
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
  }
  context.stroke();

  context.strokeStyle = 'rgba(206, 87, 193, 0.42)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2 + 0.5);
  context.lineTo(width, height / 2 + 0.5);
  context.stroke();

  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  if (peak > 0) {
    context.save();
    context.strokeStyle = 'rgba(206, 87, 193, 0.35)';
    context.setLineDash([6, 6]);
    for (const value of [peak, -peak]) {
      context.beginPath();
      context.moveTo(0, ((1 - value) * height) / 2);
      context.lineTo(width, ((1 - value) * height) / 2);
      context.stroke();
    }
    context.restore();
  }

  context.save();
  context.strokeStyle = '#25c5f9';
  context.lineWidth = 2;
  context.shadowColor = 'rgba(37, 197, 249, 0.55)';
  context.shadowBlur = 6;
  context.beginPath();
  const samplesPerPixel = Math.max(1, Math.floor(samples.length / width));
  for (let x = 0; x < width; x += 1) {
    const start = x * samplesPerPixel;
    const end = Math.min(samples.length, start + samplesPerPixel);
    let min = 1;
    let max = -1;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    const y1 = ((1 - max) * height) / 2;
    const y2 = ((1 - min) * height) / 2;
    if (x === 0) context.moveTo(x, y1); else context.lineTo(x, y1);
    context.lineTo(x, y2);
  }
  context.stroke();
  context.restore();
}

function parseHistoryItem(value: unknown, t: Translate): SavedSfxHistoryItem | null {
  if (!isRecord(value)) return null;
  const params = clampSfxParams(isRecord(value.params) ? (value.params as Partial<SfxParams>) : DEFAULT_SFX_PARAMS);
  const waveform = isWaveform(value.waveform) ? value.waveform : params.waveform;
  const presetId = isPresetId(value.presetId) ? value.presetId : null;
  const sampleRate = isSampleRate(value.sampleRate) ? value.sampleRate : 44100;
  const bitDepth = isBitDepth(value.bitDepth) ? value.bitDepth : 16;
  const savedAt = typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString();
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : createDefaultHistoryName(presetId, savedAt, t);
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : createId();
  return { id, name, savedAt, presetId, params: { ...params, waveform }, sampleRate, bitDepth, waveform };
}
function loadHistoryFromStorage(t: Translate): SavedSfxHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => parseHistoryItem(value, t)).filter((item): item is SavedSfxHistoryItem => item !== null);
  } catch {
    return [];
  }
}
function saveHistoryToStorage(history: SavedSfxHistoryItem[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)); } catch {}
}
function createHistoryItem(snapshot: Snapshot, t: Translate): SavedSfxHistoryItem {
  const savedAt = new Date().toISOString();
  return { id: createId(), name: createDefaultHistoryName(snapshot.presetId, savedAt, t), savedAt, presetId: snapshot.presetId, params: clampSfxParams(snapshot.params), sampleRate: snapshot.sampleRate, bitDepth: snapshot.bitDepth, waveform: snapshot.waveform };
}
function toSnapshot(item: SavedSfxHistoryItem): Snapshot { return { name: item.name, presetId: item.presetId, params: item.params, sampleRate: item.sampleRate, bitDepth: item.bitDepth, waveform: item.waveform }; }
async function exportSnapshot(format: ExportFormat, snapshot: Snapshot): Promise<Blob> {
  if (format === 'json') return new Blob([serializeSfxParams(snapshot.params)], { type: 'application/json' });
  const rendered = renderSfx(snapshot.params, { sampleRate: snapshot.sampleRate, bitDepth: snapshot.bitDepth });
  if (format === 'wav') return encodeSfxWav(rendered.samples, snapshot.sampleRate, snapshot.bitDepth);
  if (format === 'mp3') return encodeMp3FromSamples(rendered.samples, snapshot.sampleRate);
  return encodeOggFromSamples(rendered.samples, snapshot.sampleRate, snapshot.name);
}
async function exportHistoryArchive(format: ExportFormat, items: SavedSfxHistoryItem[]): Promise<Blob> {
  const zipEntries = await Promise.all(items.map(async (item, index) => {
    const blob = await exportSnapshot(format, toSnapshot(item));
    return {
      name: `${String(index + 1).padStart(2, '0')}-${sanitizeFileStem(item.name)}.${format}`,
      data: new Uint8Array(await new Response(blob).arrayBuffer()),
      lastModified: new Date(item.savedAt),
    };
  }));

  return createZipArchive(zipEntries);
}

function SliderField(props: { label: string; hint: string; value: number; display: string; min: number; max: number; step?: number; onChange: (nextValue: number) => void }) {
  const { label, hint, value, display, min, max, step = 0.01, onChange } = props;
  return (
    <label className="slider-card">
      <div className="slider-card__topline"><span className="slider-card__label">{label}</span><span className="slider-card__value">{display}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <small>{hint}</small>
    </label>
  );
}

function ExportMenu(props: { menuId: string; label: string; triggerText?: string; variant?: 'console' | 'inline'; isOpen: boolean; isExporting: boolean; triggerClassName: string; onToggle: (menuId: string) => void; onExport: (format: ExportFormat) => void }) {
  const { menuId, label, triggerText, variant = 'inline', isOpen, isExporting, triggerClassName, onToggle, onExport } = props;
  const { t } = useI18n();
  return (
    <div className={`export-menu ${isOpen ? 'is-open' : ''}`}>
      <button className={triggerClassName} type="button" aria-haspopup="menu" aria-expanded={isOpen} aria-label={label} disabled={isExporting} onClick={() => onToggle(menuId)}>
        {variant === 'console' ? (
          <>
            <span className="export-menu__copy">
              <span className="export-menu__eyebrow">{isExporting ? t('export.encoding') : t('export.eyebrow')}</span>
              <span className="export-menu__title">{isExporting ? t('export.exporting') : t('export.title')}</span>
            </span>
            <span className="export-menu__caret export-menu__caret--console" aria-hidden="true">▾</span>
          </>
        ) : (
          <>
            <span>{isExporting ? t('export.exporting') : (triggerText ?? t('export.trigger'))}</span>
            <span className="export-menu__caret" aria-hidden="true">▾</span>
          </>
        )}
      </button>
      {isOpen ? (
        <div className="export-menu__list" role="menu" aria-label={t('export.menuLabel', { label })}>
          {EXPORT_FORMATS.map((format) => (
            <button key={format} className="export-menu__item" type="button" role="menuitem" onClick={() => onExport(format)}>{t(`export.${format}`)}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function GameSfxGenerator() {
  const { language, t } = useI18n();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [params, setParams] = useState<SfxParams>(DEFAULT_SFX_PARAMS);
  const [sampleRate, setSampleRate] = useState<SfxSampleRate>(44100);
  const [bitDepth, setBitDepth] = useState<SfxBitDepth>(16);
  const [activePreset, setActivePreset] = useState<SfxPresetId | null>(null);
  const [serialized, setSerialized] = useState(() => serializeSfxParams(DEFAULT_SFX_PARAMS));
  const [status, setStatus] = useState<StatusMessage>({ key: 'status.ready' });
  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<SavedSfxHistoryItem[]>(() => loadHistoryFromStorage(t));
  const [openExportMenu, setOpenExportMenu] = useState<string | null>(null);
  const [exportingMenuId, setExportingMenuId] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingHistoryName, setEditingHistoryName] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<ControlSectionId, boolean>>({ ...DEFAULT_EXPANDED_SECTIONS });

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const autoPreviewTimerRef = useRef<number | null>(null);
  const paramsRef = useRef<SfxParams>(DEFAULT_SFX_PARAMS);

  const rendered = useMemo(() => renderSfx(params, { sampleRate, bitDepth }), [params, sampleRate, bitDepth]);
  const currentSnapshot = useMemo<Snapshot>(() => ({ name: createSnapshotName(activePreset, t), presetId: activePreset, params, sampleRate, bitDepth, waveform: params.waveform }), [activePreset, params, sampleRate, bitDepth, t]);
  const isFootstepMode = params.engine === 'footsteppr';

  useEffect(() => { drawWaveform(waveformCanvasRef.current, rendered.samples); }, [rendered.samples]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { setSerialized(serializeSfxParams(params)); }, [params]);
  useEffect(() => { saveHistoryToStorage(history); }, [history]);
  useEffect(() => () => {
    if (autoPreviewTimerRef.current !== null) window.clearTimeout(autoPreviewTimerRef.current);
    try { sourceRef.current?.stop(); } catch {}
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  const commitParams = (nextValue: SfxParams | ((current: SfxParams) => SfxParams)): void => setParams((current) => clampSfxParams(typeof nextValue === 'function' ? nextValue(current) : nextValue));
  const ensureAudioContext = async (): Promise<AudioContext> => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    return audioContextRef.current;
  };
  const playSnapshot = async (snapshot: Snapshot, message: StatusMessage): Promise<void> => {
    const audioContext = await ensureAudioContext();
    const nextRendered = renderSfx(snapshot.params, { sampleRate: snapshot.sampleRate, bitDepth: snapshot.bitDepth });
    try { sourceRef.current?.stop(); } catch {}
    const buffer = audioContext.createBuffer(1, nextRendered.samples.length, snapshot.sampleRate);
    buffer.getChannelData(0).set(nextRendered.samples);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null;
        setIsPlaying(false);
      }
    };
    source.start();
    sourceRef.current = source;
    setIsPlaying(true);
    setStatus(message);
  };
  const queueAutoPreview = (snapshot: Snapshot, message: StatusMessage, delay = 0): void => {
    if (autoPreviewTimerRef.current !== null) {
      window.clearTimeout(autoPreviewTimerRef.current);
      autoPreviewTimerRef.current = null;
    }

    const runPreview = (): void => {
      void playSnapshot(snapshot, message).catch(() => {
        setStatus({ key: 'status.autoPreviewFailed' });
      });
    };

    if (delay <= 0) {
      runPreview();
      return;
    }

    autoPreviewTimerRef.current = window.setTimeout(() => {
      autoPreviewTimerRef.current = null;
      runPreview();
    }, delay);
  };
  const updateParam = <K extends keyof SfxParams>(key: K, value: SfxParams[K]): void => {
    const nextParams = clampSfxParams({ ...paramsRef.current, engine: 'sfxr', [key]: value });
    setActivePreset(null);
    commitParams(nextParams);
    queueAutoPreview(
      { name: createSnapshotName(null, t), presetId: null, params: nextParams, sampleRate, bitDepth, waveform: nextParams.waveform },
      key === 'waveform' ? { key: 'status.auditionWaveform', vars: { waveform: waveformLabel(t, nextParams.waveform) } } : { key: 'status.auditionTweaked' },
      key === 'waveform' ? 0 : 140,
    );
  };
  const updateFootstepParam = (key: FootstepSliderKey, value: number): void => {
    const nextParams = clampSfxParams({ ...paramsRef.current, engine: 'footsteppr', [key]: value });
    if (activePreset === null || !isFootstepPresetId(activePreset)) {
      setActivePreset(null);
    }
    commitParams(nextParams);
    queueAutoPreview(
      { name: createSnapshotName(activePreset, t), presetId: activePreset, params: nextParams, sampleRate, bitDepth, waveform: nextParams.waveform },
      { key: 'status.auditionFootstep', vars: { terrain: terrainLabel(t, nextParams.footstepTerrain) } },
      120,
    );
  };
  const toggleSection = (sectionId: ControlSectionId): void => setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  const handlePreset = (preset: SfxPresetId): void => {
    const nextParams = createSfxPreset(preset, paramsRef.current);
    commitParams(nextParams);
    setActivePreset(preset);
    setStatus({ key: 'status.presetGenerated', vars: { preset: presetLabel(t, preset) } });
    queueAutoPreview(
      { name: createSnapshotName(preset, t), presetId: preset, params: nextParams, sampleRate, bitDepth, waveform: nextParams.waveform },
      { key: 'status.auditionPreset', vars: { preset: presetLabel(t, preset) } },
    );
  };

  const handlePlayCurrent = async (): Promise<void> => {
    try { await playSnapshot(currentSnapshot, { key: 'status.auditionCurrent' }); }
    catch { setStatus({ key: 'status.playFailed' }); }
  };
  const handlePlayHistory = async (item: SavedSfxHistoryItem): Promise<void> => {
    try { await playSnapshot(toSnapshot(item), { key: 'status.auditionHistory', vars: { name: item.name } }); }
    catch { setStatus({ key: 'status.historyPlayFailed' }); }
  };
  const handleCopyJson = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(serialized);
      setStatus({ key: 'status.jsonCopied' });
    } catch {
      setStatus({ key: 'status.copyFailed' });
    }
  };
  const handleApplyJson = (): void => {
    try {
      const nextParams = deserializeSfxParams(serialized);
      setActivePreset(null);
      commitParams(nextParams);
      setStatus({ key: 'status.jsonApplied' });
    } catch (error) {
      setStatus(error instanceof Error ? { key: 'status.jsonInvalid', vars: { message: error.message } } : { key: 'status.jsonInvalidPlain' });
    }
  };
  const handleJsonChange = (event: ChangeEvent<HTMLTextAreaElement>): void => setSerialized(event.target.value);
  const saveCurrentToHistory = (): void => {
    const nextItem = createHistoryItem(currentSnapshot, t);
    setHistory((current) => [nextItem, ...current]);
    setEditingHistoryId(nextItem.id);
    setEditingHistoryName(nextItem.name);
    setStatus({ key: 'status.historySaved', vars: { name: nextItem.name } });
  };
  const applyHistoryToWorkbench = (item: SavedSfxHistoryItem): void => {
    const nextParams = clampSfxParams({ ...item.params, waveform: item.waveform });
    setParams(nextParams);
    setSampleRate(item.sampleRate);
    setBitDepth(item.bitDepth);
    setActivePreset(item.presetId);
    setSerialized(serializeSfxParams(nextParams));
    setStatus({ key: 'status.historyApplied', vars: { name: item.name } });
    setOpenExportMenu(null);
  };
  const deleteHistoryItem = (item: SavedSfxHistoryItem): void => {
    setHistory((current) => current.filter((entry) => entry.id !== item.id));
    if (editingHistoryId === item.id) {
      setEditingHistoryId(null);
      setEditingHistoryName('');
    }
    if (openExportMenu === `history-${item.id}`) {
      setOpenExportMenu(null);
    }
    setStatus({ key: 'status.historyDeleted', vars: { name: item.name } });
  };
  const commitHistoryRename = (): void => {
    if (!editingHistoryId) return;
    setHistory((current) => current.map((item) => item.id === editingHistoryId ? { ...item, name: editingHistoryName.trim() || item.name } : item));
    setEditingHistoryId(null);
    setEditingHistoryName('');
  };
  const handleHistoryRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') commitHistoryRename();
    if (event.key === 'Escape') { setEditingHistoryId(null); setEditingHistoryName(''); }
  };
  const toggleExportMenu = (menuId: string): void => setOpenExportMenu((current) => current === menuId ? null : menuId);
  const runExport = async (format: ExportFormat, snapshot: Snapshot, menuId: string, source: StatusMessage): Promise<void> => {
    const sourceLabel = t(source.key, source.vars);
    setExportingMenuId(menuId);
    setStatus({ key: 'status.exporting', vars: { source: sourceLabel, format } });
    try {
      const blob = await exportSnapshot(format, snapshot);
      downloadBlob(blob, `${sanitizeFileStem(snapshot.name)}.${format}`);
      setStatus({ key: 'status.exported', vars: { source: sourceLabel, format } });
      setOpenExportMenu(null);
    } catch {
      setStatus({ key: 'status.exportFailed', vars: { format } });
    } finally {
      setExportingMenuId(null);
    }
  };
  const runHistoryArchiveExport = async (format: ExportFormat): Promise<void> => {
    if (history.length === 0) {
      setStatus({ key: 'status.historyEmptyExport' });
      return;
    }

    const menuId = 'history-all';
    setExportingMenuId(menuId);
    setStatus({ key: 'status.zipping', vars: { format } });
    try {
      const blob = await exportHistoryArchive(format, history);
      downloadBlob(blob, `afct-sfx-history-${format}.zip`);
      setStatus({ key: 'status.zipExported', vars: { format } });
      setOpenExportMenu(null);
    } catch {
      setStatus({ key: 'status.zipFailed', vars: { format } });
    } finally {
      setExportingMenuId(null);
    }
  };

  return (
    <section className="workbench-card" aria-label={t('app.workbenchLabel')}>
      <div className="workbench-layout">
        <div className="editor-column">
          <section className="console-surface preset-rack" aria-labelledby="preset-strip-title">
            <div className="panel-head">
              <div><p className="section-kicker">{t('presets.kicker')}</p><h3 id="preset-strip-title">{t('presets.title')}</h3></div>
              <span>{t('presets.description')}</span>
            </div>
            <div className="preset-groups" role="group" aria-label={t('presets.groupsLabel')}>
              {PRESET_CATEGORIES.map((category) => (
                <section className="preset-group" key={category.id} data-preset-group={category.id}>
                  <div className="preset-group__head">
                    <span className="preset-group__label">{t(`presetCategories.${category.id}`)}</span>
                    <span className="preset-group__count">{category.presets.length}</span>
                  </div>
                  <div className="preset-strip" role="toolbar" aria-label={t(`presetCategories.${category.id}`)}>
                    {category.presets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        data-preset-id={preset}
                        aria-pressed={activePreset === preset}
                        className={`preset-button ${preset === 'mutate' ? 'preset-button--mutate' : ''} ${activePreset === preset ? 'is-active' : ''}`}
                        onClick={() => handlePreset(preset)}
                      >
                        <span className="preset-button__glyph" aria-hidden="true">{t(`presets.${preset}.glyph`)}</span>
                        <span className="preset-button__copy"><span className="preset-button__label">{t(`presets.${preset}.label`)}</span><small>{t(`presets.${preset}.detail`)}</small></span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          {isFootstepMode ? (
            <section className="console-surface control-section is-open" aria-labelledby="footstep-controls-title">
              <div className="control-section__toggle">
                <div><p className="section-kicker">{t('sections.footstepKicker')}</p><h3 id="footstep-controls-title">{t('sections.footstepTitle')}</h3><span>{t('sections.footstepDescription')}</span></div>
              </div>
              <div>
                <div className="slider-grid">
                  {FOOTSTEP_CONTROL_FIELDS.map((key) => (
                    <SliderField
                      key={key}
                      label={t(`fields.${key}.label`)}
                      hint={t(`fields.${key}.hint`)}
                      value={params[key]}
                      display={formatPercent(params[key])}
                      min={0}
                      max={1}
                      onChange={(nextValue) => updateFootstepParam(key, nextValue)}
                    />
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="console-surface waveform-bay" aria-labelledby="waveform-panel-title">
                <div className="panel-head">
                  <div><p className="section-kicker">{t('waveforms.kicker')}</p><h3 id="waveform-panel-title">{t('waveforms.title')}</h3></div>
                  <span>{t('waveforms.description')}</span>
                </div>
                <div className="waveform-grid">
                  {WAVEFORM_OPTIONS.map((option) => (
                    <label key={option.value} className={`mode-pill ${params.waveform === option.value ? 'is-active' : ''}`}>
                      <input type="radio" name="sfx-waveform" checked={params.waveform === option.value} aria-label={waveformLabel(t, option.value)} onChange={() => updateParam('waveform', option.value)} />
                      <div className="mode-pill__badge" aria-hidden="true">{option.glyph}</div>
                      <div className="mode-pill__copy"><span className="mode-pill__label">{waveformLabel(t, option.value)}</span><small>{t(`waveforms.${option.value}.detail`)}</small></div>
                    </label>
                  ))}
                </div>
              </section>

              <div className="section-stack">
                {CONTROL_SECTIONS.map((section) => {
                  const expanded = expandedSections[section.id];
                  return (
                    <section key={section.id} className={`console-surface control-section ${expanded ? 'is-open' : ''}`}>
                      <button className="control-section__toggle" type="button" aria-expanded={expanded} aria-controls={`control-section-panel-${section.id}`} onClick={() => toggleSection(section.id)}>
                        <div><p className="section-kicker">{t('sections.kicker')}</p><h3>{t(`sections.${section.id}.title`)}</h3><span>{t(`sections.${section.id}.description`)}</span></div>
                        <span className="control-section__state">{expanded ? t('controls.collapse') : t('controls.expand')}</span>
                      </button>
                      <div id={`control-section-panel-${section.id}`} hidden={!expanded}>
                        <div className="slider-grid">
                          {section.fields.map((field) => {
                            const value = params[field.key];
                            return <SliderField key={field.key} label={t(`fields.${field.key}.label`)} hint={t(`fields.${field.key}.hint`)} value={value} display={field.signed ? formatSignedPercent(value) : formatPercent(value)} min={field.min} max={field.max} step={field.step} onChange={(nextValue) => updateParam(field.key, nextValue)} />;
                          })}
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}

        </div>
        <aside className="preview-column">
          <section className={`console-surface preview-dock ${isPlaying ? 'is-live' : ''}`} aria-labelledby="preview-title">
            <div className="panel-head preview-dock__head">
              <div><p className="section-kicker">{t('preview.kicker')}</p><h3 id="preview-title">{t('preview.title')}</h3></div>
              <span className="preview-dock__meta">{getPreviewMeta(params, sampleRate, bitDepth, t)}</span>
            </div>
            <div className="waveform-frame"><canvas ref={waveformCanvasRef} className="waveform-canvas" role="img" aria-label={t('preview.waveformAria')} /></div>
            <div className="stats-grid">
              <div className="stat-card"><span>{t('preview.stats.duration')}</span><strong>{t('preview.durationValue', { value: rendered.stats.durationSeconds.toFixed(2) })}</strong></div>
              <div className="stat-card"><span>{t('preview.stats.samples')}</span><strong>{rendered.stats.samples.toLocaleString(locale)}</strong></div>
              <div className="stat-card"><span>{t('preview.stats.peak')}</span><strong>{rendered.stats.peak.toFixed(2)}</strong></div>
              <div className="stat-card"><span>{t('preview.stats.clipped')}</span><strong>{rendered.stats.clippedSamples.toLocaleString(locale)}</strong></div>
            </div>
            <div className="preview-options">
              <div className="inline-options">
                <span>{t('preview.sampleRate')}</span>
                <div className="chip-group">
                  {SAMPLE_RATE_OPTIONS.map((option) => (
                    <button key={option} className={`segmented-button ${sampleRate === option ? 'is-active' : ''}`} type="button" onClick={() => setSampleRate(option)}>{formatSampleRateChip(option)}</button>
                  ))}
                </div>
              </div>
              <div className="inline-options">
                <span>{t('preview.bitDepth')}</span>
                <div className="chip-group">
                  {BIT_DEPTH_OPTIONS.map((option) => (
                    <button key={option} className={`segmented-button ${bitDepth === option ? 'is-active' : ''}`} type="button" onClick={() => setBitDepth(option)}>{t('common.bitValue', { value: option })}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="monitor-actions">
              <button className="primary-button play-button" type="button" aria-label={isPlaying ? t('controls.replay') : t('controls.play')} onClick={() => { void handlePlayCurrent(); }}>
                <span className="play-button__icon" aria-hidden="true">{isPlaying ? '↻' : '▶'}</span>
                <span className="play-button__copy"><span className="play-button__label">{isPlaying ? t('controls.replay') : t('controls.play')}</span><small>{isPlaying ? t('controls.replayHint') : t('controls.playHint')}</small></span>
              </button>
              <button className="secondary-button secondary-button--teal save-button" type="button" aria-label={t('controls.saveToHistory')} onClick={saveCurrentToHistory}>{t('controls.saveToHistory')}</button>
              <div className="preview-dock__footer">
                <div className="option-card option-card--monitor"><span>{t('preview.estimatedSize')}</span><strong>{formatBytes(rendered.stats.estimatedByteSize)}</strong></div>
                <ExportMenu menuId="current" label={t('export.currentLabel')} variant="console" isOpen={openExportMenu === 'current'} isExporting={exportingMenuId === 'current'} triggerClassName="export-menu__trigger export-menu__trigger--console" onToggle={toggleExportMenu} onExport={(format) => { void runExport(format, currentSnapshot, 'current', { key: 'status.sourceCurrent' }); }} />
              </div>
            </div>
            <div className={`status-banner ${isPlaying ? 'status-banner--live' : ''}`} role="status">{t(status.key, status.vars)}</div>
          </section>

          <section className="console-surface history-panel" aria-labelledby="history-title">
            <div className="panel-head history-panel__head">
              <div><p className="section-kicker">{t('history.kicker')}</p><h3 id="history-title">{t('history.title')}</h3></div>
              <div className="history-panel__tools">
                <span>{history.length > 0 ? t('history.count', { count: history.length }) : t('history.hint')}</span>
                {history.length > 0 ? (
                  <ExportMenu menuId="history-all" label={t('export.historyAllLabel')} triggerText={t('export.all')} variant="inline" isOpen={openExportMenu === 'history-all'} isExporting={exportingMenuId === 'history-all'} triggerClassName="ghost-button export-menu__trigger export-menu__trigger--inline" onToggle={toggleExportMenu} onExport={(format) => { void runHistoryArchiveExport(format); }} />
                ) : null}
              </div>
            </div>
            {history.length === 0 ? (
              <div className="history-empty" data-testid="history-empty-state"><strong>{t('history.emptyTitle')}</strong><p>{t('history.emptyHint')}</p></div>
            ) : (
              <div className="history-list">
                {history.map((item) => {
                  const isEditing = editingHistoryId === item.id;
                  const menuId = `history-${item.id}`;
                  return (
                    <article key={item.id} className="history-card">
                      <div className="history-card__head">
                        {isEditing ? (
                          <input className="history-card__input" autoFocus aria-label={t('history.renameAria')} value={editingHistoryName} onChange={(event) => setEditingHistoryName(event.target.value)} onBlur={commitHistoryRename} onKeyDown={handleHistoryRenameKeyDown} />
                        ) : (
                          <button className="history-card__title" type="button" onClick={() => { setEditingHistoryId(item.id); setEditingHistoryName(item.name); }}>{item.name}</button>
                        )}
                        <button className="ghost-button history-card__rename" type="button" onClick={() => deleteHistoryItem(item)}>{t('history.delete')}</button>
                      </div>
                      <div className="history-card__meta">{formatHistoryDetail(item.savedAt, t)}</div>
                      <div className="history-card__chips">
                        <span className="history-chip">{item.presetId ? presetLabel(t, item.presetId) : t('common.custom')}</span>
                        <span className="history-chip">{item.params.engine === 'footsteppr' ? terrainLabel(t, item.params.footstepTerrain) : waveformLabel(t, item.waveform)}</span>
                        <span className="history-chip">{formatSampleRateMeta(item.sampleRate)}</span>
                        <span className="history-chip">{t('common.bitValue', { value: item.bitDepth })}</span>
                      </div>
                      <div className="history-card__actions">
                        <button className="ghost-button" type="button" onClick={() => applyHistoryToWorkbench(item)}>{t('history.apply')}</button>
                        <button className="ghost-button" type="button" onClick={() => { void handlePlayHistory(item); }}>{t('history.play')}</button>
                        <ExportMenu menuId={menuId} label={t('export.historyItemLabel', { name: item.name })} variant="inline" isOpen={openExportMenu === menuId} isExporting={exportingMenuId === menuId} triggerClassName="ghost-button export-menu__trigger export-menu__trigger--inline" onToggle={toggleExportMenu} onExport={(format) => { void runExport(format, toSnapshot(item), menuId, { key: 'status.sourceHistory', vars: { name: item.name } }); }} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="console-surface advanced-editor-panel" aria-labelledby="json-panel-title">
            <div className="panel-head">
              <div><p className="section-kicker">{t('advanced.kicker')}</p><h3 id="json-panel-title">{t('json.title')}</h3></div>
              <span>{t('json.description')}</span>
            </div>
            <div className="advanced-editor">
              <textarea id="sfx-json-editor" className="json-editor" aria-label={t('json.editorAria')} value={serialized} onChange={handleJsonChange} />
              <div className="json-actions">
                <button className="ghost-button" type="button" onClick={() => { void handleCopyJson(); }}>{t('json.copy')}</button>
                <button className="ghost-button" type="button" onClick={handleApplyJson}>{t('json.apply')}</button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
