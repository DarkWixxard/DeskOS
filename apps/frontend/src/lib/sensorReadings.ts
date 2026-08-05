// Gemeinsame Metadaten (Label + Einheit) für MQTT-/Sensor-Telemetrie-Keys.
//
// Wird sowohl vom Sensor Hub (SensorView) als auch von der BME280-Dashboard-
// Kachel (SensorWidget) genutzt, damit Labels und Einheiten überall konsistent
// sind. Unbekannte Keys fallen auf ihren Rohnamen ohne Einheit zurück
// (siehe readingMeta()).

export interface ReadingMeta {
  unit: string;
  label: string;
}

export const READINGS: Record<string, ReadingMeta> = {
  temperature: { unit: '°C', label: 'Temperatur' },
  humidity: { unit: '%', label: 'Luftfeuchte' },
  pressure: { unit: 'hPa', label: 'Luftdruck' },
  co2: { unit: 'ppm', label: 'CO₂' },
  light: { unit: 'lx', label: 'Licht' },
  noise: { unit: 'dB', label: 'Geräusch' },
};

/** Label + Einheit zu einem Telemetrie-Key; unbekannte Keys werden roh angezeigt. */
export function readingMeta(key: string): ReadingMeta {
  return READINGS[key] ?? { unit: '', label: key };
}

/** Messwert formatieren: Zahlen auf eine Nachkommastelle runden, Strings durchreichen. */
export const fmt = (v: unknown): string => (typeof v === 'number' ? `${Math.round(v * 10) / 10}` : String(v));
