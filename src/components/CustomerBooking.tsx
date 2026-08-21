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
  deleteDoc,
  limit
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../App';
import { SERVICES, OPENING_HOURS, CLOSED_DAYS, COUNTRY_CODES, BARBER_EMAILS } from '../constants';
import { Appointment, Service, RescheduleProposal } from '../types';
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
import 'react-day-picker/style.css'; // MODIFICATO: percorso corretto per react-day-picker v9
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
  }
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
  isHighlighted?: boolean // <--- NUOVA PROP
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
        
        // 1. STATO NORMALE: Non evidenziato e Annullato (Grigio e sbiadito)
        !isHighlighted && isCancelled && "bg-white opacity-60 grayscale border border-gray-100 shadow-md",
        
        // 2. STATO NORMALE: Non evidenziato e Valido (Bianco normale)
        !isHighlighted && !isCancelled && "bg-white border border-gray-100 hover:shadow-lg shadow-md",
        
        // 3. EVIDENZIATO E ANNULLATO: Torna opaco al 100%, toglie il grigio ed emette un bagliore ROSSO
        isHighlighted && isCancelled && "bg-red-50/95 border-2 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)] ring-4 ring-red-500/30 scale-[1.02] z-20 opacity-100 grayscale-0",
        
        // 4. EVIDENZIATO E VALIDO: Emette un bagliore VERDE
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

  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  
  const next7Days = useMemo(() => eachDayOfInterval({
    start: new Date(),
    end: addDays(new Date(), 30)
  }).filter(d => !CLOSED_DAYS.includes(getDay(d))), []);

  const [selectedDate, setSelectedDate] = useState<Date>(next7Days[0]);
  const [availableSlots, setAvailableSlots] = useState<Date[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  
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
  }, [selectedDate, selectedServices]);

// Ascolta il click dalla notifica e lancia l'animazione
  useEffect(() => {
    if (selectedAppointmentId) {
      // 1. Sposta sulla tab appuntamenti
      setActiveTab('appointments');
      // 2. Imposta l'appuntamento da illuminare
      setHighlightedAppId(selectedAppointmentId);

      // 3. Aspettiamo mezzo secondo (500ms) per essere CERTI che React 
      // abbia renderizzato la nuova pagina, poi scorriamo con calma
      setTimeout(() => {
        const element = document.getElementById(`appointment-${selectedAppointmentId}`);
        if (element) {
          // Centriamo l'elemento nello schermo dolcemente
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);

      // 4. Aumentiamo il tempo del bagliore a 5 secondi per dare all'utente 
      // il tempo di leggere comodamente la scheda annullata
      setTimeout(() => {
        setHighlightedAppId(null);
      }, 5000);

      // Resetta l'ID notifica verso App.tsx
      if (onAppointmentDialogClose) onAppointmentDialogClose();
    }
  }, [selectedAppointmentId, onAppointmentDialogClose]);

  const calculateSlots = async () => {
    setLoading(true);
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    if (CLOSED_DAYS.includes(getDay(selectedDate))) {
      setAvailableSlots([]);
      setLoading(false);
      return;
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

      const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
      const slots: Date[] = [];

      OPENING_HOURS.forEach(range => {
        let current = setMinutes(setHours(dayStart, range.start), 0);
        const rangeEnd = setMinutes(setHours(dayStart, range.end), 0);

        while (!isAfter(addMinutes(current, totalDuration), rangeEnd)) {
          if (isAfter(current, new Date())) {
            const slotEnd = addMinutes(current, totalDuration);
            
            const isOverlapApp = dayAppointments.some(app => {
              const appStart = app.startTime.toDate();
              const appEnd = app.endTime.toDate();
              return (current < appEnd && slotEnd > appStart);
            });

            if (!isOverlapApp) {
              slots.push(new Date(current));
            }
          }
          current = addMinutes(current, 15);
        }
      });

      setAvailableSlots(slots);
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
            
      // SE I NUMERI SONO DIVERSI: Mostra il popup e ferma l'esecuzione corrente
      if (fullPhone !== profile.phoneNumber) {
        setNewPhoneNumberToUpdate(fullPhone);
        setShowPhoneUpdatePopup(true);
        return; 
      }
      // Se sono uguali, NON fa il return e la prenotazione procede normalmente!
    }

    setLoading(true);
    
    const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);
    const endTime = addMinutes(selectedSlot, totalDuration);

    try {
      // Verifica se esiste già una prenotazione nello stesso slot orario
      const qExisting = query(
        collection(db, 'appointments'),
        where('startTime', '==', Timestamp.fromDate(selectedSlot)),
        where('status', '==', 'booked')
      );
      
      const existingSnapshot = await getDocs(qExisting);
      if (!existingSnapshot.empty) {
        alert("Prenotazione non riuscita: questo slot è già stato prenotato da un altro cliente. La pagina verrà ricaricata.");
        window.location.reload();
        return;
      }

      // Clean up cancelled appointments in same slot (only owned by user)
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

      // Cancel active reschedule proposals in this slot
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

      await addDoc(collection(db, 'appointments'), appointmentData);
      
      try {
        const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber'), limit(1)));
        if (!barberSnapshot.empty) {
          const barberId = barberSnapshot.docs[0].id;
          await addDoc(collection(db, 'notifications'), {
            userId: barberId,
            title: 'Nuova Prenotazione',
            message: `${profile?.displayName} ha prenotato per il ${format(selectedSlot, 'd MMM HH:mm')}`,
            type: 'booking',
            read: false,
            createdAt: Timestamp.now()
          });
        }
      } catch (err) {
        console.warn("Could not notify barber:", err);
      }
      
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

    // Se mancano meno di 6 ore E NON siamo nel periodo di grazia (15 minuti dopo aver prenotato), blocca tutto.
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

      const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber'), limit(1)));
      if (!barberSnapshot.empty) {
        const barberId = barberSnapshot.docs[0].id;
        await addDoc(collection(db, 'notifications'), {
          userId: barberId,
          title: 'Appuntamento Annullato',
          message: `${profile?.displayName} ha annullato l'appuntamento del ${format(appStart, 'd MMM HH:mm')}`,
          type: 'cancellation',
          read: false,
          createdAt: Timestamp.now()
        });
      }
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
        const duration = (myApp.endTime.toDate().getTime() - myApp.startTime.toDate().getTime());
        const newStartTime = freshProposal.gapStartTime.toDate();
        const newEndTime = new Date(newStartTime.getTime() + duration);

        // Aggiorna l'appuntamento originale invece di delete+create
        await updateDoc(doc(db, 'appointments', currentTarget.appointmentId), {
          startTime: Timestamp.fromDate(newStartTime),
          endTime: Timestamp.fromDate(newEndTime),
          status: 'booked',
          updatedAt: Timestamp.now()
        });

        // Elimina il gap appointment se esiste
        if (freshProposal.gapAppointmentId) {
          await deleteDoc(doc(db, 'appointments', freshProposal.gapAppointmentId));
        }
        
        const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber'), limit(1)));
        if (!barberSnapshot.empty) {
          const barberId = barberSnapshot.docs[0].id;
          await addDoc(collection(db, 'notifications'), {
            userId: barberId,
            title: 'Proposta Accettata',
            message: `Il cliente ${profile?.displayName} ha accettato la tua proposta per il ${format(proposal.gapStartTime.toDate(), 'd MMM HH:mm')}`,
            type: 'booking',
            read: false,
            createdAt: Timestamp.now()
          });
        }

        // Elimina la proposta perché è stata accettata
        await deleteDoc(proposalRef);
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

        const barberSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'barber'), limit(1)));
        if (!barberSnapshot.empty) {
          const barberId = barberSnapshot.docs[0].id;
          await addDoc(collection(db, 'notifications'), {
            userId: barberId,
            title: 'Proposta Rifiutata',
            message: `Il cliente ${profile?.displayName} ha rifiutato la tua proposta per il ${format(proposal.gapStartTime.toDate(), 'd MMM HH:mm')}`,
            type: 'booking',
            read: false,
            createdAt: Timestamp.now()
          });
        }
      }

      // Gestione cancellazione notifiche
      let notifQ;
      if (action === 'accepted') {
        notifQ = query(collection(db, 'notifications'), where('proposalId', '==', proposal.id));
      } else {
        notifQ = query(collection(db, 'notifications'), 
          where('proposalId', '==', proposal.id),
          where('userId', '==', profile?.uid)
        );
      }
      
      const notifSnapshot = await getDocs(notifQ);
      for (const d of notifSnapshot.docs) {
        await deleteDoc(doc(db, 'notifications', d.id));
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

  // 1. Prossimi Appuntamenti: Includiamo i "booked" e i "cancelled" futuri
  const upcomingAppointments = myAppointments
    .filter(a => (a.status === 'booked' || a.status === 'cancelled') && a.startTime.toDate() > new Date())
    .sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    
  // 2. Active Appointment: Il box gigante in alto deve mostrare SOLO il prossimo confermato
  const activeAppointment = upcomingAppointments.find(a => a.status === 'booked');

  // 3. Storico Appuntamenti: Completati, Passati, Annullati passati, O quello cliccato dalla notifica
  const pastAppointments = myAppointments
    .filter(a => 
      a.status === 'completed' || 
      (a.status === 'cancelled' && a.startTime.toDate() <= new Date()) ||
      (a.status === 'booked' && a.startTime.toDate() <= new Date()) ||
      a.id === highlightedAppId // <-- TRUCCO DA ESPERTI: Forza la visualizzazione se ci hai cliccato!
    )
    .sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis())
    .slice(0, 10); // Aumentato da 3 a 10 per dare più profondità allo storico

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
                    <span className="text-xl font-bold">{format(proposal.gapStartTime.toDate(), 'HH:mm')}</span>
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
                  <div className="text-3xl font-bold">{format(selectedProposal.gapStartTime.toDate(), 'HH:mm')}</div>
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
                  <div className={`text-sm ${selectedServices.find(s => s.id === service.id) ? 'text-gray-400' : 'text-gray-500'}`}>
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
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Data</div>
              <button 
                onClick={() => setShowCalendar(true)}
                className="flex items-center gap-2 text-xs font-bold text-black bg-gray-100 px-3 py-2 rounded-xl hover:bg-gray-200 transition-all"
              >
                <CalendarIcon size={14} />
                Calendario
              </button>
            </div>

            <div className="hidden sm:flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {next7Days.map(date => (
                <button
                  key={date.toISOString()}
                  onClick={() => { setSelectedDate(date); setSelectedSlot(null); }}
                  className={`flex-shrink-0 w-20 py-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${
                    isSameDay(date, selectedDate)
                    ? 'border-black bg-black text-white shadow-lg'
                    : 'border-gray-400 hover:border-black bg-white'
                  }`}
                >
                  <span className="text-xs uppercase font-bold opacity-60">{format(date, 'EEE', { locale: it })}</span>
                  <span className="text-xl font-bold">{format(date, 'd')}</span>
                </button>
              ))}
            </div>

            <div className="sm:hidden relative">
              <select
                value={selectedDate.toISOString()}
                onChange={(e) => {
                  const date = new Date(e.target.value);
                  setSelectedDate(date);
                  setSelectedSlot(null);
                }}
                className="w-full p-4 bg-white border border-gray-400 rounded-2xl font-bold appearance-none focus:border-black outline-none"
              >
                {next7Days.map(date => (
                  <option key={date.toISOString()} value={date.toISOString()}>
                    {format(date, 'EEEE d MMMM', { locale: it })}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
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
                          <div className="font-bold text-gray-900">+39 012 345 6789</div>
                        </div>
                        <ChevronDown size={20} className={cn("text-gray-400 transition-transform", showContactMenu && "rotate-180")} />
                      </button>

                      {showContactMenu && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in slide-in-from-top-2">
                          <a 
                            href="tel:+390123456789"
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
                      href="https://instagram.com/barbershop_official" 
                      target="_blank" 
                      rel="noreferrer"
                      className="flex items-center gap-4 group hover:bg-gray-50 p-3 -m-3 rounded-2xl transition-all"
                    >
                      <div className="w-12 h-12 bg-pink-50 text-pink-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Instagram size={24} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Instagram</div>
                        <div className="font-bold text-gray-900">@barbershop_official</div>
                      </div>
                    </a>
                  </div>

                  <div className="space-y-6">
                    <a 
                      href="https://www.google.com/maps/search/?api=1&query=Via+Roma+1+Milano" 
                      target="_blank" 
                      rel="noreferrer"
                      className="flex items-center gap-4 group hover:bg-gray-50 p-3 -m-3 rounded-2xl transition-all"
                    >
                      <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <AlertCircle size={24} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Indirizzo</div>
                        <div className="font-bold text-gray-900">Via Roma 1, 20121 Milano (MI)</div>
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex justify-between items-center p-4 bg-white rounded-2xl shadow-sm border border-gray-100">
                    <span className="text-gray-500 font-medium">Mar - Sab</span>
                    <span className="font-bold text-gray-900">08:00 - 13:00, 14:00 - 20:00</span>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-white rounded-2xl shadow-sm border border-gray-100">
                    <span className="text-gray-500 font-medium">Dom - Lun</span>
                    <span className="font-bold text-red-500">Chiuso</span>
                  </div>
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
                    setSelectedDate(date);
                    setSelectedSlot(null);
                    setShowCalendar(false);
                  }
                }}
                disabled={{ before: new Date() }}
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