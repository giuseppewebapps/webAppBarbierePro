import React, { useEffect, useState, useRef } from 'react';
import AppointmentDetailsModal from './AppointmentDetailsModal';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, Timestamp, getDoc, getDocs, addDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Appointment, UserProfile, RescheduleProposal, TimeRange, SpecialDay, ProposalType } from '../types';
import { format, startOfDay, endOfDay, eachHourOfInterval, addHours, isSameDay, addDays, subDays, startOfWeek, endOfWeek, eachDayOfInterval, setHours, setMinutes, isAfter, isBefore, addMinutes, getDay } from 'date-fns';
import { getCardRowStart } from '../utils/timeline';
import { it } from 'date-fns/locale';
import { Calendar as CalendarIcon, Phone, Clock, XCircle, AlertCircle, ChevronLeft, ChevronRight, Check, Send, CheckCircle2, MessageCircle, ArrowUpCircle, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSalonSettings } from '../hooks/useSalonSettings';
import { useIsOwner } from '../hooks/useIsOwner';
import { generateWhatsAppLink } from '../utils/whatsapp';
import { cn } from '../lib/utils';

interface Props {
  selectedAppointmentId?: string | null;
  selectedNotificationType?: string | null;
  onAppointmentDialogClose?: () => void;
}

export default function MonoBarberDashboard({ selectedAppointmentId, selectedNotificationType, onAppointmentDialogClose }: Props) {
  const { profile, tenantId } = useAuth();
  const { settings: salonSettings } = useSalonSettings(tenantId);
  
  const [appointments, setAppointments] = useState<(Appointment & { customer?: UserProfile })[]>([]);
  const [localContacts, setLocalContacts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState<(Appointment & { customer?: UserProfile }) | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState<Appointment | null>(null);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  // 🚀 STATI RICERCA E HEADER
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<'name' | 'phone'>('name');
  const [isSearchActive, setIsSearchActive] = useState(false);

  const [highlightedAppId, setHighlightedAppId] = useState<string | null>(null);
  const [rescheduleCandidates, setRescheduleCandidates] = useState<(Appointment & { customer?: UserProfile })[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [showGapFiller, setShowGapFiller] = useState<{ start: Date, end: Date, appointmentId?: string } | null>(null);
  const [gapWizardStep, setGapWizardStep] = useState<1 | 2 | 3>(1);
  const [gapPlacements, setGapPlacements] = useState<Record<string, Date>>({});
  const [sendingProposal, setSendingProposal] = useState(false);
  const [shiftConfirm, setShiftConfirm] = useState<{app: Appointment & { customer?: UserProfile }, direction: 'anticipo' | 'posticipo'} | null>(null);

  // 🚀 STATI PROMEMORIA
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const tomorrow = addDays(new Date(), 1);
  const tomorrowsAppointments = appointments.filter(app => isSameDay(app.startTime.toDate(), tomorrow) && app.status === 'booked').sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

  // 🚀 RBAC
  const { isOwner } = useIsOwner();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(collection(db, 'salons', tenantId, 'contacts'), (snapshot) => {
      const map: Record<string, any> = {};
      snapshot.docs.forEach(doc => { map[doc.id] = doc.data(); });
      setLocalContacts(map);
    });
    return () => unsubscribe();
  }, [tenantId]);

  const getDisplayName = (app: Appointment & { customer?: UserProfile }) => {
    if (app.isForFriend) return `${app.friendDetails?.firstName || ''} ${app.friendDetails?.lastName || ''}`.trim() || 'Amico';
    const rawPhone = app.customer?.phoneNumber?.replace(/\D/g, '') || '';
    const purePhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.slice(-10) : rawPhone.slice(-10);
    if (purePhone && localContacts[purePhone]) return `${localContacts[purePhone].firstName} ${localContacts[purePhone].lastName}`.trim();
    return app.customer?.displayName || 'Cliente';
  };

  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(query(collection(db, 'salons', tenantId, 'calendar_exceptions')), (snapshot) => {
      setSpecialDays(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SpecialDay[]);
    });
    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const q = query(collection(db, `salons/${tenantId}/appointments`), orderBy('startTime', 'asc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Appointment[];
      const appWithProfiles = await Promise.all(docs.map(async (app) => {
        try {
          const userDoc = app.customerId !== 'manual_entry' ? await getDoc(doc(db, 'users', app.customerId)) : null;
          return { ...app, customer: userDoc?.exists() ? userDoc.data() as UserProfile : app.customer };
        } catch { return app; }
      }));
      setAppointments(appWithProfiles);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    if (selectedAppointmentId && appointments.length > 0) {
      const foundApp = appointments.find(a => a.id === selectedAppointmentId);
      if (foundApp) {
        setSelectedDate(foundApp.startTime.toDate());
        setSelectedAppointment(foundApp);
        setHighlightedAppId(selectedAppointmentId);
        setTimeout(() => document.getElementById(`appointment-${selectedAppointmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }), 500);
        setTimeout(() => setHighlightedAppId(null), 5000);
        if (onAppointmentDialogClose) onAppointmentDialogClose();
      }
    }
  }, [selectedAppointmentId, appointments, onAppointmentDialogClose]);

  // 🚀 LOGICA MOTORE DI RICERCA
  const isMatchedBySearch = (app: Appointment & { customer?: UserProfile }) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase().trim();
    if (searchType === 'name') {
      const name = getDisplayName(app).toLowerCase();
      return name.includes(searchLower);
    } else {
      const phone = (app.isForFriend ? app.friendDetails?.phone : app.customer?.phoneNumber) || '';
      return phone.replace(/\D/g, '').includes(searchLower.replace(/\D/g, ''));
    }
  };

  const filteredAppointments = appointments.filter(app => isMatchedBySearch(app));

  const handleCancel = async (app: Appointment) => {
    if (!tenantId) return;
    try {
      await updateDoc(doc(db, 'salons', tenantId, 'appointments', app.id!), { status: 'cancelled', cancelledAt: Timestamp.now(), cancelledBy: 'barber' });
      if (app.customerId !== profile?.uid && app.customerId !== 'manual_entry') {
        await addDoc(collection(db, 'salons', tenantId, 'notifications'), {
          userId: app.customerId, title: 'Appuntamento Annullato',
          message: `Il barbiere ha annullato il tuo appuntamento del ${format(app.startTime.toDate(), 'd MMM HH:mm')}`,
          type: 'cancellation', read: false, createdAt: Timestamp.now(), appointmentId: app.id
        });
      }
    } catch (error) {
      console.error(error);
    }
  };

  const findCandidatesForGap = (clickedGap: { start: Date, end: Date, appointmentId?: string }) => {
    if (!salonSettings?.weeklySchedule) return;
    const dayApps = appointments.filter(a => isSameDay(a.startTime.toDate(), clickedGap.start) && a.status === 'booked').sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    const dateString = format(clickedGap.start, 'yyyy-MM-dd');
    const dayOfWeek = getDay(clickedGap.start);
    const exception = specialDays.find(ex => ex.date === dateString);
    
    let activeHours: TimeRange[] = (exception && !exception.isClosed) ? (exception.openingHours || salonSettings.weeklySchedule[dayOfWeek]?.shifts || []) : (salonSettings.weeklySchedule[dayOfWeek]?.shifts || []);
    let currentShiftEnd = setHours(startOfDay(clickedGap.start), 20); 
    
    for (const range of activeHours) {
      const shiftEnd = setMinutes(setHours(startOfDay(clickedGap.start), Math.floor(range.end)), Math.round((range.end - Math.floor(range.end)) * 60));
      if (isAfter(shiftEnd, clickedGap.start)) { currentShiftEnd = shiftEnd; break; }
    }

    let trueEnd = currentShiftEnd;
    const nextApp = dayApps.find(a => isAfter(a.startTime.toDate(), clickedGap.start) || a.startTime.toDate().getTime() === clickedGap.start.getTime());
    if (nextApp && isBefore(nextApp.startTime.toDate(), currentShiftEnd)) trueEnd = nextApp.startTime.toDate(); 
    
    const expandedGap = { ...clickedGap, end: trueEnd };
    const gapDuration = (trueEnd.getTime() - clickedGap.start.getTime()) / 60000;

    const candidates = appointments.filter(app => {
      const appDur = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
      return app.status === 'booked' && isAfter(app.startTime.toDate(), addMinutes(currentTime, 30)) && appDur <= gapDuration && app.id !== expandedGap.appointmentId;
    }).sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
    
    setRescheduleCandidates(candidates);
    setShowGapFiller(expandedGap);
    setSelectedCandidates([]);
    setGapWizardStep(1);
    setGapPlacements({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleCandidate = (id: string) => {
    setSelectedCandidates(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleProposeReschedule = async () => {
    if (!showGapFiller || selectedCandidates.length === 0 || !tenantId) return;
    setSendingProposal(true);
    try {
      const targets = selectedCandidates.map((id, idx) => {
        const candidate = rescheduleCandidates.find(c => c.id === id)!;
        const specificTime = gapPlacements[id] || showGapFiller.start;
        const originalStart = candidate.startTime.toDate();
        const direction: ProposalType = specificTime.getTime() < originalStart.getTime() ? 'anticipo' : specificTime.getTime() > originalStart.getTime() ? 'posticipo' : 'cambio';
        return { userId: candidate.customerId, appointmentId: candidate.id!, status: idx === 0 ? 'pending' : 'waiting' as any, notifiedAt: idx === 0 ? Timestamp.now() : null, expiresAt: idx === 0 ? Timestamp.fromDate(addMinutes(new Date(), 15)) : null, proposedStartTime: Timestamp.fromDate(specificTime), type: direction };
      });
      const proposalRef = await addDoc(collection(db, 'salons', tenantId, 'rescheduleProposals'), { gapStartTime: Timestamp.fromDate(showGapFiller.start), gapEndTime: Timestamp.fromDate(showGapFiller.end), gapAppointmentId: showGapFiller.appointmentId || '', targets, currentIdx: 0, status: 'active', createdAt: Timestamp.now() });
      const firstDirection = targets[0].type;
      const directionText = firstDirection === 'posticipo' ? 'posticipare' : firstDirection === 'cambio' ? 'cambiare orario' : 'anticipare';
      await addDoc(collection(db, 'salons', tenantId, 'notifications'), { userId: targets[0].userId, title: 'Proposta di Cambio Orario', message: `Il barbiere ti propone di ${directionText} il tuo appuntamento.`, type: 'reschedule_proposal', read: false, createdAt: Timestamp.now(), proposalId: proposalRef.id, appointmentId: selectedCandidates[0] });
      setGapWizardStep(3);
    } catch (error) {
      console.error(error);
    } finally {
      setSendingProposal(false);
    }
  };

  const handleShiftProposal = async () => {
    if (!showGapFiller || !shiftConfirm || !tenantId) return;
    const { app: candidateApp, direction } = shiftConfirm;
    
    setSendingProposal(true);
    try {
      const existingQ = query(collection(db, 'salons', tenantId, 'rescheduleProposals'), where('status', '==', 'active'));
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

      // 🚀 VALIDAZIONE DIREZIONE: un posticipo proporrà SEMPRE un orario successivo,
      // un anticipo SEMPRE precedente (fix: niente più "posticipo" che anticipa)
      const originalStartTime = candidateApp.startTime.toDate();
      if (direction === 'posticipo' && !isAfter(newStart, originalStartTime)) {
        alert("Impossibile posticipare: lo spazio disponibile non è sufficiente per questo appuntamento.");
        setShiftConfirm(null);
        setSendingProposal(false);
        return;
      }
      if (direction === 'anticipo' && !isBefore(newStart, originalStartTime)) {
        alert("Impossibile anticipare: lo spazio disponibile non è sufficiente per questo appuntamento.");
        setShiftConfirm(null);
        setSendingProposal(false);
        return;
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
          proposedEndTime: Timestamp.fromDate(newEnd),
          type: direction
        }],
        currentIdx: 0,
        status: 'active',
        createdAt: Timestamp.now()
      };

      const proposalRef = await addDoc(collection(db, 'salons', tenantId, 'rescheduleProposals'), proposalData);

      await addDoc(collection(db, 'salons', tenantId, 'notifications'), {
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
      console.error(error);
    } finally {
      setSendingProposal(false);
    }
  };

  const formatDurationText = (totalMinutes: number) => {
    if (totalMinutes < 60) return `${totalMinutes} min`;
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60 > 0 ? `${totalMinutes % 60}m` : ''}`.trim();
  };

  const getCalendarData = () => {
    if (viewMode !== 'daily') return { type: viewMode, items: eachDayOfInterval({ start: startOfWeek(selectedDate), end: viewMode==='weekly'?endOfWeek(selectedDate):endOfDay(addDays(startOfDay(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)), 0)) }), formatItem: (item: Date) => format(item, viewMode==='weekly'?'EEE d':'d', { locale: it }) };
    
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const dayOfWeek = getDay(selectedDate);
    const ex = specialDays.find(e => e.date === dateString);
    const hours = (ex && !ex.isClosed) ? (ex.openingHours || salonSettings?.weeklySchedule[dayOfWeek]?.shifts || []) : ((!ex && salonSettings?.weeklySchedule[dayOfWeek]?.isOpen) ? salonSettings.weeklySchedule[dayOfWeek].shifts : []);
    
    // 🚀 La griglia termina con l'ultima riga che CONTIENE la chiusura: mai righe intere oltre la chiusura
    if (hours.length === 0) return { type: 'daily' as const, items: eachHourOfInterval({ start: setHours(startOfDay(selectedDate), 8), end: setHours(startOfDay(selectedDate), 19) }), formatItem: (item: Date) => format(item, 'HH:00') };
    const startH = Math.floor(Math.min(...hours.map(h => h.start)));
    const endH = Math.max(startH, Math.ceil(Math.max(...hours.map(h => h.end))) - 1);
    return { type: 'daily' as const, items: eachHourOfInterval({ start: setHours(startOfDay(selectedDate), startH), end: setHours(startOfDay(selectedDate), endH) }), formatItem: (item: Date) => format(item, 'HH:00') };
  };

  const calendarData = getCalendarData();
  if (loading) return <div className="text-center py-12">Caricamento dashboard...</div>;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12 px-4 sm:px-0">
      <div className="bg-white/90 backdrop-blur-md border border-white/20 rounded-3xl overflow-hidden shadow-2xl">
        
        {/* 🚀 HEADER ORIGINALE E COMPLETO RIPRISTINATO */}
        <div className="p-4 sm:p-6 border-b border-gray-100/50 flex flex-col xl:flex-row items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center justify-between w-full xl:w-auto gap-2 sm:gap-4">
            <button onClick={() => setSelectedDate(subDays(selectedDate, 1))} className="p-2 hover:bg-gray-50 rounded-full"><ChevronLeft size={20} /></button>
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              <h3 className="text-lg sm:text-xl font-bold min-w-[150px] sm:min-w-[180px] text-center">
                {format(selectedDate, 'EEEE d MMM', { locale: it })}
              </h3>
              <div className="relative w-10 h-10 flex items-center justify-center cursor-pointer shrink-0 overflow-hidden rounded-full">
                <button className="w-full h-full flex items-center justify-center hover:bg-gray-100 text-gray-500 hover:text-black transition-colors focus:outline-none">
                  <CalendarIcon size={20} />
                </button>
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => { if (e.target.value) setSelectedDate(new Date(e.target.value)); }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 p-0"
                />
              </div>
            </div>
            <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="p-2 hover:bg-gray-50 rounded-full"><ChevronRight size={20} /></button>
          </div>

          <div className="flex flex-wrap items-center justify-center xl:justify-end gap-3 sm:gap-4 w-full xl:w-auto">
            <div className="flex items-center gap-1 sm:gap-2 bg-gray-100 rounded-xl px-2 py-1.5 sm:px-3 sm:py-2">
              <button onClick={() => setViewMode('daily')} className={cn("px-2 py-1 sm:px-3 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all", viewMode === 'daily' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200")}>Giorno</button>
              <button onClick={() => setViewMode('weekly')} className={cn("px-2 py-1 sm:px-3 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all", viewMode === 'weekly' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200")}>Settimana</button>
              <button onClick={() => setViewMode('monthly')} className={cn("px-2 py-1 sm:px-3 sm:py-1 rounded-lg text-[10px] sm:text-xs font-bold transition-all", viewMode === 'monthly' ? "bg-black text-white" : "text-gray-600 hover:bg-gray-200")}>Mese</button>
            </div>
            
            <div className="relative flex-1 min-w-[220px] max-w-[320px] flex shadow-sm rounded-xl">
              <select value={searchType} onChange={(e) => setSearchType(e.target.value as 'name' | 'phone')} className="bg-gray-50 border-y border-l border-gray-200 text-xs sm:text-sm rounded-l-xl px-2 py-2 outline-none focus:border-black font-medium text-gray-600 cursor-pointer">
                <option value="name">Nome</option>
                <option value="phone">Numero</option>
              </select>
              <div className="relative flex-1">
                <input type="text" placeholder={searchType === 'name' ? "Cerca nome..." : "Cerca numero..."} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onFocus={() => setIsSearchActive(true)} onBlur={() => setIsSearchActive(false)} className={cn("pl-8 pr-3 py-2 w-full text-xs sm:text-sm rounded-r-xl border transition-all outline-none", isSearchActive ? "border-black ring-1 ring-black" : "border-gray-200 hover:border-gray-300")} />
                <Search size={16} className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors", isSearchActive ? "text-black" : "text-gray-400")} />
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setSelectedDate(new Date())} className="text-xs sm:text-sm font-bold text-gray-400 hover:text-black">Oggi</button>
              <button onClick={() => setIsReminderModalOpen(true)} className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-[#25D366]/10 text-[#25D366] text-xs font-bold rounded-xl hover:bg-[#25D366]/20 transition-all shadow-sm">
                <MessageCircle size={16} /> 
                <span className="hidden sm:inline">Promemoria</span>
                <span className="sm:hidden">Invia</span>
              </button>
            </div>
          </div>
        </div>

        {/* WIZARD RIEMPIMENTO BUCO */}
        {showGapFiller && (
          <div className="bg-emerald-50 border-b border-emerald-200 p-4 sm:p-6 shadow-inner animate-in slide-in-from-top duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div>
                <h4 className="text-lg font-bold text-emerald-900 flex items-center gap-2"><Clock size={20} /> Riempimento Buco Orario</h4>
                <p className="text-sm text-emerald-700 font-medium">{format(showGapFiller.start, 'HH:mm')} - {format(showGapFiller.end, 'HH:mm')} ({formatDurationText((showGapFiller.end.getTime() - showGapFiller.start.getTime()) / 60000)} liberi)</p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                {gapWizardStep !== 3 && <button onClick={() => { setShowGapFiller(null); setSelectedCandidates([]); setGapWizardStep(1); }} className="px-4 py-2 bg-white text-gray-500 hover:text-red-500 rounded-xl border font-bold flex-1">Annulla</button>}
                {gapWizardStep === 1 && <button disabled={selectedCandidates.length === 0} onClick={() => { const initial: Record<string, Date> = {}; selectedCandidates.forEach(id => { initial[id] = showGapFiller.start; }); setGapPlacements(initial); setGapWizardStep(2); }} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold flex-1">Avanti →</button>}
                {gapWizardStep === 2 && <button disabled={sendingProposal} onClick={handleProposeReschedule} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold flex-1 flex items-center justify-center gap-2">{sendingProposal ? 'Invio...' : <><Send size={16} /> Invia Proposte</>}</button>}
                {gapWizardStep === 3 && <button onClick={() => { setShowGapFiller(null); setSelectedCandidates([]); setGapWizardStep(1); }} className="px-8 py-2 bg-black text-white rounded-xl font-bold flex-1">Fatto</button>}
              </div>
            </div>
            {gapWizardStep === 2 && (
              <div className="bg-white p-4 rounded-2xl border border-emerald-100 space-y-4">
                <h5 className="text-sm font-bold text-gray-700 border-b pb-2">Seleziona l'orario esatto per ogni cliente</h5>
                {selectedCandidates.map(id => {
                  const candidate = rescheduleCandidates.find(c => c.id === id)!;
                  const dur = (candidate.endTime.toDate().getTime() - candidate.startTime.toDate().getTime()) / 60000;
                  const options = []; let curr = showGapFiller.start;
                  while (addMinutes(curr, dur) <= showGapFiller.end) { options.push(new Date(curr)); curr = addMinutes(curr, 15); }
                  return (
                    <div key={id} className="flex justify-between p-3 bg-gray-50 rounded-xl">
                      <div><span className="font-bold block">{getDisplayName(candidate)}</span><span className="text-xs text-gray-500">Durata: {dur} min</span></div>
                      <select className="p-2 rounded-lg border font-bold outline-none focus:border-emerald-500" value={gapPlacements[id]?.toISOString() || showGapFiller.start.toISOString()} onChange={(e) => setGapPlacements(prev => ({...prev, [id]: new Date(e.target.value)}))}>
                        {options.map(opt => <option key={opt.toISOString()} value={opt.toISOString()}>{format(opt, 'HH:mm')}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
            {gapWizardStep === 3 && (
              <div className="bg-white p-6 rounded-2xl border border-emerald-100 text-center space-y-4">
                <CheckCircle2 size={32} className="text-emerald-600 mx-auto" />
                <h5 className="text-xl font-bold">Proposte inviate nell'app!</h5>
                <p className="text-sm text-gray-500">Ora avvisa i clienti su WhatsApp per invitarli a controllare l'app.</p>
                <div className="space-y-2 text-left mt-4">
                  {selectedCandidates.map(id => {
                    const candidate = rescheduleCandidates.find(c => c.id === id)!;
                    const phone = candidate.isForFriend ? candidate.friendDetails?.phone : candidate.customer?.phoneNumber;
                    const proposedTime = gapPlacements[id] || showGapFiller.start;
                    const originalStart = candidate.startTime.toDate();
                    const direction: ProposalType = proposedTime.getTime() < originalStart.getTime() ? 'anticipo' : proposedTime.getTime() > originalStart.getTime() ? 'posticipo' : 'cambio';
                    const waLink = phone ? generateWhatsAppLink('reschedule_proposal_sent', getDisplayName(candidate), phone, format(proposedTime, 'dd/MM/yyyy'), format(proposedTime, 'HH:mm'), tenantId!, direction) : null;

                    return (
                      <div key={id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div>
                          <span className="font-bold text-sm block">{getDisplayName(candidate)}</span>
                          <span className="text-xs text-gray-500">Proposto per le {format(proposedTime, 'HH:mm')}</span>
                        </div>
                        {waLink && (
                          <a href={waLink} target="_blank" rel="noreferrer" className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-[#20bd5a] transition-all shadow-sm">
                            <MessageCircle size={16}/> WhatsApp
                          </a>
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
            
            // 🚀 RENDERIZZAZIONE VISTA SETTIMANA / MESE (Lista Orizzontale Flessibile)
            if (viewMode !== 'daily') {
              const dayApps = filteredAppointments.filter(a => {
                if (a.status === 'cancelled') return false;
                return isSameDay(a.startTime.toDate(), item);
              }).sort((a,b) => a.startTime.toMillis() - b.startTime.toMillis());

              return (
                <div key={item.toISOString()} className="min-h-[76px] border-b border-gray-50/50 p-2 flex gap-3 items-center overflow-x-auto scrollbar-hide">
                  <div className="w-12 sm:w-16 flex-shrink-0 text-right pr-2 flex flex-col justify-center">
                    <span className="text-[10px] sm:text-xs font-bold text-gray-400 capitalize">{format(item, 'EEE', { locale: it })}</span>
                    <span className="text-sm sm:text-base font-black text-gray-700">{format(item, 'dd')}</span>
                  </div>
                  
                  {dayApps.length === 0 ? (
                    <div className="flex-1 text-center text-gray-300 text-[10px] font-bold uppercase tracking-widest italic opacity-50">Libero</div>
                  ) : (
                    <div className="flex gap-2 items-center">
                      {dayApps.map(app => {
                        const appStart = app.startTime.toDate();
                        const appEnd = app.endTime.toDate();
                        const phoneNum = app.isForFriend ? app.friendDetails?.phone : app.customer?.phoneNumber;
                        // 🚀 Badge FLEX: durata reale < somma durate nominali dei servizi
                        const nominalDuration = app.services.reduce((acc, s) => acc + s.duration, 0);
                        const actualDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
                        const isFlex = actualDuration < nominalDuration;
                        // 🚀 Larghezza card proporzionale alla durata (coerente con la vista Giorno)
                        const isMobileWeek = typeof window !== 'undefined' && window.innerWidth < 640;
                        const weekCardWidth = Math.max((actualDuration / 30) * (isMobileWeek ? 7 : 10), 8);
                        
                        return (
                          <div 
                            key={app.id} 
                            onClick={() => setSelectedAppointment(app)}
                            style={{ width: `${weekCardWidth}rem`, maxWidth: '85vw' }}
                            className="shrink-0 p-2.5 rounded-xl shadow-sm flex flex-col justify-between cursor-pointer border border-black/5 bg-black text-white hover:scale-[1.02] transition-transform"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="font-bold text-xs truncate flex-1">{getDisplayName(app)}</div>
                              <div className="text-[9px] font-bold bg-white/20 px-2 py-0.5 rounded-full shrink-0 flex flex-col items-end sm:flex-row sm:items-center sm:gap-1">
                                <span>{format(appStart, 'HH:mm')}</span>
                                <span className="hidden sm:inline">-</span>
                                <span>{format(appEnd, 'HH:mm')}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 mt-1.5 min-w-0">
                              {isFlex && <span className="shrink-0 text-[8px] font-black bg-amber-400 text-black px-1.5 py-0.5 rounded-full">⚡ FLEX</span>}
                              <div className="text-[9px] opacity-70 truncate">{app.services.map(s => s.name).join(', ')}</div>
                            </div>
                            {phoneNum && <div className="text-[9px] opacity-60 flex items-center gap-1 mt-1"><Phone size={8}/> {phoneNum}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // 👇 LOGICA VISTA GIORNALIERA ORIGINALE 👇
            const itemStart = item;
            const itemEnd = addHours(item, 1);
            
            const overlappingApps = filteredAppointments.filter(a => {
              if (a.status === 'cancelled') return false;
              const appStart = a.startTime.toDate();
              const appEnd = a.endTime.toDate();
              return isBefore(appStart, itemEnd) && isAfter(appEnd, itemStart);
            });

            let isBreak = false;
            let offRange: { start: Date; end: Date; label: string } | null = null;
            // 🚀 GUARDIA: la card non può migrare su una riga "PAUSA SALONE" (dove non viene renderizzata)
            let isRowBreakHour: (d: Date) => boolean = () => false;

            if (calendarData.type === 'daily' && salonSettings?.weeklySchedule) {
              const dateString = format(selectedDate, 'yyyy-MM-dd');
              const dayOfWeek = getDay(selectedDate);
              const exception = specialDays.find(ex => ex.date === dateString);
              
              let activeHours: TimeRange[] = (exception && !exception.isClosed) ? (exception.openingHours || salonSettings.weeklySchedule[dayOfWeek]?.shifts || []) : ((!exception && salonSettings.weeklySchedule[dayOfWeek]?.isOpen) ? salonSettings.weeklySchedule[dayOfWeek].shifts : []);

              activeHours.forEach(range => {
                const shiftStart = setMinutes(setHours(startOfDay(selectedDate), Math.floor(range.start)), Math.round((range.start - Math.floor(range.start)) * 60));
                const shiftEnd = setMinutes(setHours(startOfDay(selectedDate), Math.floor(range.end)), Math.round((range.end - Math.floor(range.end)) * 60));
                if (isBefore(itemStart, shiftStart) && isBefore(shiftStart, itemEnd)) {
                  offRange = { start: itemStart, end: shiftStart, label: `APERTURA ORE ${format(shiftStart, 'HH:mm')}` };
                } else if (isBefore(itemStart, shiftEnd) && isBefore(shiftEnd, itemEnd)) {
                  offRange = { start: shiftEnd, end: itemEnd, label: `CHIUSURA ORE ${format(shiftEnd, 'HH:mm')}` };
                }
              });

              if (!offRange && activeHours.length > 1) {
                const shift1EndH = Math.floor(activeHours[0].end);
                const shift2StartH = Math.floor(activeHours[1].start);
                if (item.getHours() >= shift1EndH && item.getHours() < shift2StartH) isBreak = true;
              }
            }

            const gapsForThisItem: { start: Date; end: Date; duration: number }[] = [];
            // I buchi si calcolano su tutti gli appuntamenti, non solo su quelli filtrati!
            const allOverlappingApps = appointments.filter(a => {
              if (a.status === 'cancelled') return false;
              const appStart = a.startTime.toDate();
              const appEnd = a.endTime.toDate();
              return isBefore(appStart, itemEnd) && isAfter(appEnd, itemStart);
            });

            if (!isBreak && !searchTerm && calendarData.type === 'daily' && salonSettings?.weeklySchedule) {
              // 🚀 CLAMPING AI TURNI: i buchi esistono SOLO dentro l'orario di apertura
              // (fix: niente più "+1h" fantasma dopo la chiusura, es. fascia 20:00-21:00 con chiusura alle 20:00)
              const dateString = format(selectedDate, 'yyyy-MM-dd');
              const dayOfWeek = getDay(selectedDate);
              const exception = specialDays.find(ex => ex.date === dateString);

              let activeHours: TimeRange[] = (exception && !exception.isClosed) ? (exception.openingHours || salonSettings.weeklySchedule[dayOfWeek]?.shifts || []) : ((!exception && salonSettings.weeklySchedule[dayOfWeek]?.isOpen) ? salonSettings.weeklySchedule[dayOfWeek].shifts : []);

              const nowPlus30 = addMinutes(currentTime, 30);

              const currentShift = activeHours.find(range => {
                const sStart = setMinutes(setHours(startOfDay(selectedDate), Math.floor(range.start)), Math.round((range.start - Math.floor(range.start)) * 60));
                const sEnd = setMinutes(setHours(startOfDay(selectedDate), Math.floor(range.end)), Math.round((range.end - Math.floor(range.end)) * 60));
                return isBefore(itemStart, sEnd) && isAfter(itemEnd, sStart);
              });

              if (currentShift) {
                const shiftStart = setMinutes(setHours(startOfDay(selectedDate), Math.floor(currentShift.start)), Math.round((currentShift.start - Math.floor(currentShift.start)) * 60));
                const shiftEnd = setMinutes(setHours(startOfDay(selectedDate), Math.floor(currentShift.end)), Math.round((currentShift.end - Math.floor(currentShift.end)) * 60));

                let currentMarker = isBefore(itemStart, shiftStart) ? shiftStart : itemStart;
                const realSlotEnd = isAfter(itemEnd, shiftEnd) ? shiftEnd : itemEnd;

                const sortedApps = [...allOverlappingApps].sort((a,b) => a.startTime.toMillis() - b.startTime.toMillis());

                sortedApps.forEach(app => {
                  const appStart = app.startTime.toDate();
                  const appEnd = app.endTime.toDate();
                  const effectiveStart = isBefore(appStart, itemStart) ? itemStart : appStart;
                  const effectiveEnd = isAfter(appEnd, itemEnd) ? itemEnd : appEnd;

                  if (isBefore(currentMarker, effectiveStart)) {
                    const dur = (effectiveStart.getTime() - currentMarker.getTime()) / 60000;
                    if (dur >= 15 && isAfter(currentMarker, nowPlus30)) gapsForThisItem.push({ start: currentMarker, end: effectiveStart, duration: dur });
                  }
                  if (isAfter(effectiveEnd, currentMarker)) currentMarker = effectiveEnd;
                });

                if (isBefore(currentMarker, realSlotEnd)) {
                  const dur = (realSlotEnd.getTime() - currentMarker.getTime()) / 60000;
                  if (dur >= 15 && isAfter(currentMarker, nowPlus30)) gapsForThisItem.push({ start: currentMarker, end: realSlotEnd, duration: dur });
                }
              }
            }

            const combinedItems = [
              ...overlappingApps.map(a => ({ type: 'app' as const, data: a, start: isBefore(a.startTime.toDate(), itemStart) ? itemStart : a.startTime.toDate() })),
              ...gapsForThisItem.map(g => ({ type: 'gap' as const, data: g, start: g.start }))
            ].sort((a, b) => a.start.getTime() - b.start.getTime());

            return (
              <div key={item.toISOString()} className={cn("flex min-h-[68px] relative border-b border-gray-50/50", isBreak && "bg-gray-50/50")}>
                {isSameDay(selectedDate, currentTime) && isBefore(addHours(item, 1), currentTime) && (
                  <div className="absolute inset-0 bg-gray-200/30 backdrop-grayscale-[0.5] z-10 pointer-events-none" />
                )}
                <div className="w-16 p-3 text-right border-r border-gray-50 flex-shrink-0">
                  <span className="text-xs font-bold text-gray-400">{calendarData.formatItem(item)}</span>
                </div>
                
                <div className="flex-1 p-2 flex gap-2 overflow-x-auto items-center scrollbar-hide">
                  {isBreak ? (
                    <div className="w-full text-center text-gray-300 text-[10px] font-bold uppercase tracking-widest italic">PAUSA SALONE</div>
                  ) : (
                    <>
                      {offRange && (
                        <div className="h-[60px] px-4 bg-gray-100/80 border-2 border-dashed border-gray-300 text-gray-400 rounded-2xl flex items-center justify-center text-[10px] font-bold uppercase tracking-wider shrink-0">
                          {offRange.label}
                        </div>
                      )}

                      {combinedItems.map((itemObj, idx) => {
                        if (itemObj.type === 'gap') {
                          const gapDur = itemObj.data.duration;
                          return (
                            <button 
                              key={`gap-${idx}`} 
                              onClick={() => findCandidatesForGap({ start: itemObj.data.start, end: itemObj.data.end })} 
                              style={{ flexGrow: gapDur / 30, flexShrink: 0, flexBasis: 0, minWidth: 0 }} 
                              className="h-[60px] bg-amber-50 border-2 border-dashed border-amber-300 text-amber-600 rounded-xl hover:bg-amber-100 transition-all flex flex-col items-center justify-center font-bold text-[11px]"
                            >
                              <span className="text-amber-500 mb-0.5">+</span><span>{formatDurationText(gapDur)}</span>
                            </button>
                          );
                        }

                        const app = itemObj.data;
                        const appStart = app.startTime.toDate();
                        const appEnd = app.endTime.toDate();
                        
                        const isSpillover = isBefore(appStart, itemStart);
                        const effectiveStart = isSpillover ? itemStart : appStart;
                        const effectiveEnd = isAfter(appEnd, itemEnd) ? itemEnd : appEnd;
                        const dur = (effectiveEnd.getTime() - effectiveStart.getTime()) / 60000;
                        
                        const phoneNum = app.isForFriend ? app.friendDetails?.phone : app.customer?.phoneNumber;
                        
                        // 🚀 Badge FLEX: l'appuntamento usa la flessibilità (durata reale < nominale)
                        const nominalDuration = app.services.reduce((acc, s) => acc + s.duration, 0);
                        const actualDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
                        const isFlex = actualDuration < nominalDuration;

                        // 🚀 Larghezza card (vecchia versione): proporzionale alla DURATA TOTALE dell'appuntamento
                        const isMobileCard = typeof window !== 'undefined' && window.innerWidth < 640;
                        const cardWidth = (actualDuration / 30) * (isMobileCard ? 7 : 10);

                        const isCandidate = rescheduleCandidates.some(c => c.id === app.id);
                        const isSelected = selectedCandidates.includes(app.id!);
                        const selectionMode = showGapFiller !== null;
                        // 🚀 GUARDIA: proposte anticipo/posticipo solo su buchi reali (durata > 0)
                        const isAdjacentNext = !!showGapFiller && isAfter(showGapFiller.end, showGapFiller.start) && Math.abs(appStart.getTime() - showGapFiller.end.getTime()) < 60000;
                        const isAdjacentPrev = !!showGapFiller && isAfter(showGapFiller.end, showGapFiller.start) && Math.abs(appEnd.getTime() - showGapFiller.start.getTime()) < 60000;

                        // 🚀 CARD LEGGIBILE: la card va nella riga dove l'appuntamento ha più spazio visibile;
                        //    le altre righe mostrano il box compatto "INIZIO SERVIZIO" / "CONTINUA"
                        const cardRowStart = getCardRowStart(appStart, appEnd, itemStart, isRowBreakHour);
                        const isCardHere = cardRowStart.getTime() === itemStart.getTime();
                        const openAppointment = () => {
                          if (selectionMode) {
                            if (isCandidate) toggleCandidate(app.id!);
                          } else {
                            setSelectedAppointment(app);
                          }
                        };

                        if (!isCardHere) {
                          const isBeforeCard = isBefore(itemStart, cardRowStart);
                          return (
                            <div 
                              key={`${app.id}-${isBeforeCard ? 'start' : 'spill'}`} 
                              onClick={openAppointment}
                              title={getDisplayName(app)}
                              style={{ flexGrow: dur / 30, flexShrink: 0, flexBasis: 0, minWidth: 104 }} 
                              className={cn(
                                "min-h-[76px] sm:h-[88px] bg-gray-100 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center opacity-70 cursor-pointer hover:opacity-100 hover:bg-gray-200/70 transition-all",
                                selectionMode && !isCandidate ? "opacity-30 grayscale" : "",
                                isSelected ? "bg-emerald-500 border-emerald-500 opacity-100" : ""
                              )}
                            >
                              <span className={cn("text-[9px] sm:text-[10px] font-bold uppercase text-center leading-tight", isSelected ? "text-white" : "text-gray-400")}>
                                {isBeforeCard ? <>Inizio servizio<br/>{format(appStart, 'HH:mm')}</> : <>Continua<br/>{format(appEnd, 'HH:mm')}</>}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div 
                            key={app.id} 
                            id={`appointment-${app.id}`} 
                            onClick={openAppointment} 
                            style={{ width: `${cardWidth}rem`, maxWidth: '85vw', flexShrink: 0 }} 
                            className={cn(
                              "p-2 sm:p-2.5 rounded-xl shadow-md flex flex-col justify-between text-left cursor-pointer transition-all relative min-h-[76px] sm:h-[88px] duration-500 group", 
                              app.id === highlightedAppId ? "ring-4 ring-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.6)] scale-[1.05] z-20" : "hover:scale-[1.02]", 
                              selectionMode && !isCandidate && !isAdjacentNext && !isAdjacentPrev ? "opacity-30 grayscale" : "",
                              isSelected ? "bg-emerald-500 text-white ring-4 ring-emerald-500/30" :
                              (app.status === 'completed' || (app.status === 'booked' && isBefore(appEnd, currentTime))) ? "bg-emerald-600 text-white" : "bg-black text-white"
                            )}
                          >
                            {(isAdjacentNext || isAdjacentPrev) && !sendingProposal && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShiftConfirm({app, direction: isAdjacentNext ? 'anticipo' : 'posticipo'});
                                }}
                                className="absolute inset-0 bg-blue-600/95 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl"
                              >
                                <ArrowUpCircle size={24} className={isAdjacentPrev ? "rotate-180" : ""} />
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                                  Chiedi {isAdjacentNext ? 'Anticipo' : 'Posticipo'}
                                </span>
                              </button>
                            )}

                            {isFlex && (
                              <div
                                className="absolute -top-1.5 -right-1.5 bg-amber-400 text-amber-950 text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm border border-amber-500 z-10 cursor-help"
                                title={`Buco riempito: servizio compresso da ${nominalDuration} a ${actualDuration} min`}
                              >
                                ⚠️ Flex
                              </div>
                            )}

                            <div>
                              <div className="flex justify-between items-start gap-2">
                                <div className="font-bold text-[11px] sm:text-xs truncate">{getDisplayName(app)}</div>
                                <div className="text-[9px] font-bold opacity-60 flex flex-col items-end leading-tight shrink-0">
                                  <span>{format(appStart, 'HH:mm')}</span>
                                  <span>- {format(appEnd, 'HH:mm')}</span>
                                </div>
                              </div>
                              <div className="text-[9px] opacity-70 mt-0.5 truncate">
                                {app.services.map(s => s.name).join(', ')}
                              </div>
                            </div>

                            <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-white/10">
                              <div className="flex items-center gap-1 text-[9px] truncate">
                                <Phone size={8} /> {phoneNum?.slice(-10)}
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
                      })}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedAppointment && (
        <AppointmentDetailsModal 
          appointment={selectedAppointment}
          allAppointments={appointments}
          tenantId={tenantId!}
          salonSettings={salonSettings}
          staffMembers={[]}
          localContacts={localContacts}
          currentTime={currentTime}
          isOwner={isOwner}
          onClose={() => setSelectedAppointment(null)}
          onCancelRequest={(app) => { setShowCancelConfirm(app); setSelectedAppointment(null); }}
          onProposeShift={(app) => { findCandidatesForGap({ start: app.startTime.toDate(), end: app.endTime.toDate(), appointmentId: app.id! }); setSelectedAppointment(null); }}
        />
      )}

      {/* Modal Shift Confirmation */}
      {shiftConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4 animate-in fade-in">
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ArrowUpCircle size={32} className={shiftConfirm.direction === 'posticipo' ? "rotate-180" : ""} />
            </div>
            <h3 className="text-2xl font-bold mb-2">Conferma {shiftConfirm.direction === 'anticipo' ? 'Anticipo' : 'Posticipo'}</h3>
            <p className="text-gray-500 mb-8 text-sm">
              Vuoi inviare una proposta a <span className="font-bold text-black">{getDisplayName(shiftConfirm.app)}</span> per spostare l'appuntamento alle <span className="font-bold text-black">{format(shiftConfirm.direction === 'anticipo' ? showGapFiller!.start : addMinutes(showGapFiller!.end, -(shiftConfirm.app.services.reduce((acc, s) => acc + s.duration, 0))), 'HH:mm')}</span>?
            </p>
            <div className="flex flex-col gap-3">
              <button
                disabled={sendingProposal}
                onClick={handleShiftProposal}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all flex justify-center items-center gap-2 shadow-md"
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

      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
          <div className="bg-white p-8 rounded-[32px] text-center max-w-sm w-full shadow-2xl">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4"><AlertCircle size={32} /></div>
            <h3 className="text-xl font-bold mb-2">Conferma Annullamento</h3>
            <p className="text-gray-500 text-xs mb-6">Sei sicuro di voler annullare questo appuntamento?</p>
            <div className="flex flex-col gap-2">
              <button onClick={async () => { await handleCancel(showCancelConfirm); setShowCancelConfirm(null); }} className="w-full py-3.5 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-md">Sì, Annulla</button>
              <button onClick={() => setShowCancelConfirm(null)} className="w-full py-3.5 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all">No, Mantieni</button>
            </div>
          </div>
        </div>
      )}

      {/* 🚀 Modal Promemoria WhatsApp */}
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
                    const name = getDisplayName(app);
                    const time = app.startTime?.toDate ? format(app.startTime.toDate(), 'HH:mm') : '--:--';
                    const servicesList = app.services && Array.isArray(app.services) ? app.services.map(s => s.name).join(', ') : 'Appuntamento';
                    const message = `💈 ${salonSettings?.name || 'Salone'} ti ricorda l’appuntamento di domani alle ore ${time}!`;
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
                          onClick={(e) => { if (!phone) { e.preventDefault(); alert("Numero mancante"); } }}
                          className={cn("flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-sm", phone ? "bg-[#25D366] text-white hover:bg-[#20bd5a]" : "bg-gray-100 text-gray-400 cursor-not-allowed")}
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
    </div>
  );
}