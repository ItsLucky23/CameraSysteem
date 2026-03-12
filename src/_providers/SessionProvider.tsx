/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createContext, use, useState, ReactNode, useEffect, useMemo } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { socket, useSocket } from 'src/_sockets/socketInitializer';

import { dev, pageTitle, SessionLayout } from '../../config';

interface UserContextType {
  session: SessionLayout | null;
  sessionLoaded: boolean;
}

let latestSession: SessionLayout | null = null;

const UserContext = createContext<UserContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionLayout | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useSocket(session); //? starts the socket connection

  useEffect(() => {
    latestSession = session;
  }, [session])

  useEffect(() => {
    if (dev && session?.email) {
      document.title = `[DEV] ${session.email} - ${pageTitle}`;
      return;
    }

    document.title = dev ? `[DEV] ${pageTitle}` : pageTitle;
  }, [session?.email]);

  useEffect(() => {
    void (async () => {
      const response = await apiRequest({ name: 'session', version: 'v1' });
      if (!response.result) { return }
      setSession(response.result);
      setSessionLoaded(true);
    })()
  }, [])

  useEffect(() => {
    if (!socket) return;

    const handler = (data: string) => {
      if (dev) { console.log('updateSession', JSON.parse(data)); }
      const parsed = JSON.parse(data) as SessionLayout;
      setSession(prev => {
        if (!prev) return parsed;
        return {
          ...prev,
          ...parsed,
          avatar: `${parsed.avatar}?v=${String(Date.now())}`
        };
      });
    }

    socket.on('updateSession', handler)

    return () => {
      if (!socket) return;
      socket.off('updateSession', handler);
    }
    
  }, [])

  const contextValue = useMemo(() => ({
    session, sessionLoaded
  }), [session, sessionLoaded]);

  return (
    <UserContext value={contextValue}>
      {children}
    </UserContext>
  );
}

// 5. Create a custom hook for easier usage
export function useSession() {
  const context = use(UserContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}

export function getCurrentSession() {
  return latestSession;
}