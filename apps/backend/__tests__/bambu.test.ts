// Tests für den BambuService (Report-Parsing & Status, ohne Netzwerk/MQTT).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../src/services/DatabaseService';
import { PluginRegistry } from '../src/services/PluginRegistry';
import { BambuService } from '../src/services/BambuService';

function tempDbPath(): string {
  return path.join(os.tmpdir(), `descos-bambu-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

async function freshRegistry(dbFile: string): Promise<PluginRegistry> {
  const db = new DatabaseService(dbFile);
  const reg = new PluginRegistry(db);
  await reg.restore();
  await reg.seedDefaults();
  await reg.install('bambu');
  return reg;
}

// Beispiel eines (partiellen) Reports, wie ihn der A1 auf device/<serial>/report
// unter dem Schlüssel "print" veröffentlicht.
const SAMPLE_REPORT = {
  print: {
    gcode_state: 'RUNNING',
    subtask_name: 'benchy.gcode.3mf',
    gcode_file: 'Metadata/plate_1.gcode',
    mc_percent: 47,
    mc_remaining_time: 72, // Minuten
    layer_num: 42,
    total_layer_num: 120,
    nozzle_temper: 219.5,
    nozzle_target_temper: 220,
    bed_temper: 59.8,
    bed_target_temper: 60,
  },
};

describe('BambuService', () => {
  const created: string[] = [];

  afterAll(() => {
    for (const f of created) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  // Ohne ENV-Fallback testen, damit nur die Plugin-Settings zählen.
  beforeEach(() => {
    delete process.env.BAMBU_IP;
    delete process.env.BAMBU_ACCESS_CODE;
    delete process.env.BAMBU_SERIAL;
  });

  test('ohne Zugangsdaten: weder credentials noch online', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    const bambu = new BambuService(reg);

    const status = bambu.getStatus();
    expect(status.hasCredentials).toBe(false);
    expect(status.online).toBe(false);
    expect(status.progress).toBe(0);
  });

  test('mit Zugangsdaten: hasCredentials true, aber ohne Report offline', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('bambu', { ip: '192.168.1.50', accessCode: 'ABCD1234', serial: '00M09A1234567' });
    const bambu = new BambuService(reg);

    const status = bambu.getStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.online).toBe(false);
  });

  test('Report-Parsing: mappt Fortschritt, Restzeit, Layer, Status & Temperaturen', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('bambu', { ip: '192.168.1.50', accessCode: 'ABCD1234', serial: '00M09A1234567' });
    const bambu = new BambuService(reg);

    bambu.ingestReport(SAMPLE_REPORT);
    const s = bambu.getStatus();

    expect(s.online).toBe(true);
    expect(s.gcodeState).toBe('RUNNING');
    expect(s.jobName).toBe('benchy.gcode.3mf');
    expect(s.progress).toBe(47);
    expect(s.remainingMin).toBe(72);
    expect(s.layerNum).toBe(42);
    expect(s.totalLayers).toBe(120);
    expect(Math.round(s.nozzleTemp)).toBe(220);
    expect(s.nozzleTarget).toBe(220);
    expect(Math.round(s.bedTemp)).toBe(60);
    expect(s.bedTarget).toBe(60);
  });

  test('partielle Reports (Deltas) überschreiben nur vorhandene Felder', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('bambu', { ip: '192.168.1.50', accessCode: 'ABCD1234', serial: '00M09A1234567' });
    const bambu = new BambuService(reg);

    bambu.ingestReport(SAMPLE_REPORT);
    // Nur ein Fortschritts-Delta – der Rest muss erhalten bleiben.
    bambu.ingestReport({ print: { mc_percent: 63, mc_remaining_time: 50, layer_num: 55 } });
    const s = bambu.getStatus();

    expect(s.progress).toBe(63);
    expect(s.remainingMin).toBe(50);
    expect(s.layerNum).toBe(55);
    expect(s.totalLayers).toBe(120); // aus dem ersten Report übernommen
    expect(s.gcodeState).toBe('RUNNING');
  });

  test('control() ohne aktive MQTT-Verbindung liefert false', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('bambu', { ip: '192.168.1.50', accessCode: 'ABCD1234', serial: '00M09A1234567' });
    const bambu = new BambuService(reg);

    expect(bambu.control('pause')).toBe(false);
  });

  test('jobName fällt auf den Dateinamen (ohne Endung) zurück', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('bambu', { ip: '192.168.1.50', accessCode: 'ABCD1234', serial: '00M09A1234567' });
    const bambu = new BambuService(reg);

    bambu.ingestReport({ print: { gcode_state: 'RUNNING', gcode_file: 'cache/xyz/cube.gcode', mc_percent: 5 } });
    expect(bambu.getStatus().jobName).toBe('cube');
  });

  test('getDetail() ergänzt Lüfter/Kammer/AMS/HMS aus demselben Report', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    await reg.updateSettings('bambu', { ip: '192.168.1.50', accessCode: 'ABCD1234', serial: '00M09A1234567' });
    const bambu = new BambuService(reg);

    bambu.ingestReport({
      print: {
        ...SAMPLE_REPORT.print,
        chamber_temper: 28,
        cooling_fan_speed: '100',
        big_fan1_speed: '80',
        big_fan2_speed: '0',
        spd_lvl: 2,
        wifi_signal: '-52dBm',
        nozzle_diameter: '0.4',
        mc_print_stage: '2',
        print_error: 0,
        hms: [{ attr: 50331904, code: 65543 }],
        ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA', tray_color: 'FF6A13FF', remain: 75 }] }] },
      },
    });

    const d = bambu.getDetail();
    // Basisfelder von getStatus() bleiben erhalten.
    expect(d.gcodeState).toBe('RUNNING');
    expect(d.progress).toBe(47);
    // Erweiterte Felder.
    expect(d.chamberTemp).toBe(28);
    expect(d.partFanSpeed).toBe(100);
    expect(d.auxFanSpeed).toBe(80);
    expect(d.speedLevel).toBe(2);
    expect(d.wifiSignal).toBe('-52dBm');
    expect(d.nozzleDiameter).toBe(0.4);
    expect(d.hmsCodes).toEqual(['03000100_00010007']);
    expect(d.ams).toEqual([{ unit: 0, slot: 0, type: 'PLA', color: 'FF6A13FF', remainPercent: 75 }]);
  });

  test('getCloudDevices() liefert ohne Cloud-Token eine leere Liste', async () => {
    const dbFile = tempDbPath();
    created.push(dbFile);
    const reg = await freshRegistry(dbFile);
    const bambu = new BambuService(reg);

    await expect(bambu.getCloudDevices()).resolves.toEqual([]);
  });
});
