export interface PropertyContact {
  name: string;
  phone: string;
}

export interface ZonePlace {
  icon: 'wave' | 'anchor' | 'fork' | 'bag' | 'bus';
  name: string;
  description: string;
}

export interface ZoneGroup {
  group: string;
  places: ZonePlace[];
}

export const PROPERTY_ADDRESS = 'Formosa 259, Depto L';
export const PROPERTY_MAPS_URL = 'https://maps.app.goo.gl/tMMvfWUcGDKKQuQh6';

// Staff contacts are real people's phone numbers, so they live in the deploy's .env, not in
// the repo: VITE_PROPERTY_CONTACTS="Name:+54 9 ...;Other Name:+54 9 ...". Baked in at build
// time like VITE_API_URL — changing it means rebuilding the guest-web image.
export function parsePropertyContacts(raw: string | undefined): PropertyContact[] {
  return (raw ?? '')
    .split(';')
    .map((entry) => {
      const separator = entry.indexOf(':');
      return separator === -1
        ? null
        : { name: entry.slice(0, separator).trim(), phone: entry.slice(separator + 1).trim() };
    })
    .filter((contact): contact is PropertyContact => !!contact && !!contact.name && !!contact.phone);
}

export const PROPERTY_CONTACTS: PropertyContact[] = parsePropertyContacts(
  import.meta.env.VITE_PROPERTY_CONTACTS as string | undefined,
);

export const PROPERTY_ZONE: ZoneGroup[] = [
  {
    group: 'Playas y paseos',
    places: [
      {
        icon: 'wave',
        name: 'Playa Grande',
        description: 'La playa más famosa de la ciudad para el surf y los atardeceres.',
      },
      {
        icon: 'anchor',
        name: 'Puerto de Mar del Plata',
        description: 'Lobos marinos, barcos pesqueros y restaurantes de pescado fresco.',
      },
    ],
  },
  {
    group: 'Comer y comprar',
    places: [{ icon: 'fork', name: 'Zona Güemes', description: 'Bares, cafés y restaurantes para salir a la noche.' }],
  },
];
