export type UserRole = 'barber' | 'customer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  role: UserRole;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  price: number;
  duration: number; // in minutes
  flexibility?: number;
}

export interface Appointment {
  id?: string;
  customerId: string;
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
  type: 'cancellation' | 'booking' | 'reschedule_proposal' | 'manual_management_required';
  read: boolean;
  createdAt: any;
  proposalId?: string;
  appointmentId?: string;
}

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

// 🚀 NUOVE INTERFACCE PER L'ORARIO GRANULARE GIORNALIERO
export interface DaySchedule {
  isOpen: boolean;
  shifts: TimeRange[];
}

export type WeeklySchedule = Record<number, DaySchedule>; // Chiave: 0 (Domenica) -> 6 (Sabato)

export interface BusinessSettings {
  weeklySchedule: WeeklySchedule;
  updatedAt?: any;
}

export interface SpecialDay {
  id?: string;
  date: string; // Formato 'YYYY-MM-DD' (es. '2024-08-14') per facilitare la ricerca
  isClosed: boolean; // true = chiuso tutto il giorno, false = orario personalizzato
  openingHours?: { start: number; end: number }[]; // Es. [{start: 8, end: 14}]
}