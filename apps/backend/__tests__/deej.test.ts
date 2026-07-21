// DeejService tests: pure helpers + serial-line parsing / mapping (no hardware).
import { deejService, significantlyDifferent } from '../src/services/DeejService';
import {
  pactlMasterArgs,
  pactlMicArgs,
  parseSinkInputs,
  sinkInputMatchesApp,
} from '../src/services/AudioController';
import { parseDeejConfig, configToYaml } from '../src/services/DeejConfigFile';
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
    deejService.updateSlider(2, { target: 'app', apps: ['spotify.exe'], label: 'Musik' });
    let s = deejService.updateConfig({ sliderCount: 5 });
    expect(s.sliders.length).toBe(5);
    expect(s.sliders[2].target).toBe('app');
    expect(s.sliders[2].apps).toEqual(['spotify.exe']);

    s = deejService.updateConfig({ sliderCount: 3 });
    expect(s.sliders.length).toBe(3);
    // The custom mapping on slider #2 survived the shrink.
    expect(s.sliders[2].label).toBe('Musik');
  });

  test('maps a slider to an app group (multiple processes)', () => {
    const s = deejService.updateSlider(2, { target: 'app', apps: ['pathofexile_x64.exe', 'rocketleague.exe'] });
    expect(s.sliders[2].apps).toEqual(['pathofexile_x64.exe', 'rocketleague.exe']);
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

describe('deej config.yaml parsing', () => {
  // The exact config the user uploaded (deej format), with a group on slider 3.
  const yaml = [
    'slider_mapping:',
    '  0: spotify.exe',
    '  1: chrome.exe',
    '  2: master',
    '  3:',
    '    - pathofexile_x64.exe',
    '    - rocketleague.exe',
    '  4: discord.exe',
    'invert_sliders: false',
    'com_port: COM8',
    'baud_rate: 9600',
    'noise_reduction: default',
  ].join('\n');

  test('parses mapping, groups, targets and connection settings', () => {
    const cfg = parseDeejConfig(yaml);
    expect(cfg.comPort).toBe('COM8');
    expect(cfg.baud).toBe(9600);
    expect(cfg.invert).toBe(false);
    expect(cfg.noiseReduction).toBe('default');
    expect(cfg.sliders).toHaveLength(5);
    expect(cfg.sliders[0]).toMatchObject({ index: 0, target: 'app', apps: ['spotify.exe'] });
    expect(cfg.sliders[2].target).toBe('master');
    // The list on slider 3 becomes an app group.
    expect(cfg.sliders[3]).toMatchObject({ target: 'app', apps: ['pathofexile_x64.exe', 'rocketleague.exe'] });
  });

  test('recognises the special keywords', () => {
    const cfg = parseDeejConfig('slider_mapping:\n  0: mic\n  1: deej.current\n  2: deej.unmapped\n  3: system');
    expect(cfg.sliders.map((s) => s.target)).toEqual(['mic', 'current', 'unmapped', 'system']);
  });

  test('round-trips through configToYaml back into the same mapping', () => {
    const cfg = parseDeejConfig(yaml);
    const rendered = configToYaml({
      comPort: cfg.comPort!,
      baud: cfg.baud!,
      invert: cfg.invert!,
      noiseReduction: cfg.noiseReduction!,
      sliders: cfg.sliders,
    });
    const again = parseDeejConfig(rendered);
    expect(again.sliders[3].apps).toEqual(['pathofexile_x64.exe', 'rocketleague.exe']);
    expect(again.comPort).toBe('COM8');
    expect(again.sliders[2].target).toBe('master');
  });

  test('never throws on malformed input', () => {
    expect(parseDeejConfig(':::not yaml:::').sliders).toEqual([]);
    expect(parseDeejConfig('').sliders).toEqual([]);
  });
});
