// DeejService tests: pure helpers + serial-line parsing / mapping (no hardware).
import { deejService, significantlyDifferent } from '../src/services/DeejService';
import {
  pactlMasterArgs,
  pactlMicArgs,
  parseSinkInputs,
  sinkInputMatchesApp,
} from '../src/services/AudioController';
import { deviceManager } from '../src/core/DeviceManager';

describe('AudioController helpers', () => {
  test('builds pactl args with a clamped, rounded percentage', () => {
    expect(pactlMasterArgs(42.4)).toEqual(['set-sink-volume', '@DEFAULT_SINK@', '42%']);
    expect(pactlMasterArgs(140)).toEqual(['set-sink-volume', '@DEFAULT_SINK@', '100%']);
    expect(pactlMicArgs(-5)).toEqual(['set-source-volume', '@DEFAULT_SOURCE@', '0%']);
  });

  test('parses pactl sink-input blocks and matches by app name', () => {
    const output = [
      'Sink Input #12',
      '\tDriver: PipeWire',
      '\tProperties:',
      '\t\tapplication.name = "Spotify"',
      '\t\tapplication.process.binary = "spotify"',
      '',
      'Sink Input #34',
      '\t\tapplication.name = "Firefox"',
    ].join('\n');
    const parsed = parseSinkInputs(output);
    expect(parsed).toEqual([
      { index: 12, names: ['Spotify', 'spotify'] },
      { index: 34, names: ['Firefox'] },
    ]);
    expect(sinkInputMatchesApp(parsed[0].names, 'spotify.exe')).toBe(true);
    expect(sinkInputMatchesApp(parsed[1].names, 'chrome')).toBe(false);
  });
});

describe('significantlyDifferent (noise reduction)', () => {
  test('ignores sub-threshold jitter but always honours the extremes', () => {
    expect(significantlyDifferent(50, 51, 3)).toBe(false); // jitter, ignored
    expect(significantlyDifferent(50, 55, 3)).toBe(true); // real move
    expect(significantlyDifferent(2, 0, 3)).toBe(true); // snap to full-off
    expect(significantlyDifferent(98, 100, 3)).toBe(true); // snap to full-on
  });
});

describe('DeejService', () => {
  beforeAll(() => {
    deejService.seedDefaults();
  });

  afterAll(() => {
    deejService.stop();
    // Clean up the backing device so other suites start from a clean slate.
    const status = deejService.getStatus();
    if (status.id) deviceManager.removeDevice(status.id);
  });

  test('seeds a backing device with default master/mic mapping', () => {
    const s = deejService.getStatus();
    expect(s.id).toBeTruthy();
    expect(s.connected).toBe(false);
    expect(s.sliders.length).toBe(4);
    expect(s.sliders[0].target).toBe('master');
    expect(s.sliders[1].target).toBe('mic');
    // It is registered as an Arduino device with an 'audio' capability.
    const device = deviceManager.getDevice(s.id);
    expect(device?.type).toBe('Arduino');
    expect(device?.capabilities).toContain('audio');
  });

  test('grows/shrinks the slider list while preserving mappings', () => {
    deejService.updateSlider(2, { target: 'app', app: 'spotify.exe', label: 'Musik' });
    let s = deejService.updateConfig({ sliderCount: 5 });
    expect(s.sliders.length).toBe(5);
    expect(s.sliders[2].target).toBe('app');
    expect(s.sliders[2].app).toBe('spotify.exe');

    s = deejService.updateConfig({ sliderCount: 3 });
    expect(s.sliders.length).toBe(3);
    // The custom mapping on slider #2 survived the shrink.
    expect(s.sliders[2].label).toBe('Musik');
  });

  test('parses a serial line into normalised 0–100 slider values', () => {
    deejService.updateConfig({ noiseReduction: 'default', invert: false });
    // 0 -> 0%, 1023 -> 100%, 512 -> ~50%.
    deejService.processLine('0|1023|512');
    const s = deejService.getStatus();
    expect(s.sliders[0].value).toBe(0);
    expect(s.sliders[1].value).toBe(100);
    expect(s.sliders[2].value).toBeGreaterThanOrEqual(49);
    expect(s.sliders[2].value).toBeLessThanOrEqual(51);
    expect(s.lastLine).toBe('0|1023|512');
  });

  test('inverts slider direction when configured', () => {
    deejService.updateConfig({ invert: true });
    deejService.processLine('0|1023|1023');
    const s = deejService.getStatus();
    // With inversion a raw 0 reads as 100% and a raw 1023 as 0%.
    expect(s.sliders[0].value).toBe(100);
    expect(s.sliders[1].value).toBe(0);
    deejService.updateConfig({ invert: false });
  });

  test('manual setVolume updates a slider without hardware', async () => {
    const s = await deejService.setVolume(0, 73);
    expect(s.sliders[0].value).toBe(73);
  });
});
