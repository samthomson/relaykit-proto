import { useState, useEffect } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { trpc } from './trpc';
import { useDokploy } from './contexts/DokployContext';
import { useRefreshServices } from './contexts/RefreshServicesContext';

const Setup = () => {
  const { dokployStatus, checkDokploy } = useDokploy();
  const [apiKey, setApiKey] = useState('');
  const [setupResult, setSetupResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const hasApiKey = !!dokployStatus?.hasApiKey;

  if (hasApiKey) {
    return (
      <div className="mt-8 p-6 bg-success-bg rounded-lg">
        <h2 className="text-xl font-semibold">✓ RelayKit Configured</h2>
        <p className="text-gray-500">API key is set</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-primary text-white rounded hover:bg-primary-hover transition-colors text-sm"
        >
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
    <div className="mt-8 p-6 bg-gray-50 rounded-lg">
      <h2 className="text-xl font-semibold">Setup RelayKit</h2>
      <div className="text-gray-500 text-sm mt-4 space-y-2">
        <p>
          <strong>Step 1:</strong> Create your Dokploy account at{' '}
          <a href="http://localhost:3000" target="_blank" className="text-primary hover:underline">
            http://localhost:3000
          </a>
        </p>
        <p>
          <strong>Step 2:</strong> Generate an API key in Dokploy at{' '}
          <a href="http://localhost:3000/dashboard/settings/profile" target="_blank" className="text-primary hover:underline">
            Settings → Profile
          </a>
        </p>
        <p>
          <strong>Step 3:</strong> Paste the API key below:
        </p>
      </div>
      <form onSubmit={onSave} className="mt-4">
        <div className="mb-4">
          <label className="block mb-2">
            <span className="text-sm font-medium">Dokploy API Key:</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              placeholder="paste-your-api-key-here"
              className="block w-full px-3 py-2 mt-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-primary text-white rounded hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Saving...' : 'Save API Key'}
        </button>
      </form>
      {setupResult && (
        <div className={`mt-4 p-4 rounded ${setupResult.error ? 'bg-error-bg' : 'bg-success-bg'}`}>
          <strong>{setupResult.error ? 'Error:' : 'Success!'}</strong>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{JSON.stringify(setupResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

const ServiceCard = ({
  service,
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
  const createdAt = new Date(service.createdAt);
  const createdStr = format(createdAt, 'd MMM yyyy, h:mm a');
  const createdAgo = formatDistanceToNow(createdAt, { addSuffix: true });
  const httpsUrl = domain ? `https://${domain.host}` : '';
  const wssUrl = domain ? `wss://${domain.host}` : '';

  const deploymentPillColor =
    service.status === 'running' ? 'bg-green-100 text-green-800' :
    service.status === 'error' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700';
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold m-0 text-gray-900 truncate">
            {domain ? domain.host : service.name}
          </h3>
          <ul className="mt-3 pl-4 space-y-1.5 text-sm text-gray-600 list-none border-l-2 border-gray-200 ml-1">
            <li className="flex items-center gap-2">
              <span className="text-gray-400 font-medium w-20 shrink-0">ID</span>
              <span className="font-mono text-xs truncate" title={service.name}>{service.name}</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-gray-400 font-medium w-20 shrink-0">Service</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 inline-block">
                {service.serviceType}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-gray-400 font-medium w-20 shrink-0">Deployment</span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium inline-block ${deploymentPillColor}`}>
                {service.status}
              </span>
            </li>
            {domain && (
              <>
                <li className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-400 font-medium w-20 shrink-0">HTTPS</span>
                  <a
                    href={httpsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate"
                  >
                    {httpsUrl} ↗
                  </a>
                  <button
                    onClick={() => onCopy(httpsUrl)}
                    className="shrink-0 px-2 py-0.5 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
                  >
                    Copy
                  </button>
                </li>
                <li className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-400 font-medium w-20 shrink-0">WSS</span>
                  <span className="font-mono text-xs truncate">{wssUrl}</span>
                  <button
                    onClick={() => onCopy(wssUrl)}
                    className="shrink-0 px-2 py-0.5 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
                  >
                    Copy
                  </button>
                </li>
              </>
            )}
            {isEditing && domain && (
              <li className="flex items-center gap-2 pt-1">
                <span className="text-gray-400 font-medium w-20 shrink-0">Host</span>
                <input
                  type="text"
                  value={newDomainHost}
                  onChange={(e) => setNewDomainHost(e.target.value)}
                  className="px-2 py-1 border border-gray-200 rounded text-xs flex-1 max-w-xs"
                />
                <button onClick={onSaveDomain} className="px-2 py-1 bg-success text-white rounded text-xs hover:opacity-90 shrink-0">
                  Save
                </button>
                <button onClick={onCancelEdit} className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 shrink-0">
                  Cancel
                </button>
              </li>
            )}
            <li className="flex items-center gap-2">
              <span className="text-gray-400 font-medium w-20 shrink-0">Created</span>
              <span>{createdStr}</span>
              <span className="text-gray-400">({createdAgo})</span>
            </li>
          </ul>
          {!domain && (
            <p className="mt-2 pl-5 text-gray-400 text-xs italic">No domain configured</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {domain && !isEditing && (
            <button
              onClick={() => onEditDomain(service.composeId, domain)}
              className="px-2 py-1.5 bg-primary text-white rounded text-xs hover:bg-primary-hover"
            >
              Edit
            </button>
          )}
          {service.status === 'running' ? (
            <button
              onClick={() => onStop(service.composeId)}
              className="px-4 py-2 bg-warning text-black rounded hover:opacity-90 text-sm"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => onStart(service.composeId)}
              className="px-4 py-2 bg-success text-white rounded hover:opacity-90 text-sm"
            >
              Start
            </button>
          )}
          <button
            onClick={() => onDelete(service.composeId, service.name)}
            className="px-4 py-2 bg-error text-white rounded hover:opacity-90 text-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const ServiceList = () => {
  const { refreshTrigger } = useRefreshServices();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingDomain, setEditingDomain] = useState<{ composeId: string; domainId: string; currentHost: string } | null>(null);
  const [newDomainHost, setNewDomainHost] = useState('');

  const loadServices = async () => {
    setLoading(true);
    try {
      const result = await trpc.listServices.query(undefined);
      setServices(result);
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const handleDeleteService = async (composeId: string, serviceName: string) => {
    if (!confirm(`Are you sure you want to delete ${serviceName}?`)) return;
    try {
      await trpc.deleteService.mutate({ composeId });
      toast.success('Service deleted successfully');
      await loadServices();
    } catch (error: any) {
      toast.error(`Failed to delete service: ${error.message}`);
    }
  };

  const handleStopService = async (composeId: string) => {
    try {
      await trpc.stopService.mutate({ composeId });
      await loadServices();
      toast.success('Service stopped');
    } catch (error: any) {
      toast.error(`Failed to stop service: ${error.message}`);
    }
  };

  const handleStartService = async (composeId: string) => {
    try {
      await trpc.startService.mutate({ composeId });
      await loadServices();
      toast.success('Service started');
    } catch (error: any) {
      toast.error(`Failed to start service: ${error.message}`);
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
      toast.success('Domain updated successfully');
    } catch (error: any) {
      toast.error(`Failed to update domain: ${error.message}`);
    }
  };

  return (
    <div className="mt-12">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold m-0">Deployed Services</h2>
        <button
          onClick={loadServices}
          disabled={loading}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {services.length === 0 ? (
        <p className="text-gray-500 italic">No services deployed yet. Deploy your first service below!</p>
      ) : (
        <div className="space-y-4">
          {services.map((service) => (
            <ServiceCard
              key={service.composeId}
              service={service}
              editingDomain={editingDomain}
              newDomainHost={newDomainHost}
              setNewDomainHost={setNewDomainHost}
              onEditDomain={handleEditDomain}
              onSaveDomain={handleSaveDomain}
              onCancelEdit={() => setEditingDomain(null)}
              onCopy={copyToClipboard}
              onStart={handleStartService}
              onStop={handleStopService}
              onDelete={handleDeleteService}
            />
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
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-8 max-w-lg w-full max-h-[80vh] overflow-auto">
      <h2 className="text-2xl font-bold mt-0">Deploy {preset.name}</h2>
      <p className="text-gray-500">{preset.description}</p>
      <form onSubmit={onSubmit}>
        {preset.requiredConfig.map((field: any) => (
          <div key={field.id} className="mb-4">
            <label className="block mb-2 font-medium">
              {field.name}:
              {field.type === 'select' ? (
                <select
                  value={deployConfig[field.id] || field.default || ''}
                  onChange={(e) => setDeployConfig({ ...deployConfig, [field.id]: e.target.value })}
                  required={field.required}
                  className="block w-full px-3 py-2 mt-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {field.options?.map((option: any) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={deployConfig[field.id] || ''}
                  onChange={(e) => setDeployConfig({ ...deployConfig, [field.id]: e.target.value })}
                  required={field.required}
                  placeholder={field.placeholder || field.description}
                  className="block w-full px-3 py-2 mt-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                />
              )}
            </label>
            {field.description && <small className="text-gray-500 text-xs">{field.description}</small>}
          </div>
        ))}
        {deployResult && (
          <div className={`mb-4 p-4 rounded ${deployResult.error ? 'bg-error-bg' : 'bg-success-bg'}`}>
            <strong>{deployResult.error ? 'Error:' : 'Success!'}</strong>
            <pre className="mt-2 text-xs whitespace-pre-wrap">{JSON.stringify(deployResult, null, 2)}</pre>
          </div>
        )}
        <div className="flex gap-4 mt-6">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 px-4 py-3 bg-success text-white rounded hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {loading ? 'Deploying...' : 'Deploy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-gray-600 text-white rounded hover:opacity-90 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
);

const DeploySection = () => {
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
        const result = await trpc.listPresets.query(undefined);
        setPresets(result);
      } catch (error) {
        console.error('Error loading presets:', error);
      }
    };
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast.success('Service deployment started!');
      setDeployModalOpen(false);
      triggerRefresh();
    } catch (error: any) {
      console.error('Deploy error:', error);
      setDeployResult({ error: error.message });
      toast.error(`Deploy failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-12">
      <h2 className="text-2xl font-bold">Deploy a Service</h2>
      <p className="text-gray-500">Choose a Nostr service to deploy:</p>
      <div className="mt-4 grid gap-4 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
        {presets.map((preset) => (
          <div key={preset.id} className="p-6 border border-gray-200 rounded-lg bg-white">
            <h3 className="text-lg font-semibold m-0 mb-2">{preset.name}</h3>
            <p className="text-gray-500 text-sm m-0 mb-4">{preset.description}</p>
            <button
              onClick={() => handleDeployClick(preset)}
              className="w-full px-4 py-3 bg-success text-white rounded hover:opacity-90 text-sm font-medium"
            >
              Deploy {preset.name}
            </button>
          </div>
        ))}
      </div>
      {presets.length === 0 && <p className="text-gray-400 italic">No services available yet.</p>}
      {deployModalOpen && selectedPreset && (
        <DeployModal
          preset={selectedPreset}
          deployConfig={deployConfig}
          setDeployConfig={setDeployConfig}
          loading={loading}
          deployResult={deployResult}
          onSubmit={handleDeploy}
          onClose={() => setDeployModalOpen(false)}
        />
      )}
    </div>
  );
};

const App = () => {
  const { dokployStatus } = useDokploy();
  const hasApiKey = !!dokployStatus?.hasApiKey;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold">RelayKit</h1>
      <p className="text-gray-600">Nostr service deployment platform</p>
      <Setup />
      {hasApiKey && (
        <>
          <ServiceList />
          <DeploySection />
        </>
      )}
    </div>
  );
};

export default App;
