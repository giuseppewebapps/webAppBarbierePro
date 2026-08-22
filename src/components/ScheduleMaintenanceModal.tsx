import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { DayPicker } from 'react-day-picker';
import { XCircle, Calendar as CalendarIcon, Save, Trash2, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { SpecialDay } from '../types';

interface Props {
  onClose: () => void;
}

export default function ScheduleMaintenanceModal({ onClose }: Props) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isClosed, setIsClosed] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Orari di default (es. mattina e pomeriggio)
  const [shift1Start, setShift1Start] = useState<number>(8);
  const [shift1End, setShift1End] = useState<number>(13);
  const [hasShift2, setHasShift2] = useState(true);
  const [shift2Start, setShift2Start] = useState<number>(14);
  const [shift2End, setShift2End] = useState<number>(20);

  // Carica i dati esistenti se il giorno ha già un'eccezione
  useEffect(() => {
    const fetchException = async () => {
      const dateString = format(selectedDate, 'yyyy-MM-dd');
      const docRef = doc(db, 'calendar_exceptions', dateString);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data() as SpecialDay;
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
        // Reset ai default se non c'è eccezione
        setIsClosed(false);
        setShift1Start(8); setShift1End(13);
        setHasShift2(true);
        setShift2Start(14); setShift2End(20);
      }
    };
    fetchException();
  }, [selectedDate]);

  const handleSave = async () => {
    setLoading(true);
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    
    const openingHours = [];
    if (!isClosed) {
      openingHours.push({ start: shift1Start, end: shift1End });
      if (hasShift2) {
        openingHours.push({ start: shift2Start, end: shift2End });
      }
    }

    const specialDayData: SpecialDay = {
      date: dateString,
      isClosed,
      openingHours: isClosed ? [] : openingHours
    };

    try {
      // Usiamo setDoc con dateString come ID per evitare duplicati!
      await setDoc(doc(db, 'calendar_exceptions', dateString), specialDayData);
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
    if (!window.confirm("Vuoi ripristinare l'orario standard per questo giorno?")) return;
    setLoading(true);
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    try {
      await deleteDoc(doc(db, 'calendar_exceptions', dateString));
      alert('Orario standard ripristinato!');
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[32px] w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center">
              <CalendarIcon size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Modifica Orari</h2>
              <p className="text-xs text-gray-500">Gestisci ferie ed eccezioni</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <XCircle size={24} className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Calendario per scegliere la data */}
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

            {/* Toggle Chiusura */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
              <span className="font-bold text-gray-700">Chiuso tutto il giorno</span>
              <input
                type="checkbox"
                checked={isClosed}
                onChange={(e) => setIsClosed(e.target.checked)}
                className="w-6 h-6 rounded text-black focus:ring-black cursor-pointer"
              />
            </div>

            {/* Configurazione Orari (Visibile solo se aperto) */}
            {!isClosed && (
              <div className="space-y-4 animate-in fade-in">
                <div className="p-4 border border-gray-200 rounded-xl space-y-3">
                  <div className="text-xs font-bold text-gray-400 uppercase">Primo Turno</div>
                  <div className="flex items-center gap-4">
                    <input type="number" value={shift1Start} onChange={e => setShift1Start(Number(e.target.value))} className="w-20 p-2 border rounded-lg text-center font-bold" min="0" max="23" />
                    <span>fino alle</span>
                    <input type="number" value={shift1End} onChange={e => setShift1End(Number(e.target.value))} className="w-20 p-2 border rounded-lg text-center font-bold" min="0" max="24" />
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
                      <input type="number" value={shift2Start} onChange={e => setShift2Start(Number(e.target.value))} className="w-20 p-2 border rounded-lg text-center font-bold" min="0" max="23" />
                      <span>fino alle</span>
                      <input type="number" value={shift2End} onChange={e => setShift2End(Number(e.target.value))} className="w-20 p-2 border rounded-lg text-center font-bold" min="0" max="24" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3 bg-gray-50 sticky bottom-0">
          <button
            disabled={loading}
            onClick={handleDelete}
            className="px-6 py-4 bg-white border border-gray-200 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-all flex items-center gap-2"
          >
            <Trash2 size={20} /> Ripristina
          </button>
          <button
            disabled={loading}
            onClick={handleSave}
            className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all flex items-center justify-center gap-2 shadow-xl"
          >
            <Save size={20} /> {loading ? 'Salvataggio...' : 'Salva Regola'}
          </button>
        </div>
      </div>
    </div>
  );
}