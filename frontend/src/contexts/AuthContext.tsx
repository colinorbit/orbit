import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { api, setTokens, clearTokens, getAccessToken } from '@/api/client';
import type { User, AuthTokens } from '@/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });

  // On mount: if we have a token, fetch the current user to hydrate state
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setState({ user: null, isLoading: false });
      return;
    }

    api.get<{ data: User }>('/auth/me')
      .then((res) => setState({ user: res.data, isLoading: false }))
      .catch(() => {
        clearTokens();
        setState({ user: null, isLoading: false });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.postPublic<{ data: AuthTokens }>('/auth/login', { email, password });
    setTokens(res.data.accessToken, res.data.refreshToken);
    setState({ user: res.data.user, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best effort — clear local state regardless
    }
    clearTokens();
    setState({ user: null, isLoading: false });
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        isAuthenticated: !!state.user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
