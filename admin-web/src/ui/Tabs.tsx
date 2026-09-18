import { KeyboardEvent, useRef } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
  // Prefixes the generated tab/panel ids (`${id}-tab-<tabId>` / `${id}-panel-<tabId>`) so a
  // page rendering the corresponding tabpanel elsewhere can link to them via
  // aria-labelledby/id. Defaults to a generic value since most pages only render one Tabs
  // instance; pass an explicit id if a page ever needs more than one.
  id?: string;
}

export function Tabs({ tabs, activeTab, onChange, className = '', id = 'tabs' }: TabsProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusAndActivate(index: number) {
    const wrapped = (index + tabs.length) % tabs.length;
    buttonRefs.current[wrapped]?.focus();
    const tab = tabs[wrapped];
    if (tab.id !== activeTab) onChange(tab.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAndActivate(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusAndActivate(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
    }
  }

  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b border-border ${className}`}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-controls={`${id}-panel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onClick={() => {
              if (!isActive) onChange(tab.id);
            }}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
              isActive ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
