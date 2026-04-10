import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc,
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
import { BARBER_EMAILS } from './constants';
import BarberDashboard from './components/BarberDashboard';
import CustomerBooking from './components/CustomerBooking';
import { LogOut, Scissors, Plus, Clock as ClockIcon } from 'lucide-react';
import NotificationBell from './components/NotificationBell';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider'); // CORRETTO
  return context;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { // CORRETTO
      setNotifications([]);
      return; // CORRETTO
    }

    const q = query(
      collection(db, 'notifications'),
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
  }, [user]);

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
        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
        } else {
          // Create new profile
         const role: UserRole = BARBER_EMAILS.includes(firebaseUser.email || '') ? 'barber' : 'customer';
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'Utente',
            role: role,
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  // qui per cambiare la gestione account customer
  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout }}>
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
            <div className="bg-white/80 backdrop-blur-md p-12 rounded-[40px] border border-white/20 shadow-2xl text-center max-w-md w-full">
              <div className="mb-8">
                <div className="w-20 h-20 bg-black text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                  <Scissors size={40} />
                </div>
                <h1 className="text-4xl font-bold tracking-tight text-black">Barberia Pro</h1>
                <p className="text-gray-600 mt-2 font-medium">Prenota il tuo stile in pochi click</p>
              </div>
              <button
                onClick={login}
                className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all flex items-center justify-center gap-3 shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                Accedi con Google
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-screen">
            {/* Global Header */}
            <header className="bg-black/80 backdrop-blur-md text-white sticky top-0 z-[100] shadow-xl border-b border-white/10">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                    <Scissors size={24} className="text-white" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold tracking-tight">Barberia Pro</h1>
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
                  <BarberDashboard selectedAppointmentId={selectedAppointmentId} onAppointmentDialogClose={() => setSelectedAppointmentId(null)} />
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
      </div>
    </AuthContext.Provider>
  );
}
