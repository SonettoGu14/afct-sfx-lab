import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import GameSfxGenerator from './GameSfxGenerator';
import { LanguageProvider, STORAGE_KEY } from '../i18n';
import { zh } from '../i18n/zh';

const HISTORY_STORAGE_KEY = 'afct-sfx-lab:history-v1';
const writeText = vi.fn().mockResolvedValue(undefined);
const createObjectUrl = vi.fn(() => 'blob:test');
const revokeObjectUrl = vi.fn();
const anchorClick = vi.fn();
const originalClipboard = navigator.clipboard;
const originalAudioContext = globalThis.AudioContext;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

class MockBufferSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;

  connect(): void {}

  start(): void {}

  stop(): void {
    this.onended?.();
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;

  createBuffer(_channels: number, length: number): AudioBuffer {
    return {
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    return new MockBufferSource() as unknown as AudioBufferSourceNode;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText,
    },
  });

  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: MockAudioContext,
  });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  });

  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    value: anchorClick,
  });

  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  localStorage.clear();
  writeText.mockClear();
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  anchorClick.mockClear();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });

  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: originalAudioContext,
  });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectURL,
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectURL,
  });

  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    value: originalAnchorClick,
  });

  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function renderWorkbench() {
  return render(
    <LanguageProvider>
      <GameSfxGenerator />
    </LanguageProvider>,
  );
}

function renderApp() {
  return render(
    <LanguageProvider>
      <App />
    </LanguageProvider>,
  );
}

describe('GameSfxGenerator', () => {
  it('renders the workbench in English with preview, history and default section states', () => {
    renderWorkbench();

    expect(screen.getByRole('heading', { name: 'Preview' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Generation history' })).not.toBeNull();
    expect(screen.getByTestId('history-empty-state')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Default sound loaded');

    expect(screen.getByRole('button', { name: /Envelope/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Frequency/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Modulation/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Texture/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Filter/ }).getAttribute('aria-expanded')).toBe('false');

    expect(screen.getByRole('button', { name: 'Play sound' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save to history' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Current sound export' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Copy JSON' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Apply JSON' })).not.toBeNull();
  });

  it('renders all 28 presets in 5 category groups without authored Chinese copy', () => {
    const { container } = renderWorkbench();

    const groups = container.querySelectorAll('[data-preset-group]');
    expect(groups).toHaveLength(5);

    const counts = Array.from(groups).map((group) => ({
      id: group.getAttribute('data-preset-group'),
      count: group.querySelectorAll('[data-preset-id]').length,
    }));
    expect(counts).toEqual([
      { id: 'ui', count: 6 },
      { id: 'action', count: 6 },
      { id: 'cinematic', count: 6 },
      { id: 'footstep', count: 8 },
      { id: 'utility', count: 2 },
    ]);

    expect(container.querySelectorAll('[data-preset-id]')).toHaveLength(28);
    expect(screen.getByText('Snow Step')).not.toBeNull();
    expect(screen.getByText('Footsteps')).not.toBeNull();
    expect(container.textContent?.match(/[\u4e00-\u9fff]/)).toBeNull();
  });

  it('saves history into localStorage and loads it back after rerender', async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole('button', { name: 'Save to history' }));

    const storedRaw = localStorage.getItem(HISTORY_STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw ?? '[]') as Array<{ name: string }>;
    expect(stored).toHaveLength(1);

    cleanup();
    renderWorkbench();

    expect(screen.queryByTestId('history-empty-state')).toBeNull();
    expect(screen.getByText(stored[0]?.name ?? '')).not.toBeNull();
  });

  it('plays history without overwriting the current workbench and can apply it back', async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByLabelText('Noise'));
    await user.click(screen.getByRole('button', { name: '8k' }));
    await user.click(screen.getByRole('button', { name: 'Save to history' }));
    await user.keyboard('{Enter}');

    await user.click(screen.getByLabelText('Sine'));
    expect((screen.getByLabelText('Sine') as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('status').textContent).toContain('Auditioning history');
    expect((screen.getByLabelText('Sine') as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('status').textContent).toContain('Applied back to the workbench');
    expect((screen.getByLabelText('Noise') as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByText(/8kHz/).length).toBeGreaterThan(0);
  });

  it('opens export menus for the current snapshot and bulk history export', async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole('button', { name: 'Current sound export' }));
    expect(screen.getByRole('menuitem', { name: 'Download .wav' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download .json' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download .mp3' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download .ogg' })).not.toBeNull();

    await user.click(screen.getByRole('menuitem', { name: 'Download .json' }));
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalled());
    expect(anchorClick).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save to history' }));
    await user.keyboard('{Enter}');

    await user.click(screen.getByRole('button', { name: 'Export all history' }));
    expect(screen.getByRole('menuitem', { name: 'Download .wav' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download .json' })).not.toBeNull();
  });

  it('shows bulk history export and downloads a zip package', async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole('button', { name: 'Save to history' }));
    await user.keyboard('{Enter}');

    await user.click(screen.getByRole('button', { name: 'Export all history' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download .json' }));

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalled());
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toContain('ZIP');
  });

  it('still renders per-item export controls inside history cards', async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole('button', { name: 'Save to history' }));
    await user.keyboard('{Enter}');

    const historySection = screen.getByRole('region', { name: 'Generation history' });
    const historyButtons = within(historySection).getAllByRole('button');
    expect(historyButtons.some((button) => button.getAttribute('aria-label')?.endsWith('export'))).toBe(true);
  });
});

describe('language switching', () => {
  it('defaults to English and switches the whole UI to Chinese, persisting the choice', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'AFCT SFX Lab' })).not.toBeNull();
    expect(screen.getByText('XJTLU · Academy of Film and Creative Technology')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Preview' })).not.toBeNull();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await user.click(screen.getByRole('button', { name: '中文' }));

    expect(screen.getByText(zh['hero.department'])).not.toBeNull();
    expect(screen.getByRole('heading', { name: zh['preview.title'] })).not.toBeNull();
    expect(screen.getByText(zh['presets.pickupCoin.label'])).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(screen.getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the Chinese locale after a reload', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByRole('heading', { name: zh['preview.title'] })).not.toBeNull();

    cleanup();
    renderApp();

    expect(screen.getByRole('heading', { name: zh['preview.title'] })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Preview' })).toBeNull();
    expect(document.documentElement.lang).toBe('zh');
  });
});
