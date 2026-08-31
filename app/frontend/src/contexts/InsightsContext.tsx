import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { trpc } from '../trpc';
import { useAuth } from './AuthContext';
import type { ServerInsightsResponse } from '../../../shared/insights';

export type ServerInsights = ServerInsightsResponse;

const INSIGHTS_POLL_MS = 30000;

interface InsightsContextType {
  insights: ServerInsights | null;
  error: string | null;
}

const InsightsContext = createContext<InsightsContextType | null>(null);

export function InsightsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [insights, setInsights] = useState<ServerInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let mounted = true;

    const load = async () => {
      try {
        const next = await trpc.getServerInsights.query();
        if (!mounted) return;
        setInsights(next);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Could not load server insights');
      }
    };

    void load();
    const poll = window.setInterval(() => {
      void load();
    }, INSIGHTS_POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, [isAuthenticated]);

  return (
    <InsightsContext.Provider value={{ insights, error }}>
      {children}
    </InsightsContext.Provider>
  );
}

export function useInsights() {
  const context = useContext(InsightsContext);
  if (!context) {
    throw new Error('useInsights must be used within InsightsProvider');
  }
  return context;
}
