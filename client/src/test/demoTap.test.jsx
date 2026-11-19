import { act, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../api/config.js';
import { useDemoTap } from '../features/visit/useDemoTap.js';
import { captureDemoKey, getDemoKey } from '../lib/demoTap.js';
import { db, pid } from '../mocks/db.js';
import VisitRecordingPage from '../pages/VisitRecordingPage.jsx';
import { renderWithProviders } from './utils.jsx';

/** Stands in for the browser's EventSource so tests can push server-sent events by hand. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = FakeEventSource.CONNECTING;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  // test helpers
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  tap(rfid_id) {
    const event = { data: JSON.stringify({ rfid_id, at: new Date().toISOString() }) };
    (this.listeners.tap ?? []).forEach((fn) => fn(event));
  }
  fail(readyState) {
    this.readyState = readyState;
    this.onerror?.();
  }
}
const latest = () => FakeEventSource.instances.at(-1);

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('demo key capture', () => {
  it('stores ?demo=<key> for the tab and removes it from the address bar', () => {
    window.history.replaceState(null, '', '/visit?demo=sekret-key-123&x=1#top');
    captureDemoKey();
    expect(getDemoKey()).toBe('sekret-key-123');
    expect(window.location.search).toBe('?x=1'); // other parameters survive
    expect(window.location.hash).toBe('#top');
    expect(window.location.href).not.toContain('sekret');
  });

  it('leaves everything alone when there is no ?demo parameter', () => {
    window.history.replaceState(null, '', '/visit?x=1');
    captureDemoKey();
    expect(getDemoKey()).toBeNull();
    expect(window.location.search).toBe('?x=1');
  });

  it('?demo=off forgets a stored key', () => {
    sessionStorage.setItem('hc.demoTapKey', 'old-key');
    window.history.replaceState(null, '', '/?demo=off');
    captureDemoKey();
    expect(getDemoKey()).toBeNull();
  });
});

describe('useDemoTap', () => {
  it('is off and opens no connection without a key', () => {
    const { result } = renderHook(() => useDemoTap(() => {}));
    expect(result.current).toBe('off');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('connects with the (URL-encoded) key and reports connection state', () => {
    sessionStorage.setItem('hc.demoTapKey', 'a b&c');
    const { result } = renderHook(() => useDemoTap(() => {}));
    expect(result.current).toBe('connecting');
    expect(latest().url).toBe(`${API_BASE_URL}/demo/tap/stream?key=a%20b%26c`);

    act(() => latest().open());
    expect(result.current).toBe('connected');

    act(() => latest().fail(FakeEventSource.CONNECTING)); // dropped: the browser reconnects by itself
    expect(result.current).toBe('connecting');

    act(() => latest().fail(FakeEventSource.CLOSED)); // refused: wrong key or DEMO_TAP off
    expect(result.current).toBe('error');
  });

  it('passes each tapped card id on, ignores a repeat within 1.5 s, and ignores junk', () => {
    sessionStorage.setItem('hc.demoTapKey', 'k');
    const onTap = vi.fn();
    const now = vi.spyOn(Date, 'now');
    renderHook(() => useDemoTap(onTap));
    act(() => latest().open());

    now.mockReturnValue(10_000);
    act(() => latest().tap('04:A1:2B'));
    now.mockReturnValue(10_500);
    act(() => latest().tap('04:A1:2B')); // same card still on the phone
    now.mockReturnValue(10_600);
    act(() => latest().tap('04:FF:00')); // a different card is never a repeat
    now.mockReturnValue(12_000);
    act(() => latest().tap('04:A1:2B')); // same card again after the window
    act(() => (latest().listeners.tap ?? []).forEach((fn) => fn({ data: 'not json' })));
    act(() => (latest().listeners.tap ?? []).forEach((fn) => fn({ data: JSON.stringify({ rfid_id: 42 }) })));

    expect(onTap.mock.calls.map((c) => c[0])).toEqual(['04:A1:2B', '04:FF:00', '04:A1:2B']);
  });

  it('always calls the latest handler and closes the connection on unmount', () => {
    sessionStorage.setItem('hc.demoTapKey', 'k');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useDemoTap(fn), { initialProps: { fn: first } });
    const source = latest();
    rerender({ fn: second });
    act(() => source.tap('CARD1'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('CARD1');
    expect(FakeEventSource.instances).toHaveLength(1); // a new handler does not reconnect
    unmount();
    expect(source.closed).toBe(true);
  });

  it('stays off when the browser has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    sessionStorage.setItem('hc.demoTapKey', 'k');
    const { result } = renderHook(() => useDemoTap(() => {}));
    expect(result.current).toBe('off');
  });
});

describe('Record visit with a phone reader', () => {
  it('shows nothing about the phone reader when no key was given', () => {
    renderWithProviders(<VisitRecordingPage />);
    expect(screen.queryByText(/phone reader/i)).not.toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('looks up a card tapped on the phone and shows the real patient card', async () => {
    sessionStorage.setItem('hc.demoTapKey', 'k');
    renderWithProviders(<VisitRecordingPage />);
    expect(screen.getByText(/phone reader: connecting/i)).toBeInTheDocument();
    act(() => latest().open());
    expect(await screen.findByText(/phone reader connected/i)).toBeInTheDocument();

    act(() => latest().tap('RFID-0001'));
    expect(await screen.findByRole('heading', { name: 'Aanya Demo' })).toBeInTheDocument();
    expect(screen.getByText('251210001')).toBeInTheDocument();
  });

  it('shows the normal "card not registered" error for an unknown phone tap', async () => {
    sessionStorage.setItem('hc.demoTapKey', 'k');
    renderWithProviders(<VisitRecordingPage />);
    act(() => latest().open());
    act(() => latest().tap('04:DE:AD:BE:EF'));
    expect(await screen.findByText(/card not registered/i)).toBeInTheDocument();
    expect(screen.getByText(/04:DE:AD:BE:EF/)).toBeInTheDocument();
  });

  it('ignores a second tap while a visit form is open, so typed text is not lost', async () => {
    sessionStorage.setItem('hc.demoTapKey', 'k');
    const { account } = renderWithProviders(<VisitRecordingPage />);
    act(() => latest().open());
    act(() => latest().tap('RFID-0001'));
    expect(await screen.findByRole('heading', { name: 'Aanya Demo' })).toBeInTheDocument();
    await account.type(screen.getByLabelText(/remedy/i), 'Paracetamol');

    const patientTwo = db.patients.find((p) => p.patient_id === pid(3));
    await act(async () => {
      latest().tap('RFID-0003'); // a different, valid card arrives mid-visit
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByRole('heading', { name: 'Aanya Demo' })).toBeInTheDocument(); // still the same patient
    expect(screen.queryByRole('heading', { name: patientTwo.name })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/remedy/i)).toHaveValue('Paracetamol');
  });

  it('tells the user when the server refuses the phone reader', async () => {
    sessionStorage.setItem('hc.demoTapKey', 'wrong');
    renderWithProviders(<VisitRecordingPage />);
    act(() => latest().fail(FakeEventSource.CLOSED));
    expect(await screen.findByText(/phone reader unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/DEMO_TAP=1/)).toBeInTheDocument();
  });
});
