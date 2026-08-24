import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_OPENING_HOURS, DEFAULT_CLOSED_DAYS } from '../constants';
import { TimeRange } from '../types';
import { XCircle, Check, Clock, Calendar, ArrowLeft } from 'lucide-react';

interface ScheduleSettingsModalProps {
  onClose: () => void;
}

const DAYS_OF_WEEK = [
  { id: 0, label: 'Domenica' },
  { id: 1, label: 'Lunedì' },
  { id: 2, label: 'Martedì' },
  { id: 3, label: 'Mercoledì' },
  { id: 4, label: 'Giovedì' },
  { id: 5, label: 'Venerdì' },
  { id: 6, label: 'Sabato' },
];

export default function ScheduleSettingsModal({ onClose }: ScheduleSettingsModalProps) {
  const [openingHours, setOpeningHours] = useState<TimeRange[]>(DEFAULT_OPENING_HOURS);
  const [closedDays, setClosedDays] = useState<number[]>(DEFAULT_CLOSED_DAYS);
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
          if (data.openingHours) setOpeningHours(data.openingHours);
          if (data.closedDays) setClosedDays(data.closedDays);
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
        openingHours,
        closedDays,
        updatedAt: Timestamp.now()
      });
      alert('Orari standard salvati con successo!');
      onClose();
    } catch (err) {
      console.error("Errore salvataggio impostazioni:", err);
      alert("Si è verificato un errore durante il salvataggio.");
    } finally {
      setSaving(false);
    }
  };

  const toggleClosedDay = (dayId: number) => {
    setClosedDays(prev =>
      prev.includes(dayId) ? prev.filter(d => d !== dayId) : [...prev, dayId]
    );
  };

  const updateRange = (index: number, field: 'start' | 'end', val: number) => {
    setOpeningHours(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
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
          <div className="p-6 space-y-8 overflow-y-auto flex-1">
            {/* GIORNI DI CHIUSURA */}
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Calendar size={14} /> Giorni di Chiusura
              </h3>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map(day => {
                  const isClosed = closedDays.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleClosedDay(day.id)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                        isClosed
                          ? "bg-red-500 text-white border-red-500 shadow-sm"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {day.label} {isClosed ? '(Chiuso)' : ''}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* FASCE ORARIE CON TENDINA */}
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Clock size={14} /> Fasce Orarie
              </h3>
              <div className="space-y-4">
                {openingHours.map((range, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                    <span className="text-xs font-bold text-gray-400 uppercase">Turno {idx + 1}</span>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-400 font-bold block mb-1">Apertura</label>
                        <select 
                          value={range.start} 
                          onChange={e => updateRange(idx, 'start', Number(e.target.value))} 
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-center font-bold text-sm outline-none focus:border-black appearance-none bg-white cursor-pointer"
                        >
                          {timeOptions.map(opt => (
                            <option key={`start-${idx}-${opt.value}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="text-sm font-medium text-gray-500 mt-4">fino alle</span>
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-400 font-bold block mb-1">Chiusura</label>
                        <select 
                          value={range.end} 
                          onChange={e => updateRange(idx, 'end', Number(e.target.value))} 
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-center font-bold text-sm outline-none focus:border-black appearance-none bg-white cursor-pointer"
                        >
                          {timeOptions.map(opt => (
                            <option key={`end-${idx}-${opt.value}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
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