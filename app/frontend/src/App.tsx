import { useState, useEffect } from 'react';
import { trpc } from './trpc';
import { useToast } from './contexts/ToastContext';
import { useDokploy } from './contexts/DokployContext';
import { useRefreshServices } from './contexts/RefreshServicesContext';

const Toast = ({ message, type }: { message: string; type: 'success' | 'error' }) => (
  <div style={{
    position: 'fixed',
    top: '2rem',
    right: '2rem',
    padding: '1rem 1.5rem',
    background: type === 'success' ? '#28a745' : '#dc3545',
    color: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: 9999,
    maxWidth: '400px',
    wordWrap: 'break-word'
  }}>
    <strong>{type === 'success' ? '✓' : '✗'}</strong> {message}
  </div>
);

const ToastDisplay = () => {
  const { toast } = useToast();
  return toast ? <Toast message={toast.message} type={toast.type} /> : null;
};

const Setup = () => {
  const { dokployStatus, checkDokploy } = useDokploy();
  const [apiKey, setApiKey] = useState('');
  const [setupResult, setSetupResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const hasApiKey = !!dokployStatus?.hasApiKey;

  if (hasApiKey) {
    return (
      <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#e8f5e9', borderRadius: '8px' }}>
        <h2>✓ RelayKit Configured</h2>
        <p style={{ color: '#666' }}>API key is set</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
          Reset API Key
        </button>
      </div>
    );
  }

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSetupResult(null);
    try {
      const result = await trpc.saveApiKey.mutate({ apiKey });
      setSetupResult(result);
      await checkDokploy();
    } catch (error: any) {
      console.error('Setup error:', error);
      setSetupResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f9f9f9', borderRadius: '8px' }}>
      <h2>Setup RelayKit</h2>
      <div style={{ color: '#666', fontSize: '14px', marginBottom: '1rem' }}>
        <p style={{ marginBottom: '0.5rem' }}><strong>Step 1:</strong> Create your Dokploy account at <a href="http://localhost:3000" target="_blank" style={{ color: '#007bff' }}>http://localhost:3000</a></p>
        <p style={{ marginBottom: '0.5rem' }}><strong>Step 2:</strong> Generate an API key in Dokploy at <a href="http://localhost:3000/dashboard/settings/profile" target="_blank" style={{ color: '#007bff' }}>Settings → Profile</a></p>
        <p><strong>Step 3:</strong> Paste the API key below:</p>
      </div>
      <form onSubmit={onSave} style={{ marginTop: '1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Dokploy API Key:
            <input type="text" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required placeholder="paste-your-api-key-here"
              style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', borderRadius: '4px', border: '1px solid #ddd', fontFamily: 'monospace' }} />
          </label>
        </div>
        <button type="submit" disabled={loading} style={{ padding: '0.75rem 1.5rem', background: loading ? '#ccc' : '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px' }}>
          {loading ? 'Saving...' : 'Save API Key'}
        </button>
      </form>
      {setupResult && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: setupResult.error ? '#ffebee' : '#e8f5e9', borderRadius: '4px' }}>
          <strong>{setupResult.error ? 'Error:' : 'Success!'}</strong>
          <pre style={{ marginTop: '0.5rem', fontSize: '12px' }}>{JSON.stringify(setupResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

const btn = (overrides: React.CSSProperties = {}) => ({ padding: '0.5rem 1rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', ...overrides });
const smallBtn = (overrides: React.CSSProperties = {}) => ({ padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', ...overrides });

const ServiceCard = ({
  service,
  index,
  total,
  editingDomain,
  newDomainHost,
  setNewDomainHost,
  onEditDomain,
  onSaveDomain,
  onCancelEdit,
  onCopy,
  onStart,
  onStop,
  onDelete
}: {
  service: any;
  index: number;
  total: number;
  editingDomain: { composeId: string; domainId: string; currentHost: string } | null;
  newDomainHost: string;
  setNewDomainHost: (v: string) => void;
  onEditDomain: (composeId: string, domain: any) => void;
  onSaveDomain: () => void;
  onCancelEdit: () => void;
  onCopy: (text: string) => void;
  onStart: (composeId: string) => void;
  onStop: (composeId: string) => void;
  onDelete: (composeId: string, name: string) => void;
}) => {
  const domain = service.domains?.[0];
  const isEditing = editingDomain?.domainId === domain?.domainId;
  return (
    <div style={{ borderBottom: index < total - 1 ? '1px solid #ddd' : 'none', background: 'white' }}>
      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '16px' }}>{service.name}</h3>
            <span style={{ padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '12px', fontWeight: '500', background: '#e3f2fd', color: '#1565c0' }}>{service.serviceType}</span>
            <span style={{
              padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '12px', fontWeight: '500',
              background: service.status === 'running' ? '#d4edda' : service.status === 'error' ? '#f8d7da' : '#fff3cd',
              color: service.status === 'running' ? '#155724' : service.status === 'error' ? '#721c24' : '#856404'
            }}>{service.status}</span>
          </div>
          <div style={{ margin: '0.5rem 0 0 0' }}>
            {domain ? (
              <div style={{ marginBottom: '0.5rem', padding: '0.5rem', background: '#f9f9f9', borderRadius: '4px' }}>
                {isEditing ? (
                  <div>
                    <input type="text" value={newDomainHost} onChange={(e) => setNewDomainHost(e.target.value)}
                      style={{ padding: '0.25rem 0.5rem', marginRight: '0.5rem', borderRadius: '4px', border: '1px solid #ddd', fontSize: '12px' }} />
                    <button onClick={onSaveDomain} style={smallBtn({ marginRight: '0.25rem', background: '#28a745', color: 'white' })}>Save</button>
                    <button onClick={onCancelEdit} style={smallBtn({ background: '#6c757d', color: 'white' })}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '14px', color: '#666' }}>🌐 {domain.host} (HTTPS)</span>
                    <button onClick={() => onCopy(domain.host)} style={smallBtn({ background: '#f0f0f0', border: '1px solid #ddd' })} title="Copy domain">📋</button>
                    <button onClick={() => onEditDomain(service.composeId, domain)} style={smallBtn({ background: '#007bff', color: 'white' })}>Edit</button>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ margin: 0, color: '#999', fontSize: '12px', fontStyle: 'italic' }}>No domain configured</p>
            )}
          </div>
          <p style={{ margin: '0.25rem 0 0 0', color: '#999', fontSize: '12px' }}>
            Created: {new Date(service.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {service.status === 'running' ? (
            <button onClick={() => onStop(service.composeId)} style={btn({ background: '#ffc107', color: '#000' })}>Stop</button>
          ) : (
            <button onClick={() => onStart(service.composeId)} style={btn({ background: '#28a745', color: 'white' })}>Start</button>
          )}
          <button onClick={() => onDelete(service.composeId, service.name)} style={btn({ background: '#dc3545', color: 'white' })}>Delete</button>
        </div>
      </div>
    </div>
  );
};

const ServiceList = () => {
  const { showToast } = useToast();
  const { refreshTrigger } = useRefreshServices();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingDomain, setEditingDomain] = useState<{ composeId: string; domainId: string; currentHost: string } | null>(null);
  const [newDomainHost, setNewDomainHost] = useState('');

  const loadServices = async () => {
    setLoading(true);
    try {
      const result = await trpc.listServices.query();
      setServices(result);
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, [refreshTrigger]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success');
  };

  const handleDeleteService = async (composeId: string, serviceName: string) => {
    if (!confirm(`Are you sure you want to delete ${serviceName}?`)) return;
    try {
      await trpc.deleteService.mutate({ composeId });
      showToast('Service deleted successfully', 'success');
      await loadServices();
    } catch (error: any) {
      showToast(`Failed to delete service: ${error.message}`, 'error');
    }
  };

  const handleStopService = async (composeId: string) => {
    try {
      await trpc.stopService.mutate({ composeId });
      await loadServices();
      showToast('Service stopped', 'success');
    } catch (error: any) {
      showToast(`Failed to stop service: ${error.message}`, 'error');
    }
  };

  const handleStartService = async (composeId: string) => {
    try {
      await trpc.startService.mutate({ composeId });
      await loadServices();
      showToast('Service started', 'success');
    } catch (error: any) {
      showToast(`Failed to start service: ${error.message}`, 'error');
    }
  };

  const handleEditDomain = (composeId: string, domain: any) => {
    setEditingDomain({ composeId, domainId: domain.domainId, currentHost: domain.host });
    setNewDomainHost(domain.host);
  };

  const handleSaveDomain = async () => {
    if (!editingDomain) return;
    try {
      await trpc.updateServiceDomain.mutate({
        composeId: editingDomain.composeId,
        domainId: editingDomain.domainId,
        newHost: newDomainHost
      });
      setEditingDomain(null);
      await loadServices();
      showToast('Domain updated successfully', 'success');
    } catch (error: any) {
      showToast(`Failed to update domain: ${error.message}`, 'error');
    }
  };

  return (
    <div style={{ marginTop: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Deployed Services</h2>
        <button onClick={loadServices} disabled={loading} style={{ padding: '0.5rem 1rem', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {services.length === 0 ? (
        <p style={{ color: '#666', fontStyle: 'italic' }}>No services deployed yet. Deploy your first service below!</p>
      ) : (
        <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
          {services.map((service, index) => (
            <ServiceCard key={service.composeId} service={service} index={index} total={services.length} editingDomain={editingDomain} newDomainHost={newDomainHost} setNewDomainHost={setNewDomainHost}
              onEditDomain={handleEditDomain} onSaveDomain={handleSaveDomain} onCancelEdit={() => setEditingDomain(null)} onCopy={copyToClipboard} onStart={handleStartService} onStop={handleStopService} onDelete={handleDeleteService} />
          ))}
        </div>
      )}
    </div>
  );
};

const DeployModal = ({
  preset,
  deployConfig,
  setDeployConfig,
  loading,
  deployResult,
  onSubmit,
  onClose
}: {
  preset: any;
  deployConfig: Record<string, string>;
  setDeployConfig: (c: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) => void;
  loading: boolean;
  deployResult: any;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) => (
  <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
    <div style={{ background: 'white', borderRadius: '8px', padding: '2rem', maxWidth: '500px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
      <h2 style={{ marginTop: 0 }}>Deploy {preset.name}</h2>
      <p style={{ color: '#666' }}>{preset.description}</p>
      <form onSubmit={onSubmit}>
        {preset.requiredConfig.map((field: any) => (
          <div key={field.id} style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {field.name}:
              {field.type === 'select' ? (
                <select value={deployConfig[field.id] || field.default || ''} onChange={(e) => setDeployConfig({ ...deployConfig, [field.id]: e.target.value })} required={field.required}
                  style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {field.options?.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input type={field.type} value={deployConfig[field.id] || ''} onChange={(e) => setDeployConfig({ ...deployConfig, [field.id]: e.target.value })} required={field.required}
                  placeholder={field.placeholder || field.description} style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', borderRadius: '4px', border: '1px solid #ddd' }} />
              )}
            </label>
            {field.description && <small style={{ color: '#666', fontSize: '12px' }}>{field.description}</small>}
          </div>
        ))}
        {deployResult && (
          <div style={{ marginBottom: '1rem', padding: '1rem', background: deployResult.error ? '#ffebee' : '#e8f5e9', borderRadius: '4px' }}>
            <strong>{deployResult.error ? 'Error:' : 'Success!'}</strong>
            <pre style={{ marginTop: '0.5rem', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{JSON.stringify(deployResult, null, 2)}</pre>
          </div>
        )}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
          <button type="submit" disabled={loading} style={{ flex: 1, padding: '0.75rem', background: loading ? '#ccc' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px' }}>
            {loading ? 'Deploying...' : 'Deploy'}
          </button>
          <button type="button" onClick={onClose} disabled={loading} style={{ flex: 1, padding: '0.75rem', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
);

const DeploySection = () => {
  const { showToast } = useToast();
  const { triggerRefresh } = useRefreshServices();
  const [presets, setPresets] = useState<any[]>([]);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<any>(null);
  const [deployConfig, setDeployConfig] = useState<Record<string, string>>({});
  const [deployResult, setDeployResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const result = await trpc.listPresets.query();
        setPresets(result);
      } catch (error) {
        console.error('Error loading presets:', error);
      }
    };
    loadPresets();
  }, []);

  const handleDeployClick = (preset: any) => {
    setSelectedPreset(preset);
    const defaults: Record<string, string> = {};
    preset.requiredConfig.forEach((field: any) => {
      if (field.default) defaults[field.id] = field.default;
    });
    setDeployConfig(defaults);
    setDeployResult(null);
    setDeployModalOpen(true);
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setDeployResult(null);
    try {
      await trpc.deployService.mutate({
        presetId: selectedPreset.id,
        config: deployConfig
      });
      showToast('Service deployment started!', 'success');
      setDeployModalOpen(false);
      triggerRefresh();
    } catch (error: any) {
      console.error('Deploy error:', error);
      setDeployResult({ error: error.message });
      showToast(`Deploy failed: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '3rem' }}>
      <h2>Deploy a Service</h2>
      <p style={{ color: '#666' }}>Choose a Nostr service to deploy:</p>
      <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
        {presets.map((preset) => (
          <div key={preset.id} style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px', background: 'white' }}>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>{preset.name}</h3>
            <p style={{ color: '#666', fontSize: '14px', margin: '0 0 1rem 0' }}>{preset.description}</p>
            <button onClick={() => handleDeployClick(preset)} style={{ width: '100%', padding: '0.75rem', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
              Deploy {preset.name}
            </button>
          </div>
        ))}
      </div>
      {presets.length === 0 && <p style={{ color: '#999', fontStyle: 'italic' }}>No services available yet.</p>}
      {deployModalOpen && selectedPreset && (
        <DeployModal preset={selectedPreset} deployConfig={deployConfig} setDeployConfig={setDeployConfig} loading={loading} deployResult={deployResult} onSubmit={handleDeploy} onClose={() => setDeployModalOpen(false)} />
      )}
    </div>
  );
};

const App = () => {
  const { dokployStatus } = useDokploy();
  const hasApiKey = !!dokployStatus?.hasApiKey;

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <ToastDisplay />
      <h1>RelayKit</h1>
      <p>Nostr service deployment platform</p>
      {hasApiKey ? (
        <>
          <ServiceList />
          <DeploySection />
        </>
      ) : (
        <Setup />
      )}
    </div>
  );
};

export default App;
