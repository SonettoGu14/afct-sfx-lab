import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { LanguageProvider } from '../i18n';
import MusicWorkbench from './MusicWorkbench';

const SCORE_STORAGE_KEY = 'afct-sfx-lab:score-v1';
const createObjectUrl = vi.fn(() => 'blob:test');
const revokeObjectUrl = vi.fn();
const anchorClick = vi.fn();
const originalAudioContext = globalThis.AudioContext;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

let lastSource: MockBufferSource | null = null;

class MockBufferSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  lastStart: { when?: number; offset?: number } | null = null;

  connect(): void {}

  start(when?: number, offset?: number): void {
    this.lastStart = { when, offset };
  }

  stop(): void {
    this.onended?.();
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  currentTime = 0;

  createBuffer(_channels: number, length: number): AudioBuffer {
    return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new MockBufferSource();
    lastSource = source;
    return source as unknown as AudioBufferSourceNode;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: MockAudioContext });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: anchorClick });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  localStorage.clear();
  lastSource = null;
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  anchorClick.mockClear();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: originalAudioContext });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: originalAnchorClick });
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function renderWorkbench() {
  return render(
    <LanguageProvider>
      <MusicWorkbench />
    </LanguageProvider>,
  );
}

function paintOnce(cell: HTMLElement): void {
  fireEvent.pointerDown(cell, { button: 0 });
  fireEvent.pointerUp(window);
}

function paintDrag(from: HTMLElement, to: HTMLElement): void {
  fireEvent.pointerDown(from, { button: 0 });
  fireEvent.pointerMove(to);
  fireEvent.pointerUp(window);
}

async function waitForNotes(count: number): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('music-notes').textContent).toContain(String(count));
  }, { timeout: 5000 });
}

describe('MusicWorkbench', () => {
  it('loads the demo loop with exact stats', async () => {
    renderWorkbench();
    await waitForNotes(154);
    expect(screen.getByTestId('music-duration').textContent).toContain('17.45');
    expect(screen.getByTestId('music-grid-size').textContent).toContain('8 × 16');
  });

  it('shows all four tracks in one roll with per-track colours', async () => {
    renderWorkbench();
    await waitForNotes(154);
    expect(screen.getByTestId('roll-section-lead')).toBeTruthy();
    expect(screen.getByTestId('roll-section-bass')).toBeTruthy();
    expect(screen.getByTestId('roll-section-chords')).toBeTruthy();
    expect(screen.getByTestId('roll-section-drums')).toBeTruthy();
    const colours = new Set(screen.getAllByTestId('music-note').map((note) => note.style.background));
    expect(colours.size).toBe(4);
  });

  it('edits the track you click without switching first', async () => {
    renderWorkbench();
    await waitForNotes(154);
    paintOnce(screen.getByTestId('roll-cell-bass-59-0'));
    await waitForNotes(155);
    expect(screen.getByTestId('track-row-bass').className).toContain('is-active');
  });

  it('adds and removes a note by clicking the grid', async () => {
    renderWorkbench();
    await waitForNotes(154);
    const cell = screen.getByTestId('roll-cell-lead-83-0');
    paintOnce(cell);
    await waitForNotes(155);
    paintOnce(screen.getByTestId('roll-cell-lead-83-0'));
    await waitForNotes(154);
  });

  it('draws a note by dragging across cells', async () => {
    renderWorkbench();
    await waitForNotes(154);
    paintDrag(
      screen.getByTestId('roll-cell-lead-83-0'),
      screen.getByTestId('roll-cell-lead-83-7'),
    );
    await waitForNotes(155);
    const widths = screen.getAllByTestId('music-note').map((note) => note.style.width);
    expect(widths).toContain('110px');
  });

  it('switches the time signature and resizes the grid', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.change(screen.getByTestId('music-signature'), { target: { value: '3/4' } });
    await waitFor(() => {
      expect(screen.getByTestId('music-grid-size').textContent).toContain('8 × 12');
      expect(screen.getByTestId('music-duration').textContent).toContain('13.09');
    }, { timeout: 5000 });
    expect(screen.getByTestId('roll-cell-lead-60-95')).toBeTruthy();
  });

  it('mutes a track and re-renders the loop', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.click(screen.getByTestId('track-mute-lead'));
    await waitForNotes(128);
  });

  it('starts and stops the loop', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.click(screen.getByTestId('music-play'));
    await waitFor(() => {
      expect(screen.getByTestId('music-play').className).toContain('is-active');
    });
    expect(screen.getByTestId('music-stop').hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByTestId('music-stop'));
    await waitFor(() => {
      expect(screen.getByTestId('music-play').className).not.toContain('is-active');
    });
  });

  it('exports a WAV via the anchor download path', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.click(screen.getByTestId('music-export-wav'));
    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalled();
      expect(createObjectUrl).toHaveBeenCalled();
    });
  });

  it('drops notes that fall outside a shorter loop', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.change(screen.getByTestId('music-bars'), { target: { value: '4' } });
    await waitFor(() => {
      expect(screen.getByTestId('music-notes').textContent).not.toContain('154');
    }, { timeout: 5000 });
    expect(screen.getByRole('status').textContent).toContain('removed');
  });

  it('falls back to the demo when stored JSON is broken', async () => {
    localStorage.setItem(SCORE_STORAGE_KEY, '{broken');
    renderWorkbench();
    await waitForNotes(154);
  });

  it('renders the arrangement overview with four lanes and clips', async () => {
    renderWorkbench();
    await waitForNotes(154);
    expect(screen.getByTestId('music-overview')).toBeTruthy();
    for (const track of ['lead', 'bass', 'chords', 'drums']) {
      expect(screen.getByTestId(`overview-lane-${track}`)).toBeTruthy();
    }
    expect(screen.getAllByTestId('overview-clip').length).toBeGreaterThan(0);
    expect(screen.getByTestId('music-overview-wave')).toBeTruthy();
    expect(screen.getAllByTestId('overview-tick')).toHaveLength(8);
    expect(screen.getAllByTestId('overview-note')).toHaveLength(154);
  });

  it('seeks from the overview and moves both playheads', async () => {
    renderWorkbench();
    await waitForNotes(154);
    const lanes = document.querySelector('.arrangement__lanes') as HTMLElement;
    vi.spyOn(lanes, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);
    fireEvent.click(lanes, { clientX: 150 });
    expect(screen.getByTestId('music-overview-playhead').style.left).toBe('50%');
    expect(screen.getByTestId('music-playhead').style.left).toBe('50%');
  });

  it('starts playback from the sought position', async () => {
    renderWorkbench();
    await waitForNotes(154);
    const lanes = document.querySelector('.arrangement__lanes') as HTMLElement;
    vi.spyOn(lanes, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);
    fireEvent.click(lanes, { clientX: 150 });
    expect(lastSource).toBeNull();
    fireEvent.click(screen.getByTestId('music-play'));
    await waitFor(() => {
      expect(lastSource?.lastStart).toBeTruthy();
    });
    expect(lastSource?.lastStart?.offset).toBeCloseTo(17.4545 / 2, 1);
    expect(screen.getByTestId('music-overview-playhead').style.left).toBe('50%');
  });

  it('dims overview clips when a track is muted', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.click(screen.getByTestId('track-mute-lead'));
    await waitForNotes(128);
    const lead = screen.getByTestId('overview-lane-lead');
    expect(lead.querySelectorAll('.arrangement__clip.is-muted').length).toBeGreaterThan(0);
    expect(lead.querySelectorAll('.arrangement__note.is-muted').length).toBeGreaterThan(0);
  });

  it('keeps the overview usable on an empty score', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.click(screen.getByTestId('music-clear'));
    await waitFor(() => {
      expect(screen.queryAllByTestId('overview-clip')).toHaveLength(0);
    });
    expect(screen.getByTestId('music-overview')).toBeTruthy();
    fireEvent.click(document.querySelector('.arrangement__lanes') as HTMLElement);
  });

  it('switches modes from the masthead', async () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Music' }));
    await waitForNotes(154);
    expect(localStorage.getItem('afct-sfx-lab:mode-v1')).toBe('music');
    fireEvent.click(screen.getByRole('button', { name: 'SFX' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'SFX' }).getAttribute('aria-pressed')).toBe('true');
    });
  });
});
