import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_WEEKLY_SCHEDULE } from '../constants';
import { WeeklySchedule, TimeRange } from '../types';
import { XCircle, Check, Calendar, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

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

export default function ScheduleSettingsModal({ onClose }: ScheduleSettingsModalProps) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(DEFAULT_WEEKLY_SCHEDULE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Genera le opzioni per la tendina (scatti di 15 minuti)
  const timeOptions = React.useMemo(() => {
    const options = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const value = h + (m / 60); // Es. 8:30 diventa 8.5
        const label = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        options.push({ value, label });
      }
    }
    return options;
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'business_hours'));
        if (docSnap.exists()) {
          const data = docSnap.data();
          
          if (data.weeklySchedule) {
            // Se esiste già la nuova struttura, la carica
            setSchedule(data.weeklySchedule);
          } else if (data.openingHours && data.closedDays) {
            // 🚀 MIGRATOR AUTOMATICO: Converte i vecchi dati monolitici nella nuova mappa 7-day
            const migratedSchedule: WeeklySchedule = { ...DEFAULT_WEEKLY_SCHEDULE };
            for (let i = 0; i <= 6; i++) {
              const isClosed = data.closedDays.includes(i);
              migratedSchedule[i] = {
                isOpen: !isClosed,
                shifts: !isClosed ? [...data.openingHours] : []
              };
            }
            setSchedule(migratedSchedule);
          }
        }
      } catch (err) {
        console.error("Errore caricamento impostazioni orario:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'business_hours'), {
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
    setSchedule(prev => {
      const isCurrentlyOpen = prev[dayId].isOpen;
      return {
        ...prev,
        [dayId]: {
          ...prev[dayId],
          isOpen: !isCurrentlyOpen,
          // Se lo stiamo aprendo e non ha turni, diamo un orario base per comodità
          shifts: !isCurrentlyOpen && prev[dayId].shifts.length === 0 
            ? [{ start: 8, end: 13 }, { start: 15, end: 20 }] 
            : prev[dayId].shifts
        }
      };
    });
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
        shifts: [...prev[dayId].shifts, { start: 14, end: 20 }] // Default per un nuovo turno
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
        {/* HEADER CON BOTTONE TORNA INDIETRO */}
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
                  
                  {/* Intestazione del Giorno */}
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
                        onClick={(e) => e.stopPropagation()} // Evita il doppio click col div padre
                      />
                    </div>
                  </div>

                  {/* Fasce Orarie (Visibili solo se aperto) */}
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

                      {dayData.shifts.length < 3 && ( // Limite ragionevole a 3 turni giornalieri
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

        <div className="p-6 border-t border-gray-100 bg-gray-50/50">
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