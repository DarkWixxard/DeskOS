'use client';

import { useEffect, useState } from 'react';
import { Panel, HoloIcon } from '@/components/holo';

// One vocabulary card: the Spanish word (with its article for nouns), the German
// meaning, its part of speech, and a short example sentence pair for context.
interface VocabEntry {
  es: string;
  de: string;
  type: 'Substantiv' | 'Verb' | 'Adjektiv' | 'Adverb' | 'Ausdruck';
  example: string;
  exampleDe: string;
}

// Common, everyday Spanish vocabulary (German learner perspective). The widget
// cycles through this list — one entry per clock hour — so the order is the order
// they appear over the day. Keep entries correct incl. accents and noun articles.
const SPANISH_VOCAB: VocabEntry[] = [
  { es: 'hola', de: 'hallo', type: 'Ausdruck', example: '¡Hola! ¿Cómo estás?', exampleDe: 'Hallo! Wie geht es dir?' },
  { es: 'gracias', de: 'danke', type: 'Ausdruck', example: 'Muchas gracias por tu ayuda.', exampleDe: 'Vielen Dank für deine Hilfe.' },
  { es: 'por favor', de: 'bitte', type: 'Ausdruck', example: 'Un café, por favor.', exampleDe: 'Einen Kaffee, bitte.' },
  { es: 'el agua', de: 'das Wasser', type: 'Substantiv', example: 'Quiero un vaso de agua.', exampleDe: 'Ich möchte ein Glas Wasser.' },
  { es: 'la casa', de: 'das Haus', type: 'Substantiv', example: 'Mi casa es pequeña.', exampleDe: 'Mein Haus ist klein.' },
  { es: 'el amigo', de: 'der Freund', type: 'Substantiv', example: 'Él es mi mejor amigo.', exampleDe: 'Er ist mein bester Freund.' },
  { es: 'comer', de: 'essen', type: 'Verb', example: 'Vamos a comer algo.', exampleDe: 'Lass uns etwas essen.' },
  { es: 'beber', de: 'trinken', type: 'Verb', example: '¿Quieres beber algo?', exampleDe: 'Möchtest du etwas trinken?' },
  { es: 'hablar', de: 'sprechen', type: 'Verb', example: 'Hablo un poco de español.', exampleDe: 'Ich spreche ein bisschen Spanisch.' },
  { es: 'el trabajo', de: 'die Arbeit', type: 'Substantiv', example: 'Voy al trabajo en bici.', exampleDe: 'Ich fahre mit dem Rad zur Arbeit.' },
  { es: 'el tiempo', de: 'die Zeit / das Wetter', type: 'Substantiv', example: 'No tengo tiempo hoy.', exampleDe: 'Ich habe heute keine Zeit.' },
  { es: 'la comida', de: 'das Essen', type: 'Substantiv', example: 'La comida está deliciosa.', exampleDe: 'Das Essen ist köstlich.' },
  { es: 'grande', de: 'groß', type: 'Adjektiv', example: 'Es una ciudad muy grande.', exampleDe: 'Es ist eine sehr große Stadt.' },
  { es: 'pequeño', de: 'klein', type: 'Adjektiv', example: 'Tengo un perro pequeño.', exampleDe: 'Ich habe einen kleinen Hund.' },
  { es: 'bueno', de: 'gut', type: 'Adjektiv', example: 'Es un buen libro.', exampleDe: 'Es ist ein gutes Buch.' },
  { es: 'el día', de: 'der Tag', type: 'Substantiv', example: '¡Que tengas un buen día!', exampleDe: 'Hab einen schönen Tag!' },
  { es: 'la noche', de: 'die Nacht', type: 'Substantiv', example: 'Buenas noches y hasta mañana.', exampleDe: 'Gute Nacht und bis morgen.' },
  { es: 'el sol', de: 'die Sonne', type: 'Substantiv', example: 'Hoy hace mucho sol.', exampleDe: 'Heute scheint die Sonne stark.' },
  { es: 'la lluvia', de: 'der Regen', type: 'Substantiv', example: 'Me gusta el sonido de la lluvia.', exampleDe: 'Ich mag das Geräusch des Regens.' },
  { es: 'trabajar', de: 'arbeiten', type: 'Verb', example: 'Trabajo desde casa.', exampleDe: 'Ich arbeite von zu Hause.' },
  { es: 'aprender', de: 'lernen', type: 'Verb', example: 'Quiero aprender español.', exampleDe: 'Ich möchte Spanisch lernen.' },
  { es: 'el libro', de: 'das Buch', type: 'Substantiv', example: 'Estoy leyendo un libro nuevo.', exampleDe: 'Ich lese ein neues Buch.' },
  { es: 'la ciudad', de: 'die Stadt', type: 'Substantiv', example: 'Madrid es una ciudad bonita.', exampleDe: 'Madrid ist eine schöne Stadt.' },
  { es: 'el coche', de: 'das Auto', type: 'Substantiv', example: 'Mi coche es azul.', exampleDe: 'Mein Auto ist blau.' },
  { es: 'viajar', de: 'reisen', type: 'Verb', example: 'Me encanta viajar por el mundo.', exampleDe: 'Ich liebe es, um die Welt zu reisen.' },
  { es: 'la familia', de: 'die Familie', type: 'Substantiv', example: 'Paso el domingo con mi familia.', exampleDe: 'Ich verbringe den Sonntag mit meiner Familie.' },
  { es: 'feliz', de: 'glücklich', type: 'Adjektiv', example: 'Estoy muy feliz hoy.', exampleDe: 'Ich bin heute sehr glücklich.' },
  { es: 'rápido', de: 'schnell', type: 'Adjektiv', example: 'El tren es muy rápido.', exampleDe: 'Der Zug ist sehr schnell.' },
  { es: 'despacio', de: 'langsam', type: 'Adverb', example: '¿Puedes hablar más despacio?', exampleDe: 'Kannst du langsamer sprechen?' },
  { es: 'el dinero', de: 'das Geld', type: 'Substantiv', example: 'No llevo dinero encima.', exampleDe: 'Ich habe kein Geld dabei.' },
  { es: 'la calle', de: 'die Straße', type: 'Substantiv', example: 'Vivo en esta calle.', exampleDe: 'Ich wohne in dieser Straße.' },
  { es: 'abrir', de: 'öffnen', type: 'Verb', example: '¿Puedes abrir la ventana?', exampleDe: 'Kannst du das Fenster öffnen?' },
  { es: 'cerrar', de: 'schließen', type: 'Verb', example: 'Cierra la puerta, por favor.', exampleDe: 'Schließ bitte die Tür.' },
  { es: 'el mercado', de: 'der Markt', type: 'Substantiv', example: 'Compro fruta en el mercado.', exampleDe: 'Ich kaufe Obst auf dem Markt.' },
  { es: 'la playa', de: 'der Strand', type: 'Substantiv', example: 'En verano vamos a la playa.', exampleDe: 'Im Sommer gehen wir an den Strand.' },
  { es: 'la montaña', de: 'der Berg', type: 'Substantiv', example: 'Nos gusta caminar por la montaña.', exampleDe: 'Wir wandern gern in den Bergen.' },
  { es: 'escuchar', de: 'hören / zuhören', type: 'Verb', example: 'Me gusta escuchar música.', exampleDe: 'Ich höre gern Musik.' },
  { es: 'ver', de: 'sehen', type: 'Verb', example: '¿Quieres ver una película?', exampleDe: 'Willst du einen Film sehen?' },
  { es: 'el amor', de: 'die Liebe', type: 'Substantiv', example: 'El amor lo puede todo.', exampleDe: 'Die Liebe kann alles.' },
  { es: 'la palabra', de: 'das Wort', type: 'Substantiv', example: 'No conozco esa palabra.', exampleDe: 'Ich kenne dieses Wort nicht.' },
  { es: 'ahora', de: 'jetzt', type: 'Adverb', example: 'Tengo que irme ahora.', exampleDe: 'Ich muss jetzt gehen.' },
  { es: 'mañana', de: 'morgen', type: 'Adverb', example: 'Nos vemos mañana.', exampleDe: 'Wir sehen uns morgen.' },
  { es: 'siempre', de: 'immer', type: 'Adverb', example: 'Siempre llego temprano.', exampleDe: 'Ich komme immer früh.' },
  { es: 'nunca', de: 'nie', type: 'Adverb', example: 'Nunca he estado en España.', exampleDe: 'Ich war noch nie in Spanien.' },
  { es: 'el gato', de: 'die Katze', type: 'Substantiv', example: 'El gato duerme en el sofá.', exampleDe: 'Die Katze schläft auf dem Sofa.' },
  { es: 'el perro', de: 'der Hund', type: 'Substantiv', example: 'Mi perro es muy grande.', exampleDe: 'Mein Hund ist sehr groß.' },
  { es: 'entender', de: 'verstehen', type: 'Verb', example: 'No entiendo la pregunta.', exampleDe: 'Ich verstehe die Frage nicht.' },
  { es: 'la puerta', de: 'die Tür', type: 'Substantiv', example: 'La puerta está abierta.', exampleDe: 'Die Tür ist offen.' },
  { es: 'caro', de: 'teuer', type: 'Adjektiv', example: 'Este reloj es muy caro.', exampleDe: 'Diese Uhr ist sehr teuer.' },
  { es: 'barato', de: 'billig / günstig', type: 'Adjektiv', example: 'El menú del día es barato.', exampleDe: 'Das Tagesmenü ist günstig.' },
];

const HOUR_MS = 3_600_000;

// Deterministic pick: cycle through the list keyed by the current clock hour, so
// the same word shows for everyone during a given hour and it changes on the hour.
function entryForTimestamp(ts: number): VocabEntry {
  const hoursSinceEpoch = Math.floor(ts / HOUR_MS);
  return SPANISH_VOCAB[hoursSinceEpoch % SPANISH_VOCAB.length];
}

// Dashboard tile that shows a new Spanish vocabulary word every hour. The chosen
// word is derived from the clock hour (see entryForTimestamp), so it switches by
// itself when the hour rolls over — a small "Vokabel des Tages", once per hour.
export function SpanishVocabWidget() {
  // Time is read only after mount (starts null) so the server render and the first
  // client render agree — same trick the header clock uses to avoid a hydration
  // mismatch. A one-minute tick keeps the countdown fresh and flips the word on the
  // hour boundary.
  const [nowTs, setNowTs] = useState<number | null>(null);
  useEffect(() => {
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const entry = nowTs == null ? null : entryForTimestamp(nowTs);
  const minutesToNext = nowTs == null ? null : Math.max(1, Math.ceil((HOUR_MS - (nowTs % HOUR_MS)) / 60_000));

  return (
    <Panel
      title="Spanisch-Vokabel"
      className="flex h-full flex-col"
      badge={
        <span className="font-mono text-[10px] text-accent/60">
          {minutesToNext != null ? `Neu in ${minutesToNext} min` : 'jede Stunde'}
        </span>
      }
    >
      {entry == null ? (
        <p className="py-8 text-center text-[11px] text-accent/40">Lade Vokabel…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <HoloIcon name="book" className="h-4 w-4 text-accent/70" />
            <span className="rounded-none border border-accent/20 bg-accent/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent/70">
              {entry.type}
            </span>
          </div>

          <div
            className="font-mono text-3xl font-bold leading-tight text-accent"
            style={{ textShadow: '0 0 14px rgba(0,217,255,0.5)' }}
            lang="es"
          >
            {entry.es}
          </div>
          <div className="mt-1 text-lg text-white/90">{entry.de}</div>

          <div className="mt-3 border-t border-accent/10 pt-3">
            <p className="text-sm italic text-white/80" lang="es">
              {entry.example}
            </p>
            <p className="mt-1 font-mono text-[11px] text-accent/60">{entry.exampleDe}</p>
          </div>

          <div className="mt-auto pt-3">
            <span className="holo-label">Vokabel der Stunde · wechselt automatisch</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
