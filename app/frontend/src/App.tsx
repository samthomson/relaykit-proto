import { useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, NavLink as RouterNavLink } from 'react-router-dom';
import { RubixLoader, RubixLoaderColor } from '@samthomson/rubix-loader';
import { useAuth } from './contexts/AuthContext';
import { useDokploy } from './contexts/DokployContext';
import { useRefreshServices } from './contexts/RefreshServicesContext';
import { InsightsPage } from './components/InsightsPage';
import { RelaykitVersionPanel } from './components/RelaykitVersionPanel';
import { AccountModal } from './components/AccountModal';
import { NavServerSummary } from './components/NavServerSummary';
import { DebugPage } from './pages/DebugPage';
import { AppsPage } from './pages/AppsPage';
import { LoginScreen } from './pages/LoginScreen';
import { ServiceList } from './pages/ServicesPage';
import { serviceTypeToRubixLoaderColor } from './lib/serviceTypeColor';
import {
  Text,
  Group,
  Title,
  AppShell,
  Burger,
  NavLink,
  ScrollArea,
  Box,
  rem,
  useMantineColorScheme,
  Switch,
  Stack,
  Paper,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { DropdownButton } from '@relaykit/ui';
import { SERVICE_TYPE } from '../../shared/serviceType';

type RubixColor = (typeof RubixLoaderColor)[keyof typeof RubixLoaderColor] | (string & {});

const DokployConnectionAlert = ({ message }: { message: string }) => (
  <Paper color="red" p="md">
    <Text fw={700}>Dokploy connection problem</Text>
    <Text size="sm" mt="xs">{message}</Text>
    <Text size="sm" mt="xs" c="dimmed">
      To fix: run the setup script with your npub, or add a valid Dokploy API key to the bootstrap key file (see README).
    </Text>
  </Paper>
);

const DokployInitialCheck = () => {
  const { setDokployConnectionError, setDokployReady } = useDokploy();
  const { servicesLoading, servicesError } = useRefreshServices();

  useEffect(() => {
    if (servicesLoading) return;
    if (servicesError) {
      setDokployConnectionError(servicesError);
      return;
    }
    setDokployConnectionError(null);
    setDokployReady(true);
  }, [servicesLoading, servicesError, setDokployConnectionError, setDokployReady]);

  return null;
};

const ServicesHomeRoute = () => {
  const { dokployConnectionError, dokployReady } = useDokploy();

  if (dokployConnectionError) {
    return (
      <Stack gap="xl" p="xl">
        <DokployConnectionAlert message={dokployConnectionError} />
      </Stack>
    );
  }

  return (
    <Stack gap="xl" p="xl">
      <DokployInitialCheck />
      {!dokployReady ? (
        <Stack align="center" justify="center" gap="sm" style={{ minHeight: rem(480) }}>
          <RubixLoader size={144} colors={[RubixLoaderColor.RelayKit]} speed={1.35} />
          <Text size="sm" c="dimmed">loading services…</Text>
        </Stack>
      ) : (
        <ServiceList />
      )}
    </Stack>
  );
};

const App = () => {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const { services } = useRefreshServices();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [mobileMenuOpened, { toggle: toggleMobileMenu, close: closeMobileMenu }] = useDisclosure(false);
  const [accountModalOpen, { open: openAccountModal, close: closeAccountModal }] = useDisclosure(false);

  const rubixLoaderColors = useMemo(() => {
    const seen = new Set<RubixColor>();
    for (const service of services) {
      seen.add(serviceTypeToRubixLoaderColor(service.type, service.presetId));
    }
    return [RubixLoaderColor.RelayKit, ...Array.from(seen).filter((color) => color !== RubixLoaderColor.RelayKit)];
  }, [services]);

  const serviceCountTooltip = useMemo(() => {
    const relays = services.filter(s => s.type === SERVICE_TYPE.RELAY).length;
    const blossoms = services.filter(s => s.type === SERVICE_TYPE.BLOSSOM).length;
    const npanels = services.filter(s => s.type === SERVICE_TYPE.NPANEL).length;
    const other = services.length - relays - blossoms - npanels;
    return [
      relays > 0 && `${relays} relay${relays !== 1 ? 's' : ''}`,
      blossoms > 0 && `${blossoms} blossom${blossoms !== 1 ? 's' : ''}`,
      npanels > 0 && `${npanels} npanel${npanels !== 1 ? 's' : ''}`,
      other > 0 && `${other} other`,
    ].filter(Boolean).join('\n');
  }, [services]);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <BrowserRouter>
      <AppShell
        header={{ height: 60 }}
        navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !mobileMenuOpened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm" align="center">
              <Burger opened={mobileMenuOpened} onClick={toggleMobileMenu} hiddenFrom="sm" size="sm" />
              <Box style={{ lineHeight: 0, flexShrink: 0, height: 34, display: 'inline-flex', alignItems: 'center' }}>
                <RubixLoader
                  size={48}
                  speed={0.9}
                  colors={rubixLoaderColors}
                />
              </Box>
              <Title
                order={3}
                c="relaykit"
                className="brand-title"
                style={{
                  fontSize: rem(30),
                  lineHeight: '34px',
                  margin: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  transform: 'translateY(2px)',
                }}
              >
                RelayKit
              </Title>
            </Group>
            <DropdownButton
              variant="default"
              size="sm"
              menuWidth={200}
              items={[
                { id: 'identity', label: 'identity', onSelect: openAccountModal },
                {
                  id: 'dark-mode',
                  label: (
                    <Group justify="space-between" wrap="nowrap" w="100%">
                      <Text size="sm">dark mode</Text>
                      <Switch
                        size="sm"
                        checked={colorScheme === 'dark'}
                        readOnly
                        tabIndex={-1}
                      />
                    </Group>
                  ),
                  closeOnClick: false,
                  onSelect: () => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark'),
                },
                { id: 'divider', divider: true },
                { id: 'logout', label: 'logout', color: 'red', onSelect: logout },
              ]}
            >
              init
            </DropdownButton>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          <AppShell.Section grow component={ScrollArea}>
            <NavLink
              component={RouterNavLink}
              to="/"
              label="services"
              rightSection={services.length > 0 ? (
                <Tooltip label={<Text size="xs" style={{ whiteSpace: 'pre' }}>{serviceCountTooltip}</Text>} withArrow>
                  <Text size="xs" c="dimmed">{services.length}</Text>
                </Tooltip>
              ) : undefined}
              onClick={closeMobileMenu}
            />
            <NavLink
              component={RouterNavLink}
              to="/debug"
              label="debug"
              onClick={closeMobileMenu}
            />
            <NavLink
              component={RouterNavLink}
              to="/apps"
              label="apps"
              onClick={closeMobileMenu}
            />
            <NavLink
              component={RouterNavLink}
              to="/insights"
              label="insights"
              onClick={closeMobileMenu}
            />
          </AppShell.Section>
          <AppShell.Section>
            <NavServerSummary />
            <RelaykitVersionPanel />
          </AppShell.Section>
        </AppShell.Navbar>

        <AppShell.Main>
          <Routes>
            <Route path="/" element={<ServicesHomeRoute />} />
            <Route path="/debug" element={<DebugPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
          </Routes>
        </AppShell.Main>
      </AppShell>

      <AccountModal opened={accountModalOpen} onClose={closeAccountModal} />
    </BrowserRouter>
  );
};

export default App;
