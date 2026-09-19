import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, Timestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { WeeklySchedule, SpecialDay } from '../types';
import { XCircle, Check, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { format, getDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { useAuth } from '../context/AuthContext';

interface ScheduleSettingsModalProps {
  onClose: () => void;
}

// Ordinati da Lunedì a Domenica per la UI italiana
const DAYS_OF_WEEK = [
  { id: 1, label: 'Lunedì' },
  { id: 2, label: 'Martedì' },
  { id: 3, label: 'Mercoledì' },
  { id: 4, label: 'Giovedì' },
  { id: 5, label: 'Venerdì' },
  { id: 6, label: 'Sabato' },
  { id: 0, label: 'Domenica' },
];

// 🚀 Generiamo un orario base vuoto se il tenant è nuovo di zecca
const generateEmptySchedule = (): WeeklySchedule => {
  const empty: WeeklySchedule = {};
  for (let i = 0; i <= 6; i++) {
    empty[i] = { isOpen: false, shifts: [] };
  }
  return empty;
};

// 🚀 Confronto deterministico: rileva se il documento è stato modificato da un altro dispositivo
const serializeSchedule = (s: WeeklySchedule | null | undefined): string => {
  const parts: string[] = [];
  for (let d = 0; d <= 6; d++) {
    const day = s?.[d];
    parts.push(`${d}:${day?.isOpen ? 1 : 0}:${(day?.shifts || []).map(x => `${x.start}-${x.end}`).join('|')}`);
  }
  return parts.join(',');
};

// Converte 8.5 -> "08:30"
const decimalToHHmm = (value: number) => {
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// 🚀 Riepilogo leggibile degli orari (ordine Lunedì -> Domenica) per il dialogo di conferma
const summarizeSchedule = (s: WeeklySchedule): string => {
  return DAYS_OF_WEEK.map(({ id, label }) => {
    const day = s?.[id];
    const hours = day?.isOpen && (day.shifts || []).length > 0
      ? day.shifts.map(sh => `${decimalToHHmm(sh.start)}–${decimalToHHmm(sh.end)}`).join(', ')
      : 'CHIUSO';
    return `${label}: ${hours}`;
  }).join('\n');
};

// 🚀 Validazione: blocca orari incoerenti PRIMA di scrivere sul database
const findScheduleIssues = (s: WeeklySchedule): string[] => {
  const issues: string[] = [];
  for (const { id, label } of DAYS_OF_WEEK) {
    const day = s?.[id];
    if (!day?.isOpen) continue;
    const shifts = day.shifts || [];
    if (shifts.length === 0) {
      issues.push(`${label}: segnato come APERTO ma senza fasce orarie.`);
      continue;
    }
    shifts.forEach((sh, idx) => {
      if (!(sh.end > sh.start)) {
        issues.push(`${label}, turno ${idx + 1}: orario non valido (${decimalToHHmm(sh.start)} – ${decimalToHHmm(sh.end)}).`);
      }
    });
  }
  return issues;
};

export default function ScheduleSettingsModal({ onClose }: ScheduleSettingsModalProps) {
  // 🚀 Estrazione tenantId
  const { tenantId } = useAuth();

  // 🚀 Rimosso import da costanti statiche
  const [schedule, setSchedule] = useState<WeeklySchedule>(generateEmptySchedule());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  // 🚀 Lettura del documento (riusata all'apertura e quando si annulla un salvataggio "stale")
  const loadSchedule = async (): Promise<WeeklySchedule | null> => {
    if (!tenantId) return null;
    const docSnap = await getDoc(doc(db, 'salons', tenantId, 'settings', 'public'));
    const data = docSnap.exists() ? docSnap.data() : null;
    const loaded = data?.weeklySchedule ? (data.weeklySchedule as WeeklySchedule) : null;
    if (loaded) setSchedule(loaded);
    return loaded;
  };

  useEffect(() => {
    const fetchSettings = async () => {
      if (!tenantId) return; 
      try {
        await loadSchedule();
      } catch (err) {
        console.error("Errore caricamento impostazioni orario:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return; 
    setSaving(true);
    try {
      // 🚀 SCUDO ANTI-CONFLITTO CONFINATO AL TENANT
      const now = new Date();
      
      const exceptionsSnap = await getDocs(collection(db, 'salons', tenantId, 'calendar_exceptions'));
      const exceptions = exceptionsSnap.docs.map(d => d.data() as SpecialDay);

      const qApps = query(
        collection(db, 'salons', tenantId, 'appointments'),
        where('startTime', '>=', Timestamp.fromDate(now)),
        where('status', '==', 'booked')
      );
      const snapApps = await getDocs(qApps);
      const futureApps = snapApps.docs.map(d => d.data() as any);

      let conflictFound = false;
      let conflictMsg = "";

      for (const app of futureApps) {
        const appStart = app.startTime.toDate();
        const appEnd = app.endTime.toDate();
        const dateString = format(appStart, 'yyyy-MM-dd');
        
        if (exceptions.some(ex => ex.date === dateString)) continue;

        const dayOfWeek = getDay(appStart);
        const dayConfig = schedule[dayOfWeek];

        if (!dayConfig.isOpen) {
          conflictFound = true;
          conflictMsg = `Hai un appuntamento il ${format(appStart, 'EEEE d MMMM', {locale: it})}, ma stai impostando i ${format(appStart, 'EEEE', {locale: it})} come CHIUSI.`;
          break;
        }

        const startDec = appStart.getHours() + appStart.getMinutes() / 60;
        const endDec = appEnd.getHours() + appEnd.getMinutes() / 60;

        const fits = dayConfig.shifts.some(shift => startDec >= shift.start && endDec <= shift.end);
        if (!fits) {
          conflictFound = true;
          conflictMsg = `L'appuntamento del ${format(appStart, 'dd/MM/yyyy')} alle ${format(appStart, 'HH:mm')} cade fuori dai nuovi turni inseriti per i ${format(appStart, 'EEEE', {locale: it})}.`;
          break;
        }
      }

      if (conflictFound) {
        alert(`IMPOSSIBILE SALVARE:\n\n${conflictMsg}\n\nSposta o annulla l'appuntamento prima di restringere l'orario standard.`);
        setSaving(false);
        return;
      }

      // 🚀 VALIDAZIONE: niente giornate aperte senza fasce o con orari incoerenti
      const issues = findScheduleIssues(schedule);
      if (issues.length > 0) {
        alert(`IMPOSSIBILE SALVARE:\n\n${issues.join('\n')}\n\nOgni giorno aperto deve avere almeno una fascia con inizio precedente alla fine.`);
        setSaving(false);
        return;
      }

      // 🚀 ANTI-SOVRASCRITTURA: rileggo il documento appena prima di scrivere, così non
      // cancello modifiche fatte nel frattempo da un altro dispositivo/sessione.
      let stale = false;
      try {
        const freshSnap = await getDoc(doc(db, 'salons', tenantId, 'settings', 'public'));
        const fresh = freshSnap.exists() ? (freshSnap.data().weeklySchedule as WeeklySchedule | undefined) : undefined;
        stale = serializeSchedule(fresh) !== serializeSchedule(schedule);
      } catch (err) {
        console.warn("Impossibile verificare gli orari aggiornati:", err);
      }

      // 🚀 CONFERMA RIEPILOGATIVA: nessun salvataggio involontario
      const confirmed = window.confirm(
        (stale
          ? "⚠️ ATTENZIONE: gli orari standard sono cambiati su un altro dispositivo dopo l'apertura di questa schermata.\nPremendo OK sovrascriverai quelle modifiche con i valori mostrati qui.\nPremendo Annulla ricarico gli orari aggiornati e NON salvo.\n\n"
          : "") +
        `Stai per salvare gli ORARI STANDARD del salone:\n\n${summarizeSchedule(schedule)}\n\n` +
        `Valgono per TUTTE le settimane (le eccezioni sui singoli giorni restano invariate).\n\n` +
        `Confermi il salvataggio?`
      );

      if (!confirmed) {
        if (stale) {
          try {
            await loadSchedule();
            alert("Ho ricaricato gli orari aggiornati: nessuna modifica è stata salvata.");
          } catch (err) {
            console.error("Errore ricaricamento orari:", err);
          }
        }
        setSaving(false);
        return;
      }

      // 🚀 Salviamo i dati dinamicamente nel documento "public"
      await setDoc(doc(db, 'salons', tenantId, 'settings', 'public'), {
        weeklySchedule: schedule,
        updatedAt: Timestamp.now()
      }, { merge: true });
      
      alert('Orari standard salvati con successo!');
      onClose();
    } catch (err) {
      console.error("Errore salvataggio impostazioni:", err);
      alert("Si è verificato un errore durante il salvataggio.");
    } finally {
      setSaving(false);
    }
  };

  const toggleDayOpen = (dayId: number) => {
    // 🚀 Nessun turno inserito automaticamente: abilitare un giorno con 0 fasce NON crea
    // orari che l'owner non si aspetta (i calendari lo trattano come chiuso finché non aggiunge fasce).
    setSchedule(prev => ({
      ...prev,
      [dayId]: { ...prev[dayId], isOpen: !prev[dayId].isOpen }
    }));
  };

  const updateShift = (dayId: number, shiftIndex: number, field: 'start' | 'end', val: number) => {
    setSchedule(prev => {
      const newShifts = [...prev[dayId].shifts];
      newShifts[shiftIndex] = { ...newShifts[shiftIndex], [field]: val };
      return {
        ...prev,
        [dayId]: { ...prev[dayId], shifts: newShifts }
      };
    });
  };

  const addShift = (dayId: number) => {
    setSchedule(prev => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        // 🚀 Placeholder volutamente NON valido (00:00) invece di un orario inventato:
        // il salvataggio lo blocca finché non scegli esplicitamente inizio e fine.
        shifts: [...prev[dayId].shifts, { start: 0, end: 0 }]
      }
    }));
  };

  const removeShift = (dayId: number, shiftIndex: number) => {
    setSchedule(prev => {
      const newShifts = [...prev[dayId].shifts];
      newShifts.splice(shiftIndex, 1);
      return {
        ...prev,
        [dayId]: { ...prev[dayId], shifts: newShifts }
      };
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose} 
              className="p-2 hover:bg-gray-200 rounded-xl transition-colors flex items-center justify-center text-gray-700"
              title="Torna alle eccezioni"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-black">Orari Standard</h2>
              <p className="text-xs text-gray-500 font-medium">Configura gli orari settimanali del salone</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <XCircle className="text-gray-400" size={24} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400 font-medium">Caricamento...</div>
        ) : (
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 bg-white scrollbar-thin scrollbar-thumb-gray-200">
            {DAYS_OF_WEEK.map(day => {
              const dayData = schedule[day.id];
              return (
                <div key={day.id} className={cn("rounded-2xl border transition-all duration-300", dayData.isOpen ? "bg-white border-gray-200 shadow-sm" : "bg-gray-50 border-gray-100 grayscale-[0.5]")}>
                  
                  <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => toggleDayOpen(day.id)}>
                    <div className="flex items-center gap-3">
                      <div className={cn("w-2 h-2 rounded-full", dayData.isOpen ? "bg-emerald-500" : "bg-red-500")} />
                      <span className="font-bold text-gray-800 uppercase tracking-wider text-sm">{day.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs font-bold", dayData.isOpen ? "text-emerald-600" : "text-gray-400")}>
                        {dayData.isOpen ? "APERTO" : "CHIUSO"}
                      </span>
                      <input 
                        type="checkbox" 
                        checked={dayData.isOpen} 
                        onChange={() => toggleDayOpen(day.id)}
                        className="w-5 h-5 rounded cursor-pointer accent-black"
                        onClick={(e) => e.stopPropagation()} 
                      />
                    </div>
                  </div>

                  {dayData.isOpen && (
                    <div className="px-4 pb-4 space-y-3 animate-in fade-in slide-in-from-top-2">
                      <div className="w-full h-px bg-gray-100 mb-2"></div>
                      
                      {dayData.shifts.map((shift, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <span className="text-[10px] font-bold text-gray-400 uppercase w-14">Turno {idx + 1}</span>
                          
                          <div className="flex items-center flex-1 gap-2">
                            <select 
                              value={shift.start} 
                              onChange={e => updateShift(day.id, idx, 'start', Number(e.target.value))} 
                              className="flex-1 p-2 border border-gray-200 rounded-lg text-center font-bold text-sm outline-none focus:border-black appearance-none bg-white cursor-pointer"
                            >
                              {timeOptions.map(opt => <option key={`start-${idx}-${opt.value}`} value={opt.value}>{opt.label}</option>)}
                            </select>
                            
                            <span className="text-xs font-medium text-gray-500">al</span>
                            
                            <select 
                              value={shift.end} 
                              onChange={e => updateShift(day.id, idx, 'end', Number(e.target.value))} 
                              className="flex-1 p-2 border border-gray-200 rounded-lg text-center font-bold text-sm outline-none focus:border-black appearance-none bg-white cursor-pointer"
                            >
                              {timeOptions.map(opt => <option key={`end-${idx}-${opt.value}`} value={opt.value}>{opt.label}</option>)}
                            </select>
                          </div>

                          <button 
                            onClick={() => removeShift(day.id, idx)}
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-auto"
                            title="Elimina turno"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))}

                      {dayData.shifts.length < 3 && ( 
                        <button 
                          onClick={() => addShift(day.id)}
                          className="w-full py-2.5 border-2 border-dashed border-gray-200 text-gray-500 rounded-xl text-xs font-bold hover:border-black hover:text-black transition-all flex items-center justify-center gap-2"
                        >
                          <Plus size={16} /> Aggiungi Fascia Oraria
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="p-6 border-t border-gray-100 flex gap-3 bg-gray-50 sticky bottom-0">
          <button
            disabled={saving || loading}
            onClick={handleSave}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all flex items-center justify-center gap-2 shadow-xl"
          >
            {saving ? 'Salvataggio...' : <><Check size={20} /> Salva Orari Standard</>}
          </button>
        </div>
      </div>
    </div>
  );
}