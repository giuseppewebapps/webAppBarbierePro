import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc,
  updateDoc,
  Timestamp,
  getDocFromServer,
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot 
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, UserRole, Notification as AppNotification } from './types';
import { COUNTRY_CODES } from './constants';
import BarberDashboard from './components/BarberDashboard';
import CustomerBooking from './components/CustomerBooking';
import { LogOut, Scissors, Plus, Clock as ClockIcon, Phone } from 'lucide-react';
import NotificationBell from './components/NotificationBell';
import { autoLinkAppointments } from './utils/appointmentLinker';
import { logSystemError } from './utils/logger';
import { getTenantId } from './utils/tenantResolver';
import { AuthContext } from './context/AuthContext';
import { useSalonSettings } from './hooks/useSalonSettings';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [selectedNotificationType, setSelectedNotificationType] = useState<string | null>(null);
  
  const tenantId = getTenantId();
  
  // 🚀 Estratto il caricamento delle impostazioni per sincronizzare l'avvio
  const { settings: salonSettings, loading: settingsLoading } = useSalonSettings(tenantId);

  useEffect(() => {
    if (salonSettings?.name) {
      document.title = salonSettings.name;
    }
  }, [salonSettings]);

  // 🚀 Usa il nome dal database (Single Source of Truth), con fallback sull'URL
  const salonName = salonSettings?.name || tenantId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authError, setAuthError] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  const [showPhoneModal, setShowMandatoryPhoneModal] = useState(false);
  const [tempPhone, setTempPhone] = useState('');
  const [phonePrefix, setTempPhonePrefix] = useState('+39');
  const [savingPhone, setSavingPhone] = useState(false);

  const handlePasswordReset = async () => {
    setAuthError('');
    setResetMessage('');
    if (!email) {
      setAuthError('Inserisci la tua email nel campo qui sopra per recuperare la password.');
      return;
    }
    try {
      auth.languageCode = 'it';
      await sendPasswordResetEmail(auth, email);
      setResetMessage('Ti abbiamo inviato un\'email con le istruzioni per ripristinare la password.');
    } catch (error: any) {
      console.error('Password reset error:', error);
      if (error.code === 'auth/invalid-email') setAuthError('Formato email non valido.');
      else if (error.code === 'auth/user-not-found') setAuthError('Nessun account nativo trovato con questa email.');
      else setAuthError("Errore durante l'invio dell'email di recupero. Riprova.");
    }
  };

  useEffect(() => {
    if (!user?.uid || !tenantId) { 
      setNotifications([]);
      return; 
    }

    const q = query(
      collection(db, 'salons', tenantId, 'notifications'),
      where('userId', '==', user.uid),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AppNotification[];
      setNotifications(docs);
    });

    return () => unsubscribe();
  }, [user, tenantId]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), async (docSnap) => {
      if (docSnap.exists()) {
        const userData = docSnap.data() as UserProfile;
        const staffDoc = await getDoc(doc(db, 'salons', tenantId, 'staff', user.uid));
        userData.role = staffDoc.exists() ? 'barber' : 'customer';
        setProfile(userData);
      }
    });
    return () => unsubscribe();
  }, [user, tenantId]);

  useEffect(() => {
    if (user && profile) {
      const phone = typeof profile.phoneNumber === 'string' ? profile.phoneNumber.trim() : '';
      const isDummyNumber = phone === '+390000000000' || phone === '+390000000001' || phone === '+39' || phone.length < 13 || phone.length > 13 || phone.startsWith('+39') === false;

      if (!phone || phone === 'undefined' || phone === 'null' || phone.length < 8 || isDummyNumber) {
        setShowMandatoryPhoneModal(true);
      } else {
        setShowMandatoryPhoneModal(false);
      }
    }
  }, [user, profile]);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        let currentProfile: UserProfile;

        const staffDoc = await getDoc(doc(db, 'salons', tenantId, 'staff', firebaseUser.uid));
        const dynamicRole: UserRole = staffDoc.exists() ? 'barber' : 'customer';

        if (!userDoc.exists()) {
          currentProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'Utente',
            role: dynamicRole,
            phoneNumber: firebaseUser.phoneNumber || '' 
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), currentProfile);
        } else {
          currentProfile = userDoc.data() as UserProfile;
          currentProfile.role = dynamicRole;
        }

        if (currentProfile.role === 'customer') {
          autoLinkAppointments(currentProfile, tenantId).catch(async (err) => {
            console.error("Errore durante l'autoLink:", err);
            await logSystemError({
              type: 'login_autolink_failure',
              userId: currentProfile.uid,
              userName: currentProfile.displayName,
              tenantId,
              error: err
            });
          });
        }
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        if (name.trim() !== '') {
          await updateProfile(userCredential.user, { displayName: name });
        }
        
        await setDoc(doc(db, 'users', userCredential.user.uid), { 
          uid: userCredential.user.uid,
          email: email,
          role: 'customer',
          displayName: name.trim() !== '' ? name : 'Nuovo Cliente',
          phoneNumber: phoneNumber.trim() !== '' ? phoneNumber : ''
        }, { merge: true });
        
        setProfile(prev => prev ? { ...prev, displayName: name, phoneNumber: phoneNumber } : null);
      }
    } catch (error: unknown) {
      console.error('Auth error:', error);
      const err = error as { code?: string };
      if (err.code === 'auth/invalid-email') setAuthError('Formato email non valido.');
      else if (err.code === 'auth/invalid-credential') setAuthError('Email o password errati.');
      else if (err.code === 'auth/email-already-in-use') setAuthError('Questa email è già registrata.');
      else if (err.code === 'auth/weak-password') setAuthError('La password deve avere almeno 6 caratteri.');
      else setAuthError("Si è verificato un errore. Riprova.");
    }
  };

  const handleSaveMandatoryPhone = async () => {
    const cleanPhone = tempPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      alert("Inserisci un numero di telefono valido (minimo 10 cifre).");
      return;
    }

    if (!user) return;
    setSavingPhone(true);

    try {
      const fullPhone = phonePrefix + cleanPhone;
      
      await updateDoc(doc(db, 'users', user.uid), {
        phoneNumber: fullPhone,
        updatedAt: Timestamp.now()
      });

      await autoLinkAppointments({
        uid: user.uid,
        displayName: profile?.displayName || 'Cliente',
        email: user.email || '',
        phoneNumber: fullPhone
      }, tenantId);

      alert("Numero di telefono salvato con successo!");
      setShowMandatoryPhoneModal(false);
      window.location.reload();
    } catch (err) {
      console.error("Errore durante il salvataggio del telefono:", err);
      alert("Si è verificato un errore durante il salvataggio.");
    } finally {
      setSavingPhone(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // 🚀 L'app ora aspetta SIA l'autenticazione SIA il database SaaS prima di mostrare UI
  if (authLoading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, profile, tenantId, loading: authLoading, login, logout }}>
      <div className="min-h-screen text-black font-sans relative">
        <div 
          className="fixed inset-0 z-0 opacity-80"
          style={{
            backgroundImage: 'url("https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2074&auto=format&fit=crop")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed'
          }}
        />
        <div className="fixed inset-0 z-0 bg-white/60 backdrop-blur-md" />
        
        <div className="relative z-10">
          {!user ? (
            <div className="flex flex-col items-center justify-center min-h-screen p-4">
              <div className="bg-white/90 backdrop-blur-md p-8 sm:p-12 rounded-[40px] border border-white/20 shadow-2xl w-full max-w-md">
                <div className="mb-8 text-center">
                  <div className="w-20 h-20 bg-black text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg overflow-hidden">
                    {salonSettings?.logoUrl ? (
                      <img
                        src={salonSettings.logoUrl}
                        alt={salonSettings.name || 'Logo Salone'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Scissors size={40} />
                    )}
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight text-black">{salonName}</h1>
                  <p className="text-gray-600 mt-2 text-sm font-medium">Accedi o registrati per prenotare</p>
                </div>

                {authError && (
                  <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-xl text-sm text-center font-medium">
                    {authError}
                  </div>
                )}
                {resetMessage && (
                  <div className="mb-4 p-3 bg-emerald-100 text-emerald-700 rounded-xl text-sm text-center font-medium">
                    {resetMessage}
                  </div>
                )}

                <form onSubmit={handleEmailAuth} className="flex flex-col gap-4 mb-6">
                  {!isLoginMode && (
                    <>
                      <input
                        type="text"
                        placeholder="Nome e Cognome (es. Mario Rossi)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:border-black transition-colors"
                        required
                      />
                      <input
                        type="tel"
                        placeholder="Numero di cellulare (es. 3331234567)"
                        value={phoneNumber}
                        onChange={(e) => {
                          const onlyNums = e.target.value.replace(/[^0-9]/g, '');
                          setPhoneNumber(onlyNums.slice(0, 10));
                        }}
                        maxLength={10}
                        pattern="[0-9]{9,10}"
                        title="Inserisci un numero di cellulare valido (9 o 10 cifre)"
                        className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:border-black transition-colors"
                        required
                      />
                    </>
                  )}
                  <input
                    type="email"
                    placeholder="La tua email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:border-black transition-colors"
                    required
                  />
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-4 rounded-2xl border border-gray-200 focus:outline-none focus:border-black transition-colors"
                    required
                  />
                  {isLoginMode && (
                    <div className="flex justify-end -mt-2">
                      <button
                        type="button"
                        onClick={handlePasswordReset}
                        className="text-xs text-gray-500 hover:text-black font-medium transition-colors"
                      >
                        Hai dimenticato la password?
                      </button>
                    </div>
                  )}
                  <button
                    type="submit"
                    className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {isLoginMode ? 'Accedi' : 'Registrati'}
                  </button>
                </form>

                <div className="text-center mb-6">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLoginMode(!isLoginMode);
                      setAuthError('');
                    }}
                    className="text-sm text-gray-500 hover:text-black font-medium transition-colors"
                  >
                    {isLoginMode ? 'Non hai un account? Registrati qui' : 'Hai già un account? Accedi qui'}
                  </button>
                </div>

                <div className="flex items-center gap-4 mb-6">
                  <div className="h-px bg-gray-200 flex-1"></div>
                  <span className="text-xs text-gray-400 font-bold tracking-wider">OPPURE</span>
                  <div className="h-px bg-gray-200 flex-1"></div>
                </div>

                <button
                  onClick={login}
                  className="w-full py-4 bg-white border border-gray-200 text-black rounded-2xl font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-3 shadow-sm hover:scale-[1.02] active:scale-[0.98]"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                  Continua con Google
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-screen">
              <header className="bg-black/80 backdrop-blur-md text-white sticky top-0 z-[100] shadow-xl border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center overflow-hidden">
                        {salonSettings?.logoUrl ? (
                          <img
                            src={salonSettings.logoUrl}
                            alt={salonSettings.name || 'Logo Salone'}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Scissors size={24} className="text-white" />
                        )}
                      </div>
                    <div>
                      <h1 className="text-lg font-bold tracking-tight">{salonName}</h1>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest">
                        {profile?.role === 'barber' ? 'Calendario Appuntamenti' : `Ciao, ${profile?.displayName}`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {profile?.role === 'barber' && (
                      <>
                        <div className="relative group">
                          <button
                            onClick={() => window.dispatchEvent(new CustomEvent('open-manual-booking'))}
                            className="p-2 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
                          >
                            <Plus size={20} />
                          </button>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-white text-black text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-xl border border-gray-100">
                            Inserimento manuale
                          </div>
                        </div>

                        <div className="relative group">
                          <button
                            onClick={() => window.dispatchEvent(new CustomEvent('open-schedule-maintenance'))}
                            className="p-2 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
                          >
                            <ClockIcon size={20} />
                          </button>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-white text-black text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-xl border border-gray-100">
                            Manutenzione orari
                          </div>
                        </div>
                      </>
                    )}

                    <div className="relative group">
                      <NotificationBell 
                        notifications={notifications} 
                        onNotificationClick={(n) => {
                          if (n.type === 'reschedule_proposal' && n.proposalId) {
                            setSelectedProposalId(n.proposalId);
                          } else if (n.appointmentId) {
                            setSelectedAppointmentId(n.appointmentId);
                            setSelectedNotificationType(n.type);
                          }
                        }}
                      />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-white text-black text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-xl border border-gray-100">
                        Notifiche
                      </div>
                    </div>
                    
                    <div className="h-8 w-px bg-white/10 mx-2" />
                    <button
                      onClick={logout}
                      className="p-2 text-gray-400 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium"
                      title="Logout"
                    >
                      <LogOut size={20} />
                      <span className="hidden sm:inline">Esci</span>
                    </button>
                  </div>
                </div>
              </header>

              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <main>
                  {profile?.role === 'barber' ? (
                    <BarberDashboard 
                      selectedAppointmentId={selectedAppointmentId} 
                      selectedNotificationType={selectedNotificationType}
                      onAppointmentDialogClose={() => {
                        setSelectedAppointmentId(null);
                        setSelectedNotificationType(null);
                      }} 
                    />
                  ) : (
                    <CustomerBooking 
                      selectedProposalIdFromNotification={selectedProposalId} 
                      onProposalDialogClose={() => setSelectedProposalId(null)} 
                      selectedAppointmentId={selectedAppointmentId}
                      onAppointmentDialogClose={() => setSelectedAppointmentId(null)}
                    />
                  )}
                </main>
              </div>
            </div>
          )}
        </div>

        {showPhoneModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
            <div className="bg-white rounded-[32px] w-full max-w-md p-8 shadow-2xl border border-gray-100 text-center animate-in zoom-in duration-200">
              <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Phone size={32} />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Numero di Telefono Richiesto</h3>
              <p className="text-gray-500 text-sm mb-6 leading-relaxed">
                Serve il tuo numero di telefono per permettere al barbiere di contattarti e confermare i tuoi appuntamenti.
              </p>
              <div className="space-y-4 text-left mb-8">
                <label className="text-xs font-bold text-gray-700 ml-1">Cellulare *</label>
                <div className="flex gap-2">
                  <div className="relative w-24">
                    <select
                      value={phonePrefix}
                      onChange={(e) => setTempPhonePrefix(e.target.value)}
                      className="w-full pl-2 pr-2 py-3 bg-gray-50 border border-gray-200 rounded-2xl font-bold text-sm appearance-none outline-none focus:border-black"
                    >
                      {COUNTRY_CODES.map(c => (
                        <option key={c.code} value={c.dial_code}>{c.flag} {c.dial_code}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="tel"
                    value={tempPhone}
                    onChange={(e) => setTempPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="Min. 10 cifre"
                    className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl font-bold text-sm outline-none focus:border-black transition-all"
                  />
                </div>
              </div>
              <button
                disabled={savingPhone || tempPhone.length < 10}
                onClick={handleSaveMandatoryPhone}
                className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xl"
              >
                {savingPhone ? 'Salvataggio...' : 'Conferma e Salva'}
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthContext.Provider>
  );
}