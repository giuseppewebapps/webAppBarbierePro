export const generateWhatsAppLink = (
  type: string,
  customerName: string,
  customerPhone: string,
  date: string,
  time: string
): string | null => {
  if (!customerPhone) return null;

  // Pulizia del numero: rimuove spazi, trattini e caratteri speciali
  const cleanPhone = customerPhone.replace(/\D/g, '');
  let message = '';

  switch (type) {
    case 'booking':
      message = `Ciao ${customerName}! Ti scrivo per confermarti il tuo appuntamento in salone per il ${date} alle ore ${time}. Ti aspetto!`;
      break;
    case 'cancellation':
      message = `Ciao ${customerName}, ho visto che hai annullato l'appuntamento del ${date} alle ${time}. Nessun problema, ci vediamo alla prossima!`;
      break;
    case 'proposal_accepted':
      message = `Ciao ${customerName}, perfetto! Ho visto che hai accettato l'anticipo. L'appuntamento è aggiornato per il ${date} alle ore ${time}. A presto!`;
      break;
    case 'proposal_declined':
      message = `Ciao ${customerName}, nessun problema per il cambio! Ti confermo che il tuo appuntamento rimane fissato per il ${date} alle ore ${time}. Ti aspetto!`;
      break;
    case 'manual_management_required':
      message = `Ciao ${customerName}, ti scrivo in merito al tuo appuntamento del ${date}. Ci sarebbe da fare una piccola modifica, sentiamoci appena puoi!`;
      break;
    case 'reschedule_proposal_sent':
      message = `Ciao ${customerName}! Si è liberato un posto alle ${time}. Ti ho inviato una proposta di cambio orario direttamente sulla tua app Medo Hair Salon. Controlla e fammi sapere se riesci ad anticipare! 💈`;
      break;
    default:
      return null;
  }

  // Genera l'URL sicuro e codificato
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
};