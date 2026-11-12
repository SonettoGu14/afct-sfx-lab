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

class MockBufferSource {
  buffer: AudioBuffer | null = null;
  loop = false;
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
  currentTime = 0;

  createBuffer(_channels: number, length: number): AudioBuffer {
    return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
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
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: MockAudioContext });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: anchorClick });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  localStorage.clear();
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

  it('adds and removes a note by clicking the grid', async () => {
    renderWorkbench();
    await waitForNotes(154);
    const cell = screen.getByTestId('roll-cell-lead-83-0');
    fireEvent.click(cell);
    await waitForNotes(155);
    fireEvent.click(screen.getByTestId('roll-cell-lead-83-0'));
    await waitForNotes(154);
  });

  it('uses the brush length for new notes', async () => {
    renderWorkbench();
    await waitForNotes(154);
    fireEvent.change(screen.getByTestId('music-brush'), { target: { value: '1_4' } });
    fireEvent.click(screen.getByTestId('roll-cell-lead-83-0'));
    await waitForNotes(155);
    const widths = screen.getAllByTestId('music-note').map((note) => note.style.width);
    expect(widths).toContain('54px');
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
