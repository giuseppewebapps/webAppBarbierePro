import { Timestamp } from 'firebase/firestore';

export type UserRole = 'barber' | 'customer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  role: UserRole;
  createdAt?: Timestamp;
}

// 🚀 NUOVO SaaS: Profilo Dipendente/Owner (Localizzato per Tenant)
export interface StaffProfile {
  uid: string;
  displayName: string;
  role: 'owner' | 'barber'; // 'owner' per l'admin, 'barber' per i collaboratori
  active: boolean;          // Soft-delete: se false non riceve più appuntamenti
  order: number;            // Priorità di riempimento (1 = alta priorità per dipendenti, 99 = boss)
  color: string;            // Colore hex (es. #3B82F6) per la UI del calendario
  assignedServices: string[]; // Array di ID dei servizi che sa eseguire
  avatarUrl?: string;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  price: number;
  duration: number; // in minuti
  flexibility: number;
}

export interface Appointment {
  id?: string;
  customerId: string;
  staffId?: string;         // 🚀 NUOVO: ID del barbiere assegnato (Opzionale per retrocompatibilità base)
  isStaffRandom?: boolean;  // 🚀 NUOVO: true se il cliente ha scelto "Qualsiasi operatore"
  services: Service[];
  startTime: any; // Timestamp
  endTime: any; // Timestamp
  status: 'booked' | 'cancelled' | 'completed';
  totalAmount: number;
  createdAt: any; // Timestamp
  cancelledAt?: any; // Timestamp
  cancelledBy?: 'barber' | 'customer';
  isForFriend?: boolean;
  isManual?: boolean;
  customer?: {
    displayName: string;
    phoneNumber: string;
    email?: string;
  };
  friendDetails?: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  };
}

export interface Notification {
  id?: string;
  userId: string;
  title: string;
  message: string;
  type: 'cancellation' | 'booking' | 'reschedule_proposal' | 'manual_management_required' | 'proposal_declined';
  read: boolean;
  createdAt: any;
  proposalId?: string;
  appointmentId?: string;
}

export type ProposalType = 'anticipo' | 'posticipo' | 'cambio';

export interface RescheduleProposal {
  id?: string;
  gapStartTime: any;
  gapEndTime: any;
  gapAppointmentId?: string;
  targets: {
    userId: string;
    appointmentId: string;
    status: 'pending' | 'accepted' | 'declined' | 'expired' | 'waiting';
    notifiedAt?: any;
    expiresAt?: any;
    proposedStartTime: any;
    proposedEndTime?: any;
    type?: ProposalType; // 🚀 NUOVO: tipo di proposta (anticipo/posticipo/cambio)
    proposedStaffId?: string; // Barbiere di destinazione (buco) per la riassegnazione
  }[];
  currentIdx: number;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: any;
}

export interface CountryCode {
  code: string;
  name: string;
  dial_code: string;
}

export interface TimeRange {
  start: number; // es. 8.75 per le 08:45
  end: number;   // es. 13.75 per le 13:45
}

export interface DaySchedule {
  isOpen: boolean;
  shifts: TimeRange[];
}

export type WeeklySchedule = Record<number, DaySchedule>; // 0 (Domenica) -> 6 (Sabato)

export interface BusinessSettings {
  weeklySchedule: WeeklySchedule;
  updatedAt?: any;
}

export interface SpecialDay {
  id?: string;
  date: string; // Formato 'YYYY-MM-DD'
  isClosed: boolean; 
  openingHours?: { start: number; end: number }[]; 
}

export interface YieldConfig {
  URGENCY_CURRENT_WEEK: boolean;
  MIN_SATURATION_RATE: number;
}

// 🚀 AGGIORNATO SaaS: Master Settings del Tenant
export interface SalonPublicSettings {
  name: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  instagramUrl: string;
  address: string;
  mapsUrl: string;
  email: string;
  notificationEmail: string; 
  logoUrl?: string;          // Aggiunto per le UI personalizzate
  isActive?: boolean;        // 🚀 KILL SWITCH ABBONAMENTI: Blocca il tenant se false
  hasMultiStaff: boolean;    // 🚀 FEATURE FLAG: Attiva UI e logiche multi-postazione
  services: Service[];       
  weeklySchedule: WeeklySchedule; 
  yieldConfig: YieldConfig;  
}