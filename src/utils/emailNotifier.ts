export type EmailNotificationType = 'new_booking' | 'cancellation' | 'proposal_accepted' | 'proposal_declined';

interface SendEmailParams {
  type: EmailNotificationType;
  customerName: string;
  date: string;
  time: string;
  services?: string;
  proposalDetails?: {
    oldDate?: string;
    oldTime?: string;
    proposedTime?: string;
  };
  tenantId: string; // 🚀 Obbligatorio: identifica il salone
  targetEmail?: string; // 🚀 Opzionale: l'email del proprietario del salone corrente
}

export async function notifySystemByEmail(params: SendEmailParams) {
  try {
    // Fire and forget, per non rallentare l'app al cliente
    fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // 🚀 Passiamo l'intero oggetto params, che ora include tenantId
      body: JSON.stringify(params), 
    }).catch(err => console.error("Errore fetch invio mail:", err));
  } catch (error) {
    console.error("Errore emailNotifier:", error);
  }
}