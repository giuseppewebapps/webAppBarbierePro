import { createContext, useContext } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { UserProfile } from '../types';

export interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  tenantId: string;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider'); 
  return context;
};