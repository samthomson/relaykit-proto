import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { trpc } from '../trpc';

type DokployStatus = { hasApiKey?: boolean; error?: string } | null;

const DokployContext = createContext<{
  dokployStatus: DokployStatus;
  loading: boolean;
  checkDokploy: () => Promise<void>;
} | null>(null);

export const DokployProvider = ({ children }: { children: React.ReactNode }) => {
  const [dokployStatus, setDokployStatus] = useState<DokployStatus>(null);
  const [loading, setLoading] = useState(false);

  const checkDokploy = useCallback(async () => {
    setLoading(true);
    try {
      const result = await trpc.checkDokploy.query(undefined);
      setDokployStatus(result);
    } catch (error: any) {
      console.error('Error checking Dokploy:', error);
      setDokployStatus({ error: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkDokploy();
  }, [checkDokploy]);

  return (
    <DokployContext.Provider value={{ dokployStatus, loading, checkDokploy }}>
      {children}
    </DokployContext.Provider>
  );
};

export const useDokploy = () => {
  const ctx = useContext(DokployContext);
  if (!ctx) throw new Error('useDokploy must be used within DokployProvider');
  return ctx;
};
