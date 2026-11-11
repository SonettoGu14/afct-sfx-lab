import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, KeyboardEvent } from 'react';
import { encodeMp3FromSamples, encodeOggFromSamples } from '../lib/audioExport';
import { createZipArchive } from '../lib/zip';
import {
  DEFAULT_EXPORT_SETTINGS,
  buildGamePackage,
  type GameExportRequest,
  type SfxExportSettings,
} from '../lib/gameExport';
import { masterForExport } from '../lib/mastering';
import { randomSeed } from '../lib/prng';
import {
  DEFAULT_SFX_PARAMS,
  clampSfxParams,
  createSfxPreset,
  createSfxVariant,
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
const SAMPLE_RATE_OPTIONS: SfxSampleRate[] = [44100, 48000, 22050, 11025, 8000];
const BIT_DEPTH_OPTIONS: SfxBitDepth[] = [16, 8];
const DEFAULT_EXPANDED_SECTIONS = {
  effects: false,
  envelope: true,
  frequency: true,
  modulation: false,
  texture: false,
  filter: false,
} as const;
const EXPORT_FORMATS = ['wav', 'json', 'mp3', 'ogg'] as const;
const EXPORT_SETTINGS_STORAGE_KEY = 'afct-sfx-lab:export-v1';
const PEAK_TARGETS: Array<{ value: number | null; label: TranslationKey }> = [
  { value: null, label: 'export.peakOff' },
  { value: -3, label: 'export.peakMinus3' },
  { value: -6, label: 'export.peakMinus6' },
  { value: -12, label: 'export.peakMinus12' },
];
const VARIANT_COUNT = 5;
const SHARE_HASH_PREFIX = '#s=';
const SHARE_VERSION = 1;

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
type SliderKey = Exclude<{
  [K in keyof SfxParams]: SfxParams[K] extends number ? K : never;
}[keyof SfxParams], 'fxNormalize'>;
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
    id: 'effects',
    fields: [
      { key: 'fxDrive', min: 0, max: 1 },
      { key: 'fxCrushRate', min: 0, max: 1 },
      { key: 'fxCrushBits', min: 0, max: 1 },
      { key: 'fxTone', min: -1, max: 1, signed: true },
      { key: 'fxDelayTime', min: 0, max: 1 },
      { key: 'fxDelayFeedback', min: 0, max: 1 },
      { key: 'fxDelayMix', min: 0, max: 1 },
      { key: 'fxReverbSize', min: 0, max: 1 },
      { key: 'fxReverbMix', min: 0, max: 1 },
    ],
  },
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
function toBase64Url(json: string): string { return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromBase64Url(encoded: string): string | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}
function encodeSharePayload(params: SfxParams, sampleRate: SfxSampleRate, bitDepth: SfxBitDepth): string {
  return toBase64Url(JSON.stringify({ v: SHARE_VERSION, p: params, sr: sampleRate, bd: bitDepth }));
}
function decodeSharePayload(encoded: string): { params: SfxParams; sampleRate: SfxSampleRate; bitDepth: SfxBitDepth } | null {
  const json = fromBase64Url(encoded);
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.v !== SHARE_VERSION) return null;
    if (!isSampleRate(parsed.sr) || !isBitDepth(parsed.bd)) return null;
    if (!isRecord(parsed.p)) return null;
    return { params: clampSfxParams(parsed.p as Partial<SfxParams>), sampleRate: parsed.sr, bitDepth: parsed.bd };
  } catch { return null; }
}
const FX_BYPASS_OVERRIDES: Partial<SfxParams> = {
  fxDrive: 0,
  fxCrushRate: 0,
  fxCrushBits: 0,
  fxTone: 0,
  fxDelayMix: 0,
  fxReverbMix: 0,
  fxNormalize: 0,
};
function bypassFxChain(params: SfxParams): SfxParams { return { ...params, ...FX_BYPASS_OVERRIDES }; }
async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard-unavailable');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    document.body.removeChild(textarea);
    return copied;
  }
}
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
  const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth || 720);
  const height = Math.max(1, canvas.clientHeight || 180);
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

  context.fillStyle = '#101113';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(236, 232, 222, 0.06)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= width; x += 64) {
    context.moveTo(Math.round(x) + 0.5, 0);
    context.lineTo(Math.round(x) + 0.5, height);
  }
  for (let step = 1; step <= 3; step += 1) {
    const y = Math.round((height * step) / 4) + 0.5;
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();

  context.strokeStyle = 'rgba(236, 232, 222, 0.22)';
  context.beginPath();
  context.moveTo(0, Math.round(mid) + 0.5);
  context.lineTo(width, Math.round(mid) + 0.5);
  context.stroke();

  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index] ?? 0);
    if (value > peak) peak = value;
  }
  if (peak <= 0) return;

  const gain = (height * 0.42) / peak;

  context.save();
  context.strokeStyle = 'rgba(211, 64, 29, 0.5)';
  context.setLineDash([5, 5]);
  context.beginPath();
  const guideTop = Math.round(mid - height * 0.42) + 0.5;
  const guideBottom = Math.round(mid + height * 0.42) + 0.5;
  context.moveTo(0, guideTop);
  context.lineTo(width, guideTop);
  context.moveTo(0, guideBottom);
  context.lineTo(width, guideBottom);
  context.stroke();
  context.restore();

  context.fillStyle = 'rgba(236, 232, 222, 0.92)';
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor((x / width) * samples.length);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor(((x + 1) / width) * samples.length)));
    let min = 0;
    let max = 0;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    const top = mid - max * gain;
    const bottom = mid - min * gain;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
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
function loadExportSettings(): SfxExportSettings {
  if (typeof window === 'undefined') return DEFAULT_EXPORT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_EXPORT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SfxExportSettings>;
    return {
      trimSilence: parsed.trimSilence === true,
      targetPeakDb: typeof parsed.targetPeakDb === 'number' ? parsed.targetPeakDb : null,
      namePrefix: typeof parsed.namePrefix === 'string' ? parsed.namePrefix.slice(0, 24) : '',
    };
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}
function saveExportSettings(settings: SfxExportSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXPORT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full storage quota must not block exporting.
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
async function exportSnapshot(
  format: ExportFormat,
  snapshot: Snapshot,
  settings: SfxExportSettings,
): Promise<Blob> {
  if (format === 'json') return new Blob([serializeSfxParams(snapshot.params)], { type: 'application/json' });
  const rendered = renderSfx(snapshot.params, { sampleRate: snapshot.sampleRate, bitDepth: snapshot.bitDepth });
  const samples = masterForExport(rendered.samples, snapshot.sampleRate, {
    trim: settings.trimSilence,
    targetPeakDb: settings.targetPeakDb,
  });
  if (format === 'wav') return encodeSfxWav(samples, snapshot.sampleRate, snapshot.bitDepth);
  if (format === 'mp3') return encodeMp3FromSamples(samples, snapshot.sampleRate);
  return encodeOggFromSamples(samples, snapshot.sampleRate, snapshot.name);
}
async function exportHistoryArchive(
  format: ExportFormat,
  items: SavedSfxHistoryItem[],
  settings: SfxExportSettings,
): Promise<Blob> {
  const zipEntries = await Promise.all(items.map(async (item, index) => {
    const blob = await exportSnapshot(format, toSnapshot(item), settings);
    return {
      name: `${String(index + 1).padStart(2, '0')}-${sanitizeFileStem(item.name)}.${format}`,
      data: new Uint8Array(await new Response(blob).arrayBuffer()),
      lastModified: new Date(item.savedAt),
    };
  }));

  return createZipArchive(zipEntries);
}

function ParamField(props: { label: string; hint: string; value: number; display: string; min: number; max: number; step?: number; onChange: (nextValue: number) => void }) {
  const { label, hint, value, display, min, max, step = 0.01, onChange } = props;
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="param">
      <span className="param__line">
        <span className="param__label">{label}</span>
        <span className="param__value">{display}</span>
      </span>
      <input
        className="param__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small className="param__hint">{hint}</small>
    </label>
  );
}

function ExportMenu(props: { menuId: string; label: string; triggerText?: string; variant?: 'console' | 'inline'; isOpen: boolean; isExporting: boolean; triggerClassName: string; extraItems?: Array<{ label: string; onSelect: () => void }>; onToggle: (menuId: string) => void; onExport: (format: ExportFormat) => void }) {
  const { menuId, label, triggerText, variant = 'inline', isOpen, isExporting, triggerClassName, extraItems = [], onToggle, onExport } = props;
  const { t } = useI18n();
  return (
    <div className={`export-menu ${isOpen ? 'is-open' : ''}`}>
      <button className={triggerClassName} type="button" aria-haspopup="menu" aria-expanded={isOpen} aria-label={label} disabled={isExporting} onClick={() => onToggle(menuId)}>
        <span>{isExporting ? t('export.exporting') : variant === 'console' ? t('export.title') : (triggerText ?? t('export.trigger'))}</span>
        <span className="export-menu__caret" aria-hidden="true">▾</span>
      </button>
      {isOpen ? (
        <div className="export-menu__list" role="menu" aria-label={t('export.menuLabel', { label })}>
          {EXPORT_FORMATS.map((format) => (
            <button key={format} className="export-menu__item" type="button" role="menuitem" onClick={() => onExport(format)}>{t(`export.${format}`)}</button>
          ))}
          {extraItems.map((item) => (
            <button key={item.label} className="export-menu__item" type="button" role="menuitem" onClick={item.onSelect}>{item.label}</button>
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
  const [bypassFx, setBypassFx] = useState(false);
  const [exportSettings, setExportSettings] = useState<SfxExportSettings>(() => loadExportSettings());

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const autoPreviewTimerRef = useRef<number | null>(null);
  const paramsRef = useRef<SfxParams>(DEFAULT_SFX_PARAMS);
  const shareInitRef = useRef(false);

  const previewParams = useMemo<SfxParams>(() => (bypassFx ? bypassFxChain(params) : params), [bypassFx, params]);
  const rendered = useMemo(() => renderSfx(previewParams, { sampleRate, bitDepth }), [previewParams, sampleRate, bitDepth]);
  const currentSnapshot = useMemo<Snapshot>(() => ({ name: createSnapshotName(activePreset, t), presetId: activePreset, params, sampleRate, bitDepth, waveform: params.waveform }), [activePreset, params, sampleRate, bitDepth, t]);
  const isFootstepMode = params.engine === 'footsteppr';

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    drawWaveform(canvas, rendered.samples);
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => drawWaveform(canvas, rendered.samples));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rendered.samples]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { setSerialized(serializeSfxParams(params)); }, [params]);
  useEffect(() => { saveHistoryToStorage(history); }, [history]);
  useEffect(() => { saveExportSettings(exportSettings); }, [exportSettings]);
  useEffect(() => {
    if (shareInitRef.current) return;
    shareInitRef.current = true;
    const hash = window.location.hash;
    if (!hash.startsWith(SHARE_HASH_PREFIX)) return;
    const decoded = decodeSharePayload(hash.slice(SHARE_HASH_PREFIX.length));
    if (!decoded) {
      setStatus({ key: 'status.shareInvalid' });
      return;
    }
    setParams(decoded.params);
    setSampleRate(decoded.sampleRate);
    setBitDepth(decoded.bitDepth);
    setActivePreset(null);
    setStatus({ key: 'status.shareLoaded' });
  }, []);
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
      { name: createSnapshotName(null, t), presetId: null, params: bypassFx ? bypassFxChain(nextParams) : nextParams, sampleRate, bitDepth, waveform: nextParams.waveform },
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
      { name: createSnapshotName(activePreset, t), presetId: activePreset, params: bypassFx ? bypassFxChain(nextParams) : nextParams, sampleRate, bitDepth, waveform: nextParams.waveform },
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
      { name: createSnapshotName(preset, t), presetId: preset, params: bypassFx ? bypassFxChain(nextParams) : nextParams, sampleRate, bitDepth, waveform: nextParams.waveform },
      { key: 'status.auditionPreset', vars: { preset: presetLabel(t, preset) } },
    );
  };

  const toggleNormalizePeak = (): void => { commitParams({ ...paramsRef.current, fxNormalize: paramsRef.current.fxNormalize >= 1 ? 0 : 1 }); };
  const toggleFxBypass = (): void => { setBypassFx((current) => !current); };
  const copyShareLink = async (): Promise<void> => {
    const url = `${window.location.origin}${window.location.pathname}${SHARE_HASH_PREFIX}${encodeSharePayload(paramsRef.current, sampleRate, bitDepth)}`;
    const copied = await copyTextWithFallback(url);
    setStatus({ key: copied ? 'status.shareCopied' : 'status.shareCopyFailed' });
  };

  const handlePlayCurrent = async (): Promise<void> => {
    try { await playSnapshot({ ...currentSnapshot, params: previewParams }, { key: 'status.auditionCurrent' }); }
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
      const blob = await exportSnapshot(format, snapshot, exportSettings);
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
      const blob = await exportHistoryArchive(format, history, exportSettings);
      downloadBlob(blob, `afct-sfx-history-${format}.zip`);
      setStatus({ key: 'status.zipExported', vars: { format } });
      setOpenExportMenu(null);
    } catch {
      setStatus({ key: 'status.zipFailed', vars: { format } });
    } finally {
      setExportingMenuId(null);
    }
  };

  const toExportRequest = (item: SavedSfxHistoryItem, seed: number | null): GameExportRequest => ({
    name: item.name,
    presetId: item.presetId,
    params: item.params,
    sampleRate: item.sampleRate,
    bitDepth: item.bitDepth,
    seed,
  });
  const runGamePackageExport = async (): Promise<void> => {
    if (history.length === 0) {
      setStatus({ key: 'status.historyEmptyExport' });
      return;
    }

    setStatus({ key: 'status.packaging' });
    try {
      const blob = await buildGamePackage(history.map((item) => toExportRequest(item, null)), exportSettings);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `afct-sfx-game-package-${stamp}.zip`);
      setStatus({ key: 'status.packaged', vars: { count: history.length } });
    } catch {
      setStatus({ key: 'status.packageFailed' });
    }
  };
  const runVariantsExport = async (item: SavedSfxHistoryItem): Promise<void> => {
    const baseSeed = randomSeed();
    const requests: GameExportRequest[] = Array.from({ length: VARIANT_COUNT }, (_, index) => {
      const seed = (baseSeed + index) >>> 0;
      return {
        name: `${item.name} v${index + 1}`,
        presetId: item.presetId,
        params: createSfxVariant(item.params, item.presetId, seed),
        sampleRate: item.sampleRate,
        bitDepth: item.bitDepth,
        seed,
      };
    });

    setStatus({ key: 'status.packaging' });
    try {
      const blob = await buildGamePackage(requests, exportSettings);
      downloadBlob(blob, `afct-sfx-variants-${sanitizeFileStem(item.name)}.zip`);
      setStatus({ key: 'status.variantsPackaged', vars: { count: VARIANT_COUNT, name: item.name } });
    } catch {
      setStatus({ key: 'status.packageFailed' });
    }
  };

  return (
    <section className="workbench" aria-label={t('app.workbenchLabel')}>
      <section className={`monitor${isPlaying ? ' is-live' : ''}`} aria-labelledby="preview-title">
        <header className="monitor__bar">
          <h2 id="preview-title" className="monitor__title">{t('preview.title')}</h2>
          <span className="monitor__meta">{getPreviewMeta(params, sampleRate, bitDepth, t)}</span>
          <span className="monitor__lamp" aria-hidden="true" />
        </header>

        <div className="monitor__scope">
          <canvas ref={waveformCanvasRef} className="monitor__canvas" role="img" aria-label={t('preview.waveformAria')} />
          <span className="monitor__axis monitor__axis--start" aria-hidden="true">0.00s</span>
          <span className="monitor__axis monitor__axis--end" aria-hidden="true">{rendered.stats.durationSeconds.toFixed(2)}s</span>
        </div>

        <dl className="readout">
          <div className="readout__cell">
            <dt>{t('preview.stats.duration')}</dt>
            <dd>{t('preview.durationValue', { value: rendered.stats.durationSeconds.toFixed(2) })}</dd>
          </div>
          <div className="readout__cell">
            <dt>{t('preview.stats.samples')}</dt>
            <dd>{rendered.stats.samples.toLocaleString(locale)}</dd>
          </div>
          <div className="readout__cell">
            <dt>{t('preview.stats.peak')}</dt>
            <dd>{rendered.stats.peak.toFixed(2)}</dd>
          </div>
          <div className="readout__cell">
            <dt>{t('preview.stats.clipped')}</dt>
            <dd className={rendered.stats.clippedSamples > 0 ? 'is-warn' : undefined}>{rendered.stats.clippedSamples.toLocaleString(locale)}</dd>
          </div>
          <div className="readout__cell">
            <dt>{t('preview.estimatedSize')}</dt>
            <dd>{formatBytes(rendered.stats.estimatedByteSize)}</dd>
          </div>
        </dl>

        <div className="deck">
          <div className="deck__group deck__group--transport">
            <button className="btn btn--ink btn--play" type="button" aria-label={isPlaying ? t('controls.replay') : t('controls.play')} onClick={() => { void handlePlayCurrent(); }}>
              <span className="btn__icon" aria-hidden="true">{isPlaying ? '↻' : '▶'}</span>
              <span>{isPlaying ? t('controls.replay') : t('controls.play')}</span>
            </button>
            <button className="btn btn--ghost" type="button" aria-label={t('controls.saveToHistory')} onClick={saveCurrentToHistory}>{t('controls.saveToHistory')}</button>
          </div>

          <div className="deck__group deck__group--format">
            <div className="field-inline">
              <span className="field-inline__label">{t('preview.sampleRate')}</span>
              <div className="segmented" role="group" aria-label={t('preview.sampleRate')}>
                {SAMPLE_RATE_OPTIONS.map((option) => (
                  <button key={option} className={`segmented__btn${sampleRate === option ? ' is-active' : ''}`} type="button" aria-pressed={sampleRate === option} onClick={() => setSampleRate(option)}>{formatSampleRateChip(option)}</button>
                ))}
              </div>
            </div>
            <div className="field-inline">
              <span className="field-inline__label">{t('preview.bitDepth')}</span>
              <div className="segmented" role="group" aria-label={t('preview.bitDepth')}>
                {BIT_DEPTH_OPTIONS.map((option) => (
                  <button key={option} className={`segmented__btn${bitDepth === option ? ' is-active' : ''}`} type="button" aria-pressed={bitDepth === option} onClick={() => setBitDepth(option)}>{t('common.bitValue', { value: option })}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="deck__group deck__group--output">
            <ExportMenu menuId="current" label={t('export.currentLabel')} variant="console" isOpen={openExportMenu === 'current'} isExporting={exportingMenuId === 'current'} triggerClassName="btn btn--ghost export-menu__trigger export-menu__trigger--console" onToggle={toggleExportMenu} onExport={(format) => { void runExport(format, currentSnapshot, 'current', { key: 'status.sourceCurrent' }); }} />
          </div>
        </div>

        <div className="master">
          <span className="master__label">{t('export.masterLabel')}</span>
          <label className="master__check">
            <input
              type="checkbox"
              checked={exportSettings.trimSilence}
              onChange={(event) => setExportSettings({ ...exportSettings, trimSilence: event.target.checked })}
            />
            <span>{t('export.trim')}</span>
          </label>
          <label className="master__field">
            <span className="master__field-label">{t('export.peak')}</span>
            <select
              value={exportSettings.targetPeakDb === null ? 'off' : String(exportSettings.targetPeakDb)}
              onChange={(event) => setExportSettings({ ...exportSettings, targetPeakDb: event.target.value === 'off' ? null : Number(event.target.value) })}
            >
              {PEAK_TARGETS.map((option) => (
                <option key={String(option.value)} value={option.value === null ? 'off' : String(option.value)}>{t(option.label)}</option>
              ))}
            </select>
          </label>
          <label className="master__field">
            <span className="master__field-label">{t('export.prefix')}</span>
            <input
              type="text"
              maxLength={24}
              value={exportSettings.namePrefix}
              placeholder={t('export.prefixPlaceholder')}
              onChange={(event) => setExportSettings({ ...exportSettings, namePrefix: event.target.value })}
            />
          </label>
        </div>

        <p className={`status${isPlaying ? ' is-live' : ''}`} role="status">{bypassFx ? t('status.fxBypassed') : t(status.key, status.vars)}</p>
      </section>

      <section className="cue-sheet" aria-labelledby="preset-strip-title">
        <header className="sheet-head">
          <h2 id="preset-strip-title">{t('presets.title')}</h2>
          <p>{t('presets.description')}</p>
        </header>

        <div className="cue-columns" role="group" aria-label={t('presets.groupsLabel')}>
          {PRESET_CATEGORIES.map((category) => (
            <section className="cue-column" key={category.id} data-preset-group={category.id}>
              <header className="cue-column__head">
                <h3>{t(`presetCategories.${category.id}`)}</h3>
                <span>{category.presets.length}</span>
              </header>
              <div className="cue-list" role="toolbar" aria-label={t(`presetCategories.${category.id}`)}>
                {category.presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    data-preset-id={preset}
                    aria-pressed={activePreset === preset}
                    className={`cue ${preset === 'mutate' ? 'cue--mutate' : ''} ${activePreset === preset ? 'is-active' : ''}`}
                    onClick={() => handlePreset(preset)}
                  >
                    <span className="cue__glyph" aria-hidden="true">{t(`presets.${preset}.glyph`)}</span>
                    <span className="cue__text">
                      <span className="cue__label">{t(`presets.${preset}.label`)}</span>
                      <small>{t(`presets.${preset}.detail`)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="params" aria-label={isFootstepMode ? t('sections.footstepTitle') : t('waveforms.title')}>
        {isFootstepMode ? (
          <section className="group">
            <div className="group__toggle group__toggle--static">
              <span className="group__title">{t('sections.footstepTitle')}</span>
              <span className="group__hint">{t('sections.footstepDescription')}</span>
            </div>
            <div className="group__body">
              <div className="param-grid">
                {FOOTSTEP_CONTROL_FIELDS.map((key) => (
                  <ParamField key={key} label={t(`fields.${key}.label`)} hint={t(`fields.${key}.hint`)} value={params[key]} display={formatPercent(params[key])} min={0} max={1} onChange={(nextValue) => updateFootstepParam(key, nextValue)} />
                ))}
              </div>
            </div>
          </section>
        ) : (
          <>
            <header className="sheet-head">
              <h2 id="waveform-panel-title">{t('waveforms.title')}</h2>
              <p>{t('waveforms.description')}</p>
            </header>

            <div className="wave-picker">
              {WAVEFORM_OPTIONS.map((option) => (
                <label key={option.value} className={`wave-option ${params.waveform === option.value ? 'is-active' : ''}`}>
                  <input type="radio" name="sfx-waveform" checked={params.waveform === option.value} aria-label={waveformLabel(t, option.value)} onChange={() => updateParam('waveform', option.value)} />
                  <span className="wave-option__glyph" aria-hidden="true">{option.glyph}</span>
                  <span className="wave-option__label">{waveformLabel(t, option.value)}</span>
                  <small className="wave-option__hint">{t(`waveforms.${option.value}.detail`)}</small>
                </label>
              ))}
            </div>

            <div className="group-stack">
              {CONTROL_SECTIONS.map((section) => {
                const expanded = expandedSections[section.id];
                return (
                  <section className="group" key={section.id}>
                    <button className="group__toggle" type="button" aria-expanded={expanded} aria-controls={`control-section-panel-${section.id}`} onClick={() => toggleSection(section.id)}>
                      <span className="group__title">{t(`sections.${section.id}.title`)}</span>
                      <span className="group__hint">{t(`sections.${section.id}.description`)}</span>
                      <span className="group__mark" aria-hidden="true">{expanded ? '−' : '+'}</span>
                    </button>
                    <div id={`control-section-panel-${section.id}`} className="group__body" hidden={!expanded}>
                      <div className="param-grid">
                        {section.fields.map((field) => {
                          const value = params[field.key];
                          return <ParamField key={field.key} label={t(`fields.${field.key}.label`)} hint={t(`fields.${field.key}.hint`)} value={value} display={field.signed ? formatSignedPercent(value) : formatPercent(value)} min={field.min} max={field.max} step={field.step} onChange={(nextValue) => updateParam(field.key, nextValue)} />;
                        })}
                      </div>
                      {section.id === 'effects' ? (
                        <div className="fx-row">
                          <button type="button" className={`fx-action${params.fxNormalize === 1 ? ' is-active' : ''}`} aria-pressed={params.fxNormalize === 1} onClick={toggleNormalizePeak}>
                            <span className="fx-action__mark" aria-hidden="true" />
                            <span className="fx-action__text"><span className="fx-action__label">{t('effects.normalize.label')}</span><small>{t('effects.normalize.hint')}</small></span>
                          </button>
                          <button type="button" className={`fx-action${bypassFx ? ' is-active' : ''}`} aria-pressed={bypassFx} onClick={toggleFxBypass}>
                            <span className="fx-action__mark" aria-hidden="true" />
                            <span className="fx-action__text"><span className="fx-action__label">{t('effects.bypass')}</span><small>{t('effects.bypassHint')}</small></span>
                          </button>
                          <button type="button" className="fx-action fx-action--action" onClick={() => { void copyShareLink(); }}>
                            <span className="fx-action__mark" aria-hidden="true" />
                            <span className="fx-action__text"><span className="fx-action__label">{t('effects.share')}</span><small>{t('effects.shareHint')}</small></span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="lower">
        <section className="takes" aria-labelledby="history-title">
          <header className="sheet-head sheet-head--row">
            <div>
              <h2 id="history-title">{t('history.title')}</h2>
              <p>{history.length > 0 ? t('history.count', { count: history.length }) : t('history.hint')}</p>
            </div>
            {history.length > 0 ? (
              <div className="sheet-head__actions">
                <button className="btn btn--quiet btn--sm" type="button" onClick={() => { void runGamePackageExport(); }}>{t('export.gamePackage')}</button>
                <ExportMenu menuId="history-all" label={t('export.historyAllLabel')} triggerText={t('export.all')} variant="inline" isOpen={openExportMenu === 'history-all'} isExporting={exportingMenuId === 'history-all'} triggerClassName="btn btn--quiet btn--sm export-menu__trigger export-menu__trigger--inline" onToggle={toggleExportMenu} onExport={(format) => { void runHistoryArchiveExport(format); }} />
              </div>
            ) : null}
          </header>

          {history.length === 0 ? (
            <div className="takes__empty" data-testid="history-empty-state">
              <strong>{t('history.emptyTitle')}</strong>
              <p>{t('history.emptyHint')}</p>
            </div>
          ) : (
            <ol className="takes__list">
              {history.map((item, index) => {
                const isEditing = editingHistoryId === item.id;
                const menuId = `history-${item.id}`;
                return (
                  <li className="take" key={item.id}>
                    <span className="take__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <div className="take__id">
                      {isEditing ? (
                        <input className="take__input" autoFocus aria-label={t('history.renameAria')} value={editingHistoryName} onChange={(event) => setEditingHistoryName(event.target.value)} onBlur={commitHistoryRename} onKeyDown={handleHistoryRenameKeyDown} />
                      ) : (
                        <button className="take__name" type="button" onClick={() => { setEditingHistoryId(item.id); setEditingHistoryName(item.name); }}>{item.name}</button>
                      )}
                      <span className="take__time">{formatHistoryDetail(item.savedAt, t)}</span>
                    </div>
                    <div className="take__tags">
                      <span className="take__tag">{item.presetId ? presetLabel(t, item.presetId) : t('common.custom')}</span>
                      <span className="take__tag">{item.params.engine === 'footsteppr' ? terrainLabel(t, item.params.footstepTerrain) : waveformLabel(t, item.waveform)}</span>
                      <span className="take__tag">{formatSampleRateMeta(item.sampleRate)}</span>
                      <span className="take__tag">{t('common.bitValue', { value: item.bitDepth })}</span>
                    </div>
                    <div className="take__actions">
                      <button className="btn btn--quiet btn--sm" type="button" onClick={() => applyHistoryToWorkbench(item)}>{t('history.apply')}</button>
                      <button className="btn btn--quiet btn--sm" type="button" onClick={() => { void handlePlayHistory(item); }}>{t('history.play')}</button>
                      <ExportMenu menuId={menuId} label={t('export.historyItemLabel', { name: item.name })} variant="inline" isOpen={openExportMenu === menuId} isExporting={exportingMenuId === menuId} triggerClassName="btn btn--quiet btn--sm export-menu__trigger export-menu__trigger--inline" extraItems={[{ label: t('export.variants'), onSelect: () => { setOpenExportMenu(null); void runVariantsExport(item); } }]} onToggle={toggleExportMenu} onExport={(format) => { void runExport(format, toSnapshot(item), menuId, { key: 'status.sourceHistory', vars: { name: item.name } }); }} />
                      <button className="btn btn--quiet btn--sm" type="button" onClick={() => deleteHistoryItem(item)}>{t('history.delete')}</button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="json-panel" aria-labelledby="json-panel-title">
          <header className="sheet-head">
            <h2 id="json-panel-title">{t('json.title')}</h2>
            <p>{t('json.description')}</p>
          </header>
          <textarea id="sfx-json-editor" className="json-panel__editor" aria-label={t('json.editorAria')} value={serialized} onChange={handleJsonChange} />
          <div className="json-panel__actions">
            <button className="btn btn--quiet btn--sm" type="button" onClick={() => { void handleCopyJson(); }}>{t('json.copy')}</button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={handleApplyJson}>{t('json.apply')}</button>
          </div>
        </section>
      </div>
    </section>
  );
}
