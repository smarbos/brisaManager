import { KeyboardEvent, ReactNode, RefObject, useRef, useState } from 'react';
import { GuestReservation } from '../types';
import { Badge } from '../../ui';
import { PagoTab } from './PagoTab';
import { ComoLlegarTab } from './ComoLlegarTab';
import { LaZonaTab } from './LaZonaTab';
import { SensoresTab } from './SensoresTab';

type TabId = 'pago' | 'llegar' | 'zona' | 'sensores';

interface Tab {
  id: TabId;
  label: string;
  icon: ReactNode;
}

function iconProps() {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

function PagoIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6.5 15h4" />
    </svg>
  );
}

function LlegarIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 21s7-5.6 7-11.2A7 7 0 0 0 5 9.8C5 15.4 12 21 12 21z" />
      <circle cx="12" cy="9.8" r="2.4" />
    </svg>
  );
}

function ZonaIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  );
}

function SensoresIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" />
      <path d="M12 9v7" />
    </svg>
  );
}

interface Step4ConfirmationProps {
  reservation: GuestReservation;
  token: string;
  showAmbient: boolean;
  stepHeadingRef: RefObject<HTMLHeadingElement | null>;
}

export function Step4Confirmation({ reservation, token, showAmbient, stepHeadingRef }: Step4ConfirmationProps) {
  const [activeTab, setActiveTab] = useState<TabId>('pago');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs: Tab[] = [
    { id: 'pago', label: 'Pago', icon: <PagoIcon /> },
    { id: 'llegar', label: 'Cómo llegar', icon: <LlegarIcon /> },
    { id: 'zona', label: 'La zona', icon: <ZonaIcon /> },
  ];
  if (showAmbient) {
    tabs.push({ id: 'sensores', label: 'Sensores', icon: <SensoresIcon /> });
  }

  function selectTabAt(index: number, focus: boolean) {
    setActiveTab(tabs[index].id);
    if (focus) {
      tabRefs.current[index]?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectTabAt((index + 1) % tabs.length, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTabAt((index - 1 + tabs.length) % tabs.length, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTabAt(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTabAt(tabs.length - 1, true);
    }
  }

  return (
    <>
      <Badge tone="success">✓ Pago confirmado</Badge>
      <h2 ref={stepHeadingRef} tabIndex={-1} className="mt-2 font-heading text-xl font-bold text-heading outline-none">
        Confirmación
      </h2>
      <p className="mt-1 text-sm text-text-muted">{reservation.confirmationStepText}</p>

      <div
        role="tablist"
        aria-label="Información de tu estadía"
        className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg p-1 sm:grid-cols-4"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => selectTabAt(index, false)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
              activeTab === tab.id ? 'bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-pago" aria-labelledby="tab-pago" hidden={activeTab !== 'pago'} className="mt-4">
        <PagoTab reservation={reservation} />
      </div>
      <div role="tabpanel" id="panel-llegar" aria-labelledby="tab-llegar" hidden={activeTab !== 'llegar'} className="mt-4">
        <ComoLlegarTab />
      </div>
      <div role="tabpanel" id="panel-zona" aria-labelledby="tab-zona" hidden={activeTab !== 'zona'} className="mt-4">
        <LaZonaTab />
      </div>
      {showAmbient && (
        <div
          role="tabpanel"
          id="panel-sensores"
          aria-labelledby="tab-sensores"
          hidden={activeTab !== 'sensores'}
          className="mt-4"
        >
          <SensoresTab token={token} />
        </div>
      )}
    </>
  );
}
