import React from 'react';
import { MessageCircle } from 'lucide-react';
import { generateWhatsAppLink } from '../utils/whatsapp';
import { useAuth } from '../context/AuthContext'; // 🚀 Importiamo il contesto SaaS

interface WhatsAppButtonProps {
  type: string;
  customerName: string;
  customerPhone?: string;
  date: string;
  time: string;
  label?: string; // 🚀 Aggiunto per supportare testi dinamici ("Conferma su WhatsApp", ecc.)
  className?: string; 
}

export const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({
  type,
  customerName,
  customerPhone,
  date,
  time,
  label = "Avvisa su WhatsApp",
  className = "w-full py-4 bg-[#25D366] text-white rounded-2xl font-bold hover:bg-[#20bd5a] transition-all flex items-center justify-center gap-2"
}) => {
  // 🚀 Estraiamo il tenant corrente
  const { tenantId } = useAuth();

  // Se manca il telefono o il tenant non è ancora caricato, non renderizziamo
  if (!customerPhone || !tenantId) return null;

  // 🚀 Passiamo il tenantId al motore che genera il testo, così saprà quale nome salone usare
  const link = generateWhatsAppLink(type, customerName, customerPhone, date, time, tenantId);

  if (!link) return null;

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <MessageCircle size={20} /> {label}
    </a>
  );
};