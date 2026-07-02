'use client';

import { useEffect } from 'react';
import clsx from 'clsx';
import { useDashboardStore } from '@/stores/dashboardStore';
import { Panel, HoloIcon, HoloSwitch, HoloCorners } from '@/components/holo';

/* =========================================================================
   DeskOS Labs — experimenteller Feature-Hub.

   „Labs" ist die Werkbank für experimentelle / Beta-Funktionen. Jede Funktion
   ist ein strikt opt-in Feature-Flag: standardmäßig AUS, per Schalter aktivierbar
   und in localStorage persistiert (Store-Slice `labsFlags`). Andere Komponenten
   lesen einen Schalter mit `useLabsFlag('<id>')` und wirken sofort.

   Neue Experimente: einen Eintrag zu LABS_FEATURES hinzufügen, dann an der
   gewünschten Stelle per `useLabsFlag(<id>)` verdrahten. Details in docs/LABS.md.
   ========================================================================= */

// Reifegrad eines Experiments – steuert nur die Farbe des Badges.
export type LabsStage = 'alpha' | 'beta' | 'experimental';

export interface LabsFeature {
  id: string;
  label: string;
  description: string;
  icon: string;
  stage: LabsStage;
}

// Stabile Flag-IDs. Diese Konstanten werden dort importiert, wo ein Experiment
// tatsächlich wirkt (siehe Dashboard.tsx), damit keine Magic-Strings driften.
export const LABS_CALM_MODE = 'calm-mode';
export const LABS_DASHBOARD_CLOCK = 'dashboard-clock';

// Katalog aller Experimente. Reihenfolge = Anzeigereihenfolge.
export const LABS_FEATURES: LabsFeature[] = [
  {
    id: LABS_CALM_MODE,
    label: 'Ruhemodus',
    description:
      'Schaltet das holografische Flackern und die Scanline-Textur ab. Ruhigeres, ' +
      'kontrastärmeres Bild – angenehm bei Bewegungsempfindlichkeit oder im Dauerbetrieb.',
    icon: 'power',
    stage: 'beta',
  },
  {
    id: LABS_DASHBOARD_CLOCK,
    label: 'Dashboard-Uhr',
    description:
      'Blendet eine Live-Uhr mit Datum in die Kopfzeile des Dashboards ein – ' +
      'die gleiche Zeitanzeige, die es bisher nur im Overlay-Menü gab.',
    icon: 'activity',
    stage: 'experimental',
  },
];

const STAGE_STYLE: Record<LabsStage, string> = {
  alpha: 'border-danger/40 text-danger',
  beta: 'border-warning/40 text-warning',
  experimental: 'border-accent/40 text-accent',
};

const STAGE_LABEL: Record<LabsStage, string> = {
  alpha: 'Alpha',
  beta: 'Beta',
  experimental: 'Experimentell',
};

const holoButton =
  'flex items-center gap-1.5 rounded-none border border-accent/30 px-3 py-1.5 font-mono ' +
  'text-[11px] uppercase tracking-wider text-accent/80 transition-colors ' +
  'hover:border-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40';

function FeatureCard({ feature }: { feature: LabsFeature }) {
  const enabled = useDashboardStore((s) => s.labsFlags[feature.id] === true);
  const toggleLabsFlag = useDashboardStore((s) => s.toggleLabsFlag);

  return (
    <div
      className={clsx(
        'holo-panel relative p-4 transition-colors',
        enabled ? 'border-success/40' : 'border-accent/20'
      )}
    >
      <HoloCorners />
      <div className="flex items-start gap-3">
        <div
          className={clsx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-none border ring-1 transition-colors',
            enabled
              ? 'border-success/40 text-success ring-success/30'
              : 'border-accent/25 text-accent/70 ring-accent/20'
          )}
        >
          <HoloIcon name={feature.icon} className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mono text-sm font-bold uppercase tracking-wider text-white/90">
              {feature.label}
            </h3>
            <span
              className={clsx(
                'shrink-0 rounded-none border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
                STAGE_STYLE[feature.stage]
              )}
            >
              {STAGE_LABEL[feature.stage]}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-accent/60">{feature.description}</p>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-accent/40">
            {enabled ? '● aktiv · wirkt sofort' : '○ aus'}
          </div>
        </div>

        <HoloSwitch
          checked={enabled}
          onChange={() => toggleLabsFlag(feature.id)}
          label={feature.label}
        />
      </div>
    </div>
  );
}

export function LabsView() {
  const labsFlags = useDashboardStore((s) => s.labsFlags);
  const hydrateLabsFlags = useDashboardStore((s) => s.hydrateLabsFlags);
  const resetLabsFlags = useDashboardStore((s) => s.resetLabsFlags);
  const setActiveView = useDashboardStore((s) => s.setActiveView);

  // Saved flags are applied after mount (avoids an SSR hydration mismatch), so
  // reading the Labs page directly still reflects the persisted selection.
  useEffect(() => {
    hydrateLabsFlags();
  }, [hydrateLabsFlags]);

  const activeCount = LABS_FEATURES.filter((f) => labsFlags[f.id] === true).length;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* --------------------------- Header --------------------------- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-1.5 rounded-none border border-accent/30 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-accent/80 transition-colors hover:border-accent hover:bg-accent/10"
          >
            <HoloIcon name="grid" className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            <HoloIcon name="flask" className="h-5 w-5 text-accent" />
            <h2
              className="font-mono text-xl font-bold uppercase tracking-[0.2em] text-accent"
              style={{ textShadow: '0 0 12px rgba(0,217,255,0.5)' }}
            >
              Labs
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => resetLabsFlags()}
          disabled={activeCount === 0}
          className={holoButton}
        >
          <HoloIcon name="refresh" className="h-4 w-4" />
          Zurücksetzen
        </button>
      </div>

      {/* --------------------- Experimental warning ------------------- */}
      <div className="mb-4 flex items-start gap-3 rounded-none border border-warning/40 bg-warning/5 px-4 py-3">
        <HoloIcon name="flask" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0">
          <div className="font-mono text-sm font-bold uppercase tracking-[0.15em] text-warning">
            Experimentelle Funktionen
          </div>
          <p className="mt-0.5 text-[12px] text-accent/60">
            Hier schaltest du Vorschau-Features frei. Sie können sich ändern, unfertig sein oder wieder
            verschwinden. Jeder Schalter ist opt-in und wird lokal in diesem Browser gespeichert.
          </p>
        </div>
      </div>

      {/* ---------------------- Feature catalogue --------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {LABS_FEATURES.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} />
        ))}
      </div>

      {/* ----------------------------- Footer ------------------------- */}
      <Panel title="Status" className="mt-4">
        <div className="flex items-end gap-3">
          <span className="holo-value text-4xl">{activeCount}</span>
          <span className="holo-label pb-1">
            von {LABS_FEATURES.length} Experimenten aktiv
          </span>
        </div>
        <p className="mt-3 text-[11px] text-accent/40">
          Neue Experimente werden im Katalog <code className="text-accent/60">LABS_FEATURES</code>{' '}
          gepflegt und per <code className="text-accent/60">useLabsFlag()</code> verdrahtet – siehe
          docs/LABS.md.
        </p>
      </Panel>
    </div>
  );
}
