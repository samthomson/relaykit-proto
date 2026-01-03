import { useState, useEffect } from 'react';
import { trpc } from './trpc';

function App() {
  const [loading, setLoading] = useState(false);
  const [dokployStatus, setDokployStatus] = useState<any>(null);
  const [projects, setProjects] = useState<any>(null);
  const [setupResult, setSetupResult] = useState<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<any>(null);
  const [deployConfig, setDeployConfig] = useState<Record<string, string>>({});
  const [deployResult, setDeployResult] = useState<any>(null);
  
  const [apiKey, setApiKey] = useState('');

  // Load presets and check Dokploy status on mount
  useEffect(() => {
    loadPresets();
    checkDokploy();
  }, []);

  const loadPresets = async () => {
    try {
      const result = await trpc.listPresets.query();
      setPresets(result);
    } catch (error) {
      console.error('Error loading presets:', error);
    }
  };

  const handleDeployClick = (preset: any) => {
    setSelectedPreset(preset);
    setDeployConfig({});
    setDeployResult(null);
    setDeployModalOpen(true);
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setDeployResult(null);

    try {
      const result = await trpc.deployService.mutate({
        presetId: selectedPreset.id,
        config: deployConfig,
      });
      setDeployResult(result);
      
      // Reload projects list after successful deployment
      await listProjects();
    } catch (error: any) {
      console.error('Deploy error:', error);
      setDeployResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const checkDokploy = async () => {
    setLoading(true);
    try {
      const result = await trpc.checkDokploy.query();
      setDokployStatus(result);
    } catch (error: any) {
      console.error('Error checking Dokploy:', error);
      setDokployStatus({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const listProjects = async () => {
    setLoading(true);
    try {
      const result = await trpc.listProjects.query();
      setProjects(result);
    } catch (error: any) {
      console.error('Error listing projects:', error);
      setProjects({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSetupResult(null);
    
    try {
      const result = await trpc.saveApiKey.mutate({ apiKey });
      setSetupResult(result);
    } catch (error: any) {
      console.error('Setup error:', error);
      setSetupResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>RelayKit</h1>
      <p>Nostr service deployment platform</p>
      
      {dokployStatus?.hasApiKey ? (
        <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#e8f5e9', borderRadius: '8px' }}>
          <h2>✓ RelayKit Configured</h2>
          <p style={{ color: '#666' }}>
            API key is set ({dokployStatus.apiKeyLength} characters)
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Reset API Key
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f9f9f9', borderRadius: '8px' }}>
          <h2>Setup RelayKit</h2>
          <div style={{ color: '#666', fontSize: '14px', marginBottom: '1rem' }}>
            <p style={{ marginBottom: '0.5rem' }}>
              <strong>Step 1:</strong> Create your Dokploy account at{' '}
              <a href="http://localhost:3000" target="_blank" style={{ color: '#007bff' }}>
                http://localhost:3000
              </a>
            </p>
            <p style={{ marginBottom: '0.5rem' }}>
              <strong>Step 2:</strong> Generate an API key in Dokploy at{' '}
              <a href="http://localhost:3000/dashboard/settings/profile" target="_blank" style={{ color: '#007bff' }}>
                Settings → Profile
              </a>
            </p>
            <p>
              <strong>Step 3:</strong> Paste the API key below:
            </p>
          </div>
          
          <form onSubmit={handleSetup} style={{ marginTop: '1rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                Dokploy API Key:
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  placeholder="paste-your-api-key-here"
                  style={{ 
                    display: 'block',
                    width: '100%',
                    padding: '0.5rem',
                    marginTop: '0.25rem',
                    borderRadius: '4px',
                    border: '1px solid #ddd',
                    fontFamily: 'monospace'
                  }}
                />
              </label>
            </div>
            
            <button 
              type="submit" 
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                background: loading ? '#ccc' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '16px'
              }}
            >
              {loading ? 'Saving...' : 'Save API Key'}
            </button>
          </form>
          
          {setupResult && (
            <div style={{ 
              marginTop: '1rem', 
              padding: '1rem', 
              background: setupResult.error ? '#ffebee' : '#e8f5e9',
              borderRadius: '4px'
            }}>
              <strong>{setupResult.error ? 'Error:' : 'Success!'}</strong>
              <pre style={{ marginTop: '0.5rem', fontSize: '12px' }}>
                {JSON.stringify(setupResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <button onClick={checkDokploy} disabled={loading}>
          {loading ? 'Checking...' : 'Check Dokploy Connection'}
        </button>

        <button onClick={listProjects} disabled={loading}>
          {loading ? 'Loading...' : 'List Dokploy Projects'}
        </button>
      </div>

      {dokployStatus && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <strong>Dokploy Status:</strong>
          <pre style={{ fontSize: '12px' }}>{JSON.stringify(dokployStatus, null, 2)}</pre>
        </div>
      )}

      {projects && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f0f0', borderRadius: '4px' }}>
          <strong>Dokploy Projects:</strong>
          <pre style={{ fontSize: '12px' }}>{JSON.stringify(projects, null, 2)}</pre>
        </div>
      )}

      <div style={{ marginTop: '3rem' }}>
        <h2>Deploy a Service</h2>
        <p style={{ color: '#666' }}>Choose a Nostr service to deploy:</p>
        
        <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {presets.map((preset) => (
            <div 
              key={preset.id}
              style={{
                padding: '1.5rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
                background: 'white'
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem 0' }}>{preset.name}</h3>
              <p style={{ color: '#666', fontSize: '14px', margin: '0 0 1rem 0' }}>
                {preset.description}
              </p>
              <button
                onClick={() => handleDeployClick(preset)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Deploy {preset.name}
              </button>
            </div>
          ))}
        </div>

        {presets.length === 0 && (
          <p style={{ color: '#999', fontStyle: 'italic' }}>No services available yet.</p>
        )}
      </div>

      {deployModalOpen && selectedPreset && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '2rem',
            maxWidth: '500px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h2 style={{ marginTop: 0 }}>Deploy {selectedPreset.name}</h2>
            <p style={{ color: '#666' }}>{selectedPreset.description}</p>

            <form onSubmit={handleDeploy}>
              {selectedPreset.requiredConfig.map((field: any) => (
                <div key={field.id} style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                    {field.name}:
                    <input
                      type={field.type}
                      value={deployConfig[field.id] || ''}
                      onChange={(e) => setDeployConfig({
                        ...deployConfig,
                        [field.id]: e.target.value
                      })}
                      required={field.required}
                      placeholder={field.description}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.5rem',
                        marginTop: '0.25rem',
                        borderRadius: '4px',
                        border: '1px solid #ddd'
                      }}
                    />
                  </label>
                  {field.description && (
                    <small style={{ color: '#666', fontSize: '12px' }}>{field.description}</small>
                  )}
                </div>
              ))}

              {deployResult && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '1rem',
                  background: deployResult.error ? '#ffebee' : '#e8f5e9',
                  borderRadius: '4px'
                }}>
                  <strong>{deployResult.error ? 'Error:' : 'Success!'}</strong>
                  <pre style={{ marginTop: '0.5rem', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(deployResult, null, 2)}
                  </pre>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: loading ? '#ccc' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '16px'
                  }}
                >
                  {loading ? 'Deploying...' : 'Deploy'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeployModalOpen(false)}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '16px'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

