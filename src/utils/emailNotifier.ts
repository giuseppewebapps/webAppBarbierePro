import { logSystemError } from './logger';

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
  tenantId: string;
  targetEmail?: string;
}

/**
 * Invio email di notifica al salone.
 *
 * Prima era completamente muto: la fetch non veniva attesa e la risposta non era
 * controllata, quindi un errore della function (sandbox Resend, quota, 500) non
 * lasciava NESSUNA traccia, ne lato utente ne nei log applicativi.
 *
 * Ora:
 *  - la risposta viene controllata (response.ok)
 *  - gli errori finiscono in system_logs, cosi sono visibili e contabili
 *  - keepalive tiene viva la richiesta se il cliente chiude subito la pagina/app
 *    dopo aver prenotato (causa nota di email mai inviate)
 */
export async function notifySystemByEmail(params: SendEmailParams) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      keepalive: true,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // corpo non leggibile: ci basta lo status HTTP
      }
      console.error('[EMAIL] Invio non riuscito, HTTP ' + response.status, detail);
      await logSystemError({
        type: 'email_send_failure',
        tenantId: params.tenantId,
        error: new Error('HTTP ' + response.status + ', notifica ' + params.type + ', ' + detail),
      });
    }
  } catch (error) {
    console.error('Errore emailNotifier:', error);
    await logSystemError({
      type: 'email_send_failure',
      tenantId: params.tenantId,
      error,
    });
  }
}