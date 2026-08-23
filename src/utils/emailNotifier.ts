import { SYSTEM_NOTIFICATION_EMAIL } from '../constants';

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
}

export async function notifySystemByEmail(params: SendEmailParams) {
  try {
    // Fire and forget, per non rallentare l'app al cliente!
    fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...params,
        targetEmail: SYSTEM_NOTIFICATION_EMAIL // Pescato dalle constants!
      }),
    }).catch(err => console.error("Errore fetch invio mail:", err));
  } catch (error) {
    console.error("Errore emailNotifier:", error);
  }
}