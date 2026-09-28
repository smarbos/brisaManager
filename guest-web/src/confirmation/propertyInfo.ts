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

export const PROPERTY_CONTACTS: PropertyContact[] = [
  { name: 'Johanna', phone: '+54 9 2235550101' },
  { name: 'Marta', phone: '+54 9 2235550102' },
];

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
