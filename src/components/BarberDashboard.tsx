import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSalonSettings } from '../hooks/useSalonSettings';
import MonoBarberDashboard from './MonoBarberDashboard';
import MultiBarberDashboard from './MultiBarberDashboard';
import ManualBookingModal from './ManualBookingModal';
import ScheduleMaintenanceModal from './ScheduleMaintenanceModal';

interface BarberDashboardProps {
  selectedAppointmentId?: string | null;
  selectedNotificationType?: string | null;
  onAppointmentDialogClose?: () => void;
}

export default function BarberDashboard(props: BarberDashboardProps) {
  const { tenantId } = useAuth();
  const { settings: salonSettings, loading } = useSalonSettings(tenantId);
  
  // 🚀 STATO GLOBALE DEI MODALI DI SERVIZIO
  const [isManualBookingOpen, setIsManualBookingOpen] = useState(false);
  const [isScheduleMaintenanceOpen, setIsScheduleMaintenanceOpen] = useState(false);

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

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  return (
    <>
      {/* 🚀 ROUTER DINAMICO */}
      {salonSettings?.hasMultiStaff ? (
        <MultiBarberDashboard {...props} />
      ) : (
        <MonoBarberDashboard {...props} />
      )}

      {/* 🚀 MODALI GLOBALI RENDERIZZATI QUI IN MODO SICURO */}
      {isManualBookingOpen && (
        <ManualBookingModal 
          onClose={() => setIsManualBookingOpen(false)} 
          onSuccess={() => setIsManualBookingOpen(false)}
        />
      )}

      {isScheduleMaintenanceOpen && (
        <ScheduleMaintenanceModal 
          onClose={() => setIsScheduleMaintenanceOpen(false)} 
        />
      )}
    </>
  );
}