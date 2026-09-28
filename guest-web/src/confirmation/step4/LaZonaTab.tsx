import { ReactNode } from 'react';
import { PROPERTY_ZONE, ZonePlace } from '../propertyInfo';

const ZONE_ICONS: Record<ZonePlace['icon'], ReactNode> = {
  wave: <path d="M2 12c2.5-4 5-4 7.5 0s5 4 7.5 0 3-3 5-2" />,
  anchor: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11H5v2M16 11h3v2" />
    </>
  ),
  fork: <path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-2.5 5-2.5 8h2.5v10" />,
  bag: (
    <>
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  bus: (
    <>
      <rect x="4" y="4" width="16" height="13" rx="2" />
      <path d="M4 12h16M8 20v-3M16 20v-3" />
      <circle cx="8.5" cy="14.5" r=".6" />
      <circle cx="15.5" cy="14.5" r=".6" />
    </>
  ),
};

function PlaceIcon({ icon }: { icon: ZonePlace['icon'] }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ZONE_ICONS[icon]}
    </svg>
  );
}

export function LaZonaTab() {
  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-heading">Información de la zona</h3>
      <p className="mt-1 text-sm text-text-muted">
        Lugares para conocer, comer y resolver lo que necesites cerca del departamento.
      </p>

      {PROPERTY_ZONE.map((group) => (
        <div key={group.group} className="mt-5 first:mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">{group.group}</h4>
          <div className="mt-2 flex flex-col">
            {group.places.map((place) => (
              <div key={place.name} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-driftwood">
                  <PlaceIcon icon={place.icon} />
                </div>
                <div>
                  <p className="font-semibold text-heading">{place.name}</p>
                  <p className="text-sm text-text-muted">{place.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
