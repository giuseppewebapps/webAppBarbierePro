import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  getDoc,
  Timestamp,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../App';
import { notifySystemByEmail } from '../utils/emailNotifier';
import { 
  format, 
  addMinutes, 
  startOfDay, 
  endOfDay, 
  isBefore, 
  addHours, 
  setHours, 
  setMinutes, 
  isSameDay,
  getDay,
  eachDayOfInterval,
  addDays,
  isAfter,
  differenceInMinutes
} from 'date-fns';
import { it } from 'date-fns/locale';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Scissors, 
  CheckCircle2, 
  XCircle, 
  ChevronRight,
  Phone,
  AlertCircle,
  Globe,
  ArrowUpCircle,
  ChevronDown,
  Mail,
  Instagram,
  MessageCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  SERVICES, 
  DEFAULT_WEEKLY_SCHEDULE, 
  COUNTRY_CODES, 
  BARBER_EMAILS, 
  SALON_INFO 
} from '../constants';
import { Appointment, Service, RescheduleProposal, SpecialDay, TimeRange, WeeklySchedule } from '../types';
import { calculateOptimalSlots } from '../utils/slotEngine';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email
    }
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface CustomerBookingProps {
  selectedProposalIdFromNotification?: string | null;
  onProposalDialogClose?: () => void;
  selectedAppointmentId?: string | null;
  onAppointmentDialogClose?: () => void;
}

// Helper component for Appointment Ticket
const AppointmentTicket: React.FC<{ 
  app: Appointment, 
  onCancel?: (app: Appointment) => void,
  isHighlighted?: boolean
}> = ({ app, onCancel, isHighlighted }) => {
  const now = new Date();
  const isPast = isBefore(app.startTime.toDate(), now);
  const isCancelled = app.status === 'cancelled';
  
  const createdAt = app.createdAt?.toDate ? app.createdAt.toDate() : new Date(0);
  const isGracePeriod = differenceInMinutes(now, createdAt) <= 15;
  const isMoreThan6Hours = isAfter(app.startTime.toDate(), addHours(now, 6));
  
  const canCancel = app.status === 'booked' && !isPast && (isMoreThan6Hours || isGracePeriod);
  
  return (
    <div 
      id={`appointment-${app.id}`}
      className={cn(
        "relative rounded-3xl p-6 transition-all duration-500 overflow-hidden",
        !isHighlighted && isCancelled && "bg-white opacity-60 grayscale border border-gray-100 shadow-md",
        !isHighlighted && !isCancelled && "bg-white border border-gray-100 hover:shadow-lg shadow-md",
        isHighlighted && isCancelled && "bg-red-50/95 border-2 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)] ring-4 ring-red-500/30 scale-[1.02] z-20 opacity-100 grayscale-0",
        isHighlighted && !isCancelled && "bg-emerald-50/95 border-2 border-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.4)] ring-4 ring-emerald-500/30 scale-[1.02] z-20"
      )}
    >
      <div className="absolute top-1/2 -left-3 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full border border-gray-100 shadow-inner z-10" />
      <div className="absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full border border-gray-100 shadow-inner z-10" />
      
      <div className="flex justify-between items-start mb-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Data e Ora</div>
          <div className="text-lg font-bold">
            {format(app.startTime.toDate(), 'd MMM yyyy', { locale: it })}
          </div>
          <div className="text-2xl font-black text-black">
            {format(app.startTime.toDate(), 'HH:mm')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Stato</div>
          <span className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
            app.status === 'booked' ? (isPast ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700") :
            app.status === 'completed' ? "bg-blue-100 text-blue-700" :
            "bg-red-100 text-red-700"
          )}>
            {app.status === 'booked' ? (isPast ? 'Passato' : 'Confermato') : 
             app.status === 'completed' ? 'Completato' : 'Annullato'}
          </span>
        </div>
      </div>

      <div className="pt-4 border-t border-dashed border-gray-200 space-y-3">
        <div className="flex flex-wrap gap-2">
          {app.services.map(s => (
            <span key={s.id} className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-lg flex items-center gap-1">
              <Scissors size={10} /> {s.name}
            </span>
          ))}
        </div>
        <div className="flex justify-between items-center">
          <div className="text-sm font-bold text-gray-900">€{app.totalAmount}</div>
          {onCancel && canCancel && (
            <button
              onClick={() => onCancel(app)}
              className="text-[10px] font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-xl transition-colors uppercase tracking-wider"
            >
              Annulla
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default function CustomerBooking({ 
  selectedProposalIdFromNotification, 
  onProposalDialogClose,
  selectedAppointmentId,
  onAppointmentDialogClose
}: CustomerBookingProps) {
  const { profile } = useAuth();

  // 🚀 STATO DINAMICO IMPOSTAZIONI ORARI (Inizializzato con i Fallback a 7 giorni)
  const [businessSettings, setBusinessSettings] = useState<{
    weeklySchedule: WeeklySchedule;
  }>({
    weeklySchedule: DEFAULT_WEEKLY_SCHEDULE
  });

  // 🚀 ASCOLTO IN TEMPO REALE DI FIRESTORE
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'business_hours'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBusinessSettings({
          weeklySchedule: data.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE
        });
      }
    });
    return () => unsubscribe();
  }, []);

  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  
// 🚀 1. Limiti Assoluti di Prenotazione (30 giorni / 1 mese) - CONGELATI IN RAM
  const MAX_BOOKING_DAYS = 30;
  const { todayNormalized, maxBookingDate } = useMemo(() => {
    const today = startOfDay(new Date());
    return {
      todayNormalized: today,
      maxBookingDate: addDays(today, MAX_BOOKING_DAYS)
    };
  }, []); 

  // 🚀 2. Finestra visibile (Scansiona l'intero range di 30 giorni)
  const visibleDays = useMemo(() => {
    const days = eachDayOfInterval({
      start: todayNormalized,
      end: maxBookingDate
    });
    
    return days.filter(d => {
      if (isAfter(d, maxBookingDate)) return false;
      const dateString = format(d, 'yyyy-MM-dd');
      const exception = specialDays.find(ex => ex.date === dateString);
      if (exception) return !exception.isClosed;
      return businessSettings.weeklySchedule[getDay(d)]?.isOpen;
    });
  }, [todayNormalized, specialDays, businessSettings, maxBookingDate]);

  const [selectedDate, setSelectedDate] = useState<Date>(visibleDays[0] || todayNormalized);
  const [availableSlots, setAvailableSlots] = useState<Date[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);

  // 🚀 STATI PER LO SCANNER DEI GIORNI PIENI
  const [fullyBookedDays, setFullyBookedDays] = useState<string[]>([]);
  const [isScanningDays, setIsScanningDays] = useState(false);

  // 🚀 MOTORE DI SCANSIONE IN BACKGROUND
  useEffect(() => {
    const scanVisibleDays = async () => {
      // Se non ha scelto servizi o non ci sono giorni visibili, non oscuriamo nulla
      if (selectedServices.length === 0 || visibleDays.length === 0) {
        setFullyBookedDays([]);
        return;
      }

      setIsScanningDays(true);
      try {
        const windowStartMs = startOfDay(visibleDays[0]);
        const windowEndMs = endOfDay(visibleDays[visibleDays.length - 1]);

        // 1. Facciamo UNA SOLA query Firebase per tutta la finestra di 14 giorni
        const q = query(
          collection(db, 'appointments'),
          where('startTime', '>=', Timestamp.fromDate(windowStartMs)),
          where('startTime', '<=', Timestamp.fromDate(windowEndMs)),
          where('status', '==', 'booked')
        );
        const snap = await getDocs(q);
        const windowApps = snap.docs.map(doc => doc.data() as Appointment);

        // 2. Prepariamo i parametri dell'algoritmo
        const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
        const totalFlexibility = selectedServices.reduce((acc, s) => acc + (s.flexibility || 0), 0);
        const requestedService = { id: 'combo', duration: totalDuration, flexibility: totalFlexibility };

        const mappedCatalog = SERVICES.map(s => ({
          id: s.id,
          duration: s.duration,
          flexibility: s.flexibility || 0
        }));

        const busyDays: string[] = [];
        const now = new Date();

        // 3. Simuliamo il calcolo per ogni singolo giorno della finestra
        for (const day of visibleDays) {
          const dateString = format(day, 'yyyy-MM-dd');
          const dayOfWeek = getDay(day);
          const exception = specialDays.find(ex => ex.date === dateString);
          
          let activeHours: TimeRange[] = [];
          if (exception && !exception.isClosed) {
            activeHours = exception.openingHours?.length ? exception.openingHours : (businessSettings.weeklySchedule[dayOfWeek]?.shifts || []);
          } else if (businessSettings.weeklySchedule[dayOfWeek]?.isOpen) {
            activeHours = businessSettings.weeklySchedule[dayOfWeek].shifts;
          }

          // Filtriamo appuntamenti solo per il giorno ciclato
          const dayStartMs = startOfDay(day).getTime();
          const dayEndMs = endOfDay(day).getTime();
          const dayApps = windowApps.filter(app => {
            const t = app.startTime.toDate().getTime();
            return t >= dayStartMs && t <= dayEndMs;
          }).map(app => {
            const actualDur = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
            const nomDur = app.services?.reduce((acc: number, s: any) => acc + s.duration, 0) || actualDur;
            return {
              start: app.startTime.toDate(),
              end: app.endTime.toDate(),
              isCompressed: actualDur < nomDur
            };
          });

          let slotsFound = 0;

          // Calcoliamo gli slot per ogni turno di quel giorno
          activeHours.forEach(range => {
            const sH = Math.floor(range.start);
            const sM = Math.round((range.start - sH) * 60);
            const shiftStart = setMinutes(setHours(day, sH), sM);

            const eH = Math.floor(range.end);
            const eM = Math.round((range.end - eH) * 60);
            const shiftEnd = setMinutes(setHours(day, eH), eM);

            const slots = calculateOptimalSlots(requestedService, mappedCatalog, dayApps, { start: shiftStart, end: shiftEnd });
            
            // Se è oggi, scartiamo gli slot passati per non dare falsi positivi
            const validSlots = isSameDay(day, now) ? slots.filter(s => isAfter(s, now)) : slots;
            slotsFound += validSlots.length;
          });

          // Se per questo giorno, con questo specifico servizio, ci sono 0 slot... lo dichiariamo PIENO!
          if (slotsFound === 0) {
            busyDays.push(dateString);
          }
        }

        setFullyBookedDays(busyDays);
      } catch (error) {
        console.error("Errore nello scanning dei giorni:", error);
      } finally {
        setIsScanningDays(false);
      }
    };

    scanVisibleDays();
  }, [selectedServices, visibleDays, businessSettings, specialDays]);
  
  const [phonePrefix, setPhonePrefix] = useState('+39');
  const [phoneNumber, setPhoneNumber] = useState('');
  
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);
  const [proposals, setProposals] = useState<RescheduleProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<RescheduleProposal | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState<Appointment | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'booking' | 'appointments' | 'contacts'>('booking');

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const [isForFriend, setIsForFriend] = useState(false);
  const [friendFirstName, setFriendFirstName] = useState('');
  const [friendLastName, setFriendLastName] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [friendPhone, setFriendPhone] = useState('');

  const [showPhoneUpdatePopup, setShowPhoneUpdatePopup] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [newPhoneNumberToUpdate, setNewPhoneNumberToUpdate] = useState<string | null>(null);
  const [showContactMenu, setShowContactMenu] = useState(false);
  const [highlightedAppId, setHighlightedAppId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.phoneNumber) {
      const prefix = COUNTRY_CODES.find(c => profile.phoneNumber?.startsWith(c.dial_code));
      if (prefix) {
        setPhonePrefix(prefix.dial_code);
        setPhoneNumber(profile.phoneNumber.replace(prefix.dial_code, ''));
      } else {
        setPhoneNumber(profile.phoneNumber);
      }
    }
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, 'appointments'),
      where('customerId', '==', profile.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Appointment[];
      setMyAppointments(docs.sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis()));
    });

    return () => unsubscribe();
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, 'rescheduleProposals'),
      where('status', '==', 'active')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RescheduleProposal[];
      
      const activeProposals = docs.filter(p => {
        const currentTarget = p.targets[p.currentIdx];
        return currentTarget && currentTarget.userId === profile.uid && currentTarget.status === 'pending';
      });
      
      setProposals(activeProposals);

      if (selectedProposal) {
        const stillActive = activeProposals.find(p => p.id === selectedProposal.id);
        if (!stillActive) {
          setSelectedProposal(null);
        } else {
          setSelectedProposal(stillActive);
        }
      }

      if (selectedProposalIdFromNotification) {
        const found = activeProposals.find(p => p.id === selectedProposalIdFromNotification);
        if (found) {
          setSelectedProposal(found);
          if (onProposalDialogClose) onProposalDialogClose();
        } else {
          const checkInactive = async () => {
            const docSnap = await getDoc(doc(db, 'rescheduleProposals', selectedProposalIdFromNotification));
            if (docSnap.exists()) {
              const data = docSnap.data() as RescheduleProposal;
              if (data.status !== 'active') {
                alert("Questa proposta non è più attiva o è già stata gestita.");
              } else {
                alert("Questa proposta non è più disponibile per te.");
              }
            }
            if (onProposalDialogClose) onProposalDialogClose();
          };
          checkInactive();
        }
      }
    });

    return () => unsubscribe();
  }, [profile, selectedProposalIdFromNotification]);

  useEffect(() => {
    if (selectedDate && selectedServices.length > 0) {
      calculateSlots();
    } else {
      setAvailableSlots([]);
    }
  }, [selectedDate, selectedServices, businessSettings]);

  useEffect(() => {
    if (selectedAppointmentId) {
      setActiveTab('appointments');
      setHighlightedAppId(selectedAppointmentId);

      setTimeout(() => {
        const element = document.getElementById(`appointment-${selectedAppointmentId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);

      setTimeout(() => {
        setHighlightedAppId(null);
      }, 5000);

      if (onAppointmentDialogClose) onAppointmentDialogClose();
    }
  }, [selectedAppointmentId, onAppointmentDialogClose]);

  useEffect(() => {
    const q = query(collection(db, 'calendar_exceptions'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SpecialDay[];
      setSpecialDays(docs);
    });
    return () => unsubscribe();
  }, []);

  const calculateSlots = async () => {
    setLoading(true);
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const dayOfWeek = getDay(selectedDate);
    const exceptionForToday = specialDays.find(ex => ex.date === dateString);

    if (exceptionForToday?.isClosed || (!exceptionForToday && !businessSettings.weeklySchedule[dayOfWeek]?.isOpen)) {
      setAvailableSlots([]);
      setLoading(false);
      return;
    }

    let activeOpeningHours: TimeRange[] = [];
    if (exceptionForToday && !exceptionForToday.isClosed) {
      activeOpeningHours = exceptionForToday.openingHours?.length ? exceptionForToday.openingHours : (businessSettings.weeklySchedule[dayOfWeek]?.shifts || []);
    } else {
      activeOpeningHours = businessSettings.weeklySchedule[dayOfWeek]?.shifts || [];
    }

    try {
      const q = query(
        collection(db, 'appointments'),
        where('startTime', '>=', Timestamp.fromDate(dayStart)),
        where('startTime', '<=', Timestamp.fromDate(dayEnd))
      );
      const snapshot = await getDocs(q);
      const dayAppointments = snapshot.docs
        .map(doc => doc.data() as Appointment)
        .filter(app => app.status === 'booked');

      // Adapter: Mappatura appuntamenti esistenti con calcolo dello "stato di stress" (isCompressed)
      const mappedAppointments = dayAppointments.map(app => {
        const actualDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
        const nominalDuration = app.services.reduce((acc, s) => acc + s.duration, 0);
        return {
          start: app.startTime.toDate(),
          end: app.endTime.toDate(),
          isCompressed: actualDuration < nominalDuration // true se l'appuntamento è già in modalità "Flex"
        };
      });

      // 🚀 Adapter: Mappatura catalogo leggendo la flessibilità REALE dalle costanti
      const mappedCatalog = SERVICES.map(s => ({
        id: s.id,
        duration: s.duration,
        flexibility: s.flexibility || 0 
      }));

      // 🚀 Adapter: Somma durata e flessibilità per combo di servizi multipli
      const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
      const totalFlexibility = selectedServices.reduce((acc, s) => acc + (s.flexibility || 0), 0);

      const requestedService = {
        id: 'custom_combo',
        duration: totalDuration,
        flexibility: totalFlexibility
      };

      let allValidSlots: Date[] = [];

      // Esecuzione del motore per ogni turno di lavoro della giornata
      activeOpeningHours.forEach(range => {
        const startHour = Math.floor(range.start);
        const startMin = Math.round((range.start - startHour) * 60);
        const shiftStart = setMinutes(setHours(dayStart, startHour), startMin);

        const endHour = Math.floor(range.end);
        const endMin = Math.round((range.end - endHour) * 60);
        const shiftEnd = setMinutes(setHours(dayStart, endHour), endMin);

        const shiftSlots = calculateOptimalSlots(
          requestedService,
          mappedCatalog,
          mappedAppointments,
          { start: shiftStart, end: shiftEnd }
        );

        allValidSlots = [...allValidSlots, ...shiftSlots];
      });

      // Ordinamento cronologico finale
      const uniqueSortedSlots = Array.from(new Set(allValidSlots.map(d => d.getTime())))
        .map(time => new Date(time))
        .sort((a, b) => a.getTime() - b.getTime());

      // Filtra slot passati se la data selezionata è oggi
      const now = new Date();
      setAvailableSlots(uniqueSortedSlots.filter(slot => isAfter(slot, now)));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'appointments');
    } finally {
      setLoading(false);
    }
  };

  const toggleService = (service: Service) => {
    if (selectedServices.find(s => s.id === service.id)) {
      setSelectedServices(selectedServices.filter(s => s.id !== service.id));
    } else {
      setSelectedServices([...selectedServices, service]);
    }
    setSelectedSlot(null);
  };

  const handleBooking = async (shouldUpdateProfilePhone: boolean = false) => {
    if (!selectedSlot || selectedServices.length === 0 || !profile) return;

    const fullPhone = phonePrefix + phoneNumber.replace(/\D/g, '');
    
    if (isForFriend) {
      if (!friendFirstName || !friendLastName || !friendEmail || !friendPhone) {
        alert("Tutti i campi dell'amico sono obbligatori.");
        return;
      }
      if (!friendEmail.includes('@')) {
        alert("Inserisci un'email valida per l'amico.");
        return;
      }
      if (friendPhone.length < 10) {
        alert("Il numero di telefono dell'amico deve contenere almeno 10 cifre.");
        return;
      }
    } else {
      if (phoneNumber.replace(/\D/g, '').length < 10) {
        alert("Il numero di telefono deve contenere almeno 10 cifre.");
        return;
      }
    }

    if (!isForFriend && fullPhone !== profile.phoneNumber && !showPhoneUpdatePopup && !shouldUpdateProfilePhone) {
      if (fullPhone !== profile.phoneNumber) {
        setNewPhoneNumberToUpdate(fullPhone);
        setShowPhoneUpdatePopup(true);
        return; 
      }
    }

    setLoading(true);
    
    const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);
    
    const dayStart = startOfDay(selectedSlot);
    const dayEnd = endOfDay(selectedSlot);

   try {
      // 1. Scarichiamo gli appuntamenti del giorno per trovare gli ostacoli
      const qDay = query(
        collection(db, 'appointments'),
        where('startTime', '>=', Timestamp.fromDate(dayStart)),
        where('startTime', '<=', Timestamp.fromDate(dayEnd)),
        where('status', '==', 'booked')
      );
      const daySnap = await getDocs(qDay);
      const dayApps = daySnap.docs.map(d => d.data() as Appointment).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

      // 2. Anti-doppia prenotazione
      if (dayApps.some(a => a.startTime.toMillis() === selectedSlot.getTime())) {
        alert("Prenotazione non riuscita: questo slot è già stato prenotato. La pagina verrà ricaricata.");
        window.location.reload();
        return;
      }

      // 3. Troviamo la fine del turno
    const dateString = format(selectedSlot, 'yyyy-MM-dd');
    const dayOfWeek = getDay(selectedSlot);
    const exception = specialDays.find(ex => ex.date === dateString);
    
    let activeHours: TimeRange[] = [];
    if (exception && !exception.isClosed) {
      activeHours = exception.openingHours?.length ? exception.openingHours : (businessSettings.weeklySchedule[dayOfWeek]?.shifts || []);
    } else {
      activeHours = businessSettings.weeklySchedule[dayOfWeek]?.shifts || [];
    }
    
    let shiftEnd = dayEnd;
      for (const range of activeHours) {
        const eH = Math.floor(range.end);
        const eM = Math.round((range.end - eH) * 60);
        const currentShiftEnd = setMinutes(setHours(dayStart, eH), eM);
        if (isAfter(currentShiftEnd, selectedSlot)) {
          shiftEnd = currentShiftEnd;
          break;
        }
      }

      // 4. Calcoliamo il vero endTime basandoci sullo spazio disponibile
      const nextApp = dayApps.find(a => a.startTime.toMillis() > selectedSlot.getTime());
      const obstacleTime = nextApp && isBefore(nextApp.startTime.toDate(), shiftEnd) ? nextApp.startTime.toDate() : shiftEnd;
      
      const availableMins = (obstacleTime.getTime() - selectedSlot.getTime()) / 60000;
      const actualDuration = Math.min(totalDuration, availableMins);
      const endTime = addMinutes(selectedSlot, actualDuration);

      const qCancelled = query(
        collection(db, 'appointments'),
        where('startTime', '==', Timestamp.fromDate(selectedSlot)),
        where('status', '==', 'cancelled'),
        where('customerId', '==', profile.uid)
      );
      
      try {
        const cancelledSnapshot = await getDocs(qCancelled);
        for (const d of cancelledSnapshot.docs) {
          await deleteDoc(doc(db, 'appointments', d.id));
        }
      } catch (err) {
        console.warn("Could not clean up cancelled appointments:", err);
      }

      const qProposals = query(
        collection(db, 'rescheduleProposals'),
        where('status', '==', 'active'),
        where('gapStartTime', '==', Timestamp.fromDate(selectedSlot))
      );

      try {
        const proposalSnapshot = await getDocs(qProposals);
        for (const d of proposalSnapshot.docs) {
          await updateDoc(doc(db, 'rescheduleProposals', d.id), { status: 'cancelled' });
          const notifQ = query(collection(db, 'notifications'), where('proposalId', '==', d.id));
          const notifSnap = await getDocs(notifQ);
          for (const nd of notifSnap.docs) {
            await deleteDoc(doc(db, 'notifications', nd.id));
          }
        }
      } catch (err) {
        console.warn("Could not clean up active proposals:", err);
      }

      const appointmentData: any = {
        customerId: profile.uid,
        services: selectedServices,
        startTime: Timestamp.fromDate(selectedSlot),
        endTime: Timestamp.fromDate(endTime),
        status: 'booked',
        totalAmount: totalAmount,
        createdAt: Timestamp.now(),
        isForFriend: isForFriend
      };

      if (isForFriend) {
        appointmentData.friendDetails = {
          firstName: friendFirstName,
          lastName: friendLastName,
          phone: friendPhone,
          email: friendEmail
        };
      }

      const appointmentRef = await addDoc(collection(db, 'appointments'), appointmentData);
      
      try {
        const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber')));
        for (const barberDoc of barberSnapshot.docs) {
          await addDoc(collection(db, 'notifications'), {
            userId: barberDoc.id,
            title: 'Nuova Prenotazione',
            message: `${profile?.displayName} ha prenotato per il ${format(selectedSlot, 'd MMM HH:mm')}`,
            type: 'booking',
            read: false,
            createdAt: Timestamp.now(),
            appointmentId: appointmentRef.id
          });
        }
      } catch (err) {
        console.warn("Could not notify barber:", err);
      }
      
      notifySystemByEmail({
        type: 'new_booking',
        customerName: isForFriend ? `${friendFirstName} ${friendLastName}` : (profile?.displayName || 'Cliente'),
        date: format(selectedSlot, 'dd/MM/yyyy'),
        time: format(selectedSlot, 'HH:mm'),
        services: selectedServices.map(s => s.name).join(', ')
      });

      if (shouldUpdateProfilePhone && newPhoneNumberToUpdate) {
        try {
          await updateDoc(doc(db, 'users', profile.uid), { phoneNumber: newPhoneNumberToUpdate });
        } catch (err) {
          console.warn("Could not update profile phone:", err);
        }
      }

      setBookingSuccess(true);
      setIsForFriend(false);
      setFriendFirstName('');
      setFriendLastName('');
      setFriendEmail('');
      setFriendPhone('');
      setShowPhoneUpdatePopup(false);
      setNewPhoneNumberToUpdate(null);
      setSelectedServices([]);
      setSelectedSlot(null);

      setTimeout(() => {
        setBookingSuccess(false);
      }, 5000);

    } catch (error) {
      if (error instanceof Error && error.message.includes('appointments')) {
        throw error;
      }
      handleFirestoreError(error, OperationType.CREATE, 'appointments');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (app: Appointment) => {
    const now = new Date();
    const appStart = app.startTime.toDate();
    const createdAt = app.createdAt?.toDate ? app.createdAt.toDate() : new Date(0);
    
    if (app.status === 'completed' || isBefore(appStart, now)) {
      alert("Non puoi annullare un appuntamento passato o completato.");
      return;
    }

    const hoursDiff = (appStart.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isGracePeriod = differenceInMinutes(now, createdAt) <= 15;

    if (hoursDiff < 6 && !isGracePeriod) {
      alert("Puoi annullare solo fino a 6 ore prima dell'appuntamento. (Hai 15 minuti di tempo dopo aver prenotato per correggere un eventuale errore).");
      return;
    }

    try {
      await updateDoc(doc(db, 'appointments', app.id!), {
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        cancelledBy: 'customer'
      });

      const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber')));
      
      for (const barberDoc of barberSnapshot.docs) {
        await addDoc(collection(db, 'notifications'), {
          userId: barberDoc.id,
          title: 'Appuntamento Annullato',
          message: `${profile?.displayName} ha annullato l'appuntamento del ${format(appStart, 'd MMM HH:mm')}`,
          type: 'cancellation',
          read: false,
          createdAt: Timestamp.now(),
          appointmentId: app.id
        });
      }

      notifySystemByEmail({
        type: 'cancellation',
        customerName: profile?.displayName || 'Cliente',
        date: format(appStart, 'dd/MM/yyyy'),
        time: format(appStart, 'HH:mm'),
        services: app.services.map(s => s.name).join(', ')
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `appointments/${app.id}`);
    }
  };

  const handleProposalAction = async (proposal: RescheduleProposal, action: 'accepted' | 'declined') => {
    setLoading(true);
    try {
      const proposalRef = doc(db, 'rescheduleProposals', proposal.id!);
      const proposalDoc = await getDoc(proposalRef);
      
      if (!proposalDoc.exists() || proposalDoc.data().status !== 'active') {
        console.warn("Proposal not active or not found");
        return;
      }
      
      const freshProposal = { id: proposalDoc.id, ...proposalDoc.data() } as RescheduleProposal;
      const updatedTargets = [...freshProposal.targets];
      const currentTarget = updatedTargets[freshProposal.currentIdx];

      if (currentTarget.userId !== profile?.uid || currentTarget.status !== 'pending') {
        console.warn("Not user's turn or already processed");
        return;
      }
      
     if (action === 'accepted') {
        const appDoc = await getDoc(doc(db, 'appointments', currentTarget.appointmentId));
        if (!appDoc.exists()) {
          console.error("Original appointment not found");
          currentTarget.status = 'expired';
          await updateDoc(proposalRef, { targets: updatedTargets });
          return;
        }

        const myApp = appDoc.data() as Appointment;

        // 🚀 BLOCCO STALE DATA: Intercetta l'appuntamento già annullato
        if (myApp.status !== 'booked') {
          alert("Questo appuntamento è stato annullato o completato dal barbiere. La proposta di cambio non è più valida.");
          await updateDoc(proposalRef, { status: 'cancelled' });
          setProposals(prev => prev.filter(p => p.id !== proposal.id));
          setSelectedProposal(null);
          setLoading(false);
          return;
        }
        
        const newStartTime = currentTarget.proposedStartTime ? currentTarget.proposedStartTime.toDate() : freshProposal.gapStartTime.toDate();
        
        // 🚀 APPLICAZIONE DECOMPRESSIONE: Se la proposta contiene la fine (Shift intelligente), usala!
        let newEndTime: Date;
        if (currentTarget.proposedEndTime) {
          newEndTime = currentTarget.proposedEndTime.toDate();
        } else {
          // Fallback legacy per retrocompatibilità
          const duration = (myApp.endTime.toDate().getTime() - myApp.startTime.toDate().getTime());
          newEndTime = new Date(newStartTime.getTime() + duration);
        }

        // 🚀 PRE-CHECK ANTI-SOVRAPPOSIZIONE (Previene la doppia accettazione)
        const conflictQuery = query(
          collection(db, 'appointments'),
          where('status', '==', 'booked'),
          where('startTime', '<', Timestamp.fromDate(newEndTime)),
          where('endTime', '>', Timestamp.fromDate(newStartTime))
        );
        const conflictSnap = await getDocs(conflictQuery);
        // Filtriamo se stesso per evitare falsi positivi
        const realConflicts = conflictSnap.docs.filter(d => d.id !== currentTarget.appointmentId);
        
        if (realConflicts.length > 0) {
          alert("Spiacenti, questo orario non è più disponibile perché il barbiere ha già riempito lo spazio. L'appuntamento rimarrà al tuo orario originale.");
          await updateDoc(proposalRef, { status: 'cancelled' });
          setProposals(prev => prev.filter(p => p.id !== proposal.id));
          setSelectedProposal(null);
          setLoading(false);
          return; // Blocca tutto e non sovrascrive
        }

        await updateDoc(doc(db, 'appointments', currentTarget.appointmentId), {
          startTime: Timestamp.fromDate(newStartTime),
          endTime: Timestamp.fromDate(newEndTime),
          status: 'booked',
          updatedAt: Timestamp.now()
        });

        if (freshProposal.gapAppointmentId) {
          try {
            await deleteDoc(doc(db, 'appointments', freshProposal.gapAppointmentId));
          } catch (e) {
            console.warn("Gap appointment delete skipped:", e);
          }
        }
        
        const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber')));
        for (const barberDoc of barberSnapshot.docs) {
          await addDoc(collection(db, 'notifications'), {
            userId: barberDoc.id,
            title: 'Proposta Accettata',
            message: `Il cliente ${profile?.displayName} ha accettato la tua proposta per il ${format(proposal.gapStartTime.toDate(), 'd MMM HH:mm')}`,
            type: 'booking',
            read: false,
            createdAt: Timestamp.now(),
            appointmentId: currentTarget.appointmentId 
          });
        }

        notifySystemByEmail({
          type: 'proposal_accepted',
          customerName: profile?.displayName || 'Cliente',
          date: format(newStartTime, 'dd/MM/yyyy'),
          time: format(newStartTime, 'HH:mm'),
          proposalDetails: {
            oldDate: format(myApp.startTime.toDate(), 'dd/MM/yyyy'),
            oldTime: format(myApp.startTime.toDate(), 'HH:mm')
          }
        });

        await updateDoc(proposalRef, { 
          status: 'completed',
          updatedAt: Timestamp.now()
        });

        try {
          const notifQ = query(
            collection(db, 'notifications'), 
            where('proposalId', '==', proposal.id),
            where('userId', '==', profile?.uid)
          );
          const notifSnapshot = await getDocs(notifQ);
          for (const d of notifSnapshot.docs) {
            await deleteDoc(doc(db, 'notifications', d.id));
          }
        } catch (err) {
          console.warn("Pulizia notifiche utente completata con avviso:", err);
        }
      } else {
        currentTarget.status = 'declined';
        
        const nextIdx = freshProposal.currentIdx + 1;
        
        if (nextIdx < updatedTargets.length) {
          updatedTargets[nextIdx].status = 'pending';
          updatedTargets[nextIdx].notifiedAt = Timestamp.now();
          updatedTargets[nextIdx].expiresAt = Timestamp.fromDate(addMinutes(new Date(), 15));
          
          await updateDoc(proposalRef, {
            targets: updatedTargets,
            currentIdx: nextIdx
          });

          await addDoc(collection(db, 'notifications'), {
            userId: updatedTargets[nextIdx].userId,
            title: 'Proposta di Cambio Orario',
            message: `Il barbiere ti propone un anticipo! Hai 15 minuti per accettare.`,
            type: 'reschedule_proposal',
            read: false,
            createdAt: Timestamp.now(),
            proposalId: proposal.id
          });
        } else {
          await updateDoc(proposalRef, {
            targets: updatedTargets,
            status: 'completed'
          });
        }

        try {
          const appDoc = await getDoc(doc(db, 'appointments', currentTarget.appointmentId));
          const myApp = appDoc.exists() ? (appDoc.data() as Appointment) : null;
          
          const customerPhone = myApp?.isForFriend 
            ? myApp?.friendDetails?.phone 
            : (myApp?.customer?.phoneNumber || profile?.phoneNumber || '');

          const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber')));
          for (const barberDoc of barberSnapshot.docs) {
            await addDoc(collection(db, 'notifications'), {
              userId: barberDoc.id,
              title: 'Proposta Rifiutata',
              message: `Il cliente ${profile?.displayName || 'Cliente'} ha preferito mantenere il suo orario.`,
              type: 'proposal_declined',
              read: false,
              createdAt: Timestamp.now(),
              declinedDetails: {
                customerName: profile?.displayName || 'Cliente',
                customerPhone: customerPhone,
                originalTime: myApp?.startTime || proposal.gapStartTime,
                proposedTime: currentTarget.proposedStartTime || proposal.gapStartTime
              }
            });
          }

          notifySystemByEmail({
            type: 'proposal_declined',
            customerName: profile?.displayName || 'Cliente',
            date: format(myApp?.startTime?.toDate() || freshProposal.gapStartTime.toDate(), 'dd/MM/yyyy'),
            time: format(myApp?.startTime?.toDate() || freshProposal.gapStartTime.toDate(), 'HH:mm'),
            proposalDetails: {
              oldTime: format(myApp?.startTime?.toDate() || freshProposal.gapStartTime.toDate(), 'HH:mm'),
              proposedTime: format(freshProposal.gapStartTime.toDate(), 'HH:mm')
            }
          });

        } catch (err) {
          console.warn("Impossibile inviare notifica di rifiuto al barbiere:", err);
        }
      }

      if (profile?.uid) {
        const userNotifQ = query(
          collection(db, 'notifications'),
          where('proposalId', '==', proposal.id),
          where('userId', '==', profile.uid)
        );
        
        const userNotifSnapshot = await getDocs(userNotifQ);
        for (const d of userNotifSnapshot.docs) {
          await deleteDoc(doc(db, 'notifications', d.id));
        }
      }

      setProposals(prev => prev.filter(p => p.id !== proposal.id));
      setSelectedProposal(null);
      if (onProposalDialogClose) onProposalDialogClose();
      
    } catch (error) {
      console.error("Error handling proposal action:", error);
      const opType = action === 'accepted' ? OperationType.DELETE : OperationType.UPDATE;
      handleFirestoreError(error, opType, `rescheduleProposals/${proposal.id}`);
      alert("Si è verificato un errore durante l'aggiornamento della proposta. Riprova.");
    } finally {
      setLoading(false);
    }
  };

  // 🚀 MEMOIZZAZIONE REGOLE CALENDARIO (Singola Funzione Blindata)
  const disabledDays = useMemo(() => {
    return (date: Date) => {
      // 1. Limiti temporali assoluti (Blocca il passato o date oltre i 150 giorni)
      if (isBefore(startOfDay(date), todayNormalized)) return true;
      if (isAfter(startOfDay(date), maxBookingDate)) return true;

      const dateString = format(date, 'yyyy-MM-dd');
      
      // 2. Eccezioni del Calendario (Ferie o Aperture Straordinarie)
      const exception = specialDays.find(ex => ex.date === dateString);
      if (exception) {
        if (exception.isClosed) return true; // Ferie forzate
        if (fullyBookedDays.includes(dateString)) return true; // Aperto eccezionalmente, ma esaurito
        return false; // Domenica aperta e con posti: Rendila cliccabile!
      }
      
      // 3. Regole Standard di chiusura granulare
      if (!businessSettings.weeklySchedule[getDay(date)]?.isOpen) return true;
      
      // 4. Scudo anti-overbooking per i giorni standard
      if (fullyBookedDays.includes(dateString)) return true;
      
      return false;
    };
  }, [todayNormalized, maxBookingDate, specialDays, businessSettings, fullyBookedDays]);

  const upcomingAppointments = myAppointments
    .filter(a => (a.status === 'booked' || a.status === 'cancelled') && a.startTime.toDate() > new Date())
    .sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    
  const activeAppointment = upcomingAppointments.find(a => a.status === 'booked');

  const pastAppointments = myAppointments
    .filter(a => 
      a.status === 'completed' || 
      (a.status === 'cancelled' && a.startTime.toDate() <= new Date()) ||
      (a.status === 'booked' && a.startTime.toDate() <= new Date()) ||
      a.id === highlightedAppId
    )
    .sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis())
    .slice(0, 10);

  return (
    <div className="max-w-4xl mx-auto pb-32 px-4 sm:px-6 overflow-x-hidden w-full">
      {/* Mobile Tab Navigation */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-black/90 backdrop-blur-xl border border-white/10 rounded-full p-1.5 shadow-2xl flex items-center gap-1">
        <button 
          onClick={() => setActiveTab('booking')}
          className={cn(
            "px-6 py-2.5 rounded-full text-xs font-bold transition-all flex items-center gap-2",
            activeTab === 'booking' ? "bg-white text-black" : "text-gray-400 hover:text-white"
          )}
        >
          <Scissors size={16} /> Prenota
        </button>
        <button 
          onClick={() => setActiveTab('appointments')}
          className={cn(
            "px-6 py-2.5 rounded-full text-xs font-bold transition-all flex items-center gap-2",
            activeTab === 'appointments' ? "bg-white text-black" : "text-gray-400 hover:text-white"
          )}
        >
          <CalendarIcon size={16} /> Appuntamenti
        </button>
        <button 
          onClick={() => setActiveTab('contacts')}
          className={cn(
            "px-6 py-2.5 rounded-full text-xs font-bold transition-all flex items-center gap-2",
            activeTab === 'contacts' ? "bg-white text-black" : "text-gray-400 hover:text-white"
          )}
        >
          <Phone size={16} /> Contatti
        </button>
      </div>

      {activeTab === 'booking' && (
        <div className="space-y-12 animate-in fade-in duration-500">
          {/* Reschedule Proposals */}
          {proposals.length > 0 && (
            <div className="space-y-4">
              {proposals.map(proposal => (
                <button 
                  key={proposal.id} 
                  onClick={() => setSelectedProposal(proposal)}
                  className="w-full bg-emerald-600 text-white rounded-3xl p-4 sm:p-6 shadow-xl animate-in slide-in-from-top-4 text-left group hover:bg-emerald-700 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-emerald-200 text-xs font-bold uppercase tracking-widest">
                      <ArrowUpCircle size={16} /> Proposta di anticipo
                    </div>
                    <div className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">
                      Scade tra {Math.max(0, Math.ceil((proposal.targets[proposal.currentIdx].expiresAt.toDate().getTime() - currentTime.getTime()) / 60000))} min
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <p className="text-sm opacity-90 mb-1">Il barbiere ti propone di anticipare:</p>
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-bold">{format((proposal.targets[proposal.currentIdx].proposedStartTime || proposal.gapStartTime).toDate(), 'HH:mm')}</span>
                        <span className="text-xs opacity-60">invece di</span>
                        <span className="text-sm opacity-70 line-through">
                          {format(myAppointments.find(a => a.id === proposal.targets[proposal.currentIdx].appointmentId)?.startTime.toDate() || new Date(), 'HH:mm')}
                        </span>
                      </div>
                    </div>
                    <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ChevronRight size={20} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Proposal Detail Modal */}
          {selectedProposal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in">
              <div className="bg-white/95 backdrop-blur-xl w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-gray-100/50 flex justify-between items-center bg-emerald-600/90 text-white flex-shrink-0">
                  <h3 className="text-xl font-bold">Dettaglio Proposta</h3>
                  <button onClick={() => setSelectedProposal(null)} className="p-1 hover:bg-white/10 rounded-full">
                    <XCircle size={24} />
                  </button>
                </div>
                <div className="p-6 sm:p-8 space-y-6 overflow-y-auto">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                      <Clock size={32} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-1">Nuovo Orario Proposto</div>
                      <div className="text-3xl font-bold">{format((selectedProposal.targets[selectedProposal.currentIdx].proposedStartTime || selectedProposal.gapStartTime).toDate(), 'HH:mm')}</div>
                      <div className="text-[10px] text-emerald-600 font-bold uppercase mt-1">
                        Scade tra {Math.max(0, Math.ceil((selectedProposal.targets[selectedProposal.currentIdx].expiresAt.toDate().getTime() - currentTime.getTime()) / 60000))} min
                      </div>
                      <div className="text-sm text-emerald-600/70 font-medium">
                        {format(selectedProposal.gapStartTime.toDate(), 'EEEE d MMMM yyyy', { locale: it })}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-2xl space-y-2 border border-gray-100">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Il tuo appuntamento attuale</div>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                      <div className="font-bold text-gray-700">
                        {format(myAppointments.find(a => a.id === selectedProposal.targets[selectedProposal.currentIdx].appointmentId)?.startTime.toDate() || new Date(), 'EEEE d MMMM yyyy', { locale: it })}
                      </div>
                      <div className="text-sm font-bold text-gray-500 bg-white px-2 py-1 rounded-lg border border-gray-100 inline-block w-fit">
                        {format(myAppointments.find(a => a.id === selectedProposal.targets[selectedProposal.currentIdx].appointmentId)?.startTime.toDate() || new Date(), 'HH:mm')}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Servizi Prenotati</div>
                    <div className="flex flex-wrap gap-2">
                      {myAppointments.find(a => a.id === selectedProposal.targets[selectedProposal.currentIdx].appointmentId)?.services.map(s => (
                        <span key={s.id} className="px-3 py-1.5 bg-black text-white rounded-full text-xs font-bold flex items-center gap-2">
                          <Scissors size={12} /> {s.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-6 border-t border-gray-100 flex flex-col gap-3">
                    <button
                      disabled={loading}
                      onClick={() => handleProposalAction(selectedProposal, 'accepted')}
                      className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                    >
                      Accetta Cambio
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => handleProposalAction(selectedProposal, 'declined')}
                      className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all"
                    >
                      Rifiuta
                    </button>
                    <button
                      onClick={() => setSelectedProposal(null)}
                      className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                    >
                      Chiudi
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active Appointment Reminder */}
          {activeAppointment && (
            <div className="bg-black/80 backdrop-blur-md text-white rounded-[32px] p-8 shadow-2xl relative overflow-hidden border border-white/10">
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-gray-400 text-sm font-bold uppercase tracking-widest mb-4">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  Il tuo prossimo appuntamento
                </div>
                <div className="flex flex-col md:flex-row justify-between gap-6">
                  <div>
                    <div className="text-4xl font-bold mb-2">
                      {format(activeAppointment.startTime.toDate(), 'HH:mm')}
                    </div>
                    <div className="text-xl text-gray-300">
                      {format(activeAppointment.startTime.toDate(), 'EEEE d MMMM', { locale: it })}
                    </div>
                  </div>
                  <div className="flex flex-col justify-end items-start md:items-end gap-4">
                    <div className="flex gap-2">
                      {activeAppointment.services.map(s => (
                        <span key={s.id} className="px-3 py-1 bg-white/10 rounded-full text-xs border border-white/20">
                          {s.name}
                        </span>
                      ))}
                    </div>
                    {activeAppointment.status === 'booked' && !isBefore(activeAppointment.startTime.toDate(), new Date()) && (
                      <button
                        onClick={() => setShowCancelConfirm(activeAppointment)}
                        className="text-sm text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                      >
                        <XCircle size={16} /> Annulla prenotazione
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <Scissors className="absolute -bottom-8 -right-8 text-white/5 w-48 h-48 rotate-12" />
            </div>
          )}

          {bookingSuccess && (
            <div className="bg-emerald-50/80 backdrop-blur-sm border border-emerald-100 text-emerald-700 p-4 rounded-2xl flex items-center gap-3 animate-in fade-in">
              <CheckCircle2 className="text-emerald-500" />
              Prenotazione effettuata con successo!
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-8">
            <section className="space-y-6 bg-white/80 backdrop-blur-md p-4 sm:p-6 rounded-3xl border border-white/20 shadow-xl">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <span className="w-8 h-8 bg-black text-white rounded-full flex items-center justify-center text-sm">1</span>
                Scegli i servizi
              </h2>
              <div className="grid gap-4">
                {SERVICES.map(service => (
                  <button
                    key={service.id}
                    onClick={() => toggleService(service)}
                    className={`w-full p-4 rounded-2xl border text-left transition-all flex justify-between items-center ${
                      selectedServices.find(s => s.id === service.id)
                      ? 'border-black bg-black text-white shadow-lg'
                      : 'border-gray-400 hover:border-black bg-white'
                    }`}
                  >
                    <div>
                      <div className="font-bold">{service.name}</div>
                      {service.description && (
                        <div className={cn("text-xs mt-0.5 mb-1 leading-tight", selectedServices.find(s => s.id === service.id) ? "text-gray-300" : "text-gray-500")}>
                          {service.description}
                        </div>
                      )}
                      <div className={`text-sm ${selectedServices.find(s => s.id === service.id) ? 'text-gray-400' : 'text-gray-500 font-medium'}`}>
                        {service.duration} min • €{service.price}
                      </div>
                    </div>
                    {selectedServices.find(s => s.id === service.id) && <CheckCircle2 size={20} />}
                  </button>
                ))}
              </div>
              {selectedServices.length > 0 && (
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">Durata totale:</span>
                    <span className="font-bold">{selectedServices.reduce((acc, s) => acc + s.duration, 0)} min</span>
                  </div>
                  <div className="flex justify-between text-lg">
                    <span className="font-bold">Totale:</span>
                    <span className="font-bold">€{selectedServices.reduce((acc, s) => acc + s.price, 0)}</span>
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-6 bg-white/80 backdrop-blur-md p-4 sm:p-6 rounded-3xl border border-white/20 shadow-xl">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <span className="w-8 h-8 bg-black text-white rounded-full flex items-center justify-center text-sm">2</span>
                Scegli data e ora
              </h2>
              
              <div className="space-y-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Data</div>
                <div className="flex justify-center bg-white border border-gray-100 rounded-3xl p-2 sm:p-4 shadow-sm">
                  <DayPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(startOfDay(date));
                        setSelectedSlot(null);
                      }
                    }}
                    disabled={disabledDays}
                    locale={it}
                    className="border-none w-full flex justify-center"
                    modifiersClassNames={{
                      selected: "bg-black text-white rounded-full",
                      today: "text-emerald-600 font-bold"
                    }}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="text-sm font-bold text-gray-400 uppercase tracking-widest">Orari disponibili</div>
                {selectedServices.length === 0 ? (
                  <div className="text-gray-400 text-sm italic">Seleziona almeno un servizio per vedere gli orari.</div>
                ) : loading ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-black"></div>
                    Calcolo orari...
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-center gap-2">
                    <AlertCircle size={16} /> Nessun orario disponibile per questa data.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {availableSlots.map(slot => (
                      <button
                        key={slot.toISOString()}
                        onClick={() => setSelectedSlot(slot)}
                        className={`py-3 rounded-xl border text-sm font-bold transition-all ${
                          selectedSlot && slot.getTime() === selectedSlot.getTime()
                          ? 'border-black bg-black text-white shadow-md'
                          : 'border-gray-400 hover:border-black bg-white'
                        }`}
                      >
                        {format(slot, 'HH:mm')}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedSlot && (
                <div className="space-y-6 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <input
                      type="checkbox"
                      id="forFriend"
                      checked={isForFriend}
                      onChange={(e) => setIsForFriend(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300 text-black focus:ring-black"
                    />
                    <label htmlFor="forFriend" className="text-sm font-bold cursor-pointer">
                      Prenota per un amico
                    </label>
                  </div>

                  {isForFriend ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Nome Amico</label>
                          <input
                            type="text"
                            value={friendFirstName}
                            onChange={(e) => setFriendFirstName(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-black outline-none text-sm"
                            placeholder="Nome"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cognome Amico</label>
                          <input
                            type="text"
                            value={friendLastName}
                            onChange={(e) => setFriendLastName(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-black outline-none text-sm"
                            placeholder="Cognome"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Email Amico</label>
                        <input
                          type="email"
                          value={friendEmail}
                          onChange={(e) => setFriendEmail(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-black outline-none text-sm"
                          placeholder="email@esempio.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Telefono Amico</label>
                        <input
                          type="tel"
                          value={friendPhone}
                          onChange={(e) => setFriendPhone(e.target.value.replace(/\D/g, ''))}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-black outline-none text-sm"
                          placeholder="Min. 10 cifre"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Il tuo numero di telefono</label>
                      <div className="flex gap-2">
                        <div className="relative w-32">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          <select
                            value={phonePrefix}
                            onChange={(e) => setPhonePrefix(e.target.value)}
                            className="w-full pl-9 pr-2 py-3 rounded-xl border border-gray-200 focus:border-black focus:ring-0 outline-none appearance-none bg-white text-sm"
                          >
                            {COUNTRY_CODES.map(c => (
                              <option key={c.code} value={c.dial_code}>{c.flag} {c.dial_code}</option>
                            ))}
                          </select>
                        </div>
                        <div className="relative flex-1">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                          <input
                            type="tel"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                            placeholder="Min. 10 cifre"
                            className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:border-black focus:ring-0 outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => handleBooking()}
                    disabled={loading || (!isForFriend && phoneNumber.length < 10) || (isForFriend && friendPhone.length < 10)}
                    className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? 'Prenotazione in corso...' : 'Conferma Prenotazione'}
                    <ChevronRight size={20} />
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* Phone Update Popup */}
          {showPhoneUpdatePopup && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120] p-4 animate-in fade-in">
              <div className="bg-white/95 backdrop-blur-xl w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20 animate-in zoom-in-95 text-center">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Phone size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-2">Aggiorna Telefono?</h3>
                <p className="text-gray-500 mb-8 leading-relaxed text-sm">
                  Hai inserito un numero diverso da quello salvato nel tuo profilo. Desideri aggiornarlo permanentemente?
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => handleBooking(true)}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all"
                  >
                    Sì, aggiorna e prenota
                  </button>
                  <button
                    onClick={() => handleBooking(false)}
                    className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                  >
                    No, prenota e basta
                  </button>
                  <button
                    onClick={() => setShowPhoneUpdatePopup(false)}
                    className="w-full py-2 text-xs text-gray-400 hover:underline"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'appointments' && (
        <div className="space-y-12 animate-in fade-in duration-500">
          <section>
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
              <CalendarIcon size={24} className="text-gray-400" />
              Prossimi Appuntamenti
            </h2>
            {upcomingAppointments.length === 0 ? (
              <div className="bg-white/50 backdrop-blur-sm rounded-3xl p-12 text-center border border-dashed border-gray-300">
                <p className="text-gray-400 font-medium">Non hai appuntamenti futuri.</p>
                <button 
                  onClick={() => setActiveTab('booking')}
                  className="mt-4 text-black font-bold hover:underline"
                >
                  Prenota ora →
                </button>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {upcomingAppointments.map(app => (
                  <AppointmentTicket 
                    key={app.id} 
                    app={app} 
                    onCancel={setShowCancelConfirm} 
                    isHighlighted={highlightedAppId === app.id}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
              <Clock size={24} className="text-gray-400" />
              Storico Appuntamenti
            </h2>
            {pastAppointments.length === 0 ? (
              <div className="text-center py-12 text-gray-400 italic">Nessun appuntamento passato registrato.</div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {pastAppointments.map(app => (
                  <AppointmentTicket 
                    key={app.id} 
                    app={app} 
                    isHighlighted={highlightedAppId === app.id}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'contacts' && (
        <div className="animate-in fade-in duration-500">
          <section className="pb-12">
            <h2 className="text-2xl font-bold mb-8">Contatti e Posizione</h2>
            <div className="bg-white/95 backdrop-blur-xl rounded-[32px] border border-white/20 shadow-2xl overflow-hidden">
              <div className="p-8 space-y-8">
                <div className="grid gap-8 sm:grid-cols-2">
                  <div className="space-y-6">
                    <div className="relative">
                      <button 
                        onClick={() => setShowContactMenu(!showContactMenu)}
                        className="w-full flex items-center gap-4 group hover:bg-gray-50 p-3 -m-3 rounded-2xl transition-all text-left"
                      >
                        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Phone size={24} />
                        </div>
                        <div className="flex-1">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Telefono</div>
                          <div className="font-bold text-gray-900">{SALON_INFO.phone}</div>
                        </div>
                        <ChevronDown size={20} className={cn("text-gray-400 transition-transform", showContactMenu && "rotate-180")} />
                      </button>

                      {showContactMenu && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in slide-in-from-top-2">
                          <a 
                            href={`tel:+${SALON_INFO.whatsapp}`}
                            className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors border-b border-gray-50"
                          >
                            <Phone size={18} className="text-emerald-600" />
                            <span className="font-bold">Chiama ora</span>
                          </a>
                          <a 
                            href="https://wa.me/390123456789"
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
                          >
                            <MessageCircle size={18} className="text-emerald-500" />
                            <span className="font-bold">Chat su WhatsApp</span>
                          </a>
                        </div>
                      )}
                    </div>

                    <a 
                      href={`mailto:${BARBER_EMAILS[0]}`} 
                      className="flex items-center gap-4 group hover:bg-gray-50 p-3 rounded-2xl transition-all"
                    >
                      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Mail size={24} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Email</div>
                        <div className="font-bold text-gray-900 break-all">{BARBER_EMAILS[0]}</div>
                      </div>
                    </a>

                    <a 
                      href={SALON_INFO.instagramUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="flex items-center gap-4 group hover:bg-gray-50 p-3 -m-3 rounded-2xl transition-all"
                    >
                      <div className="w-12 h-12 bg-pink-50 text-pink-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Instagram size={24} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Instagram</div>
                        <div className="font-bold text-gray-900">{SALON_INFO.instagram}</div>
                      </div>
                    </a>
                  </div>

                  <div className="space-y-6">
                    <a 
                      href={SALON_INFO.mapsUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="flex items-center gap-4 group hover:bg-gray-50 p-3 -m-3 rounded-2xl transition-all"
                    >
                      <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <AlertCircle size={24} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Indirizzo</div>
                        <div className="font-bold text-gray-900">{SALON_INFO.address}</div>
                        <div className="text-xs text-emerald-600 font-bold mt-1">Apri nel navigatore →</div>
                      </div>
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50/50 p-8 border-t border-gray-100">
                <div className="flex items-center gap-3 mb-6">
                  <Clock size={20} className="text-gray-400" />
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Orari di Apertura</div>
                </div>

                <div className="flex flex-col gap-2">
                  {[1, 2, 3, 4, 5, 6, 0].map(dayIndex => {
                    const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
                    const dayData = businessSettings.weeklySchedule?.[dayIndex];

                    if (!dayData) return null;

                    return (
                      <div key={dayIndex} className="flex justify-between items-center p-3 sm:p-4 bg-white rounded-2xl shadow-sm border border-gray-100">
                        <span className="text-gray-700 font-bold text-sm">{dayNames[dayIndex]}</span>
                        <div className="text-right">
                          {!dayData.isOpen || dayData.shifts.length === 0 ? (
                            <span className="text-xs font-bold text-red-500 uppercase tracking-wider">Chiuso</span>
                          ) : (
                            dayData.shifts.map((range, i) => {
                              const startH = Math.floor(range.start);
                              const startM = Math.round((range.start - startH) * 60);
                              const endH = Math.floor(range.end);
                              const endM = Math.round((range.end - endH) * 60);
                              const timeStr = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')} - ${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                              return <div key={i} className="font-bold text-gray-900 text-xs">{timeStr}</div>;
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Calendar Modal */}
      {showCalendar && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl border border-white/20 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Seleziona Data</h3>
              <button 
                onClick={() => setShowCalendar(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <XCircle size={24} className="text-gray-400" />
              </button>
            </div>
            
            <div className="flex justify-center bg-gray-50 rounded-2xl p-4 mb-6">
              <DayPicker
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    const normalizedDate = startOfDay(date);
                    setSelectedDate(normalizedDate);
                    setWindowStart(normalizedDate);
                    setSelectedSlot(null);
                    setShowCalendar(false);
                  }
                }}
                disabled={disabledDays}
                locale={it}
                className="border-none"
                modifiersClassNames={{
                  selected: "bg-black text-white rounded-full",
                  today: "text-emerald-600 font-bold"
                }}
              />
            </div>

            <button
              onClick={() => setShowCalendar(false)}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all"
            >
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4 animate-in fade-in">
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-2xl font-bold mb-2">Conferma Annullamento</h3>
            <p className="text-gray-500 mb-8 leading-relaxed text-sm">
              Sei sicuro di voler annullare l'appuntamento del <span className="font-bold text-black">{format(showCancelConfirm.startTime.toDate(), 'd MMMM yyyy HH:mm', { locale: it })}</span>? Questa azione non può essere annullata.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  handleCancel(showCancelConfirm);
                  setShowCancelConfirm(null);
                }}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all"
              >
                Sì, Annulla
              </button>
              <button
                onClick={() => setShowCancelConfirm(null)}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
              >
                No, mantieni
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}