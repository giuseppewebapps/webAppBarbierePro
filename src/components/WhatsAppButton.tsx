import React from 'react';
import { MessageCircle } from 'lucide-react';
import { generateWhatsAppLink } from '../utils/whatsapp';

interface WhatsAppButtonProps {
  type: string;
  customerName: string;
  customerPhone?: string;
  date: string;
  time: string;
  className?: string; // Per permetterti di personalizzare i colori in base al popup
}

export const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({
  type,
  customerName,
  customerPhone,
  date,
  time,
  className = "w-full py-4 bg-[#25D366] text-white rounded-2xl font-bold hover:bg-[#20bd5a] transition-all flex items-center justify-center gap-2"
}) => {
  // Se non c'è il numero, il bottone non viene proprio renderizzato (niente errori in UI)
  if (!customerPhone) return null;

  const link = generateWhatsAppLink(type, customerName, customerPhone, date, time);

  if (!link) return null;

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <MessageCircle size={20} /> Avvisa su WhatsApp
    </a>
  );
};