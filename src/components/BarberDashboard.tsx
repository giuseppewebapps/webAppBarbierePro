import React, { useEffect, useState } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
  getDoc,
  getDocs,
  setDoc,
  where,
  addDoc,
  deleteDoc,
  limit
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Appointment, UserProfile, Notification as AppNotification } from '../types';
import { 
  format, 
  startOfDay, 
  endOfDay, 
  eachHourOfInterval, 
  addHours, 
  isSameDay, 
  addDays, 
  subDays,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  setHours,
  setMinutes,
  isAfter,
  isBefore,
  addMinutes,
  getDay
} from 'date-fns';
import { it } from 'date-fns/locale';
import { 
  Calendar as CalendarIcon, 
  Phone, 
  Clock, 
  Scissors, 
  XCircle, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  ArrowUpCircle,
  Send,
  CheckCircle2,
  Globe,
  ArrowLeft,
  Check,
  Plus,
  User,
  ChevronDown,
  Search,
  MessageCircle
} from 'lucide-react';
import { useAuth } from '../App';
import { WhatsAppButton } from './WhatsAppButton';
import { generateWhatsAppLink } from '../utils/whatsapp';
import { SERVICES, OPENING_HOURS, CLOSED_DAYS, COUNTRY_CODES } from '../constants';
import { cn } from '../lib/utils';
import { RescheduleProposal } from '../types';

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
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    }
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface BarberDashboardProps {
  selectedAppointmentId?: string | null;
  selectedNotificationType?: string | null;
  onAppointmentDialogClose?: () => void;
}

export default function BarberDashboard({ selectedAppointmentId, selectedNotificationType, onAppointmentDialogClose }: BarberDashboardProps) {
  const { profile } = useAuth();
  const [appointments, setAppointments] = useState<(Appointment & { customer?: UserProfile })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState<(Appointment & { customer?: UserProfile }) | null>(null);
  const [activeNotifType, setActiveNotifType] = useState<string | null>(null);
  const [showContactMenu, setShowContactMenu] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<Appointment | null>(null);
  const [showGapFiller, setShowGapFiller] = useState<{ start: Date, end: Date, appointmentId: string } | null>(null);
  const [rescheduleCandidates, setRescheduleCandidates] = useState<(Appointment & { customer?: UserProfile })[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [isManualBookingOpen, setIsManualBookingOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedAppId, setHighlightedAppId] = useState<string | null>(null);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [declinedProposalNotif, setDeclinedProposalNotif] = useState<any>(null);

  useEffect(() => {
    const handleOpenManualBooking = () => setIsManualBookingOpen(true);
    const handleOpenScheduleMaintenance = () => alert("Manutenzione orari in arrivo...");

    window.addEventListener('open-manual-booking', handleOpenManualBooking);
    window.addEventListener('open-schedule-maintenance', handleOpenScheduleMaintenance);

    return () => {
      window.removeEventListener('open-manual-booking', handleOpenManualBooking);
      window.removeEventListener('open-schedule-maintenance', handleOpenScheduleMaintenance);
    };
  }, []);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Logica di Avanzamento Coda Proposte Reschedule Scadute (Solo per il Barbiere/Admin)
  useEffect(() => {
    if (!profile || profile.role !== 'barber') return;

    const checkAndAdvance = async () => {
      try {
        const q = query(collection(db, 'rescheduleProposals'), where('status', 'in', ['active', 'completed']));
        const snapshot = await getDocs(q);
        
        for (const docSnap of snapshot.docs) {
          const proposal = { id: docSnap.id, ...docSnap.data() } as RescheduleProposal;
          
          // ELIMINA se l'orario di inizio è passato
          if (isAfter(currentTime, proposal.gapStartTime.toDate())) {
            await deleteDoc(doc(db, 'rescheduleProposals', proposal.id!));
            const notifQ = query(collection(db, 'notifications'), where('proposalId', '==', proposal.id));
            const notifSnap = await getDocs(notifQ);
            for (const nd of notifSnap.docs) {
              await deleteDoc(doc(db, 'notifications', nd.id));
            }
            continue;
          }

          if (proposal.status === 'completed') continue;

          const currentTarget = proposal.targets[proposal.currentIdx];
          
          if (currentTarget && currentTarget.status === 'pending' && currentTarget.expiresAt) {
            const expiresAt = currentTarget.expiresAt.toDate();
            if (isAfter(currentTime, expiresAt)) {
              const updatedTargets = [...proposal.targets];
              updatedTargets[proposal.currentIdx].status = 'expired';
              
              const nextIdx = proposal.currentIdx + 1;
              let newStatus: 'active' | 'completed' | 'cancelled' = proposal.status;
              
              if (nextIdx < updatedTargets.length) {
                updatedTargets[nextIdx].status = 'pending';
                updatedTargets[nextIdx].notifiedAt = Timestamp.now();
                updatedTargets[nextIdx].expiresAt = Timestamp.fromDate(addMinutes(new Date(), 15));
                
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
                newStatus = 'completed';
              }

              await updateDoc(doc(db, 'rescheduleProposals', proposal.id!), {
                targets: updatedTargets,
                currentIdx: nextIdx < updatedTargets.length ? nextIdx : proposal.currentIdx,
                status: newStatus
              });
              
              const notifQ = query(collection(db, 'notifications'), 
                where('proposalId', '==', proposal.id), 
                where('userId', '==', currentTarget.userId)
              );
              const notifSnap = await getDocs(notifQ);
              for (const d of notifSnap.docs) {
                await deleteDoc(doc(db, 'notifications', d.id));
              }
            }
          }
        }
      } catch (error) {
        console.error("Error in checkAndAdvance:", error);
      }
    };

    checkAndAdvance();
  }, [currentTime, profile]);

  useEffect(() => {
    const path = 'appointments';
    const q = query(
      collection(db, path),
      orderBy('startTime', 'asc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Appointment[];

      const appointmentsWithProfiles = await Promise.all(docs.map(async (app) => {
        try {
          const userDoc = app.customerId !== 'manual_entry' ? await getDoc(doc(db, 'users', app.customerId)) : null;
          return {
            ...app,
            customer: userDoc?.exists() ? userDoc.data() as UserProfile : app.customer
          };
        } catch (error) {
          return app;
        }
      }));

      setAppointments(appointmentsWithProfiles);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, []);

// AGGIUNTA: Ascolta il click dalla notifica e apre il popup del Barbiere
  useEffect(() => {
    if (selectedAppointmentId && appointments.length > 0) {
      const foundApp = appointments.find(a => a.id === selectedAppointmentId);
      if (foundApp) {
        // 1. Sposta magicamente il calendario al giorno dell'appuntamento
        setSelectedDate(foundApp.startTime.toDate());
        
        setActiveNotifType(selectedNotificationType || null);

        // 2. Apre il popup di dettaglio
        setSelectedAppointment(foundApp);

        // 3. Imposta l'appuntamento da illuminare
        setHighlightedAppId(selectedAppointmentId);

        // 4. Aspettiamo mezzo secondo per il render, poi scorriamo (in Orizzontale!)
        setTimeout(() => {
          const element = document.getElementById(`appointment-${selectedAppointmentId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        }, 500);

        // 5. Spegniamo il bagliore dopo 5 secondi
        setTimeout(() => {
          setHighlightedAppId(null);
        }, 5000);
        
        // 6. Avvisa App.tsx di resettare l'ID
        if (onAppointmentDialogClose) onAppointmentDialogClose();
      }
    }
  }, [selectedAppointmentId, appointments, onAppointmentDialogClose, selectedNotificationType]);

  // Ascolta le notifiche speciali di rifiuto
  useEffect(() => {
    const handleSpecialNotif = (e: any) => {
      const notif = e.detail;
      if (notif && notif.type === 'proposal_declined') {
        setDeclinedProposalNotif(notif);
      }
    };
    
    window.addEventListener('special-notification-click', handleSpecialNotif);
    return () => window.removeEventListener('special-notification-click', handleSpecialNotif);
  }, []);

  const handleCancel = async (app: Appointment) => {
    const path = `appointments/${app.id}`;
    try {
      await updateDoc(doc(db, 'appointments', app.id!), {
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        cancelledBy: 'barber'
      });

      // Notify Customer (only if it's not the barber themselves)
      if (app.customerId !== profile?.uid) {
        await addDoc(collection(db, 'notifications'), {
          userId: app.customerId,
          title: 'Appuntamento Annullato dal Barbiere',
          message: `Il barbiere ha annullato il tuo appuntamento del ${format(app.startTime.toDate(), 'd MMM HH:mm')}`,
          type: 'cancellation',
          read: false,
          createdAt: Timestamp.now(),
          appointmentId: app.id
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // Filtra gli appuntamenti in base al termine di ricerca
  const filteredAppointments = appointments.filter(app => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const customerName = app.customer?.displayName?.toLowerCase() || '';
    const friendName = app.friendDetails ? 
      `${app.friendDetails.firstName} ${app.friendDetails.lastName}`.toLowerCase() : '';
    return customerName.includes(searchLower) || friendName.includes(searchLower);
  });

  // Ottieni le ore o i giorni in base alla visualizzazione selezionata
  const getCalendarData = () => {
    switch (viewMode) {
      case 'daily':
        return {
          type: 'daily' as const,
          items: eachHourOfInterval({
            start: setHours(startOfDay(selectedDate), 8),
            end: setHours(startOfDay(selectedDate), 20)
          }),
          formatItem: (item: Date) => format(item, 'HH:00')
        };
      case 'weekly':
        const weekStart = startOfWeek(selectedDate);
        const weekEnd = endOfWeek(selectedDate);
        return {
          type: 'weekly' as const,
          items: eachDayOfInterval({ start: weekStart, end: weekEnd }),
          formatItem: (item: Date) => format(item, 'EEE d', { locale: it })
        };
      case 'monthly':
        const monthStart = startOfDay(selectedDate);
        const monthEnd = endOfDay(addDays(startOfDay(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)), 0));
        return {
          type: 'monthly' as const,
          items: eachDayOfInterval({ start: monthStart, end: monthEnd }),
          formatItem: (item: Date) => format(item, 'd', { locale: it })
        };
      default:
        return {
          type: 'daily' as const,
          items: eachHourOfInterval({
            start: setHours(startOfDay(selectedDate), 8),
            end: setHours(startOfDay(selectedDate), 20)
          }),
          formatItem: (item: Date) => format(item, 'HH:00')
        };
    }
  };

  const calendarData = getCalendarData();

  const getAppointmentsForItem = (item: Date) => {
    return filteredAppointments.filter(app => {
      const start = app.startTime.toDate();
      const isPast = isBefore(start, currentTime);

      if (calendarData.type === 'daily') {
        if (!(isSameDay(start, item) && start.getHours() === item.getHours())) return false;
      } else {
        if (!isSameDay(start, item)) return false;
      }

      // Lasciamo:
      //1. Quelli "da fare" (booked)
      //2. Quelli completati (completed) - come richiesto, restano a video verdi
      //3. Quelli con "possibilità di cambio" (cancelled non ancora passati)

      if (app.status === 'booked' || app.status === 'completed') return true;
      if (app.status === 'cancelled' && !isPast) return true;

      // Gli appuntamenti "scaduti" (cancelled passati) e quelli già "completati" vengono rimossi
      return false;
    });
  };

  const isMatchedBySearch = (app: Appointment & { customer?: UserProfile }) => {
    if (!searchTerm) return false;
    const searchLower = searchTerm.toLowerCase();
    const customerName = app.customer?.displayName?.toLowerCase() || '';
    const friendName = app.friendDetails ? 
      `${app.friendDetails.firstName} ${app.friendDetails.lastName}`.toLowerCase() : '';
    return customerName.includes(searchLower) || friendName.includes(searchLower);
  };

  const handleProposeReschedule = async (gap: { start: Date, end: Date, appointmentId: string }) => {
    if (selectedCandidates.length === 0) return;
    setSendingProposal(true);
    try {
      const targets = selectedCandidates.map((id, idx) => {
        const candidate = rescheduleCandidates.find(c => c.id === id)!;
        return {
          userId: candidate.customerId,
          appointmentId: candidate.id!,
          status: idx === 0 ? 'pending' : 'waiting' as any,
          notifiedAt: idx === 0 ? Timestamp.now() : null,
          expiresAt: idx === 0 ? Timestamp.fromDate(addMinutes(new Date(), 15)) : null
        };
      });

      const proposalData: Partial<RescheduleProposal> = {
        gapStartTime: Timestamp.fromDate(gap.start),
        gapEndTime: Timestamp.fromDate(gap.end),
        gapAppointmentId: gap.appointmentId,
        targets,
        currentIdx: 0,
        status: 'active',
        createdAt: Timestamp.now()
      };

      const proposalRef = await addDoc(collection(db, 'rescheduleProposals'), proposalData);

      // Notify first candidate
      const firstTarget = targets[0];
      await addDoc(collection(db, 'notifications'), {
        userId: firstTarget.userId,
        title: 'Proposta di Cambio Orario',
        message: `Il barbiere ti propone di anticipare il tuo appuntamento del ${format(rescheduleCandidates.find(c => c.id === selectedCandidates[0])!.startTime.toDate(), 'd MMM')} alle ore ${format(gap.start, 'HH:mm')}. Hai 15 minuti per accettare!`,
        type: 'reschedule_proposal',
        read: false,
        createdAt: Timestamp.now(),
        proposalId: proposalRef.id,
        appointmentId: selectedCandidates[0]
      });

      alert("Proposta inviata con successo alla coda selezionata!");
      setShowGapFiller(null);
      setSelectedCandidates([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'rescheduleProposals');
    } finally {
      setSendingProposal(false);
    }
  };

  const findCandidatesForGap = (gap: { start: Date, end: Date, appointmentId: string }) => {
    const gapDuration = (gap.end.getTime() - gap.start.getTime()) / (1000 * 60);
    
    // Candidates are people with appointments AFTER this gap
    // Sorted by date (today first, then future)
    const candidates = appointments.filter(app => {
      const appStart = app.startTime.toDate();
      const appDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / (1000 * 60);
      
      return app.status === 'booked' && 
             isAfter(appStart, gap.end) && 
             appDuration <= gapDuration;
    }).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    
    setRescheduleCandidates(candidates);
    setShowGapFiller(gap);
    setSelectedCandidates([]);
  };

  const toggleCandidate = (id: string) => {
    setSelectedCandidates(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  if (loading) {
    return <div className="text-center py-12">Caricamento dashboard...</div>;
  }

  // qui per cambiare la gestione account barbiere
  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12 px-4 sm:px-0">
      <div className="bg-white/80 backdrop-blur-md border border-white/20 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-gray-100/50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setSelectedDate(subDays(selectedDate, 1))} className="p-2 hover:bg-gray-50 rounded-full"><ChevronLeft size={20} /></button>
            <h3 className="text-xl font-bold min-w-[200px] text-center">
              {format(selectedDate, 'EEEE d MMMM', { locale: it })}
            </h3>
            <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="p-2 hover:bg-gray-50 rounded-full"><ChevronRight size={20} /></button>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
              <button
                onClick={() => setViewMode('daily')}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-all",
                  viewMode === 'daily' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200"
                )}
              >
                Giorno
              </button>
              <button
                onClick={() => setViewMode('weekly')}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-all",
                  viewMode === 'weekly' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200"
                )}
              >
                Settimana
              </button>
              <button
                onClick={() => setViewMode('monthly')}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-all",
                  viewMode === 'monthly' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200"
                )}
              >
                Mese
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="Cerca cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setIsSearchActive(true)}
                className={cn(
                  "pl-10 pr-4 py-2 w-48 text-sm rounded-xl border transition-all",
                  isSearchActive ? "border-black ring-2 ring-black/20" : "border-gray-200 hover:border-gray-300"
                )}
              />
              <Search
                size={18}
                className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2 transition-colors",
                  isSearchActive ? "text-black" : "text-gray-400"
                )}
              />
            </div>
            <button onClick={() => setSelectedDate(new Date())} className="text-sm font-bold text-gray-400 hover:text-black">Oggi</button>
          </div>
        </div>

        {/* Selection Mode Header */}
        {showGapFiller && (
          <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between animate-in slide-in-from-top duration-300">
            <div className="flex flex-col">
              <h4 className="text-sm font-bold text-emerald-900">Seleziona appuntamenti</h4>
              <p className="text-[10px] text-emerald-700 opacity-70">
                Stai riempiendo il buco delle {format(showGapFiller.start, 'HH:mm')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                disabled={sendingProposal || selectedCandidates.length === 0}
                onClick={() => handleProposeReschedule(showGapFiller)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 shadow-lg shadow-emerald-200"
              >
                {sendingProposal ? 'Invio...' : 'Chiedi'} ({selectedCandidates.length})
              </button>
              <button
                onClick={() => {
                  setShowGapFiller(null);
                  setSelectedCandidates([]);
                  setRescheduleCandidates([]);
                }}
                className="p-2 bg-white text-gray-400 hover:text-red-500 rounded-xl border border-gray-100 transition-all"
                title="Annulla selezione"
              >
                <ArrowLeft size={20} />
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-50">
          {calendarData.items.map(item => {
            const apps = getAppointmentsForItem(item);
            const isBreak = calendarData.type === 'daily' && item.getHours() === 13;
            const isMatched = apps.length > 0 && searchTerm && apps.some(app => isMatchedBySearch(app));
            
            return (
              <div key={item.toISOString()} className={cn("flex min-h-[60px] relative", isBreak && "bg-gray-50/50")}>
                {/* Past Time Overlay */}
                {isSameDay(selectedDate, currentTime) && isBefore(addHours(item, 1), currentTime) && (
                  <div className="absolute inset-0 bg-gray-200/30 backdrop-grayscale-[0.5] z-10 pointer-events-none" />
                )}
                
                <div className="w-16 p-3 text-right border-r border-gray-50 flex-shrink-0">
                  <span className="text-xs font-bold text-gray-400">{calendarData.formatItem(item)}</span>
                </div>
                <div className="flex-1 p-1.5 flex gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                  {isBreak ? (
                    <div className="flex items-center justify-center w-full text-gray-300 text-[10px] font-bold uppercase tracking-widest italic">Pausa Pranzo</div>
                  ) : apps.length === 0 ? (
                    <div className="flex-1"></div>
                  ) : (
                    apps.map(app => {
                      const duration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / (1000 * 60);
                      const cardWidth = (duration / 30) * 14; // 14rem is w-56
                      
                      const isCandidate = rescheduleCandidates.some(c => c.id === app.id);
                      const isSelected = selectedCandidates.includes(app.id!);
                      const selectionMode = showGapFiller !== null;

                      return (
                        <div 
                          key={app.id} 
                          id={`appointment-${app.id}`}
                          onClick={() => {
                            if (selectionMode) {
                              if (isCandidate) toggleCandidate(app.id!);
                            } else {
                              setSelectedAppointment(app);
                            }
                          }}
                          style={{ width: `${cardWidth}rem` }}
                          className={cn(
                            "flex-shrink-0 p-2.5 rounded-xl shadow-md flex flex-col justify-between text-left transition-all cursor-pointer relative h-[88px] duration-500",
                            
                            // EFFETTO BAGLIORE SE EVIDENZIATO
                            app.id === highlightedAppId ? (app.status === 'cancelled' ? "ring-4 ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.7)] scale-[1.05] z-20 grayscale-0 opacity-100" : "ring-4 ring-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.6)] scale-[1.05] z-20") : "hover:scale-[1.02]",
                            
                            selectionMode && !isCandidate ? "bg-gray-100 text-gray-400 grayscale shadow-none border-gray-200" :
                            isSelected ? "bg-emerald-500 text-white ring-4 ring-emerald-500/30" :
                            (app.status === 'completed' || (app.status === 'booked' && isBefore(app.endTime.toDate(), currentTime))) ? "bg-emerald-600 text-white" :
                            app.status === 'booked' ? "bg-black text-white" : 
                            "bg-red-50 text-red-600 border border-red-100"
                          )}
                        >
                          <div>
                            <div className="flex justify-between items-start">
                              <div className="font-bold text-xs truncate">
                                {app.status === 'cancelled' ? 'ANNULLATO' : (app.isForFriend ? `Per: ${app.friendDetails?.firstName}` : app.customer?.displayName)}
                              </div>
                              <div className="text-[9px] font-bold opacity-60 flex flex-col items-end leading-tight">
                                <span>{format(app.startTime.toDate(), 'HH:mm')}</span>
                                <span>- {format(app.endTime?.toDate() || addMinutes(app.startTime.toDate(), app.services.reduce((acc, s) => acc + s.duration, 0)), 'HH:mm')}</span>
                              </div>
                            </div>
                            <div className="text-[9px] opacity-70 mt-0.5 flex flex-wrap gap-1">
                              {app.services.map(s => s.name).join(', ')}
                            </div>
                          </div>
                          <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-white/10">
                            {app.status !== 'cancelled' ? (
                              <>
                                <div className="flex items-center gap-1 text-[9px] truncate">
                                  <Phone size={8} /> {app.isForFriend ? app.friendDetails?.phone?.slice(-10) : app.customer?.phoneNumber?.slice(-10)}
                                </div>
                                {app.isForFriend && (
                                  <div className="text-[8px] bg-white/20 px-1 rounded uppercase font-bold">Amico</div>
                                )}
                              </>
                            ) : (
                              <button 
                                disabled={isBefore(app.startTime.toDate(), currentTime) || selectionMode}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  findCandidatesForGap({ 
                                    start: app.startTime.toDate(), 
                                    end: app.endTime.toDate(),
                                    appointmentId: app.id!
                                  });
                                }}
                                className="w-full py-1 bg-red-600 text-white rounded-lg text-[8px] font-bold uppercase flex items-center justify-center gap-1 hover:bg-red-700 disabled:opacity-30 disabled:grayscale"
                              >
                                <ArrowUpCircle size={10} /> {isBefore(app.startTime.toDate(), currentTime) ? 'Scaduto' : 'Proponi Cambio'}
                              </button>
                            )}
                          </div>

                          {/* Selection Checkmark */}
                          {isSelected && (
                            <div className="absolute bottom-1 right-1 bg-white text-emerald-600 rounded-full p-0.5 shadow-sm animate-in zoom-in">
                              <Check size={10} strokeWidth={4} />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 px-4 py-2 bg-white/50 backdrop-blur-sm rounded-2xl border border-white/20 w-fit mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-black rounded-full shadow-sm" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Prenotato</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-emerald-600 rounded-full shadow-sm" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Completato</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-50 border border-red-100 rounded-full shadow-sm" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Annullato (Buco)</span>
        </div>
      </div>

      {/* Appointment Details Modal */}
      {selectedAppointment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
          <div className="bg-white/90 backdrop-blur-xl w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100/50 flex justify-between items-center bg-black/90 text-white">
              <h3 className="text-xl font-bold">Dettagli Appuntamento</h3>
              <button onClick={() => {
                setSelectedAppointment(null);
                setActiveNotifType(null);
                setShowContactMenu(false);
              }} className="p-1 hover:bg-white/10 rounded-full">
                <XCircle size={24} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center text-black flex-shrink-0">
                  <Clock size={32} />
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold">
                    {selectedAppointment.isForFriend 
                      ? `${selectedAppointment.friendDetails?.firstName} ${selectedAppointment.friendDetails?.lastName}` 
                      : selectedAppointment.customer?.displayName}
                  </div>
                  
                  <div className="relative mt-1">
                    <button 
                      onClick={() => setShowContactMenu(!showContactMenu)}
                      className="text-emerald-600 font-bold flex items-center gap-2 hover:bg-emerald-50 px-3 py-1.5 -ml-3 rounded-xl transition-all"
                    >
                      <Phone size={14} /> 
                      {selectedAppointment.isForFriend 
                        ? selectedAppointment.friendDetails?.phone 
                        : selectedAppointment.customer?.phoneNumber}
                      <ChevronRight size={14} className={cn("transition-transform", showContactMenu && "rotate-90")} />
                    </button>

                    {showContactMenu && (
                      <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 animate-in slide-in-from-top-2">
                        <a 
                          href={`tel:${selectedAppointment.isForFriend ? selectedAppointment.friendDetails?.phone : selectedAppointment.customer?.phoneNumber}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm font-bold text-gray-700"
                        >
                          <Phone size={16} /> Chiama
                        </a>
                        <a 
                          href={`https://wa.me/${(selectedAppointment.isForFriend ? selectedAppointment.friendDetails?.phone : selectedAppointment.customer?.phoneNumber)?.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm font-bold text-emerald-600"
                        >
                          <Send size={16} /> WhatsApp
                        </a>
                        {/* Email option for desktop */}
                        <a 
                          href={`mailto:${selectedAppointment.isForFriend ? selectedAppointment.friendDetails?.email : selectedAppointment.customer?.email}`}
                          className="hidden sm:flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm font-bold text-blue-600"
                        >
                          <Globe size={16} /> Invia Email
                        </a>
                      </div>
                    )}
                  </div>

                  {selectedAppointment.isForFriend && (
                    <div className="text-xs text-amber-600 font-bold mt-2 flex items-center gap-1">
                      <AlertCircle size={12} /> Prenotato da {selectedAppointment.customer?.displayName} per un amico
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Data</div>
                  <div className="font-bold">{format(selectedAppointment.startTime.toDate(), 'd MMMM', { locale: it })}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Orario</div>
                  <div className="font-bold">{format(selectedAppointment.startTime.toDate(), 'HH:mm')} - {format(selectedAppointment.endTime.toDate(), 'HH:mm')}</div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Servizi Selezionati</div>
                <div className="flex flex-wrap gap-2">
                  {selectedAppointment.services.map(s => (
                    <span key={s.id} className="px-3 py-1.5 bg-black text-white rounded-full text-xs font-bold flex items-center gap-2">
                      <Scissors size={12} /> {s.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100 flex flex-col gap-3">
                
                {/* INIZIO NUOVO BOTTONE WHATSAPP DINAMICO */}
                <WhatsAppButton 
                  type={
                    activeNotifType === 'booking' ? 'booking' :
                    activeNotifType === 'cancellation' ? 'cancellation' :
                    activeNotifType === 'proposal_accepted' ? 'proposal_accepted' :
                    'manual_management_required'
                  }
                 customerName={
                    selectedAppointment.isForFriend 
                      ? selectedAppointment.friendDetails?.firstName || 'Cliente'
                      : selectedAppointment.customer?.displayName || 'Cliente'
                  }
                  customerPhone={
                    selectedAppointment.isForFriend 
                      ? selectedAppointment.friendDetails?.phone 
                      : selectedAppointment.customer?.phoneNumber
                  }
                  date={format(selectedAppointment.startTime.toDate(), 'dd/MM/yyyy')}
                  time={format(selectedAppointment.startTime.toDate(), 'HH:mm')}
                  label={
                    activeNotifType === 'booking' ? 'Conferma su WhatsApp' :
                    activeNotifType === 'cancellation' ? 'Saluta su WhatsApp' :
                    activeNotifType === 'proposal_accepted' ? 'Conferma Cambio' :
                    'Chat Gestione Manuale'
                  }
                  className="w-full py-4 bg-[#25D366] text-white rounded-2xl font-bold hover:bg-[#20bd5a] transition-all flex items-center justify-center gap-2 shadow-md mb-2"
                />
                {/* FINE NUOVO BOTTONE WHATSAPP DINAMICO */}

                {/* Tasto Annulla (Solo se prenotato e futuro) */}
                {selectedAppointment.status === 'booked' && !isBefore(selectedAppointment.startTime.toDate(), currentTime) && (
                  <button
                    onClick={() => {
                      setShowCancelConfirm(selectedAppointment);
                      setSelectedAppointment(null);
                    }}
                    className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                  >
                    <XCircle size={20} /> Annulla Appuntamento
                  </button>
                )}
                
                {/* Tasto Proponi Cambio (Solo se annullato) */}
                {selectedAppointment.status === 'cancelled' && (
                  <button
                    disabled={isBefore(selectedAppointment.startTime.toDate(), currentTime)}
                    onClick={() => {
                      findCandidatesForGap({ 
                        start: selectedAppointment.startTime.toDate(), 
                        end: selectedAppointment.endTime.toDate(),
                        appointmentId: selectedAppointment.id!
                      });
                      setSelectedAppointment(null);
                    }}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale"
                  >
                    <ArrowUpCircle size={20} /> {isBefore(selectedAppointment.startTime.toDate(), currentTime) ? 'Orario Passato' : 'Proponi Cambio Orario'}
                  </button>
                )}

                {/* Tasto Chiudi */}
                <button
                  onClick={() => {
                    setSelectedAppointment(null);
                    setActiveNotifType(null);
                    setShowContactMenu(false);
                  }}
                  className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Cancellation Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[80] p-4 animate-in fade-in">
          <div className="bg-white/90 backdrop-blur-xl w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl border border-white/20 p-8 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-xl font-bold mb-2">Conferma Annullamento</h3>
            <p className="text-gray-500 text-sm mb-8">
              Sei sicuro di voler annullare questo appuntamento? Questa azione non può essere annullata.
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
                No, Mantieni
              </button>
            </div>
          </div>
        </div>
      )}

{/* Popup Proposta Rifiutata - Design Pulito e Diretto */}
      {declinedProposalNotif && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl border border-white/20 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <XCircle size={32} />
            </div>
            
            <h3 className="text-2xl font-bold mb-2">Proposta Rifiutata</h3>
            <p className="text-gray-500 mb-6 text-sm leading-relaxed">
              Il cliente <span className="font-bold text-black">{declinedProposalNotif.declinedDetails?.customerName}</span> ha preferito ignorare lo scambio.
            </p>
            
            <div className="bg-gray-50 rounded-2xl p-4 mb-8 text-left space-y-3 border border-gray-100">
              <div className="flex justify-between items-center opacity-40">
                <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Cambio Proposto</span>
                <span className="font-bold line-through">
                  {declinedProposalNotif.declinedDetails?.proposedTime ? format(declinedProposalNotif.declinedDetails.proposedTime.toDate(), 'dd/MM/yyyy - HH:mm') : '--:--'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                  <CheckCircle2 size={12} /> Orario Mantenuto
                </span>
                <span className="font-bold text-emerald-600">
                  {declinedProposalNotif.declinedDetails?.originalTime ? format(declinedProposalNotif.declinedDetails.originalTime.toDate(), 'dd/MM/yyyy - HH:mm') : '--:--'}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              {declinedProposalNotif.declinedDetails?.customerPhone && (
                <WhatsAppButton
                  type="proposal_declined"
                  customerName={declinedProposalNotif.declinedDetails.customerName}
                  customerPhone={declinedProposalNotif.declinedDetails.customerPhone}
                  date={declinedProposalNotif.declinedDetails.originalTime ? format(declinedProposalNotif.declinedDetails.originalTime.toDate(), 'dd/MM/yyyy') : ''}
                  time={declinedProposalNotif.declinedDetails.originalTime ? format(declinedProposalNotif.declinedDetails.originalTime.toDate(), 'HH:mm') : ''}
                  label="Avvisa su WhatsApp"
                  className="w-full py-4 bg-[#25D366] text-white rounded-2xl font-bold hover:bg-[#20bd5a] transition-all flex items-center justify-center gap-2"
                />
              )}
              
              <button
                onClick={() => setDeclinedProposalNotif(null)}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 hover:text-black transition-all"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Booking Modal */}
      {isManualBookingOpen && (
        <ManualBookingModal 
          onClose={() => setIsManualBookingOpen(false)} 
          onSuccess={() => {
            setIsManualBookingOpen(false);
            // The onSnapshot will handle the update
          }}
        />
      )}
    </div>
  );
}

interface ManualBookingModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function ManualBookingModal({ onClose, onSuccess }: ManualBookingModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phonePrefix, setPhonePrefix] = useState('+39');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedServices, setSelectedServices] = useState<typeof SERVICES>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [availableSlots, setAvailableSlots] = useState<Date[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [suggestions, setSuggestions] = useState<{ firstName: string, lastName: string, phone: string, email?: string, phonePrefix?: string }[]>([]);
  // Search for contacts as the barber types
  useEffect(() => {
    const searchContacts = async () => {
      if (firstName.length < 2) {
        setSuggestions([]);
        return;
      }

      try {
        const searchStr = firstName.toLowerCase();
        const q = query(
          collection(db, 'contacts'),
          where('firstNameLower', '>=', searchStr),
          where('firstNameLower', '<=', searchStr + '\uf8ff'),
          limit(5)
        );
        const snapshot = await getDocs(q);
        const results = snapshot.docs.map(d => d.data() as any);
        
        // Filter by lastName if provided (case-insensitive)
        const filtered = results.filter(r => 
          !lastName || r.lastNameLower.startsWith(lastName.toLowerCase())
        );
        
        setSuggestions(filtered);
      } catch (error) {
        console.error("Error searching contacts:", error);
      }
    };

    const timer = setTimeout(searchContacts, 300);
    return () => clearTimeout(timer);
  }, [firstName, lastName]);

  const selectSuggestion = (s: any) => {
    setFirstName(s.firstName);
    setLastName(s.lastName);
    setPhone(s.phone);
    if (s.phonePrefix) setPhonePrefix(s.phonePrefix);
    if (s.email) setEmail(s.email);
    setSuggestions([]);
  };

  const next30Days = React.useMemo(() => eachDayOfInterval({
    start: new Date(),
    end: addDays(new Date(), 30)
  }).filter(d => !CLOSED_DAYS.includes(getDay(d))), []);

  useEffect(() => {
    if (selectedDate && selectedServices.length > 0) {
      calculateSlots();
    } else {
      setAvailableSlots([]);
    }
  }, [selectedDate, selectedServices]);

  const calculateSlots = async () => {
    setLoading(true);
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

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
            const isOverlap = dayAppointments.some(app => {
              const appStart = app.startTime.toDate();
              const appEnd = app.endTime.toDate();
              return (current < appEnd && slotEnd > appStart);
            });

            if (!isOverlap) {
              slots.push(new Date(current));
            }
          }
          current = addMinutes(current, 15);
        }
      });

      setAvailableSlots(slots);
    } catch (error) {
      console.error("Error calculating slots:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async () => {
    if (!firstName || !lastName || !phone || !selectedSlot || selectedServices.length === 0) {
      alert("Nome, Cognome, Telefono, Servizi e Orario sono obbligatori.");
      return;
    }

    // Phone validation (same as customer side)
    if (phone.replace(/\D/g, '').length < 10) {
      alert("Il numero di telefono deve contenere almeno 10 cifre.");
      return;
    }

    setLoading(true);
    const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);
    const endTime = addMinutes(selectedSlot, totalDuration);

    try {
      // Save/Update contact with lowercase fields for case-insensitive search
      const contactId = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
      await setDoc(doc(db, 'contacts', contactId), {
        firstName,
        lastName,
        firstNameLower: firstName.toLowerCase(),
        lastNameLower: lastName.toLowerCase(),
        phone,
        phonePrefix,
        email: email || '',
        updatedAt: Timestamp.now()
      }, { merge: true });

      // Check for cancelled appointments in the same slot to delete them
      const q = query(
        collection(db, 'appointments'),
        where('startTime', '==', Timestamp.fromDate(selectedSlot)),
        where('status', '==', 'cancelled')
      );
      const cancelledSnapshot = await getDocs(q);
      for (const d of cancelledSnapshot.docs) {
        await deleteDoc(doc(db, 'appointments', d.id));
      }

      await addDoc(collection(db, 'appointments'), {
        customerId: 'manual_entry',
        customer: {
          displayName: `${firstName} ${lastName}`,
          phoneNumber: phonePrefix + phone,
          email: email || ''
        },
        services: selectedServices,
        startTime: Timestamp.fromDate(selectedSlot),
        endTime: Timestamp.fromDate(endTime),
        status: 'booked',
        totalAmount: totalAmount,
        createdAt: Timestamp.now(),
        isManual: true
      });

      // SE LA SPUNTA È ATTIVA, CREA E APRI IL LINK WHATSAPP
      if (sendWhatsApp) {
        const link = generateWhatsAppLink(
          'booking', 
          firstName, 
          phonePrefix + phone, 
          format(selectedSlot, 'dd/MM/yyyy'), 
          format(selectedSlot, 'HH:mm')
        );
        if (link) {
          window.open(link, '_blank');
        }
      }

      onSuccess();
    } catch (error) {
      console.error("Error booking:", error);
      alert("Errore durante la prenotazione.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[32px] w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-300">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center">
              <Plus size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-black">Inserimento Manuale</h2>
              <p className="text-xs text-gray-500 font-medium">Aggiungi un appuntamento al calendario</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <XCircle className="text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Customer Info */}
          <section>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <User size={14} /> Informazioni Cliente
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
              <div className="space-y-1.5 relative">
                <label className="text-xs font-bold text-gray-700 ml-1">Nome *</label>
                <input 
                  type="text" 
                  value={firstName} 
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="Es. Mario"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black/5 focus:border-black transition-all outline-none text-sm"
                />
                
                {suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-2xl shadow-xl z-[160] overflow-hidden animate-in fade-in slide-in-from-top-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => selectSuggestion(s)}
                        className="w-full p-3 text-left hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                      >
                        <div>
                          <div className="font-bold text-sm">{s.firstName} {s.lastName}</div>
                          <div className="text-[10px] text-gray-400">{s.phone}</div>
                        </div>
                        <Check size={14} className="text-emerald-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 ml-1">Cognome *</label>
                <input 
                  type="text" 
                  value={lastName} 
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Es. Rossi"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black/5 focus:border-black transition-all outline-none text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 ml-1">Telefono *</label>
                <div className="flex gap-2">
                  <div className="relative w-24">
                    <select
                      value={phonePrefix}
                      onChange={e => setPhonePrefix(e.target.value)}
                      className="w-full pl-2 pr-2 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black/5 focus:border-black transition-all outline-none text-sm appearance-none"
                    >
                      {COUNTRY_CODES.map(c => (
                        <option key={c.code} value={c.dial_code}>{c.flag} {c.dial_code}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <input 
                    type="tel" 
                    value={phone} 
                    onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="Min. 10 cifre"
                    className="flex-1 px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black/5 focus:border-black transition-all outline-none text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 ml-1">Email (Opzionale)</label>
                <input 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Es. mario.rossi@email.it"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black/5 focus:border-black transition-all outline-none text-sm"
                />
              </div>
            </div>
          </section>

          {/* Services */}
          <section>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Scissors size={14} /> Servizi
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SERVICES.map(service => {
                const isSelected = selectedServices.find(s => s.id === service.id);
                return (
                  <button
                    key={service.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedServices(selectedServices.filter(s => s.id !== service.id));
                      } else {
                        setSelectedServices([...selectedServices, service]);
                      }
                      setSelectedSlot(null);
                    }}
                    className={cn(
                      "p-4 rounded-2xl border transition-all text-left group relative",
                      isSelected 
                        ? "bg-black border-black text-white shadow-lg scale-[1.02]" 
                        : "bg-white border-gray-100 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    )}
                  >
                    <div className="font-bold text-sm">{service.name}</div>
                    <div className={cn("text-[10px] mt-1", isSelected ? "text-gray-400" : "text-gray-400")}>
                      {service.duration} min • €{service.price}
                    </div>
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 size={14} className="text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Date & Time */}
          <section className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <CalendarIcon size={14} /> Data
              </h3>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                {next30Days.map(date => {
                  const isSelected = isSameDay(date, selectedDate);
                  return (
                    <button
                      key={date.toISOString()}
                      onClick={() => {
                        setSelectedDate(date);
                        setSelectedSlot(null);
                      }}
                      className={cn(
                        "flex-shrink-0 w-16 py-3 rounded-2xl border transition-all flex flex-col items-center gap-1",
                        isSelected 
                          ? "bg-black border-black text-white shadow-lg" 
                          : "bg-white border-gray-100 text-gray-600 hover:border-gray-200"
                      )}
                    >
                      <span className="text-[10px] font-bold uppercase opacity-60">{format(date, 'EEE', { locale: it })}</span>
                      <span className="text-lg font-bold">{format(date, 'd')}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedServices.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Clock size={14} /> Orari Disponibili
                </h3>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
                  </div>
                ) : availableSlots.length > 0 ? (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {availableSlots.map(slot => {
                      const isSelected = selectedSlot && slot.getTime() === selectedSlot.getTime();
                      return (
                        <button
                          key={slot.toISOString()}
                          onClick={() => setSelectedSlot(slot)}
                          className={cn(
                            "py-2 rounded-xl border text-xs font-bold transition-all",
                            isSelected 
                              ? "bg-black border-black text-white shadow-md" 
                              : "bg-white border-gray-100 text-gray-600 hover:border-gray-200"
                          )}
                        >
                          {format(slot, 'HH:mm')}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <p className="text-sm text-gray-400 font-medium">Nessun orario disponibile per questa data</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50/50">
          
          {/* NUOVO CHECKBOX WHATSAPP */}
          <div className="flex items-center gap-3 mb-4 px-2">
            <input
              type="checkbox"
              id="sendWhatsApp"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <label htmlFor="sendWhatsApp" className="text-sm font-bold text-gray-700 cursor-pointer flex items-center gap-2">
              Avvisa il cliente su WhatsApp 
              <MessageCircle size={18} className="text-[#25D366]" />
            </label>
          </div>

          <button
            disabled={loading || !firstName || !lastName || !phone || !selectedSlot || selectedServices.length === 0}
            onClick={handleBooking}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xl"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
            ) : (
              <>
                <Check size={20} /> Conferma Appuntamento
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
