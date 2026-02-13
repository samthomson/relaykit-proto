import { createContext, useContext, useState, useCallback } from 'react';

const RefreshServicesContext = createContext<{ refreshTrigger: number; triggerRefresh: () => void } | null>(null);

export const RefreshServicesProvider = ({ children }: { children: React.ReactNode }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshTrigger((n) => n + 1), []);
  return (
    <RefreshServicesContext.Provider value={{ refreshTrigger, triggerRefresh }}>
      {children}
    </RefreshServicesContext.Provider>
  );
};

export const useRefreshServices = () => {
  const ctx = useContext(RefreshServicesContext);
  if (!ctx) throw new Error('useRefreshServices must be used within RefreshServicesProvider');
  return ctx;
};
