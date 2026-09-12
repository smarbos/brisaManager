import { createContext, useContext, useState, ReactNode } from 'react';
import { login as loginRequest } from '../api/client';

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem('accessToken')));

  async function login(email: string, password: string) {
    const { accessToken } = await loginRequest(email, password);
    localStorage.setItem('accessToken', accessToken);
    setIsAuthenticated(true);
  }

  function logout() {
    localStorage.removeItem('accessToken');
    setIsAuthenticated(false);
  }

  return <AuthContext.Provider value={{ isAuthenticated, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
