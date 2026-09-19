import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, deleteDoc, collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { format, getDay, startOfDay, endOfDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { DayPicker } from 'react-day-picker';
import ScheduleSettingsModal from './ScheduleSettingsModal';
import { XCircle, Settings, Calendar as CalendarIcon, Save, Trash2, Users, Lock, AlertTriangle, Plus } from 'lucide-react';
import { SpecialDay, Appointment, StaffProfile } from '../types';
import { useAuth } from '../context/AuthContext';
import { useSalonSettings } from '../hooks/useSalonSettings';
import { useIsOwner } from '../hooks/useIsOwner';

interface Props {
  onClose: () => void;
}

// Converte 8.5 -> "08:30" (per leggere l'orario standard e riepilogare le fasce)
const decimalToHHmm = (value: number) => {
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export default function ScheduleMaintenanceModal({ onClose }: Props) {
  const { tenantId, profile } = useAuth();
  const { settings: salonSettings } = useSalonSettings(tenantId);
  const { isOwner, loading: ownerLoading } = useIsOwner();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isClosed, setIsClosed] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [staffMembers, setStaffMembers] = useState<StaffProfile[]>([]);
  const [targetStaffId, setTargetStaffId] = useState<string | 'all'>('all');
  
  const [isScheduleSettingsOpen, setIsScheduleSettingsOpen] = useState(false);

  // 🚀 SICUREZZA ANTI-TAP: un'eccezione esiste solo se creata/modificata esplicitamente
  const [isExceptionMode, setIsExceptionMode] = useState(false);
  const [existingException, setExistingException] = useState(false);
  const [existingMeta, setExistingMeta] = useState<{ createdAt?: any; createdBy?: string } | null>(null);
  
  const [shift1Start, setShift1Start] = useState<number>(8);
  const [shift1End, setShift1End] = useState<number>(13);
  const [hasShift2, setHasShift2] = useState(true);
  const [shift2Start, setShift2Start] = useState<number>(14);
  const [shift2End, setShift2End] = useState<number>(20);

  const timeOptions = React.useMemo(() => {
    const options = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const value = h + (m / 60); 
        const label = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        options.push({ value, label });
      }
    }
    return options;
  }, []);

  // 🚀 CARICAMENTO STAFF (solo per il selettore di destinazione in multi-staff)
  useEffect(() => {
    if (!tenantId) return;

    if (salonSettings?.hasMultiStaff) {
      const fetchStaff = async () => {
        const snap = await getDocs(query(collection(db, 'salons', tenantId, 'staff'), where('active', '==', true)));
        setStaffMembers(snap.docs.map(d => d.data() as StaffProfile).sort((a, b) => a.order - b.order));
      };
      fetchStaff();
    }
  }, [tenantId, salonSettings?.hasMultiStaff]);

  // Caricamento Dati Giorno
  useEffect(() => {
    const fetchException = async () => {
      if (!tenantId) return;
      const dateString = format(selectedDate, 'yyyy-MM-dd');
      
      const docId = targetStaffId === 'all' ? dateString : `${dateString}_${targetStaffId}`;
      const docRef = doc(db, 'salons', tenantId, 'calendar_exceptions', docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data() as SpecialDay;
        // 🚀 Eccezione esistente: si entra in modalità modifica con i suoi valori
        setExistingException(true);
        setExistingMeta({ createdAt: data.createdAt, createdBy: data.createdBy });
        setIsExceptionMode(true);
        setIsClosed(data.isClosed);
        if (data.openingHours && data.openingHours.length > 0) {
          setShift1Start(data.openingHours[0].start);
          setShift1End(data.openingHours[0].end);
          if (data.openingHours.length > 1) {
            setHasShift2(true);
            setShift2Start(data.openingHours[1].start);
            setShift2End(data.openingHours[1].end);
          } else {
            setHasShift2(false);
          }
        }
      } else {
        // 🚀 NIENTE più default automatici (8-13 / 14-20): senza eccezione si applica
        // l'orario standard e l'owner deve confermare esplicitamente la creazione.
        setExistingException(false);
        setExistingMeta(null);
        setIsExceptionMode(false);
        setIsClosed(false);
      }
    };
    fetchException();
  }, [selectedDate, tenantId, targetStaffId]);

  // 🚀 Orario standard del giorno selezionato (riferimento: questo modal NON lo modifica mai)
  const standardDay = salonSettings?.weeklySchedule?.[getDay(selectedDate)];
  const standardLabel = !salonSettings
    ? '—'
    : (standardDay?.isOpen && standardDay.shifts?.length
        ? standardDay.shifts.map(s => `${decimalToHHmm(s.start)}–${decimalToHHmm(s.end)}`).join(', ')
        : 'CHIUSO');

  // 🚀 Precompila le fasce con l'orario standard del giorno (nessun default inventato)
  const applyStandardShifts = () => {
    const shifts = standardDay?.isOpen ? (standardDay.shifts || []) : [];
    if (shifts.length > 0) {
      setShift1Start(shifts[0].start);
      setShift1End(shifts[0].end);
      if (shifts.length > 1) {
        setHasShift2(true);
        setShift2Start(shifts[1].start);
        setShift2End(shifts[1].end);
      } else {
        setHasShift2(false);
      }
    } else {
      setHasShift2(false);
    }
  };

  // 🚀 CREAZIONE ESPLICITA: si entra in modalità eccezione solo premendo il bottone
  const enterExceptionMode = () => {
    applyStandardShifts();
    const isStandardOpen = !!(standardDay?.isOpen && standardDay.shifts?.length);
    setIsClosed(!isStandardOpen); // se lo standard è chiuso si parte da "chiuso/assente"
    setIsExceptionMode(true);
  };

  const handleClosedToggle = (checked: boolean) => {
    setIsClosed(checked);
    if (!checked) applyStandardShifts();
  };

  const handleSave = async () => {
    if (!tenantId || !isExceptionMode) return;
    setLoading(true);
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    
    const openingHours: { start: number, end: number }[] = [];
    if (!isClosed) {
      openingHours.push({ start: shift1Start, end: shift1End });
      if (hasShift2) {
        openingHours.push({ start: shift2Start, end: shift2End });
      }
    }

    try {
      const dayStart = startOfDay(selectedDate);
      const dayEnd = endOfDay(selectedDate);
      
      // 🚀 ISOLAMENTO DATI TENANTID: GARANTITO!
      const qApps = query(
        collection(db, 'salons', tenantId, 'appointments'),
        where('startTime', '>=', Timestamp.fromDate(dayStart)),
        where('startTime', '<=', Timestamp.fromDate(dayEnd)),
        where('status', '==', 'booked')
      );
      const snapApps = await getDocs(qApps);
      
      const dayApps = snapApps.docs
        .map(d => d.data() as Appointment)
        .filter(app => targetStaffId === 'all' || app.staffId === targetStaffId);

      if (dayApps.length > 0) {
        if (isClosed) {
          alert(`Impossibile chiudere: ci sono ${dayApps.length} appuntamenti confermati! Spostali o annullali prima.`);
          setLoading(false);
          return;
        }

        let hasConflict = false;
        for (const app of dayApps) {
          const appStart = app.startTime.toDate();
          const appEnd = app.endTime.toDate();
          const startDec = appStart.getHours() + appStart.getMinutes() / 60;
          const endDec = appEnd.getHours() + appEnd.getMinutes() / 60;

          const fits = openingHours.some(shift => startDec >= shift.start && endDec <= shift.end);
          if (!fits) {
            hasConflict = true;
            break;
          }
        }

        if (hasConflict) {
          alert("Impossibile salvare: alcuni appuntamenti fissati cadono fuori dalle nuove fasce orarie.");
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.error("Errore controllo conflitti:", e);
    }

    // 🚀 CONFERMA RIEPILOGATIVA: nessun salvataggio involontario
    const dateLabel = format(selectedDate, 'EEEE d MMMM yyyy', { locale: it });
    const targetLabel = targetStaffId === 'all' ? 'tutto il salone' : 'il barbiere selezionato';
    const summary = isClosed
      ? (targetStaffId === 'all' ? 'Il salone risulterà CHIUSO tutto il giorno.' : 'Il barbiere risulterà ASSENTE per tutto il giorno.')
      : `Fasce orarie: ${openingHours.map(h => `${decimalToHHmm(h.start)}–${decimalToHHmm(h.end)}`).join(', ')}`;

    const confirmed = window.confirm(
      `Stai per salvare un'ECCEZIONE per ${dateLabel} (${targetLabel}).\n\n` +
      `${summary}\n\n` +
      `L'orario standard del ${format(selectedDate, 'EEEE', { locale: it })} (${standardLabel}) NON viene modificato: questa regola vale solo per questo giorno.\n\n` +
      `Confermi il salvataggio?`
    );
    if (!confirmed) {
      setLoading(false);
      return;
    }

    const docId = targetStaffId === 'all' ? dateString : `${dateString}_${targetStaffId}`;
    const specialDayData: SpecialDay & { staffId?: string | null } = {
      date: dateString,
      isClosed,
      openingHours: isClosed ? [] : openingHours,
      staffId: targetStaffId === 'all' ? null : targetStaffId,
      // 🚀 AUDIT MINIMO: chi ha creato/modificato (i doc vecchi non hanno questi campi)
      createdAt: existingMeta?.createdAt || Timestamp.now(),
      createdBy: existingMeta?.createdBy || profile?.uid || 'sconosciuto',
      updatedAt: Timestamp.now()
    };

    try {
      await setDoc(doc(db, 'salons', tenantId, 'calendar_exceptions', docId), specialDayData);
      alert('Orario aggiornato con successo!');
      onClose();
    } catch (error) {
      console.error(error);
      alert('Errore durante il salvataggio.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!tenantId || !existingException) return;
    if (!window.confirm(`Vuoi eliminare l'eccezione del ${format(selectedDate, 'dd/MM/yyyy')} e tornare all'orario standard (${standardLabel})?`)) return;
    setLoading(true);
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const docId = targetStaffId === 'all' ? dateString : `${dateString}_${targetStaffId}`;
    try {
      await deleteDoc(doc(db, 'salons', tenantId, 'calendar_exceptions', docId));
      alert('Orario standard ripristinato!');
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // 🚀 GATE RBAC: solo il Titolare può modificare gli orari
  if (ownerLoading) return null;
  if (!isOwner) {
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white rounded-[32px] p-8 max-w-sm w-full text-center shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-red-500"></div>
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-red-100">
            <Lock size={36} strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-black mb-2 text-gray-900 tracking-tight">Accesso Negato</h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed">
            Solo il <strong>Titolare</strong> del salone ha i permessi per modificare gli orari di apertura, chiusura e le ferie.
          </p>
          <button onClick={onClose} className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-md hover:bg-gray-800 hover:shadow-lg transition-all active:scale-95">
            Torna al Calendario
          </button>
        </div>
      </div>
    );
  }

  // 🚀 INTERFACCIA STANDARD
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center">
              <CalendarIcon size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Modifica Orari</h2>
              <p className="text-xs text-gray-500">Gestisci ferie ed eccezioni</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsScheduleSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-black text-white text-xs font-bold rounded-xl hover:bg-gray-800 transition-all shadow-sm"
              title="Configura orari di apertura e chiusura standard"
            >
              <Settings size={14} />
              <span>Orari Standard</span>
            </button>

            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
              <XCircle size={24} className="text-gray-400" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-8 flex-1 overflow-y-auto">
          
          {salonSettings?.hasMultiStaff && staffMembers.length > 0 && (
            <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
              <label className="text-xs font-bold text-blue-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                <Users size={14} /> Applica Regola A:
              </label>
              <select
                value={targetStaffId}
                onChange={(e) => setTargetStaffId(e.target.value)}
                className="w-full p-3 bg-white border border-blue-200 rounded-xl text-sm font-bold text-blue-900 outline-none cursor-pointer shadow-sm"
              >
                <option value="all">Tutto il Salone (Chiusura Globale)</option>
                {staffMembers.map(staff => (
                  <option key={staff.uid} value={staff.uid}>
                    Solo {staff.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-center bg-gray-50 rounded-2xl p-4">
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              locale={it}
              className="border-none"
              modifiersClassNames={{
                selected: "bg-black text-white rounded-full",
                today: "text-emerald-600 font-bold"
              }}
            />
          </div>

          <div className="space-y-6">
            <h3 className="text-lg font-bold border-b pb-2">
              Impostazioni per il {format(selectedDate, 'dd/MM/yyyy')}
            </h3>

            {/* 🚀 RIFERIMENTO: orario standard del giorno (questo modal non lo modifica mai) */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Orario standard del {format(selectedDate, 'EEEE', { locale: it })}
              </div>
              <div className="font-bold text-gray-800 mt-1">{standardLabel}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                Vale per tutte le settimane. Un'eccezione cambia solo questo giorno.
              </div>
            </div>

            {!isExceptionMode ? (
              <div className="p-5 rounded-2xl border-2 border-dashed border-gray-200 text-center space-y-3 animate-in fade-in">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Nessuna eccezione per questo giorno: si applica l'<strong>orario standard</strong>.
                </p>
                <button
                  onClick={enterExceptionMode}
                  className="w-full py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> Crea eccezione per il {format(selectedDate, 'd MMMM', { locale: it })}
                </button>
              </div>
            ) : (
              <>
                {/* 🚀 BADGE ECCEZIONE: rende evidente che NON si sta toccando lo standard */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed text-amber-900">
                    <div className="font-black uppercase tracking-wider">
                      {existingException ? "Stai modificando un'eccezione" : "Stai creando un'ECCEZIONE"}
                    </div>
                    <div>
                      Vale <strong>solo</strong> per il {format(selectedDate, 'd MMMM yyyy', { locale: it })}. L'orario standard resta <strong>{standardLabel}</strong>.
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="font-bold text-gray-700">
                    {targetStaffId === 'all' ? 'Chiuso tutto il giorno' : 'Assente / Non disponibile'}
                  </span>
                  <input
                    type="checkbox"
                    checked={isClosed}
                    onChange={(e) => handleClosedToggle(e.target.checked)}
                    className="w-6 h-6 rounded text-black focus:ring-black cursor-pointer"
                  />
                </div>

            {!isClosed && (
              <div className="space-y-4 animate-in fade-in">
                <div className="p-4 border border-gray-200 rounded-xl space-y-3">
                  <div className="text-xs font-bold text-gray-400 uppercase">Primo Turno</div>
                  <div className="flex items-center gap-4">
                    <select value={shift1Start} onChange={e => setShift1Start(Number(e.target.value))} className="w-24 p-2 border rounded-lg text-center font-bold outline-none focus:border-black appearance-none bg-white cursor-pointer">
                      {timeOptions.map(opt => <option key={`start1-${opt.value}`} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <span className="text-sm font-medium text-gray-500">fino alle</span>
                    <select value={shift1End} onChange={e => setShift1End(Number(e.target.value))} className="w-24 p-2 border rounded-lg text-center font-bold outline-none focus:border-black appearance-none bg-white cursor-pointer">
                      {timeOptions.map(opt => <option key={`end1-${opt.value}`} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="shift2" checked={hasShift2} onChange={(e) => setHasShift2(e.target.checked)} />
                  <label htmlFor="shift2" className="text-sm font-bold text-gray-600 cursor-pointer">Abilita Secondo Turno</label>
                </div>

                {hasShift2 && (
                  <div className="p-4 border border-gray-200 rounded-xl space-y-3 animate-in fade-in">
                    <div className="text-xs font-bold text-gray-400 uppercase">Secondo Turno</div>
                    <div className="flex items-center gap-4">
                      <select value={shift2Start} onChange={e => setShift2Start(Number(e.target.value))} className="w-24 p-2 border rounded-lg text-center font-bold outline-none focus:border-black appearance-none bg-white cursor-pointer">
                        {timeOptions.map(opt => <option key={`start2-${opt.value}`} value={opt.value}>{opt.label}</option>)}
                      </select>
                      <span className="text-sm font-medium text-gray-500">fino alle</span>
                      <select value={shift2End} onChange={e => setShift2End(Number(e.target.value))} className="w-24 p-2 border rounded-lg text-center font-bold outline-none focus:border-black appearance-none bg-white cursor-pointer">
                        {timeOptions.map(opt => <option key={`end2-${opt.value}`} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
              </>
            )}
          </div>
        </div>

        {(isExceptionMode || existingException) && (
          <div className="p-6 border-t border-gray-100 flex gap-3 bg-gray-50 sticky bottom-0 shrink-0">
            {existingException && (
              <button
                disabled={loading}
                onClick={handleDelete}
                className="px-6 py-4 bg-white border border-gray-200 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-all flex items-center gap-2"
              >
                <Trash2 size={20} /> Ripristina
              </button>
            )}
            {isExceptionMode && (
              <button
                disabled={loading}
                onClick={handleSave}
                className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all flex items-center justify-center gap-2 shadow-xl"
              >
                <Save size={20} /> {loading ? 'Salvataggio...' : existingException ? 'Aggiorna Eccezione' : 'Salva Eccezione'}
              </button>
            )}
          </div>
        )}

        {isScheduleSettingsOpen && (
          <ScheduleSettingsModal onClose={() => setIsScheduleSettingsOpen(false)} />
        )}
      </div>
    </div>
  );
}