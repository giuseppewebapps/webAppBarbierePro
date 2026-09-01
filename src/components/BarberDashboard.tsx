import React, { useEffect, useState, useRef } from 'react';
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
import { Appointment, UserProfile, RescheduleProposal, TimeRange, Notification as AppNotification, WeeklySchedule } from '../types';
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
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
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
  MessageCircle,
  Settings
} from 'lucide-react';
import { useAuth } from '../App';
import { WhatsAppButton } from './WhatsAppButton';
import { generateWhatsAppLink } from '../utils/whatsapp';
import { 
  SERVICES, 
  DEFAULT_WEEKLY_SCHEDULE, 
  COUNTRY_CODES, 
  BARBER_EMAILS, 
  SALON_INFO 
} from '../constants';
import { cn } from '../lib/utils';
import { SpecialDay } from '../types';
import ScheduleMaintenanceModal from './ScheduleMaintenanceModal';
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
  };
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
  const [showGapFiller, setShowGapFiller] = useState<{ start: Date, end: Date, appointmentId?: string } | null>(null);
  const [rescheduleCandidates, setRescheduleCandidates] = useState<(Appointment & { customer?: UserProfile })[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [gapWizardStep, setGapWizardStep] = useState<1 | 2 | 3>(1);
  const [gapPlacements, setGapPlacements] = useState<Record<string, Date>>({});
  const [isManualBookingOpen, setIsManualBookingOpen] = useState(false);
  const [isScheduleMaintenanceOpen, setIsScheduleMaintenanceOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<'name' | 'phone'>('name');
  const [highlightedAppId, setHighlightedAppId] = useState<string | null>(null);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [declinedProposalNotif, setDeclinedProposalNotif] = useState<any>(null);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);

  // 🚀 NUOVI STATI PER LA MODIFICA RAPIDA CLIENTE
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [editCustomerForm, setEditCustomerForm] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);

  // STATO IMPOSTAZIONI ORARI DINAMICHE
  const [businessSettings, setBusinessSettings] = useState<{
    weeklySchedule: WeeklySchedule;
  }>({
    weeklySchedule: DEFAULT_WEEKLY_SCHEDULE
  });

  // ASCOLTA LE IMPOSTAZIONI STANDARD DA FIRESTORE
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

  // Ascolta le eccezioni del calendario
  useEffect(() => {
    const q = query(collection(db, 'calendar_exceptions'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SpecialDay[];
      setSpecialDays(docs);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleOpenManualBooking = () => setIsManualBookingOpen(true);
    const handleOpenScheduleMaintenance = () => setIsScheduleMaintenanceOpen(true);

    window.addEventListener('open-manual-booking', handleOpenManualBooking);
    window.addEventListener('open-schedule-maintenance', handleOpenScheduleMaintenance);

    return () => {
      window.removeEventListener('open-manual-booking', handleOpenManualBooking);
      window.removeEventListener('open-schedule-maintenance', handleOpenScheduleMaintenance);
    };
  }, []);

  const [sendingProposal, setSendingProposal] = useState(false);
  const [shiftConfirm, setShiftConfirm] = useState<{app: Appointment & { customer?: UserProfile }, direction: 'anticipo' | 'posticipo'} | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Avanzamento Coda Proposte Reschedule Scadute
  useEffect(() => {
    if (!profile || profile.role !== 'barber') return;

    const checkAndAdvance = async () => {
      try {
        const q = query(collection(db, 'rescheduleProposals'), where('status', 'in', ['active', 'completed']));
        const snapshot = await getDocs(q);
        
        for (const docSnap of snapshot.docs) {
          const proposal = { id: docSnap.id, ...docSnap.data() } as RescheduleProposal;
          
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

  useEffect(() => {
    if (selectedAppointmentId && appointments.length > 0) {
      const foundApp = appointments.find(a => a.id === selectedAppointmentId);
      if (foundApp) {
        setSelectedDate(foundApp.startTime.toDate());
        setActiveNotifType(selectedNotificationType || null);
        setSelectedAppointment(foundApp);
        setHighlightedAppId(selectedAppointmentId);

        setTimeout(() => {
          const element = document.getElementById(`appointment-${selectedAppointmentId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        }, 500);

        setTimeout(() => {
          setHighlightedAppId(null);
        }, 5000);
        
        if (onAppointmentDialogClose) onAppointmentDialogClose();
      }
    }
  }, [selectedAppointmentId, appointments, onAppointmentDialogClose, selectedNotificationType]);

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

  const startEditingCustomer = () => {
    if (!selectedAppointment) return;
    const isFriend = selectedAppointment.isForFriend;
    const fullName = isFriend 
      ? `${selectedAppointment.friendDetails?.firstName || ''} ${selectedAppointment.friendDetails?.lastName || ''}` 
      : (selectedAppointment.customer?.displayName || '');
    const nameParts = fullName.trim().split(' ');
    
    setEditCustomerForm({
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      phone: (isFriend ? selectedAppointment.friendDetails?.phone : selectedAppointment.customer?.phoneNumber) || '',
      email: (isFriend ? selectedAppointment.friendDetails?.email : selectedAppointment.customer?.email) || ''
    });
    setIsEditingCustomer(true);
  };

const handleSaveCustomerEdits = async () => {
    if (!selectedAppointment) return;
    setSavingCustomer(true);
    try {
      const fullName = `${editCustomerForm.firstName} ${editCustomerForm.lastName}`.trim();
      
      // 1. IGIENIZZAZIONE DATI (Strict Validation)
      const rawPhone = editCustomerForm.phone.replace(/\D/g, '');
      const pure10Digits = (rawPhone.startsWith('39') && rawPhone.length > 10) 
        ? rawPhone.substring(2) 
        : rawPhone.slice(-10);
      const fullPhone = pure10Digits.length >= 9 ? `+39${pure10Digits}` : '';
      const cleanContactPhone = pure10Digits;

      const appRef = doc(db, 'appointments', selectedAppointment.id!);
      
      // 2. SALVATAGGIO IN CLOUD
      if (selectedAppointment.isForFriend) {
        await updateDoc(appRef, {
          'friendDetails.firstName': editCustomerForm.firstName,
          'friendDetails.lastName': editCustomerForm.lastName,
          'friendDetails.phone': fullPhone,
          'friendDetails.email': editCustomerForm.email
        });
      } else {
        await updateDoc(appRef, {
          'customer.displayName': fullName,
          'customer.phoneNumber': fullPhone,
          'customer.email': editCustomerForm.email
        });

        // Fail-Safe Update su Users
        const isAppUser = selectedAppointment.customerId && selectedAppointment.customerId !== 'manual_entry' && selectedAppointment.customerId !== 'test_entry';
        
        if (isAppUser) {
          try {
            await updateDoc(doc(db, 'users', selectedAppointment.customerId), {
              displayName: fullName,
              phoneNumber: fullPhone,
              ...(editCustomerForm.email ? { email: editCustomerForm.email } : {}),
              updatedAt: Timestamp.now()
            });
            // REGOLA D'ORO: Distruggiamo l'eventuale contatto ombra se esisteva!
            if (cleanContactPhone) {
              try { await deleteDoc(doc(db, 'contacts', cleanContactPhone)); } catch(e) {}
            }
          } catch (e) {
            console.warn("Salto aggiornamento cloud utente (documento protetto o legacy).");
          }
        } else {
          // L'utente non ha l'app: Aggiorna la rubrica manuale
          if (cleanContactPhone) {
            await setDoc(doc(db, 'contacts', cleanContactPhone), {
              firstName: editCustomerForm.firstName,
              lastName: editCustomerForm.lastName,
              firstNameLower: editCustomerForm.firstName.toLowerCase(),
              lastNameLower: editCustomerForm.lastName.toLowerCase(),
              phone: cleanContactPhone,
              phonePrefix: '+39',
              email: editCustomerForm.email,
              updatedAt: Timestamp.now()
            }, { merge: true });
          }
        }
      }

      // 3. AGGIORNAMENTO ISTANTANEO UI (Senza F5)
      const updatedCustomerObj = selectedAppointment.isForFriend ? undefined : {
        ...selectedAppointment.customer!,
        displayName: fullName,
        phoneNumber: fullPhone,
        email: editCustomerForm.email
      };
      
      const updatedFriendObj = selectedAppointment.isForFriend ? {
        ...selectedAppointment.friendDetails!,
        firstName: editCustomerForm.firstName,
        lastName: editCustomerForm.lastName,
        phone: fullPhone,
        email: editCustomerForm.email
      } : undefined;

      setAppointments(prev => prev.map(app => 
        app.id === selectedAppointment.id 
          ? { ...app, customer: updatedCustomerObj || app.customer, friendDetails: updatedFriendObj || app.friendDetails } 
          : app
      ));

      setSelectedAppointment(prev => {
        if (!prev) return prev;
        return { ...prev, customer: updatedCustomerObj || prev.customer, friendDetails: updatedFriendObj || prev.friendDetails };
      });
      
      setIsEditingCustomer(false);
    } catch (error) {
      console.error("Errore salvataggio cliente:", error);
      alert("Errore durante l'aggiornamento dei dati.");
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleCancel = async (app: Appointment) => {
    const path = `appointments/${app.id}`;
    try {
      await updateDoc(doc(db, 'appointments', app.id!), {
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        cancelledBy: 'barber'
      });

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

  const isMatchedBySearch = (app: Appointment & { customer?: UserProfile }) => {
    if (!searchTerm) return false;
    const searchLower = searchTerm.toLowerCase().trim();

    if (searchType === 'name') {
      const customerName = app.customer?.displayName?.toLowerCase() || '';
      const friendName = app.friendDetails ? 
        `${app.friendDetails.firstName} ${app.friendDetails.lastName}`.toLowerCase() : '';
      return customerName.includes(searchLower) || friendName.includes(searchLower);
    } else {
      const customerPhone = app.customer?.phoneNumber || '';
      const friendPhone = app.friendDetails?.phone || '';
      const normSearch = searchLower.replace(/\D/g, '');
      return customerPhone.includes(normSearch) || friendPhone.includes(normSearch);
    }
  };

  const filteredAppointments = appointments.filter(app => {
    if (!searchTerm) return true;
    return isMatchedBySearch(app);
  });

  const getCalendarData = () => {
    switch (viewMode) {
      case 'daily': {
        const dateString = format(selectedDate, 'yyyy-MM-dd');
        const dayOfWeek = getDay(selectedDate);
        const exceptionForToday = specialDays.find(ex => ex.date === dateString);
        
        let activeOpeningHours: TimeRange[] = [];
        if (exceptionForToday && !exceptionForToday.isClosed) {
          activeOpeningHours = exceptionForToday.openingHours?.length ? exceptionForToday.openingHours : (businessSettings.weeklySchedule[dayOfWeek]?.shifts || []);
        } else if (!exceptionForToday && businessSettings.weeklySchedule[dayOfWeek]?.isOpen) {
          activeOpeningHours = businessSettings.weeklySchedule[dayOfWeek].shifts;
        }

        // Se il giorno è chiuso, mostriamo l'intervallo di default (08:00 - 20:00)
        if (exceptionForToday?.isClosed || (!exceptionForToday && !businessSettings.weeklySchedule[dayOfWeek]?.isOpen) || activeOpeningHours.length === 0) {
          return {
            type: 'daily' as const,
            items: eachHourOfInterval({
              start: setHours(startOfDay(selectedDate), 8),
              end: setHours(startOfDay(selectedDate), 20)
            }),
            formatItem: (item: Date) => format(item, 'HH:00')
          };
        }

        // Troviamo l'ora intera di inizio (floor) e di fine (ceil/round) per mantenere le etichette pulite (es. 07:00, 08:00)
        const minStart = Math.min(...activeOpeningHours.map(h => h.start));
        const maxEnd = Math.max(...activeOpeningHours.map(h => h.end));

        const startH = Math.floor(minStart);
        const endH = Math.ceil(maxEnd);

        return {
          type: 'daily' as const,
          items: eachHourOfInterval({
            start: setHours(startOfDay(selectedDate), startH),
            end: setHours(startOfDay(selectedDate), endH)
          }),
          formatItem: (item: Date) => format(item, 'HH:00')
        };
      }

      case 'weekly': {
        const weekStart = startOfWeek(selectedDate);
        const weekEnd = endOfWeek(selectedDate);
        return {
          type: 'weekly' as const,
          items: eachDayOfInterval({ start: weekStart, end: weekEnd }),
          formatItem: (item: Date) => format(item, 'EEE d', { locale: it })
        };
      }

      case 'monthly': {
        const monthStart = startOfDay(selectedDate);
        const monthEnd = endOfDay(addDays(startOfDay(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)), 0));
        return {
          type: 'monthly' as const,
          items: eachDayOfInterval({ start: monthStart, end: monthEnd }),
          formatItem: (item: Date) => format(item, 'd', { locale: it })
        };
      }

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

      if (app.status === 'booked' || app.status === 'completed') return true;
      if (app.status === 'cancelled' && !isPast) return true;

      return false;
    });
  };

  const formatDurationText = (totalMinutes: number) => {
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const hourStr = hours === 1 ? '1 ora' : `${hours} ore`;
    return mins > 0 ? `${hourStr} e ${mins} min` : hourStr;
  };

  const handleProposeReschedule = async () => {
    if (!showGapFiller || selectedCandidates.length === 0) return;
    setSendingProposal(true);
    try {
      const targets = selectedCandidates.map((id, idx) => {
        const candidate = rescheduleCandidates.find(c => c.id === id)!;
        const specificTime = gapPlacements[id] || showGapFiller.start; 
        return {
          userId: candidate.customerId,
          appointmentId: candidate.id!,
          status: idx === 0 ? 'pending' : 'waiting' as any,
          notifiedAt: idx === 0 ? Timestamp.now() : null,
          expiresAt: idx === 0 ? Timestamp.fromDate(addMinutes(new Date(), 15)) : null,
          proposedStartTime: Timestamp.fromDate(specificTime)
        };
      });

      const proposalData: Partial<RescheduleProposal> = {
        gapStartTime: Timestamp.fromDate(showGapFiller.start),
        gapEndTime: Timestamp.fromDate(showGapFiller.end),
        gapAppointmentId: showGapFiller.appointmentId || '',
        targets,
        currentIdx: 0,
        status: 'active',
        createdAt: Timestamp.now()
      };

      const proposalRef = await addDoc(collection(db, 'rescheduleProposals'), proposalData);

      const firstTarget = targets[0];
      const timeToDisplay = gapPlacements[selectedCandidates[0]] || showGapFiller.start;
      
      await addDoc(collection(db, 'notifications'), {
        userId: firstTarget.userId,
        title: 'Proposta di Cambio Orario',
        message: `Il barbiere ti propone di anticipare il tuo appuntamento del ${format(rescheduleCandidates.find(c => c.id === selectedCandidates[0])!.startTime.toDate(), 'd MMM')} alle ore ${format(timeToDisplay, 'HH:mm')}. Hai 15 minuti per accettare!`,
        type: 'reschedule_proposal',
        read: false,
        createdAt: Timestamp.now(),
        proposalId: proposalRef.id,
        appointmentId: selectedCandidates[0]
      });

      setGapWizardStep(3);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'rescheduleProposals');
    } finally {
      setSendingProposal(false);
    }
  };

  // 🚀 MOTORE DI TRASLAZIONE E DECOMPRESSIONE DINAMICA
  const handleShiftProposal = async () => {
    if (!showGapFiller || !shiftConfirm) return;
    const { app: candidateApp, direction } = shiftConfirm;
    
    setSendingProposal(true);
    try {
      // 🚀 CONTROLLO ANTI-SPAM (Niente proposte duplicate)
      const existingQ = query(collection(db, 'rescheduleProposals'), where('status', '==', 'active'));
      const existingSnap = await getDocs(existingQ);
      const hasDuplicate = existingSnap.docs.some(doc => {
        const data = doc.data() as RescheduleProposal;
        return data.targets.some(t => t.appointmentId === candidateApp.id);
      });

      if (hasDuplicate) {
        alert("Hai già inviato una proposta a questo cliente! Attendi la sua risposta.");
        setShiftConfirm(null);
        setSendingProposal(false);
        return;
      }
      const nominalDuration = candidateApp.services.reduce((acc, s) => acc + s.duration, 0);
      let newStart: Date, newEnd: Date;

      if (direction === 'anticipo') {
        newStart = showGapFiller.start; 
        newEnd = addMinutes(newStart, nominalDuration); 
      } else {
        newEnd = showGapFiller.end;
        newStart = addMinutes(newEnd, -nominalDuration); 
      }

      const proposalData: Partial<RescheduleProposal> = {
        gapStartTime: Timestamp.fromDate(showGapFiller.start),
        gapEndTime: Timestamp.fromDate(showGapFiller.end),
        gapAppointmentId: showGapFiller.appointmentId || '',
        targets: [{
          userId: candidateApp.customerId,
          appointmentId: candidateApp.id!,
          status: 'pending',
          notifiedAt: Timestamp.now(),
          expiresAt: Timestamp.fromDate(addMinutes(new Date(), 15)),
          proposedStartTime: Timestamp.fromDate(newStart),
          proposedEndTime: Timestamp.fromDate(newEnd)
        }],
        currentIdx: 0,
        status: 'active',
        createdAt: Timestamp.now()
      };

      const proposalRef = await addDoc(collection(db, 'rescheduleProposals'), proposalData);

      await addDoc(collection(db, 'notifications'), {
        userId: candidateApp.customerId,
        title: 'Proposta di Cambio Orario',
        message: `Il barbiere ti chiede se puoi ${direction === 'anticipo' ? 'anticipare' : 'posticipare'} il tuo appuntamento alle ore ${format(newStart, 'HH:mm')}. Hai 15 minuti per accettare!`,
        type: 'reschedule_proposal',
        read: false,
        createdAt: Timestamp.now(),
        proposalId: proposalRef.id,
        appointmentId: candidateApp.id
      });

      setShiftConfirm(null);
      setGapWizardStep(3);
      setSelectedCandidates([candidateApp.id!]);
      setRescheduleCandidates([candidateApp]);
      setGapPlacements({ [candidateApp.id!]: newStart });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'rescheduleProposals');
    } finally {
      setSendingProposal(false);
    }
  };

  const findCandidatesForGap = (clickedGap: { start: Date, end: Date, appointmentId?: string }) => {
    const dayApps = appointments
      .filter(a => isSameDay(a.startTime.toDate(), clickedGap.start) && a.status === 'booked')
      .sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    
    let trueEnd = setHours(startOfDay(clickedGap.start), 20);
    const nextApp = dayApps.find(a => isAfter(a.startTime.toDate(), clickedGap.start) || a.startTime.toDate().getTime() === clickedGap.start.getTime());
    
    if (nextApp) { trueEnd = nextApp.startTime.toDate(); }
    
    const expandedGap = { ...clickedGap, end: trueEnd };
    const gapDuration = (trueEnd.getTime() - clickedGap.start.getTime()) / (1000 * 60);

    const candidates = appointments.filter(app => {
      const appStart = app.startTime.toDate();
      const appDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / (1000 * 60);
      
      return app.status === 'booked' && 
             isAfter(appStart, addMinutes(currentTime, 30)) && 
             appDuration <= gapDuration && 
             app.id !== expandedGap.appointmentId;
    }).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    
    setRescheduleCandidates(candidates);
    setShowGapFiller(expandedGap);
    setSelectedCandidates([]);
    setGapWizardStep(1);
    setGapPlacements({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleCandidate = (id: string) => {
    setSelectedCandidates(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const tomorrow = addDays(new Date(), 1);
  const tomorrowsAppointments = appointments.filter(app => 
    isSameDay(app.startTime.toDate(), tomorrow) && app.status === 'booked'
  ).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

  if (loading) {
    return <div className="text-center py-12">Caricamento dashboard...</div>;
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12 px-4 sm:px-0">
      <div className="bg-white/80 backdrop-blur-md border border-white/20 rounded-3xl overflow-hidden shadow-2xl">
        
        {/* INTESTAZIONE RESPONSIVE */}
        <div className="p-4 sm:p-6 border-b border-gray-100/50 flex flex-col xl:flex-row items-center justify-between gap-4 sm:gap-6">
          
          <div className="flex items-center justify-between w-full xl:w-auto gap-2 sm:gap-4">
            <button onClick={() => setSelectedDate(subDays(selectedDate, 1))} className="p-2 hover:bg-gray-50 rounded-full"><ChevronLeft size={20} /></button>
            
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              <h3 className="text-lg sm:text-xl font-bold min-w-[150px] sm:min-w-[180px] text-center">
                {format(selectedDate, 'EEEE d MMMM', { locale: it })}
              </h3>
              
              <div className="relative w-10 h-10 flex items-center justify-center cursor-pointer shrink-0 overflow-hidden rounded-full">
                <button className="w-full h-full flex items-center justify-center hover:bg-gray-100 text-gray-500 hover:text-black transition-colors focus:outline-none">
                  <CalendarIcon size={20} />
                </button>
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDate(new Date(e.target.value));
                    }
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 p-0"
                  title="Seleziona una data"
                />
              </div>
            </div>

            <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="p-2 hover:bg-gray-50 rounded-full"><ChevronRight size={20} /></button>
          </div>

          <div className="flex flex-wrap items-center justify-center xl:justify-end gap-3 sm:gap-4 w-full xl:w-auto">
            
            <div className="flex items-center gap-1 sm:gap-2 bg-gray-100 rounded-xl px-2 py-1.5 sm:px-3 sm:py-2">
              <button
                onClick={() => setViewMode('daily')}
                className={cn("px-2 py-1 sm:px-3 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all", viewMode === 'daily' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200")}
              >
                Giorno
              </button>
              <button
                onClick={() => setViewMode('weekly')}
                className={cn("px-2 py-1 sm:px-3 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all", viewMode === 'weekly' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200")}
              >
                Settimana
              </button>
              <button
                onClick={() => setViewMode('monthly')}
                className={cn("px-2 py-1 sm:px-3 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all", viewMode === 'monthly' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200")}
              >
                Mese
              </button>
            </div>
            
            <div className="relative flex-1 min-w-[220px] max-w-[320px] flex shadow-sm rounded-xl">
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as 'name' | 'phone')}
                className="bg-gray-50 border-y border-l border-gray-200 text-xs sm:text-sm rounded-l-xl px-2 py-2 outline-none focus:border-black font-medium text-gray-600 cursor-pointer"
              >
                <option value="name">Nome</option>
                <option value="phone">Numero</option>
              </select>
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder={searchType === 'name' ? "Cerca nome..." : "Cerca numero..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onFocus={() => setIsSearchActive(true)}
                  onBlur={() => setIsSearchActive(false)}
                  className={cn("pl-8 pr-3 py-2 w-full text-xs sm:text-sm rounded-r-xl border transition-all outline-none", isSearchActive ? "border-black ring-1 ring-black" : "border-gray-200 hover:border-gray-300")}
                />
                <Search size={16} className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors", isSearchActive ? "text-black" : "text-gray-400")} />
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setSelectedDate(new Date())} className="text-xs sm:text-sm font-bold text-gray-400 hover:text-black">Oggi</button>
              
              <button 
                onClick={() => setIsReminderModalOpen(true)} 
                className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-[#25D366]/10 text-[#25D366] text-xs font-bold rounded-xl hover:bg-[#25D366]/20 transition-all shadow-sm"
              >
                <MessageCircle size={16} /> 
                <span className="hidden sm:inline">Promemoria</span>
                <span className="sm:hidden">Invia</span>
              </button>
            </div>

          </div>
        </div>

        {/* WIZARD: SELEZIONE E COLLOCAMENTO (MULTI-STEP) */}
        {showGapFiller && (
          <div className="bg-emerald-50 border-b border-emerald-200 p-4 sm:p-6 shadow-inner animate-in slide-in-from-top duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div>
                <h4 className="text-lg font-bold text-emerald-900 flex items-center gap-2">
                  <Clock size={20} /> Riempimento Buco
                </h4>
                <p className="text-sm text-emerald-700 font-medium">
                  {format(showGapFiller.start, 'HH:mm')} - {format(showGapFiller.end, 'HH:mm')} 
                  ({formatDurationText((showGapFiller.end.getTime() - showGapFiller.start.getTime()) / 60000)} liberi)
                </p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                {gapWizardStep !== 3 && (
                  <button
                    onClick={() => {
                      setShowGapFiller(null);
                      setSelectedCandidates([]);
                      setGapPlacements({});
                      setGapWizardStep(1);
                    }}
                    className="px-4 py-2 bg-white text-gray-500 hover:text-red-500 rounded-xl border border-gray-200 text-sm font-bold flex-1 sm:flex-none"
                  >
                    Annulla
                  </button>
                )}
                
                {gapWizardStep === 1 && (
                  <button
                    disabled={selectedCandidates.length === 0}
                    onClick={() => {
                      const initialPlacements: Record<string, Date> = {};
                      selectedCandidates.forEach(id => { initialPlacements[id] = showGapFiller.start; });
                      setGapPlacements(initialPlacements);
                      setGapWizardStep(2);
                    }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex-1 sm:flex-none"
                  >
                    Avanti →
                  </button>
                )}

                {gapWizardStep === 2 && (
                  <button
                    disabled={sendingProposal}
                    onClick={handleProposeReschedule}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex-1 sm:flex-none flex items-center justify-center gap-2"
                  >
                    {sendingProposal ? 'Invio...' : <><Send size={16} /> Invia Proposte</>}
                  </button>
                )}

                {gapWizardStep === 3 && (
                  <button
                    onClick={() => {
                      setShowGapFiller(null);
                      setSelectedCandidates([]);
                      setGapPlacements({});
                      setGapWizardStep(1);
                    }}
                    className="px-8 py-2 bg-black text-white rounded-xl text-sm font-bold hover:bg-gray-800 flex-1 sm:flex-none"
                  >
                    Fatto
                  </button>
                )}
              </div>
            </div>

            {/* STEP 2: Assegnazione Orari Manuale */}
            {gapWizardStep === 2 && (
              <div className="bg-white p-4 rounded-2xl border border-emerald-100 space-y-4">
                <h5 className="text-sm font-bold text-gray-700 border-b pb-2">Seleziona l'orario esatto per ogni cliente</h5>
                {selectedCandidates.map(id => {
                  const candidate = rescheduleCandidates.find(c => c.id === id)!;
                  const dur = (candidate.endTime.toDate().getTime() - candidate.startTime.toDate().getTime()) / 60000;
                  
                  const options = [];
                  let curr = showGapFiller.start;
                  while (addMinutes(curr, dur) <= showGapFiller.end) {
                    options.push(new Date(curr));
                    curr = addMinutes(curr, 15);
                  }

                  return (
                    <div key={id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl">
                      <div>
                        <span className="font-bold block">{candidate.isForFriend ? candidate.friendDetails?.firstName : candidate.customer?.displayName}</span>
                        <span className="text-xs text-gray-500">Servizio: {dur} min</span>
                      </div>
                      <select 
                        className="p-2 rounded-lg border border-gray-200 font-bold outline-none focus:border-emerald-500"
                        value={gapPlacements[id]?.toISOString() || showGapFiller.start.toISOString()}
                        onChange={(e) => setGapPlacements(prev => ({...prev, [id]: new Date(e.target.value)}))}
                      >
                        {options.map(opt => (
                          <option key={opt.toISOString()} value={opt.toISOString()}>{format(opt, 'HH:mm')}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                <div className="text-[10px] text-emerald-600 flex items-center gap-1 mt-2">
                  <AlertCircle size={12} /> Assicurati di non sovrapporre gli orari se hai scelto più clienti!
                </div>
              </div>
            )}

            {/* STEP 3: Notifiche WhatsApp Centralizzate */}
            {gapWizardStep === 3 && (
              <div className="bg-white p-6 rounded-2xl border border-emerald-100 text-center space-y-6">
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-2">
                    <CheckCircle2 size={32} />
                  </div>
                  <h5 className="text-xl font-bold text-gray-900">Proposte inviate nell'app!</h5>
                  <p className="text-sm text-gray-500">Ora avvisa i clienti su WhatsApp per invitarli a controllare l'app.</p>
                </div>
                
                <div className="space-y-3 text-left">
                  {selectedCandidates.map(id => {
                    const candidate = rescheduleCandidates.find(c => c.id === id)!;
                    const phone = candidate.isForFriend ? candidate.friendDetails?.phone : candidate.customer?.phoneNumber;
                    const name = candidate.isForFriend ? candidate.friendDetails?.firstName : candidate.customer?.displayName;
                    const proposedTime = gapPlacements[id] || showGapFiller.start;
                    
                    const waLink = phone ? generateWhatsAppLink(
                      'reschedule_proposal_sent', 
                      name || 'Cliente', 
                      phone, 
                      format(proposedTime, 'dd/MM/yyyy'), 
                      format(proposedTime, 'HH:mm')
                    ) : null;

                    return (
                      <div key={id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div>
                          <span className="font-bold text-sm block">{name}</span>
                          <span className="text-xs text-gray-500">Proposto per le {format(proposedTime, 'HH:mm')}</span>
                        </div>
                        {waLink ? (
                          <a 
                            href={waLink}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white rounded-lg text-xs font-bold hover:bg-[#20bd5a] transition-all shadow-sm hover:shadow-md"
                          >
                            <MessageCircle size={16} /> WhatsApp
                          </a>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Numero mancante</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-gray-50">
          {calendarData.items.map(item => {
            const apps = getAppointmentsForItem(item).filter(a => a.status !== 'cancelled'); 
            
            // --- CALCOLO TURNI E OVERLAY "FUORI TURNO" (Corretto per orari frazionati) ---
            let isBreak = false;
            let offRange: { start: Date, end: Date, label: string } | null = null;

            if (calendarData.type === 'daily') {
              const dateString = format(selectedDate, 'yyyy-MM-dd');
              const dayOfWeek = getDay(selectedDate);
              const exceptionForToday = specialDays.find(ex => ex.date === dateString);
              
              let activeOpeningHours: TimeRange[] = [];
              if (exceptionForToday && !exceptionForToday.isClosed) {
                activeOpeningHours = exceptionForToday.openingHours?.length ? exceptionForToday.openingHours : (businessSettings.weeklySchedule[dayOfWeek]?.shifts || []);
              } else if (!exceptionForToday && businessSettings.weeklySchedule[dayOfWeek]?.isOpen) {
                activeOpeningHours = businessSettings.weeklySchedule[dayOfWeek].shifts;
              }

              const itemStart = item;
              const itemEnd = addHours(item, 1);

              // 1. Controllo minuti frazionati "Fuori Turno" (Aperture / Chiusure a metà ora)
              activeOpeningHours.forEach(range => {
                const sH = Math.floor(range.start);
                const sM = Math.round((range.start - sH) * 60);
                const eH = Math.floor(range.end);
                const eM = Math.round((range.end - eH) * 60);

                const shiftStart = setMinutes(setHours(startOfDay(selectedDate), sH), sM);
                const shiftEnd = setMinutes(setHours(startOfDay(selectedDate), eH), eM);

                // CASO A: Apertura frazionata (es. Apertura ore 08:45 nella riga delle 08:00)
                if (isBefore(itemStart, shiftStart) && isBefore(shiftStart, itemEnd)) {
                  offRange = {
                    start: itemStart,
                    end: shiftStart,
                    label: `Apertura ore ${format(shiftStart, 'HH:mm')}`
                  };
                }
                // CASO B: Chiusura frazionata (es. Apertura fino alle ore 13:15 nella riga delle 13:00 o 20:30 nella riga delle 20:00)
                else if (isBefore(itemStart, shiftEnd) && isBefore(shiftEnd, itemEnd)) {
                  offRange = {
                    start: shiftEnd,
                    end: itemEnd,
                    label: `Apertura fino alle ore ${format(shiftEnd, 'HH:mm')}`
                  };
                }
              });

              // 2. Controllo Pausa Salone Totale (Solamente se l'ora è COMPLETAMENTE fuori dai turni)
              if (!offRange && activeOpeningHours.length > 1) {
                const shift1EndH = Math.floor(activeOpeningHours[0].end);
                const shift2StartH = Math.floor(activeOpeningHours[1].start);
                const itemH = item.getHours();

                if (itemH >= shift1EndH && itemH < shift2StartH) {
                  isBreak = true;
                }
              }
            }

            const isMatched = apps.length > 0 && searchTerm && apps.some(app => isMatchedBySearch(app));

            // --- CALCOLO BUCHI ORARI (Intelligente e Vincolato ai Turni) ---
            const gapsForThisItem: { start: Date, end: Date, duration: number }[] = [];
            
            if (!isBreak && !searchTerm && calendarData.type === 'daily') {
              const dateString = format(selectedDate, 'yyyy-MM-dd');
              const dayOfWeek = getDay(selectedDate);
              const exceptionForToday = specialDays.find(ex => ex.date === dateString);
              
              let activeOpeningHours: TimeRange[] = [];
              if (exceptionForToday && !exceptionForToday.isClosed) {
                activeOpeningHours = exceptionForToday.openingHours?.length ? exceptionForToday.openingHours : (businessSettings.weeklySchedule[dayOfWeek]?.shifts || []);
              } else if (!exceptionForToday && businessSettings.weeklySchedule[dayOfWeek]?.isOpen) {
                activeOpeningHours = businessSettings.weeklySchedule[dayOfWeek].shifts;
              }

              const itemStart = item; // Es. 11:00
              const itemEnd = addHours(item, 1); // Es. 12:00
              const nowPlus30 = addMinutes(currentTime, 30);

              // Troviamo il turno attivo per questo slot
              const currentShift = activeOpeningHours.find(range => {
                const sH = Math.floor(range.start);
                const sM = Math.round((range.start - sH) * 60);
                const eH = Math.floor(range.end);
                const eM = Math.round((range.end - eH) * 60);

                const shiftStart = setMinutes(setHours(startOfDay(selectedDate), sH), sM);
                const shiftEnd = setMinutes(setHours(startOfDay(selectedDate), eH), eM);

                return isBefore(itemStart, shiftEnd) && isAfter(itemEnd, shiftStart);
              });

              if (currentShift) {
                const sH = Math.floor(currentShift.start);
                const sM = Math.round((currentShift.start - sH) * 60);
                const shiftStart = setMinutes(setHours(startOfDay(selectedDate), sH), sM);

                const eH = Math.floor(currentShift.end);
                const eM = Math.round((currentShift.end - eH) * 60);
                const shiftEnd = setMinutes(setHours(startOfDay(selectedDate), eH), eM);

                // Marker iniziale di base per quest'ora (rispettando l'apertura del turno)
                let currentMarker = isBefore(itemStart, shiftStart) ? shiftStart : itemStart;
                const realSlotEnd = isAfter(itemEnd, shiftEnd) ? shiftEnd : itemEnd;

                // Prendiamo TUTTI gli appuntamenti del giorno che intersecano questa riga oraria,
                // non solo quelli che INIZIANO in quest'ora!
                const dayAppointmentsInSlot = filteredAppointments.filter(app => {
                  if (app.status === 'cancelled') return false;
                  const appStart = app.startTime.toDate();
                  const appEnd = app.endTime.toDate();
                  // L'appuntamento interseca la riga se inizia prima della fine dello slot E finisce dopo l'inizio dello slot
                  return isBefore(appStart, realSlotEnd) && isAfter(appEnd, currentMarker);
                }).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

                // Se un appuntamento è iniziato prima (es. 10:45) e finisce dentro quest'ora (es. 11:30),
                // aggiorniamo subito il marker iniziale per spingerlo alle 11:30!
                dayAppointmentsInSlot.forEach(app => {
                  const appStart = app.startTime.toDate();
                  const appEnd = app.endTime.toDate();

                  // Se c'è uno spazio libero PRIMA dell'inizio di questo appuntamento
                  if (isBefore(currentMarker, appStart) && isBefore(appStart, realSlotEnd)) {
                    const dur = (appStart.getTime() - currentMarker.getTime()) / 60000;
                    if (dur >= 15 && isAfter(currentMarker, nowPlus30)) {
                      gapsForThisItem.push({ start: currentMarker, end: appStart, duration: dur });
                    }
                  }

                  // Spostiamo avanti il marker di occupazione fino alla fine dell'appuntamento corrente
                  if (isAfter(appEnd, currentMarker)) {
                    currentMarker = isBefore(appEnd, realSlotEnd) ? appEnd : realSlotEnd;
                  }
                });

                // Se rimane spazio libero DOPO l'ultimo appuntamento fino alla fine della riga
                if (isBefore(currentMarker, realSlotEnd)) {
                  const dur = (realSlotEnd.getTime() - currentMarker.getTime()) / 60000;
                  if (dur >= 15 && isAfter(currentMarker, nowPlus30)) {
                    gapsForThisItem.push({ start: currentMarker, end: realSlotEnd, duration: dur });
                  }
                }
              }
            }

            // Uniamo Elementi e Buchi
            const combinedItems = [
              ...apps.map(a => ({ type: 'app' as const, data: a, start: a.startTime.toDate() })), 
              ...gapsForThisItem.map(g => ({ type: 'gap' as const, data: g, start: g.start }))
            ].sort((a, b) => a.start.getTime() - b.start.getTime());

            return (
              <div key={item.toISOString()} className={cn("flex min-h-[60px] relative", isBreak && "bg-gray-50/50")}>
                {/* Past Time Overlay */}
                {isSameDay(selectedDate, currentTime) && isBefore(addHours(item, 1), currentTime) && (
                  <div className="absolute inset-0 bg-gray-200/30 backdrop-grayscale-[0.5] z-10 pointer-events-none" />
                )}
                
                <div className="w-16 p-3 text-right border-r border-gray-50 flex-shrink-0">
                  <span className="text-xs font-bold text-gray-400">{calendarData.formatItem(item)}</span>
                </div>
                <div className="flex-1 p-1.5 flex gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent items-center">
                  
                  {/* CASO 1: Pausa Salone Completa */}
                  {isBreak ? (
                    <div className="flex items-center justify-center w-full text-gray-300 text-[10px] font-bold uppercase tracking-widest italic">
                      Pausa Salone
                    </div>
                  ) : (
                    <>
                      {/* CASO 2A: Overlay Apertura (Posizionato sulla SINISTRA dello slot) */}
                      {offRange && offRange.label.includes('Apertura') && (
                        <div 
                          style={{ 
                            width: `${((offRange.end.getTime() - offRange.start.getTime()) / 60000 / 30) * (typeof window !== 'undefined' && window.innerWidth < 640 ? 7 : 10)}rem`,
                            maxWidth: '45vw'
                          }}
                          className="flex-shrink-0 h-[60px] flex items-center justify-center bg-gray-100/80 border-2 border-dashed border-gray-300 text-gray-400 rounded-xl select-none"
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wider text-center px-2">
                            {offRange.label}
                          </span>
                        </div>
                      )}

                      {/* CASO 3: Appuntamenti e Buchi Orari */}
                      {combinedItems.length === 0 && !offRange ? (
                        <div className="flex-1"></div>
                      ) : (
                        combinedItems.map((itemObj, idx) => {
                          if (itemObj.type === 'gap') {
                            const gap = itemObj.data as { start: Date, end: Date, duration: number };
                            const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
                            const baseWidth = isMobile ? 7 : 10; 
                            const cardWidth = (gap.duration / 30) * baseWidth;
                            
                            return (
                              <button
                                key={`gap-${idx}`}
                                onClick={() => findCandidatesForGap({ start: gap.start, end: gap.end })}
                                style={{ width: `${cardWidth}rem`, maxWidth: '85vw' }}
                                className="flex-shrink-0 h-[60px] flex flex-col items-center justify-center gap-1 bg-amber-50 border-2 border-dashed border-amber-200 text-amber-600 rounded-xl hover:bg-amber-100 hover:border-amber-400 transition-all opacity-80 hover:opacity-100"
                              >
                                <Plus size={16} />
                                <span className="text-[10px] font-bold leading-tight text-center">
                                  {formatDurationText(gap.duration)}
                                </span>
                              </button>
                            );
                          }

                          const app = itemObj.data as Appointment & { customer?: UserProfile };
                          const duration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / (1000 * 60);
                          
                          // 🚀 CALCOLO COMPRESSIONE: Verifichiamo se l'appuntamento ha usato la Flessibilità
                          const nominalDuration = app.services.reduce((acc, s) => acc + s.duration, 0);
                          const isCompressed = duration < nominalDuration;
                          
                          const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
                          const baseWidth = isMobile ? 7 : 10; 
                          const cardWidth = (duration / 30) * baseWidth; 
                          
                          const isCandidate = rescheduleCandidates.some(c => c.id === app.id);
                          const isSelected = selectedCandidates.includes(app.id!);
                          const selectionMode = showGapFiller !== null;

                          // 🚀 RILEVAMENTO ADIACENZA (Shift Scope)
                          const isAdjacentNext = selectionMode && Math.abs(app.startTime.toDate().getTime() - showGapFiller!.end.getTime()) < 60000;
                          const isAdjacentPrev = selectionMode && Math.abs(app.endTime.toDate().getTime() - showGapFiller!.start.getTime()) < 60000;

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
                              style={{ width: `${cardWidth}rem`, maxWidth: '85vw' }}
                              className={cn(
                                "flex-shrink-0 p-2 sm:p-2.5 rounded-xl shadow-md flex flex-col justify-between text-left transition-all cursor-pointer relative min-h-[76px] sm:h-[88px] duration-500 overflow-hidden group",
                                app.id === highlightedAppId ? "ring-4 ring-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.6)] scale-[1.05] z-20" : "hover:scale-[1.02]",
                                selectionMode && !isCandidate && !isAdjacentNext && !isAdjacentPrev ? "bg-gray-100 text-gray-400 grayscale shadow-none border-gray-200 opacity-50" :
                                isSelected ? "bg-emerald-500 text-white ring-4 ring-emerald-500/30" :
                                (app.status === 'completed' || (app.status === 'booked' && isBefore(app.endTime.toDate(), currentTime))) ? "bg-emerald-600 text-white" :
                                "bg-black text-white" 
                              )}
                            >
                              {/* 🚀 OVERLAY AZIONE RAPIDA DECOMPRESSIONE */}
                              {(isAdjacentNext || isAdjacentPrev) && !sendingProposal && (
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setShiftConfirm({app, direction: isAdjacentNext ? 'anticipo' : 'posticipo'}); 
                                  }}
                                  className="absolute inset-0 bg-blue-600/95 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <ArrowUpCircle size={20} className={isAdjacentPrev ? "rotate-180" : ""} />
                                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                                    Chiedi {isAdjacentNext ? 'Anticipo' : 'Posticipo'}
                                  </span>
                                </button>
                              )}

                              {/* 🚀 BADGE FLESSIBILITÀ (Triangolino Giallo) */}
                              {isCompressed && (
                                <div 
                                  className="absolute -top-1.5 -right-1.5 bg-amber-400 text-amber-950 text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm border border-amber-500 z-10 flex items-center gap-0.5 cursor-help"
                                  title={`Buco riempito: Servizio compresso da ${nominalDuration} a ${duration} min`}
                                >
                                  ⚠️ Flex
                                </div>
                              )}

                              <div>
                                <div className="flex justify-between items-start gap-2">
                                  <div className="font-bold text-[11px] sm:text-xs truncate">
                                    {app.isForFriend ? `Per: ${app.friendDetails?.firstName}` : app.customer?.displayName}
                                  </div>
                                  <div className="text-[9px] font-bold opacity-60 flex flex-col items-end leading-tight shrink-0">
                                    <span>{format(app.startTime.toDate(), 'HH:mm')}</span>
                                    <span>- {format(app.endTime?.toDate() || addMinutes(app.startTime.toDate(), app.services.reduce((acc, s) => acc + s.duration, 0)), 'HH:mm')}</span>
                                  </div>
                                </div>
                                <div className="text-[9px] opacity-70 mt-0.5 truncate">
                                  {app.services.map(s => s.name).join(', ')}
                                </div>
                              </div>
                              <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-white/10">
                                <div className="flex items-center gap-1 text-[9px] truncate">
                                  <Phone size={8} /> {app.isForFriend ? app.friendDetails?.phone?.slice(-10) : app.customer?.phoneNumber?.slice(-10)}
                                </div>
                                {app.isForFriend && (
                                  <div className="text-[8px] bg-white/20 px-1 rounded uppercase font-bold">Amico</div>
                                )}
                              </div>

                              {isSelected && (
                                <div className="absolute bottom-1 right-1 bg-white text-emerald-600 rounded-full p-0.5 shadow-sm animate-in zoom-in">
                                  <Check size={10} strokeWidth={4} />
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}

                      {/* CASO 2B: Overlay Chiusura (Posizionato sulla DESTRA dello slot) */}
                      {offRange && offRange.label.includes('Chiusura') && (
                        <div 
                          style={{ 
                            width: `${((offRange.end.getTime() - offRange.start.getTime()) / 60000 / 30) * (typeof window !== 'undefined' && window.innerWidth < 640 ? 7 : 10)}rem`,
                            maxWidth: '45vw'
                          }}
                          className="flex-shrink-0 h-[60px] flex items-center justify-center bg-gray-100/80 border-2 border-dashed border-gray-300 text-gray-400 rounded-xl select-none"
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wider text-center px-2">
                            {offRange.label}
                          </span>
                        </div>
                      )}
                    </>
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
                setIsEditingCustomer(false);
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
                  {isEditingCustomer ? (
                    <div className="bg-white rounded-2xl p-4 shadow-inner border border-gray-100 space-y-3 mt-1 animate-in fade-in zoom-in-95 duration-200">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Nome</label>
                          <input type="text" value={editCustomerForm.firstName} onChange={e => setEditCustomerForm({...editCustomerForm, firstName: e.target.value})} className="w-full px-3 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-black outline-none" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Cognome</label>
                          <input type="text" value={editCustomerForm.lastName} onChange={e => setEditCustomerForm({...editCustomerForm, lastName: e.target.value})} className="w-full px-3 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-black outline-none" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Telefono</label>
                        <input type="tel" value={editCustomerForm.phone} onChange={e => setEditCustomerForm({...editCustomerForm, phone: e.target.value.replace(/\D/g, '')})} className="w-full px-3 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-black outline-none" />
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button onClick={handleSaveCustomerEdits} disabled={savingCustomer} className="flex-1 py-2 bg-black text-white rounded-xl text-xs font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-1 transition-all shadow-md">
                          {savingCustomer ? 'Salvataggio...' : <><Check size={14} /> Salva</>}
                        </button>
                        <button onClick={() => setIsEditingCustomer(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all">
                          Annulla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="animate-in fade-in duration-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-2xl font-bold leading-tight">
                          {selectedAppointment.isForFriend 
                            ? `${selectedAppointment.friendDetails?.firstName} ${selectedAppointment.friendDetails?.lastName || ''}` 
                            : selectedAppointment.customer?.displayName}
                        </div>
                        <button onClick={startEditingCustomer} className="p-2 bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200 rounded-xl transition-all shadow-sm shrink-0">
                          <Settings size={18} />
                        </button>
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

                <button
                  onClick={() => {
                    setSelectedAppointment(null);
                    setActiveNotifType(null);
                    setShowContactMenu(false);
                    setIsEditingCustomer(false);
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

      {/* Shift Confirmation Modal */}
      {shiftConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4 animate-in fade-in">
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ArrowUpCircle size={32} className={shiftConfirm.direction === 'posticipo' ? "rotate-180" : ""} />
            </div>
            <h3 className="text-2xl font-bold mb-2">Conferma {shiftConfirm.direction === 'anticipo' ? 'Anticipo' : 'Posticipo'}</h3>
            <p className="text-gray-500 mb-8 text-sm">
              Vuoi inviare una proposta a <span className="font-bold text-black">{shiftConfirm.app.isForFriend ? shiftConfirm.app.friendDetails?.firstName : shiftConfirm.app.customer?.displayName}</span> per spostare l'appuntamento alle <span className="font-bold text-black">{format(shiftConfirm.direction === 'anticipo' ? showGapFiller!.start : addMinutes(showGapFiller!.end, -(shiftConfirm.app.services.reduce((acc, s) => acc + s.duration, 0))), 'HH:mm')}</span>?
            </p>
            <div className="flex flex-col gap-3">
              <button
                disabled={sendingProposal}
                onClick={handleShiftProposal}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all flex justify-center items-center gap-2"
              >
                {sendingProposal ? 'Invio in corso...' : 'Sì, Invia Proposta'}
              </button>
              <button
                disabled={sendingProposal}
                onClick={() => setShiftConfirm(null)}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup Proposta Rifiutata */}
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

      {/* Modal Promemoria WhatsApp */}
      {isReminderModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#25D366] text-white">
              <div className="flex items-center gap-3">
                <MessageCircle size={24} />
                <div>
                  <h3 className="text-lg font-bold">Promemoria di Domani</h3>
                  <p className="text-xs opacity-90">{format(tomorrow, 'EEEE d MMMM', { locale: it })}</p>
                </div>
              </div>
              <button onClick={() => setIsReminderModalOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2">
              {tomorrowsAppointments.length === 0 ? (
                <div className="p-8 text-center text-gray-400 font-medium">
                  Nessun appuntamento confermato per domani.
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {tomorrowsAppointments.map(app => {
                    const phone = (app.isForFriend ? app.friendDetails?.phone : app.customer?.phoneNumber) || '';
                    const name = (app.isForFriend ? app.friendDetails?.firstName : app.customer?.displayName) || 'Cliente';
                    const time = app.startTime?.toDate ? format(app.startTime.toDate(), 'HH:mm') : '--:--';
                    
                    const servicesList = app.services && Array.isArray(app.services) 
                      ? app.services.map(s => s.name).join(', ') 
                      : 'Appuntamento';

                    const message = `💈 Medo Hair Salon ti ricorda l’appuntamento di domani alle ore ${time}!`;
                    const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}` : '#';

                    return (
                      <div key={app.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div>
                          <div className="font-bold text-sm text-gray-900">{name}</div>
                          <div className="text-xs text-gray-500 font-medium mt-0.5">Ore {time} • {servicesList}</div>
                        </div>
                        <a 
                          href={waLink} 
                          target="_blank" 
                          rel="noreferrer"
                          onClick={(e) => {
                            if (!phone) {
                              e.preventDefault();
                              alert("Numero di telefono mancante per questo cliente.");
                            }
                          }}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-sm",
                            phone ? "bg-[#25D366] text-white hover:bg-[#20bd5a]" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                          )}
                        >
                          <Send size={14} /> Invia
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
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
          }}
          businessSettings={businessSettings}
        />
      )}

      {isScheduleMaintenanceOpen && (
        <ScheduleMaintenanceModal onClose={() => setIsScheduleMaintenanceOpen(false)} />
      )}
    </div>
  );
}

interface ManualBookingModalProps {
  onClose: () => void;
  onSuccess: () => void;
  businessSettings: {
    weeklySchedule: WeeklySchedule;
  };
}

function ManualBookingModal({ onClose, onSuccess, businessSettings }: ManualBookingModalProps) {
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
const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  
  // 🚀 NUOVO STATO: La "Rubrica Universale" scaricata in memoria (RAM)
  const [globalDirectory, setGlobalDirectory] = useState<{ firstName: string, lastName: string, phone: string, email: string, displayPhone: string, phonePrefix: string }[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // Ref per gestire il clic fuori dalla tendina
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSuggestions([]); 
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'calendar_exceptions'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SpecialDay[];
      setSpecialDays(docs);
    });
    return () => unsubscribe();
  }, []);

  // 🚀 STEP 1: CARICAMENTO SINGOLO (Tutto il database in RAM al primo avvio della modale)
  useEffect(() => {
    const fetchEntireDirectory = async () => {
      try {
        const contactsSnap = await getDocs(collection(db, 'contacts'));
        const usersSnap = await getDocs(collection(db, 'users'));
        
        const combined: any[] = [];

        // 1A. Preleviamo tutti gli utenti che usano l'App
        usersSnap.docs.forEach(doc => {
          const u = doc.data();
          if (u.role === 'barber') return; // Escludiamo i barbieri stessi
          
          const fullName = u.displayName || '';
          const parts = fullName.split(' ');
          const fName = parts[0] || '';
          const lName = parts.slice(1).join(' ') || '';
          
          const rawPhone = (u.phoneNumber || '').replace(/\D/g, '');
          const cleanPhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.substring(2) : rawPhone.slice(-10);

          combined.push({
            firstName: fName,
            lastName: lName,
            phone: cleanPhone,
            phonePrefix: '+39',
            email: u.email || '',
            displayPhone: cleanPhone.length >= 9 ? `+39 ${cleanPhone}` : 'Nessun numero'
          });
        });

        // 1B. Preleviamo tutti i contatti manuali (La rubrica)
        contactsSnap.docs.forEach(doc => {
          const c = doc.data();
          const rawPhone = (c.phone || '').replace(/\D/g, '');
          const cleanPhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.substring(2) : rawPhone.slice(-10);

          combined.push({
            firstName: c.firstName || '',
            lastName: c.lastName || '',
            phone: cleanPhone,
            phonePrefix: '+39',
            email: c.email || '',
            displayPhone: cleanPhone.length >= 9 ? `+39 ${cleanPhone}` : 'Nessun numero'
          });
        });

        // 1C. Deduplicazione assoluta e definitiva in base al numero
        const uniqueMap = new Map();
        combined.forEach(item => {
          // Se ha un numero valido, usa il numero per scartare i cloni. Altrimenti usa il nome.
          const key = item.phone && item.phone.length >= 9 ? item.phone : `${item.firstName.toLowerCase()}_${item.lastName.toLowerCase()}_${Math.random()}`;
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, item);
          }
        });

        setGlobalDirectory(Array.from(uniqueMap.values()));
        setDirectoryLoaded(true);
      } catch (error) {
        console.error("Errore nel caricamento massivo rubrica:", error);
      }
    };
    fetchEntireDirectory();
  }, []);

  // 🚀 STEP 2: RICERCA ISTANTANEA (Totalmente slegata da Firebase, fluida come l'acqua)
  useEffect(() => {
    if (!directoryLoaded) return; // Aspettiamo che la RAM sia piena

    const searchFirst = firstName.trim().toLowerCase();
    const searchLast = lastName.trim().toLowerCase();

    if (searchFirst.length < 2) {
      setSuggestions([]);
      return;
    }

    const filtered = globalDirectory.filter(person => {
      const fullContactName = `${person.firstName} ${person.lastName}`.toLowerCase();
      
      // La logica più permissiva e potente del mondo web (.includes)
      // Non importa se c'è uno spazio, lui trova la corrispondenza esatta dentro la stringa!
      const matchesFirst = fullContactName.includes(searchFirst);
      const matchesLast = !searchLast || fullContactName.includes(searchLast);

      return matchesFirst && matchesLast;
    });

    setSuggestions(filtered.slice(0, 5));
  }, [firstName, lastName, directoryLoaded, globalDirectory]);

  const selectSuggestion = (s: any) => {
    setFirstName(s.firstName);
    setLastName(s.lastName);
    setPhone(s.phone);
    if (s.phonePrefix) setPhonePrefix(s.phonePrefix);
    if (s.email) setEmail(s.email);
    setSuggestions([]);
  };

  const next30Days = React.useMemo(() => {
    const days = eachDayOfInterval({ start: new Date(), end: addDays(new Date(), 30) });
    return days.filter(d => {
      const dateString = format(d, 'yyyy-MM-dd');
      const exception = specialDays.find(ex => ex.date === dateString);
      if (exception) return !exception.isClosed;
      return businessSettings.weeklySchedule[getDay(d)]?.isOpen;
    });
  }, [specialDays, businessSettings]);

  // 🚀 MEMOIZZAZIONE REGOLE CALENDARIO BARBIERE
  const disabledDays = React.useMemo(() => {
    return [
      { before: startOfDay(new Date()) },
      (date: Date) => {
        const dateString = format(date, 'yyyy-MM-dd');
        // 1. Controllo Eccezioni (Ferie o APERTURE STRAORDINARIE)
        const exception = specialDays.find(ex => ex.date === dateString);
        if (exception) {
          return exception.isClosed;
        }
        // 2. Controllo giorni di chiusura standard
        if (!businessSettings.weeklySchedule[getDay(date)]?.isOpen) return true;
        
        return false;
      }
    ];
  }, [specialDays, businessSettings]);

  useEffect(() => {
    if (selectedDate && selectedServices.length > 0) {
      calculateSlots();
    } else {
      setAvailableSlots([]);
    }
  }, [selectedDate, selectedServices, businessSettings]);

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

      // 🚀 Adapter: Mappatura appuntamenti esistenti con calcolo dello "stato di stress" (isCompressed)
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

      // Ordinamento cronologico finale e deduplicazione
      const uniqueSortedSlots = Array.from(new Set(allValidSlots.map(d => d.getTime())))
        .map(time => new Date(time))
        .sort((a, b) => a.getTime() - b.getTime());

      // Filtra slot passati se la data selezionata è oggi
      const now = new Date();
      setAvailableSlots(uniqueSortedSlots.filter(slot => isAfter(slot, now)));
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

    const rawPhone = phone.replace(/\D/g, '');
    const pure10Digits = (rawPhone.startsWith('39') && rawPhone.length > 10) 
      ? rawPhone.substring(2) 
      : rawPhone.slice(-10);

    if (pure10Digits.length < 9) {
      alert("Il numero di telefono deve contenere almeno 9 cifre valide.");
      return;
    }

    setLoading(true);
    const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);
    
    // 🚀 CALCOLO DURATA COMPRESSA REALE
    const dayStart = startOfDay(selectedSlot);
    const dayEnd = endOfDay(selectedSlot);
    
    // Scarichiamo gli appuntamenti per trovare gli ostacoli (usiamo direttamente il DB per sicurezza massima)
    const qDay = query(
      collection(db, 'appointments'),
      where('startTime', '>=', Timestamp.fromDate(dayStart)),
      where('startTime', '<=', Timestamp.fromDate(dayEnd)),
      where('status', '==', 'booked')
    );
    const daySnap = await getDocs(qDay);
    const dayApps = daySnap.docs.map(d => d.data() as Appointment).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

    // Troviamo la fine del turno
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

    // Calcoliamo il vero endTime
    const nextApp = dayApps.find(a => a.startTime.toMillis() > selectedSlot.getTime());
    const obstacleTime = nextApp && isBefore(nextApp.startTime.toDate(), shiftEnd) ? nextApp.startTime.toDate() : shiftEnd;
    
    const availableMins = (obstacleTime.getTime() - selectedSlot.getTime()) / 60000;
    const actualDuration = Math.min(totalDuration, availableMins);
    const endTime = addMinutes(selectedSlot, actualDuration);

    // Costruiamo i formati
    const fullPhoneNumber = `+39${pure10Digits}`;
    const cleanContactPhone = pure10Digits;

    try {
      let finalCustomerId = 'manual_entry';
      let isRegisteredUser = false;

      const usersRef = collection(db, 'users');
      const userQuery = query(usersRef, where('phoneNumber', '==', fullPhoneNumber), limit(1));
      const userSnapshot = await getDocs(userQuery);

      if (!userSnapshot.empty) {
        // 🟢 L'UTENTE ESISTE (Niente Rubrica)
        finalCustomerId = userSnapshot.docs[0].id;
        isRegisteredUser = true;

        await updateDoc(doc(db, 'users', finalCustomerId), {
          displayName: `${firstName} ${lastName}`,
          ...(email ? { email: email } : {}),
          updatedAt: Timestamp.now()
        });

        // Purge: Cancelliamo il contatto in rubrica se c'era
        try { await deleteDoc(doc(db, 'contacts', cleanContactPhone)); } catch(e) {}
      } else {
        // 🟠 L'UTENTE NON ESISTE (Creiamo/Aggiorniamo in Rubrica)
        await setDoc(doc(db, 'contacts', cleanContactPhone), {
          firstName,
          lastName,
          firstNameLower: firstName.toLowerCase(),
          lastNameLower: lastName.toLowerCase(),
          phone: cleanContactPhone,
          phonePrefix: '+39',
          email: email || '',
          updatedAt: Timestamp.now()
        }, { merge: true });
      }

      // Creazione Appuntamento
      const q = query(
        collection(db, 'appointments'),
        where('startTime', '==', Timestamp.fromDate(selectedSlot)),
        where('status', '==', 'cancelled')
      );
      const cancelledSnapshot = await getDocs(q);
      for (const d of cancelledSnapshot.docs) {
        await deleteDoc(doc(db, 'appointments', d.id));
      }
      
      const newAppointmentRef = await addDoc(collection(db, 'appointments'), {
        customerId: finalCustomerId,
        customer: {
          displayName: `${firstName} ${lastName}`,
          phoneNumber: fullPhoneNumber,
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

      if (isRegisteredUser) {
        await addDoc(collection(db, 'notifications'), {
          userId: finalCustomerId,
          title: 'Nuovo Appuntamento Fissato',
          message: `Il barbiere ha inserito un appuntamento per te il ${format(selectedSlot, 'd MMM')} alle ${format(selectedSlot, 'HH:mm')}`,
          type: 'booking',
          read: false,
          createdAt: Timestamp.now(),
          appointmentId: newAppointmentRef.id
        });
      }

      if (sendWhatsApp) {
        const link = generateWhatsAppLink(
          'booking', 
          firstName, 
          fullPhoneNumber, 
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
              <div className="space-y-1.5 relative" ref={searchContainerRef}>
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
                    {service.description && (
                      <div className={cn("text-[10px] mt-0.5 leading-tight", isSelected ? "text-gray-400" : "text-gray-500")}>
                        {service.description}
                      </div>
                    )}
                    <div className={cn("text-[10px] mt-1 font-medium", isSelected ? "text-gray-400" : "text-gray-400")}>
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
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2 m-0">
                <CalendarIcon size={14} /> Data
              </h3>
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