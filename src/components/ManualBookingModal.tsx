import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, query, where, getDocs, Timestamp, onSnapshot, doc, updateDoc, deleteDoc, limit, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useSalonSettings } from '../hooks/useSalonSettings';
import { format, addMinutes, startOfDay, endOfDay, isBefore, setHours, setMinutes, getDay, isAfter } from 'date-fns';
import { it } from 'date-fns/locale';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon, Clock, Scissors, CheckCircle2, XCircle, ChevronRight, Phone, Globe, Check, Plus, User, ChevronDown, MessageCircle, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { COUNTRY_CODES } from '../constants';
import { Appointment, SpecialDay, TimeRange, StaffProfile } from '../types';
import { calculateMultiStaffSlots, Shift as SlotShift } from '../utils/slotEngine';
import { generateWhatsAppLink } from '../utils/whatsapp';
import { logSystemError } from '../utils/logger';

interface ManualBookingModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function ManualBookingModal({ onClose, onSuccess }: ManualBookingModalProps) {
  const { tenantId, profile } = useAuth();
  const { settings: salonSettings } = useSalonSettings(tenantId);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phonePrefix, setPhonePrefix] = useState('+39');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [availableSlots, setAvailableSlots] = useState<Date[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [suggestions, setSuggestions] = useState<{ firstName: string, lastName: string, phone: string, email?: string, phonePrefix?: string }[]>([]);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  
  // 🚀 STATO MULTI-STAFF
  const [staffMembers, setStaffMembers] = useState<StaffProfile[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  const [globalDirectory, setGlobalDirectory] = useState<{ firstName: string, lastName: string, phone: string, email: string }[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
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

  // Caricamento Staff e Special Days
  useEffect(() => {
    if (!tenantId) return;
    if (salonSettings?.hasMultiStaff) {
      const fetchStaff = async () => {
        const snap = await getDocs(query(collection(db, 'salons', tenantId, 'staff'), where('active', '==', true)));
        setStaffMembers(snap.docs.map(d => d.data() as StaffProfile).sort((a, b) => a.order - b.order));
      };
      fetchStaff();
    }
    
    const unsubscribe = onSnapshot(query(collection(db, 'salons', tenantId, 'calendar_exceptions')), (snapshot) => {
      setSpecialDays(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SpecialDay[]);
    });
    return () => unsubscribe();
  }, [tenantId, salonSettings?.hasMultiStaff]);

  // Caricamento Rubrica Locale
  useEffect(() => {
    if (!tenantId) return;
    const fetchDirectory = async () => {
      try {
        const snap = await getDocs(collection(db, 'salons', tenantId, 'contacts'));
        const contacts = snap.docs.map(doc => {
          const c = doc.data();
          const rawPhone = (c.phone || '').replace(/\D/g, '');
          const cleanPhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.substring(2) : rawPhone.slice(-10);
          return { firstName: c.firstName || '', lastName: c.lastName || '', phone: cleanPhone, email: c.email || '' };
        });
        setGlobalDirectory(contacts);
        setDirectoryLoaded(true);
      } catch (error) {
        console.error("Errore rubrica:", error);
      }
    };
    fetchDirectory();
  }, [tenantId]);

  useEffect(() => {
    if (!directoryLoaded || firstName.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const searchFirst = firstName.trim().toLowerCase();
    const searchLast = lastName.trim().toLowerCase();
    const filtered = globalDirectory.filter(person => {
      const full = `${person.firstName} ${person.lastName}`.toLowerCase();
      return full.includes(searchFirst) && (!searchLast || full.includes(searchLast));
    });
    setSuggestions(filtered.slice(0, 5));
  }, [firstName, lastName, directoryLoaded, globalDirectory]);

  const disabledDays = React.useMemo(() => {
    return [
      { before: startOfDay(new Date()) },
      (date: Date) => {
        const dateString = format(date, 'yyyy-MM-dd');
        const exception = specialDays.find(ex => ex.date === dateString && !(ex as any).staffId);
        if (exception) return exception.isClosed;
        return !salonSettings?.weeklySchedule[getDay(date)]?.isOpen;
      }
    ];
  }, [specialDays, salonSettings]);

  useEffect(() => {
    if (selectedDate && selectedServices.length > 0 && salonSettings?.weeklySchedule) {
      calculateSlots();
    } else {
      setAvailableSlots([]);
    }
  }, [selectedDate, selectedServices, salonSettings?.weeklySchedule, selectedStaffId]);

  // 🚀 HELPER DISPONIBILITÀ E ORARI PER-DATA
  const isSalonClosedOn = (dateString: string): boolean => {
    const globalEx = specialDays.find(ex => ex.date === dateString && !(ex as any).staffId);
    if (globalEx) return globalEx.isClosed;
    return !(salonSettings?.weeklySchedule?.[getDay(new Date(dateString + 'T00:00:00'))]?.isOpen);
  };

  const isStaffAbsentOn = (staffId: string, dateString: string): boolean => {
    const staffEx = specialDays.find(ex => ex.date === dateString && (ex as any).staffId === staffId);
    return staffEx ? staffEx.isClosed : false;
  };

  // Orari per-barbiere: staff > salone (globale) > settimanali
  const hoursForStaff = (staffId: string, dateString: string, dayOfWeek: number): TimeRange[] => {
    const weeklyHours = salonSettings?.weeklySchedule?.[dayOfWeek]?.shifts || [];

    const staffEx = specialDays.find(ex => ex.date === dateString && (ex as any).staffId === staffId);
    if (staffEx) {
      if (staffEx.isClosed) return [];
      return staffEx.openingHours?.length ? staffEx.openingHours : weeklyHours;
    }

    const globalEx = specialDays.find(ex => ex.date === dateString && !(ex as any).staffId);
    if (globalEx) {
      if (globalEx.isClosed) return [];
      return globalEx.openingHours?.length ? globalEx.openingHours : weeklyHours;
    }

    return weeklyHours;
  };

  const availableStaffForDate = (dateString: string, staff: StaffProfile[]): StaffProfile[] =>
    staff.filter(s => !isStaffAbsentOn(s.uid, dateString));

  const shiftsForDay = (hours: TimeRange[], day: Date): SlotShift[] =>
    hours.map(range => {
      const sH = Math.floor(range.start);
      const sM = Math.round((range.start - sH) * 60);
      const eH = Math.floor(range.end);
      const eM = Math.round((range.end - eH) * 60);
      return { start: setMinutes(setHours(day, sH), sM), end: setMinutes(setHours(day, eH), eM) };
    });

  const calculateSlots = async () => {
    if (!tenantId || !salonSettings?.weeklySchedule || !salonSettings?.yieldConfig) return;
    setLoading(true);
    const dayStart = startOfDay(selectedDate);

    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const dayOfWeek = getDay(selectedDate);

    // Chiusura globale del salone -> nessuno slot
    if (isSalonClosedOn(dateString)) {
      setAvailableSlots([]);
      setLoading(false);
      return;
    }

    const dateAvailableStaff = availableStaffForDate(dateString, staffMembers);

    try {
      const snap = await getDocs(query(collection(db, 'salons', tenantId, 'appointments'),
        where('startTime', '>=', Timestamp.fromDate(dayStart)),
        where('startTime', '<=', Timestamp.fromDate(endOfDay(selectedDate)))
      ));
      const dayAppointments = snap.docs.map(doc => doc.data() as Appointment).filter(app => app.status === 'booked');

      const mappedCatalog = salonSettings.services.map(s => ({ id: s.id, duration: s.duration, flexibility: s.flexibility || 0 }));

      // 🏠 MONO-SALONE (nessuno staff configurato): orari del salone, motore legacy
      if (staffMembers.length === 0) {
        let legacySlots: Date[] = [];
        shiftsForDay(hoursForStaff('', dateString, dayOfWeek), dayStart).forEach(window => {
          legacySlots = [...legacySlots, ...calculateMultiStaffSlots(
            selectedServices, mappedCatalog, dayAppointments, [], selectedStaffId,
            { start: window.start, end: window.end }, salonSettings.yieldConfig, true
          )];
        });
        const uniqueLegacySlots = Array.from(new Set(legacySlots.map(d => d.getTime())))
          .map(time => new Date(time))
          .sort((a, b) => a.getTime() - b.getTime());
        setAvailableSlots(uniqueLegacySlots.filter(slot => isAfter(slot, new Date())));
        return;
      }

      // Se nessun barbiere è disponibile quel giorno -> nessuno slot
      if (dateAvailableStaff.length === 0) {
        setAvailableSlots([]);
        setLoading(false);
        return;
      }

      // Turni per-barbiere (orari ridotti/assenza gestiti da hoursForStaff)
      const staffShifts: Record<string, SlotShift[]> = {};
      dateAvailableStaff.forEach(st => {
        staffShifts[st.uid] = shiftsForDay(hoursForStaff(st.uid, dateString, dayOfWeek), dayStart);
      });

      // 🚀 Motore multi-staff con isManualBooking=true (l'operatore inserisce manualmente)
      const allValidSlots = calculateMultiStaffSlots(
        selectedServices, mappedCatalog, dayAppointments, dateAvailableStaff, selectedStaffId,
        { start: setHours(dayStart, 8), end: setHours(dayStart, 20) },
        salonSettings.yieldConfig,
        true,       // <-- isManualBooking resta true per il manuale
        staffShifts
      );

      const uniqueSortedSlots = Array.from(new Set(allValidSlots.map(d => d.getTime()))).map(time => new Date(time)).sort((a, b) => a.getTime() - b.getTime());
      setAvailableSlots(uniqueSortedSlots.filter(slot => isAfter(slot, new Date())));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async () => {
    if (salonSettings?.hasMultiStaff && !selectedStaffId) return alert("Seleziona l'operatore.");
    if (!firstName || !lastName || !phone || !selectedSlot || selectedServices.length === 0 || !tenantId) return alert("Compila i campi obbligatori.");

    const rawPhone = phone.replace(/\D/g, '');
    const purePhone = rawPhone.length > 10 && rawPhone.startsWith('39') ? rawPhone.substring(2) : rawPhone.slice(-10);
    if (purePhone.length < 9) return alert("Telefono non valido.");

    setLoading(true);
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);
    const totalDuration = selectedServices.reduce((acc, s) => acc + s.duration, 0);
    const endTime = addMinutes(selectedSlot, totalDuration);

    try {
      const usersRef = collection(db, 'users');
      const userQuery = query(usersRef, where('phoneNumber', '==', `+39${purePhone}`), limit(1));
      const userSnapshot = await getDocs(userQuery);
      const finalCustomerId = userSnapshot.empty ? 'manual_entry' : userSnapshot.docs[0].id;

      await setDoc(doc(db, 'salons', tenantId, 'contacts', purePhone), {
        firstName, lastName, firstNameLower: firstName.toLowerCase(), lastNameLower: lastName.toLowerCase(),
        phone: purePhone, phonePrefix: '+39', email: email || '', updatedAt: Timestamp.now()
      }, { merge: true });

      const newAppRef = await addDoc(collection(db, 'salons', tenantId, 'appointments'), {
        customerId: finalCustomerId,
        staffId: selectedStaffId || null,
        isStaffRandom: false,
        customer: { displayName: `${firstName} ${lastName}`, phoneNumber: `+39${purePhone}`, email: email || '' },
        services: selectedServices,
        startTime: Timestamp.fromDate(selectedSlot),
        endTime: Timestamp.fromDate(endTime),
        status: 'booked',
        totalAmount,
        createdAt: Timestamp.now(),
        isManual: true
      });

      if (sendWhatsApp) {
        const link = generateWhatsAppLink('booking', firstName, `+39${purePhone}`, format(selectedSlot, 'dd/MM/yyyy'), format(selectedSlot, 'HH:mm'), tenantId);
        if (link) window.open(link, '_blank');
      }

      onSuccess();
    } catch (error: any) {
      logSystemError({ type: 'manual_booking_failure', tenantId, error: error.message });
      alert("Errore salvataggio. Permessi negati.");
    } finally {
      setLoading(false);
    }
  };

  const displayedServices = salonSettings?.hasMultiStaff && selectedStaffId 
    ? salonSettings.services.filter(s => staffMembers.find(st => st.uid === selectedStaffId)?.assignedServices.includes(s.id))
    : salonSettings?.services || [];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center"><Plus size={24} /></div>
            <div>
              <h2 className="text-xl font-bold text-black">Inserimento Manuale</h2>
              <p className="text-xs text-gray-500 font-medium">Aggiungi appuntamento al volo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><XCircle className="text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Sezione Operatore */}
          {salonSettings?.hasMultiStaff && staffMembers.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={14} /> Operatore</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {staffMembers.map(staff => (
                  <button key={staff.uid} onClick={() => { setSelectedStaffId(staff.uid); setSelectedServices([]); setSelectedSlot(null); }}
                    className={cn("p-3 rounded-2xl border transition-all text-center flex flex-col items-center gap-2", selectedStaffId === staff.uid ? "border-black bg-black text-white scale-105" : "border-gray-200 bg-white hover:bg-gray-50")}
                  >
                    <div className="w-8 h-8 rounded-full border border-white/20" style={{ backgroundColor: staff.color }} />
                    <span className="text-xs font-bold truncate w-full">{staff.displayName.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Info Cliente */}
          <section>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={14} /> Cliente</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
              <div className="space-y-1.5 relative" ref={searchContainerRef}>
                <label className="text-xs font-bold text-gray-700 ml-1">Nome *</label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Es. Mario" className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:border-black outline-none text-sm" />
                {suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-2xl shadow-xl z-[160] overflow-hidden">
                    {suggestions.map((s, i) => (
                      <button key={i} onClick={() => { setFirstName(s.firstName); setLastName(s.lastName); setPhone(s.phone); setSuggestions([]); }} className="w-full p-3 text-left hover:bg-gray-50 flex items-center justify-between border-b border-gray-50">
                        <div><div className="font-bold text-sm">{s.firstName} {s.lastName}</div><div className="text-[10px] text-gray-400">{s.phone}</div></div><Check size={14} className="text-emerald-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5"><label className="text-xs font-bold text-gray-700 ml-1">Cognome *</label><input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Es. Rossi" className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:border-black outline-none text-sm" /></div>
              <div className="space-y-1.5"><label className="text-xs font-bold text-gray-700 ml-1">Telefono *</label><input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="Min. 10 cifre" className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:border-black outline-none text-sm" /></div>
            </div>
          </section>

          {/* Servizi */}
          <section>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Scissors size={14} /> Servizi</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {displayedServices.map(service => {
                const isSelected = selectedServices.some(s => s.id === service.id);
                return (
                  <button key={service.id} onClick={() => { setSelectedServices(isSelected ? selectedServices.filter(s => s.id !== service.id) : [...selectedServices, service]); setSelectedSlot(null); }}
                    className={cn("p-4 rounded-2xl border transition-all text-left relative", isSelected ? "bg-black border-black text-white scale-[1.02]" : "bg-white border-gray-100 text-gray-600 hover:bg-gray-50")}
                  >
                    <div className="font-bold text-sm">{service.name}</div>
                    <div className={cn("text-[10px] mt-1 font-medium", isSelected ? "text-gray-400" : "text-gray-400")}>{service.duration} min • €{service.price}</div>
                    {isSelected && <CheckCircle2 size={14} className="absolute top-2 right-2 text-white" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Orari */}
          <section className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><CalendarIcon size={14} /> Data & Orario</h3>
              <div className="flex justify-center bg-white border border-gray-100 rounded-3xl p-2 sm:p-4 shadow-sm">
                <DayPicker mode="single" selected={selectedDate} onSelect={(d) => { if(d){ setSelectedDate(d); setSelectedSlot(null); } }} disabled={disabledDays} locale={it} modifiersClassNames={{ selected: "bg-black text-white rounded-full", today: "text-emerald-600 font-bold" }} />
              </div>
            </div>
            {selectedServices.length > 0 && (
              loading ? <div className="text-center text-sm text-gray-500 py-4">Calcolo in corso...</div> : 
              availableSlots.length > 0 ? (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {availableSlots.map(slot => (
                    <button key={slot.toISOString()} onClick={() => setSelectedSlot(slot)} className={cn("py-2 rounded-xl border text-xs font-bold transition-all", selectedSlot?.getTime() === slot.getTime() ? "bg-black border-black text-white" : "bg-white border-gray-100 hover:border-gray-300")}>
                      {format(slot, 'HH:mm')}
                    </button>
                  ))}
                </div>
              ) : <div className="text-center py-4 bg-gray-50 rounded-xl text-sm text-gray-500">Nessun orario disponibile.</div>
            )}
          </section>
        </div>

        {/* Footer Convalida */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3 mb-4 px-2">
            <input type="checkbox" id="wa" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-emerald-600" />
            <label htmlFor="wa" className="text-sm font-bold flex items-center gap-2 cursor-pointer">Avvisa su WhatsApp <MessageCircle size={18} className="text-[#25D366]" /></label>
          </div>
          <button disabled={loading || !firstName || !phone || !selectedSlot || selectedServices.length === 0 || (salonSettings?.hasMultiStaff && !selectedStaffId)} onClick={handleBooking} className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 disabled:opacity-30 flex justify-center gap-2">
            {loading ? 'Caricamento...' : <><Check size={20} /> Conferma Appuntamento</>}
          </button>
        </div>
      </div>
    </div>
  );
}