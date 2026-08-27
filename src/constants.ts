import { Service } from './types';

export const SERVICES: Service[] = [
  { 
    id: 'barba', 
    name: 'Taglio, shampoo e barba', 
    description: 'Pacchetto relax: shampoo, taglio personalizzato e rifinitura barba per uno stile impeccabile.',
    price: 25, 
    duration: 60,
    flexibility: 15 
  },
  { 
    id: 'taglio', 
    name: 'Taglio e shampoo', 
    description: 'Taglio su misura con lavaggio e rifinitura, per un look sempre curato e definito.',
    price: 18, 
    duration: 45,
    flexibility: 15 
  },
  { 
    id: 'solo_barba', 
    name: 'Barba', 
    description: 'Rasatura completa o rifinitura sagomata per una barba ordinata, precisa e sempre valorizzata.',
    price: 10, 
    duration: 20,
    flexibility: 5 
  },
  { 
    id: 'shampoo', 
    name: 'Shampoo e acconciatura', 
    description: 'Lavaggio, asciugatura e styling su misura. Perfetto per capelli curati in ogni occasione.*Prezzo variabile',
    price: 10, 
    duration: 15,
    flexibility: 5  
  }
];

// Fallback di default se non presenti su Firestore
export const DEFAULT_OPENING_HOURS = [
  { start: 8, end: 13 }, 
  { start: 15, end: 20 },
];

export const DEFAULT_CLOSED_DAYS = [0, 1]; // 0 = Domenica, 1 = Lunedì

export const BARBER_EMAILS = [
  'do.maldera@libero.it',
  'eaglewealth.fs@gmail.com',
  'malderadomenico98@gmail.com',
];

// Indirizzo mail dove far arrivare le notifiche
export const SYSTEM_NOTIFICATION_EMAIL = 'notifiche.medohs@gmail.com';

export const SALON_INFO = {
  phone: "+39 327 141 3594",
  whatsapp: "393271413594",
  instagram: "@_medo_hs",
  instagramUrl: "https://www.instagram.com/_medo_hs?igsi=cHp0NWI4ZjdrejJ3",
  address: "Piazza Mentana, 13, 70033 Corato BA",
  mapsUrl: "https://maps.app.goo.gl/eU1pZovvLLYeVqv78"
};

export const COUNTRY_CODES = [
  { code: 'IT', name: 'Italia', dial_code: '+39', flag: '🇮🇹' },
  { code: 'US', name: 'United States', dial_code: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dial_code: '+44', flag: '🇬🇧' },
  { code: 'FR', name: 'Francia', dial_code: '+33', flag: '🇫🇷' },
  { code: 'DE', name: 'Germania', dial_code: '+49', flag: '🇩🇪' },
  { code: 'ES', name: 'Spagna', dial_code: '+34', flag: '🇪🇸' },
  { code: 'CH', name: 'Svizzera', dial_code: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', dial_code: '+43', flag: '🇦🇹' },
  { code: 'BE', name: 'Belgio', dial_code: '+32', flag: '🇧🇪' },
  { code: 'NL', name: 'Paesi Bassi', dial_code: '+31', flag: '🇳🇱' },
  { code: 'PT', name: 'Portogallo', dial_code: '+351', flag: '🇵🇹' },
  { code: 'RO', name: 'Romania', dial_code: '+40', flag: '🇷🇴' },
  { code: 'AL', name: 'Albania', dial_code: '+355', flag: '🇦🇱' },
  { code: 'MA', name: 'Marocco', dial_code: '+212', flag: '🇲🇦' },
  { code: 'EG', name: 'Egitto', dial_code: '+20', flag: '🇪🇬' },
  { code: 'CN', name: 'Cina', dial_code: '+86', flag: '🇨🇳' },
  { code: 'IN', name: 'India', dial_code: '+91', flag: '🇮🇳' },
  { code: 'BR', name: 'Brasile', dial_code: '+55', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', dial_code: '+54', flag: '🇦🇷' },
];
