import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

// Su Vercel dovrai impostare RESEND_API_KEY
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Consenti solo richieste POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }

  const { type, customerName, date, time, services, proposalDetails, targetEmail } = req.body;

  if (!targetEmail) {
    return res.status(400).json({ error: 'Indirizzo email di destinazione mancante' });
  }

  let subject = '';
  let badgeColor = '#000000';
  let badgeText = '';
  let contentHtml = '';

  // 1. NUOVA PRENOTAZIONE
  if (type === 'new_booking') {
    subject = `💈 NUOVA PRENOTAZIONE: ${customerName}`;
    badgeColor = '#10B981'; // Verde
    badgeText = 'NUOVA PRENOTAZIONE';
    contentHtml = `
      <p style="margin: 5px 0;"><strong>Cliente:</strong> ${customerName}</p>
      <p style="margin: 5px 0;"><strong>Data:</strong> ${date}</p>
      <p style="margin: 5px 0;"><strong>Orario:</strong> ${time}</p>
      <p style="margin: 5px 0;"><strong>Servizi:</strong> ${services}</p>
    `;
  } 
  // 2. ANNULLAMENTO
  else if (type === 'cancellation') {
    subject = `❌ CANCELLAZIONE: ${customerName}`;
    badgeColor = '#EF4444'; // Rosso
    badgeText = 'APPUNTAMENTO ANNULLATO';
    contentHtml = `
      <p style="margin: 5px 0;"><strong>Cliente:</strong> ${customerName}</p>
      <p style="margin: 5px 0;"><strong>Data Annullata:</strong> ${date}</p>
      <p style="margin: 5px 0;"><strong>Orario:</strong> ${time}</p>
      <p style="margin: 5px 0;"><strong>Servizi persi:</strong> ${services}</p>
      <p style="margin-top: 15px; font-style: italic; color: #6b7280;">Si è liberato un buco in agenda!</p>
    `;
  } 
  // 3A. PROPOSTA ACCETTATA
  else if (type === 'proposal_accepted') {
    subject = `✅ CAMBIO ORARIO ACCETTATO: ${customerName}`;
    badgeColor = '#25D366'; // Verde WhatsApp
    badgeText = 'PROPOSTA ACCETTATA';
    contentHtml = `
      <p style="margin: 5px 0;"><strong>Cliente:</strong> ${customerName}</p>
      <div style="background-color: #f3f4f6; padding: 12px; border-radius: 8px; margin: 10px 0;">
        <p style="margin: 3px 0; color: #ef4444; text-decoration: line-through;"><strong>Vecchio Orario:</strong> ${proposalDetails?.oldDate || date} ore ${proposalDetails?.oldTime || '--:--'}</p>
        <p style="margin: 3px 0; color: #10b981; font-weight: bold;"><strong>Nuovo Orario:</strong> ${date} ore ${time}</p>
      </div>
    `;
  } 
  // 3B. PROPOSTA RIFIUTATA / SCADUTA
  else if (type === 'proposal_declined') {
    subject = `⚠️ PROPOSTA IGNORATA/RIFIUTATA: ${customerName}`;
    badgeColor = '#F59E0B'; // Arancione
    badgeText = 'PROPOSTA RIFIUTATA';
    contentHtml = `
      <p style="margin: 5px 0;"><strong>Cliente:</strong> ${customerName}</p>
      <p style="margin: 5px 0;"><strong>L'utente ha rifiutato il cambio alle ore:</strong> ${proposalDetails?.proposedTime || time}</p>
      <p style="margin: 5px 0; color: #10b981; font-weight: bold;"><strong>Mantiene il suo orario originale:</strong> ${date} ore ${proposalDetails?.oldTime || time}</p>
    `;
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
      <div style="max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
        <div style="background-color: #000000; color: #ffffff; padding: 25px 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; letter-spacing: 2px; text-transform: uppercase;">Notifiche App</h1>
        </div>
        <div style="padding: 25px;">
          <span style="display: inline-block; background-color: ${badgeColor}; color: #ffffff; font-size: 10px; font-weight: bold; padding: 4px 10px; border-radius: 12px; margin-bottom: 15px; text-transform: uppercase;">
            ${badgeText}
          </span>
          <div style="font-size: 14px; line-height: 1.6; color: #18181b;">
            ${contentHtml}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const data = await resend.emails.send({
      from: 'Notifiche Salone <onboarding@resend.dev>', // Indirizzo free di Resend
      to: [targetEmail],
      subject,
      html: emailHtml,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Errore invio email:", error);
    return res.status(500).json({ error: (error as Error).message });
  }
}