// DeskOS ESP32 Simulator
//
// Pretends to be an ESP32 sensor+LED node on MQTT, so the whole MQTT path
// (announce -> auto-register, telemetry -> Sensor Hub, commands) is testable
// without any real hardware.
//
//   Topics (deskos/nodes/<id>/...):
//     announce  (retained)  node + module description
//     status    (retained)  online/offline (LWT)
//     telemetry             sensor readings
//     cmd                   commands from DeskOS (subscribed)

import dotenv from 'dotenv';
import mqtt from 'mqtt';

dotenv.config();

// IPv4-Loopback (nicht "localhost"): unter Windows löst "localhost" oft zu ::1
// auf, während der eingebettete Broker IPv4 bindet -> Verbindung scheitert.
const BROKER = process.env.MQTT_BROKER || `mqtt://127.0.0.1:${process.env.MQTT_PORT || 1883}`;
const NODE_ID = process.env.SIM_NODE_ID || 'esp32-sim-1';
const NAME = process.env.SIM_NAME || 'ESP32 Sensor Node';
const INTERVAL = parseInt(process.env.SIM_INTERVAL || '2000');
const base = `deskos/nodes/${NODE_ID}`;

// Sensor state with gentle random-walk drift.
const sensors = { temperature: 22.5, humidity: 45, co2: 600, light: 320, noise: 38 };
const bounds: Record<keyof typeof sensors, [number, number, number]> = {
  // [min, max, max step]
  temperature: [18, 30, 0.3],
  humidity: [30, 70, 1],
  co2: [400, 1600, 25],
  light: [0, 1000, 40],
  noise: [30, 90, 3],
};

function drift(): Record<string, number> {
  for (const key of Object.keys(sensors) as (keyof typeof sensors)[]) {
    const [min, max, step] = bounds[key];
    const next = sensors[key] + (Math.random() * 2 - 1) * step;
    sensors[key] = Math.round(Math.max(min, Math.min(max, next)) * 10) / 10;
  }
  return { ...sensors };
}

console.log(`🤖 DeskOS ESP32 Simulator "${NAME}" (${NODE_ID}) -> ${BROKER}`);

const client = mqtt.connect(BROKER, {
  reconnectPeriod: 3000,
  will: { topic: `${base}/status`, payload: 'offline', retain: true, qos: 0 },
});

// Letzter geloggter Verbindungsfehler – verhindert Spam im 3s-Reconnect-Takt.
let lastClientError: string | undefined;

function announce() {
  client.publish(
    `${base}/announce`,
    JSON.stringify({
      name: NAME,
      type: 'sensor',
      capabilities: ['sensor', 'led'],
      modules: [
        { id: 'env', type: 'sensor', sensors: ['temperature', 'humidity', 'co2', 'light', 'noise'] },
        { id: 'led', type: 'led' },
      ],
      fw: 'sim-1.0',
    }),
    { retain: true }
  );
}

client.on('connect', () => {
  lastClientError = undefined;
  console.log('✅ Connected to MQTT broker');
  client.publish(`${base}/status`, 'online', { retain: true });
  announce();
  client.subscribe(`${base}/cmd`);
});

client.on('message', (topic, payload) => {
  if (topic !== `${base}/cmd`) return;
  let cmd: any = {};
  try {
    cmd = JSON.parse(payload.toString());
  } catch {
    return;
  }
  console.log('📥 Command received:', cmd);
  switch (cmd.action) {
    case 'restart':
      console.log('🔄 Neustart… (re-announce)');
      setTimeout(announce, 500);
      break;
    case 'wifi':
      console.log(`📶 WLAN gesetzt: SSID "${cmd.ssid}"`);
      break;
    case 'ota':
      console.log(`⬆️  OTA-Update von ${cmd.url}`);
      break;
    case 'led':
      console.log('💡 LED:', cmd.color);
      break;
    default:
      break;
  }
});

client.on('error', (err) => {
  const msg = (err && (err.message || (err as NodeJS.ErrnoException).code)) || String(err);
  if (msg === lastClientError) return;
  lastClientError = msg;
  console.error(
    `❌ MQTT error: ${msg} — Broker erreichbar? Der Broker steckt im Backend (eingebetteter aedes). ` +
      `Dafür muss das Backend laufen und in dessen .env darf KEIN MQTT_BROKER gesetzt sein.`
  );
});

const timer = setInterval(() => {
  if (client.connected) client.publish(`${base}/telemetry`, JSON.stringify(drift()));
}, INTERVAL);

function shutdown() {
  clearInterval(timer);
  client.publish(`${base}/status`, 'offline', { retain: true }, () => {
    client.end(true, {}, () => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
