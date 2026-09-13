import React, { useState } from 'react';
import { doc, updateDoc, Timestamp, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase';
import { Appointment, UserProfile, StaffProfile, SalonPublicSettings } from '../types';
import { format, isBefore, isAfter } from 'date-fns';
import { it } from 'date-fns/locale';
import { XCircle, Phone, ChevronRight, Send, Scissors, Check, Users, ArrowUpCircle, Settings, Globe, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { WhatsAppButton } from './WhatsAppButton';

interface Props {
  appointment: Appointment & { customer?: UserProfile };
  allAppointments?: (Appointment & { customer?: UserProfile })[];
  tenantId: string;
  salonSettings: SalonPublicSettings | null;
  staffMembers: StaffProfile[];
  localContacts: Record<string, any>;
  currentTime: Date;
  isOwner: boolean;
  onClose: () => void;
  onCancelRequest: (app: Appointment) => void;
  onProposeShift: (app: Appointment) => void;
}

export default function AppointmentDetailsModal({
  appointment, allAppointments = [], tenantId, salonSettings, staffMembers, localContacts, currentTime, isOwner, onClose, onCancelRequest, onProposeShift
}: Props) {
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [showContactMenu, setShowContactMenu] = useState(false);
  const [editCustomerForm, setEditCustomerForm] = useState({ firstName: '', lastName: '', phone: '', email: '' });

  const getDisplayName = (app: Appointment & { customer?: UserProfile }) => {
    if (app.isForFriend) return `${app.friendDetails?.firstName || ''} ${app.friendDetails?.lastName || ''}`.trim() || 'Amico';
    const rawPhone = app.customer?.phoneNumber?.replace(/\D/g, '') || '';
    const purePhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.slice(-10) : rawPhone.slice(-10);
    if (purePhone && localContacts[purePhone]) return `${localContacts[purePhone].firstName} ${localContacts[purePhone].lastName}`.trim();
    return app.customer?.displayName || 'Cliente';
  };

  const startEditingCustomer = () => {
    const fullName = getDisplayName(appointment);
    const nameParts = fullName.split(' ');
    setEditCustomerForm({
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      phone: (appointment.isForFriend ? appointment.friendDetails?.phone : appointment.customer?.phoneNumber) || '',
      email: (appointment.isForFriend ? appointment.friendDetails?.email : appointment.customer?.email) || ''
    });
    setIsEditingCustomer(true);
  };

  const handleSaveCustomerEdits = async () => {
    setSavingCustomer(true);
    try {
      const fullName = `${editCustomerForm.firstName} ${editCustomerForm.lastName}`.trim();
      const rawPhone = editCustomerForm.phone.replace(/\D/g, '');
      const purePhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.substring(2) : rawPhone.slice(-10);
      const fullPhone = purePhone.length >= 9 ? `+39${purePhone}` : '';
      const appRef = doc(db, 'salons', tenantId, 'appointments', appointment.id!);
      
      if (appointment.isForFriend) {
        await updateDoc(appRef, { 'friendDetails.firstName': editCustomerForm.firstName, 'friendDetails.lastName': editCustomerForm.lastName, 'friendDetails.phone': fullPhone, 'friendDetails.email': editCustomerForm.email });
      } else {
        await updateDoc(appRef, { 'customer.displayName': fullName, 'customer.phoneNumber': fullPhone, 'customer.email': editCustomerForm.email });
      }

      if (purePhone) {
        await updateDoc(doc(db, 'salons', tenantId, 'contacts', purePhone), {
          firstName: editCustomerForm.firstName, lastName: editCustomerForm.lastName,
          firstNameLower: editCustomerForm.firstName.toLowerCase(), lastNameLower: editCustomerForm.lastName.toLowerCase(),
          phone: purePhone, phonePrefix: '+39', email: editCustomerForm.email, updatedAt: Timestamp.now()
        });
      }
      setIsEditingCustomer(false);
    } catch (error) {
      alert("Errore durante l'aggiornamento.");
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleReassignStaff = async (newStaffId: string) => {
    if (newStaffId === appointment.staffId) return;
    const newStaff = staffMembers.find(s => s.uid === newStaffId);
    if (!newStaff) return;

    const canDoAll = appointment.services.map(s => s.id).every(id => newStaff.assignedServices.includes(id));
    if (!canDoAll) {
      alert(`⚠️ ${newStaff.displayName} non esegue tutti i servizi previsti per questo appuntamento.`);
      return;
    }

    const appStart = appointment.startTime.toDate();
    const appEnd = appointment.endTime.toDate();

    const hasOverlap = allAppointments.some(a => {
      if (a.id === appointment.id || a.status !== 'booked' || a.staffId !== newStaffId) return false;
      const otherStart = a.startTime.toDate();
      const otherEnd = a.endTime.toDate();
      return isBefore(otherStart, appEnd) && isAfter(otherEnd, appStart);
    });

    if (hasOverlap) {
      alert(`⚠️ Impossibile spostare: ${newStaff.displayName} ha già un altro appuntamento in questa fascia oraria!`);
      return;
    }

    try {
      await updateDoc(doc(db, 'salons', tenantId, 'appointments', appointment.id!), { 
        staffId: newStaffId, 
        updatedAt: Timestamp.now() 
      });
    } catch (error) {
      alert("Errore durante lo spostamento.");
    }
  };

  const customerPhone = appointment.isForFriend ? appointment.friendDetails?.phone : appointment.customer?.phoneNumber;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 sm:p-6 animate-in fade-in duration-200">
      {/* 🚀 Usiamo 85svh per evitare che il modale venga tagliato sui dispositivi mobile */}
      <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[85svh] md:max-h-[90vh]">
        
        {/* HEADER MODALE */}
        <div className="p-5 sm:p-6 border-b border-gray-800 flex justify-between items-center bg-black text-white shrink-0">
          <h3 className="text-lg sm:text-xl font-bold">Dettagli Appuntamento</h3>
          {/* 🚀 Area di touch ingrandita per il mobile */}
          <button onClick={onClose} className="p-2 -mr-2 hover:bg-white/10 rounded-full transition-colors flex items-center justify-center">
            <XCircle size={24} />
          </button>
        </div>
        
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {isEditingCustomer ? (
            <div className="bg-gray-50 rounded-2xl p-4 space-y-3 shadow-inner border border-gray-100">
               <div className="grid grid-cols-2 gap-3">
                 <div><label className="text-[10px] font-bold text-gray-400 uppercase">Nome</label><input type="text" value={editCustomerForm.firstName} onChange={e => setEditCustomerForm({...editCustomerForm, firstName: e.target.value})} className="w-full px-3 py-2 rounded-xl outline-none" /></div>
                 <div><label className="text-[10px] font-bold text-gray-400 uppercase">Cognome</label><input type="text" value={editCustomerForm.lastName} onChange={e => setEditCustomerForm({...editCustomerForm, lastName: e.target.value})} className="w-full px-3 py-2 rounded-xl outline-none" /></div>
               </div>
               <div><label className="text-[10px] font-bold text-gray-400 uppercase">Telefono</label><input type="tel" value={editCustomerForm.phone} onChange={e => setEditCustomerForm({...editCustomerForm, phone: e.target.value})} className="w-full px-3 py-2 rounded-xl outline-none" /></div>
               <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveCustomerEdits} disabled={savingCustomer} className="flex-1 py-2 bg-black text-white rounded-xl text-xs font-bold">{savingCustomer ? 'Salvataggio...' : <><Check size={14} className="inline mr-1" /> Salva</>}</button>
                 <button onClick={() => setIsEditingCustomer(false)} className="px-4 py-2 bg-gray-200 rounded-xl text-xs font-bold text-gray-700">Annulla</button>
               </div>
            </div>
          ) : (
            <div>
              <div className="flex justify-between items-start">
                <h2 className="text-2xl font-bold leading-tight">{getDisplayName(appointment)}</h2>
                <button onClick={startEditingCustomer} className="p-2 bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200 rounded-xl transition-all shrink-0"><Settings size={18}/></button>
              </div>
              <div className="relative mt-2">
                <button onClick={() => setShowContactMenu(!showContactMenu)} className="text-emerald-600 font-bold flex items-center gap-2 hover:bg-emerald-50 px-3 py-1.5 -ml-3 rounded-xl transition-all">
                  <Phone size={14} /> {customerPhone} <ChevronRight size={14} className={cn("transition-transform", showContactMenu && "rotate-90")} />
                </button>
                {showContactMenu && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
                    <a href={`tel:${customerPhone}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm font-bold text-gray-700"><Phone size={16} /> Chiama</a>
                    <a href={`https://wa.me/${(customerPhone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm font-bold text-emerald-600"><Send size={16} /> WhatsApp</a>
                    <a href={`mailto:${appointment.isForFriend ? appointment.friendDetails?.email : appointment.customer?.email}`} className="hidden sm:flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm font-bold text-blue-600"><Globe size={16} /> Invia Email</a>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-2xl"><div className="text-[10px] text-gray-400 font-bold uppercase">Data</div><div className="font-bold text-sm sm:text-base">{format(appointment.startTime.toDate(), 'd MMM yyyy', { locale: it })}</div></div>
            <div className="p-4 bg-gray-50 rounded-2xl"><div className="text-[10px] text-gray-400 font-bold uppercase">Orario</div><div className="font-bold text-sm sm:text-base">{format(appointment.startTime.toDate(), 'HH:mm')} - {format(appointment.endTime.toDate(), 'HH:mm')}</div></div>
          </div>

          {salonSettings?.hasMultiStaff && staffMembers.length > 0 && appointment.status === 'booked' && !isBefore(appointment.endTime.toDate(), currentTime) && (
            <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 relative">
              <label className="text-[10px] font-bold text-blue-800 uppercase tracking-widest mb-2 flex items-center gap-1"><Users size={12} /> Operatore Assegnato</label>
              <select value={appointment.staffId || ''} onChange={(e) => handleReassignStaff(e.target.value)} className="w-full p-3 bg-white border border-blue-200 rounded-xl text-sm font-bold text-blue-900 outline-none cursor-pointer">
                {!appointment.staffId && <option value="" disabled>Da Assegnare</option>}
                {staffMembers.map(staff => <option key={staff.uid} value={staff.uid}>{staff.displayName}</option>)}
              </select>
            </div>
          )}

          <div>
            <div className="text-[10px] text-gray-400 uppercase font-bold mb-2">Servizi Selezionati</div>
            <div className="flex flex-wrap gap-2">
              {appointment.services.map(s => <span key={s.id} className="px-3 py-1.5 bg-black text-white rounded-full text-xs font-bold flex items-center gap-1"><Scissors size={12}/> {s.name}</span>)}
            </div>
          </div>

          <div className="pt-6 pb-2 flex flex-col gap-3 border-t border-gray-100">
            <WhatsAppButton type="booking" customerName={getDisplayName(appointment)} customerPhone={customerPhone} date={format(appointment.startTime.toDate(), 'dd/MM/yyyy')} time={format(appointment.startTime.toDate(), 'HH:mm')} label="Avvisa su WhatsApp" tenantId={tenantId} className="w-full py-4 bg-[#25D366] text-white rounded-2xl font-bold flex justify-center gap-2 shadow-sm hover:shadow-md transition-all" />
            
            {appointment.status === 'booked' && !isBefore(appointment.startTime.toDate(), currentTime) && (
              <button onClick={() => onCancelRequest(appointment)} className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-colors">Annulla Appuntamento</button>
            )}
            
            {appointment.status === 'cancelled' && (
              <button disabled={isBefore(appointment.startTime.toDate(), currentTime)} onClick={() => onProposeShift(appointment)} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md">
                <ArrowUpCircle size={20} /> {isBefore(appointment.startTime.toDate(), currentTime) ? 'Orario Passato' : 'Proponi Cambio Orario'}
              </button>
            )}

            {/* 🚀 NUOVO PULSANTE CHIUDI IN BASSO */}
            <button onClick={onClose} className="w-full py-4 bg-gray-100 text-gray-700 rounded-2xl font-bold hover:bg-gray-200 transition-colors mt-2">
              Chiudi Finestra
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}