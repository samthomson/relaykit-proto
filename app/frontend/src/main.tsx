import React from 'react';
import ReactDOM from 'react-dom/client';
import { RubixLoader } from '@samthomson/rubix-loader';
import App from './App';
import './index.css';
import '@mantine/charts/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Toaster } from 'sonner';
import { buildRelaykitTheme } from '@relaykit/ui';
import { AuthProvider } from './contexts/AuthContext';
import { DokployProvider } from './contexts/DokployContext';
import { InsightsProvider } from './contexts/InsightsContext';
import { RefreshServicesProvider } from './contexts/RefreshServicesContext';

const theme = buildRelaykitTheme();

const toastIconSize = 43;

const ToastRubixIcon = ({ color, speed = 0.9 }: { color: string; speed?: number }) => (
  <div
    style={{
      width: 50,
      height: 50,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
      lineHeight: 0,
      flexShrink: 0,
    }}
  >
    <RubixLoader size={toastIconSize} colors={[color]} speed={speed} />
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <AuthProvider>
        <DokployProvider>
          <RefreshServicesProvider>
            <InsightsProvider>
            <Notifications position="top-right" />
            <Toaster
              position="top-right"
              richColors={false}
              duration={7000}
              icons={{
                success: <ToastRubixIcon color="#22c55e" />,
                warning: <ToastRubixIcon color="#f59e0b" />,
                error: <ToastRubixIcon color="#ef4444" />,
                info: <ToastRubixIcon color="#3b82f6" />,
                loading: <ToastRubixIcon color="#a273f0" speed={1.15} />,
              }}
              toastOptions={{
                className: 'rk-toast',
                classNames: {
                  icon: 'rk-toast-icon',
                  content: 'rk-toast-content',
                },
              }}
            />
            <App />
            </InsightsProvider>
          </RefreshServicesProvider>
        </DokployProvider>
      </AuthProvider>
    </MantineProvider>
  </React.StrictMode>
);

