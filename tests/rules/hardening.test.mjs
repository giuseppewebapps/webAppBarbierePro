// Test delle regole Firestore sull Emulator. Avvio: tests/run-rules-tests.cmd
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, Timestamp,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-hardening';
const STAFF_A = 'staff-a-uid';
const STAFF_B = 'staff-b-uid';
const CUSTOMER = 'customer-uid';
const OTHER = 'other-uid';

const now = Timestamp.now();
const start = Timestamp.fromDate(new Date('2026-10-01T09:00:00Z'));
const end = Timestamp.fromDate(new Date('2026-10-01T09:30:00Z'));

function appointment(overrides) {
  return Object.assign({
    customerId: CUSTOMER,
    staffId: null,
    services: [],
    startTime: start,
    endTime: end,
    status: 'booked',
    totalAmount: 20,
    createdAt: now,
  }, overrides || {});
}

function notification(overrides) {
  return Object.assign({
    userId: STAFF_A,
    title: 'Nuova Prenotazione',
    message: 'test',
    type: 'booking',
    read: false,
    createdAt: now,
  }, overrides || {});
}

let testEnv;

before(async function () {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });

  await testEnv.withSecurityRulesDisabled(async function (ctx) {
    const db = ctx.firestore();
    await setDoc(doc(db, 'salons/tenantA/staff/' + STAFF_A), {
      uid: STAFF_A, displayName: 'Aldo', role: 'owner', active: true, order: 1, color: '#000000', assignedServices: ['taglio'],
    });
    await setDoc(doc(db, 'users/' + STAFF_A), { uid: STAFF_A, email: 'aldo@a.it', role: 'barber', displayName: 'Aldo' });
    await setDoc(doc(db, 'users/' + CUSTOMER), { uid: CUSTOMER, email: 'c@a.it', role: 'customer', displayName: 'Cliente', phoneNumber: '+393331112222' });
    await setDoc(doc(db, 'users/' + OTHER), { uid: OTHER, email: 'o@a.it', role: 'customer', displayName: 'Altro', phoneNumber: '+393334445555' });

    await setDoc(doc(db, 'salons/tenantA/appointments/appCur'), appointment({}));
    await setDoc(doc(db, 'salons/tenantA/appointments/appOther'), appointment({ customerId: OTHER }));
    await setDoc(doc(db, 'salons/tenantA/appointments/appCancelled'), appointment({ status: 'cancelled' }));

    await setDoc(doc(db, 'salons/tenantB/staff/' + STAFF_B), {
      uid: STAFF_B, displayName: 'Bepi', role: 'owner', active: true, order: 1, color: '#000000', assignedServices: ['taglio'],
    });
    await setDoc(doc(db, 'salons/tenantB/appointments/appB'), appointment({ customerId: OTHER }));
    await setDoc(doc(db, 'salons/tenantA/settings/public'), { name: 'Salone A', services: [], weeklySchedule: {} });
  });
});

after(async function () {
  await testEnv.cleanup();
});

// ---------------- users: niente enumerazione, niente escalazione ----------------
test('un utente autenticato NON puo elencare la collezione users', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(getDocs(collection(db, 'users')));
});

test('un utente autenticato puo leggere un singolo profilo (serve alla dashboard)', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(getDoc(doc(db, 'users', STAFF_A)));
});

test('un utente non puo cambiarsi il ruolo', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(updateDoc(doc(db, 'users', CUSTOMER), { role: 'barber' }));
});

test('un utente puo aggiornare i propri dati (telefono)', async function () {
  const db = testEnv.authenticatedContext(OTHER).firestore();
  await assertSucceeds(updateDoc(doc(db, 'users', OTHER), { phoneNumber: '+393336667777' }));
});

// ---------------- appointments: isolamento tenant e proprietario ----------------
test('il cliente puo prenotare anche in un altro salone: e il caso normale', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(setDoc(doc(db, 'salons/tenantB/appointments/legitBooking'), appointment({})));
});

test('il cliente NON puo creare un appuntamento con stato falsificato', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(setDoc(doc(db, 'salons/tenantB/appointments/hackStatus'), appointment({ status: 'completed' })));
});

test('il cliente NON puo prenotare a nome di un altro utente', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(setDoc(doc(db, 'salons/tenantA/appointments/hack2'), appointment({ customerId: OTHER })));
});

test('il cliente puo creare il proprio appuntamento', async function () {
  const db = testEnv.authenticatedContext(OTHER).firestore();
  await assertSucceeds(setDoc(doc(db, 'salons/tenantA/appointments/newOk'), appointment({ customerId: OTHER })));
});

test('il cliente NON puo assegnarsi uno staff di un altro salone', async function () {
  const db = testEnv.authenticatedContext(OTHER).firestore();
  await assertFails(setDoc(doc(db, 'salons/tenantA/appointments/hack3'), appointment({ customerId: OTHER, staffId: STAFF_B })));
});

test('il cliente NON puo modificare servizi o importo del proprio appuntamento', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(updateDoc(doc(db, 'salons/tenantA/appointments/appCur'), { totalAmount: 0 }));
});

test('il cliente puo cancellare il proprio appuntamento', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(updateDoc(doc(db, 'salons/tenantA/appointments/appCur'), { status: 'cancelled', cancelledAt: now, cancelledBy: 'customer' }));
});

test('il cliente NON puo cancellare l appuntamento di un altro', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(updateDoc(doc(db, 'salons/tenantA/appointments/appOther'), { status: 'cancelled' }));
});

test('il cliente NON puo eliminare un appuntamento attivo altrui', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(deleteDoc(doc(db, 'salons/tenantA/appointments/appOther')));
});

test('il cliente puo eliminare il proprio appuntamento cancellato (cleanup)', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(deleteDoc(doc(db, 'salons/tenantA/appointments/appCancelled')));
});

test('lo staff puo leggere e modificare qualsiasi appuntamento del proprio salone', async function () {
  const db = testEnv.authenticatedContext(STAFF_A).firestore();
  await assertSucceeds(getDoc(doc(db, 'salons/tenantA/appointments/appOther')));
  await assertSucceeds(updateDoc(doc(db, 'salons/tenantA/appointments/appOther'), { totalAmount: 25 }));
});

test('lo staff del salone A NON puo scrivere nel salone B', async function () {
  const db = testEnv.authenticatedContext(STAFF_A).firestore();
  await assertFails(updateDoc(doc(db, 'salons/tenantB/appointments/appB'), { totalAmount: 0 }));
  await assertFails(deleteDoc(doc(db, 'salons/tenantB/appointments/appB')));
});

test('auto-link: il cliente aggancia un appuntamento manuale col proprio telefono', async function () {
  const manual = appointment({ customerId: 'manual_entry', isManual: true, customer: { displayName: 'Cliente', phoneNumber: '+393331112222', email: 'c@a.it' } });
  const manualAltrui = appointment({ customerId: 'manual_entry', isManual: true, customer: { displayName: 'Altro', phoneNumber: '+393339999999', email: 'x@x.it' } });
  await testEnv.withSecurityRulesDisabled(async function (ctx) {
    await setDoc(doc(ctx.firestore(), 'salons/tenantA/appointments/manualLink'), manual);
    await setDoc(doc(ctx.firestore(), 'salons/tenantA/appointments/manualAltrui'), manualAltrui);
  });
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(updateDoc(doc(db, 'salons/tenantA/appointments/manualLink'), {
    customerId: CUSTOMER,
    customer: { displayName: 'Cliente', phoneNumber: '+393331112222', email: 'c@a.it' },
    isManual: false,
  }));
});

test('auto-link: il cliente NON puo agganciare l appuntamento manuale di un altro', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(updateDoc(doc(db, 'salons/tenantA/appointments/manualAltrui'), {
    customerId: CUSTOMER,
    customer: { displayName: 'Cliente', phoneNumber: '+393331112222', email: 'c@a.it' },
    isManual: false,
  }));
});

// ---------------- notifiche, proposte, log, settings ----------------
test('il cliente puo notificare lo staff del proprio salone', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(addDoc(collection(db, 'salons/tenantA/notifications'), notification({ userId: STAFF_A })));
});

test('il cliente NON puo notificare un utente qualsiasi (anti-spam)', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(addDoc(collection(db, 'salons/tenantA/notifications'), notification({ userId: 'utente-a-caso' })));
});

test('il cliente NON puo leggere le notifiche dello staff', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(getDoc(doc(db, 'salons/tenantA/notifications/nStaff')));
});

test('il cliente NON puo creare proposte di cambio orario', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(addDoc(collection(db, 'salons/tenantA/rescheduleProposals'), { status: 'active' }));
});

test('un log valido viene accettato ma non e leggibile dal client', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertSucceeds(addDoc(collection(db, 'system_logs'), { type: 'test_error', errorMessage: 'x' }));
  await assertFails(getDoc(doc(db, 'system_logs/none')));
});

test('un anonimo legge settings ma non scrive appuntamenti', async function () {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'salons/tenantA/settings/public')));
  await assertFails(setDoc(doc(db, 'salons/tenantA/appointments/anon1'), appointment({ customerId: 'x' })));
});

test('lo staff scrive le impostazioni del proprio salone', async function () {
  const db = testEnv.authenticatedContext(STAFF_A).firestore();
  await assertSucceeds(setDoc(doc(db, 'salons/tenantA/settings/public'), { name: 'Salone A mod' }, { merge: true }));
});

test('un cliente NON puo scrivere le impostazioni del salone', async function () {
  const db = testEnv.authenticatedContext(CUSTOMER).firestore();
  await assertFails(setDoc(doc(db, 'salons/tenantA/settings/public'), { name: 'hack' }, { merge: true }));
});