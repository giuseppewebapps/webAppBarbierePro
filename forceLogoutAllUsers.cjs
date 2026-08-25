// forceLogoutAllUsers.cjs
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const readline = require('readline');

// Assicurati che il percorso del file serviceAccountKey.json sia corretto
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const auth = getAuth();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function forceLogoutAll() {
  console.log("\n==================================================");
  console.log("⚠️  MASS LOGOUT: REVOCA DI TUTTE LE SESSIONI  ⚠️");
  console.log("==================================================\n");
  console.log("Questo script revocherà i Refresh Token di TUTTI gli utenti registrati.");
  console.log("Di conseguenza, chiunque abbia l'app aperta verrà disconnesso alla");
  console.log("prossima richiesta di rete o al ricaricamento della pagina.\n");

  const confirm = await askQuestion("Sei ASSOLUTAMENTE sicuro di voler disconnettere tutti gli utenti? (scrivi 'SI' per procedere): ");

  if (confirm !== 'SI') {
    console.log("\n🛑 Operazione annullata.");
    process.exit(0);
  }

  console.log("\n🚀 Inizio revoca delle sessioni...\n");

  let nextPageToken;
  let totalUsers = 0;
  let revokedUsers = 0;

  try {
    // Cicliamo tutti gli utenti a blocchi di 1000
    do {
      const listUsersResult = await auth.listUsers(1000, nextPageToken);
      const users = listUsersResult.users;
      totalUsers += users.length;

      // Revoca il token per ogni utente nel blocco
      const revokePromises = users.map(async (userRecord) => {
        try {
          await auth.revokeRefreshTokens(userRecord.uid);
          revokedUsers++;
        } catch (error) {
          console.error(`❌ Errore durante la revoca per UID ${userRecord.uid}:`, error.message);
        }
      });

      // Attendiamo che il blocco corrente finisca
      await Promise.all(revokePromises);
      
      console.log(`⏳ Elaborati ${revokedUsers} utenti...`);

      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    console.log("\n==================================================");
    console.log(`✅ MASS LOGOUT COMPLETATO CON SUCCESSO!`);
    console.log(`   └ Utenti totali analizzati: ${totalUsers}`);
    console.log(`   └ Sessioni invalidate: ${revokedUsers}`);
    console.log("==================================================\n");

  } catch (error) {
    console.error("\n❌ Errore critico durante l'esecuzione:", error);
  } finally {
    rl.close();
    process.exit(0);
  }
}

forceLogoutAll();