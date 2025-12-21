import { useState } from 'react';
import { trpc } from './trpc';

function App() {
  const [number, setNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const result = await trpc.getRandomNumber.query();
      setNumber(result);
    } catch (error) {
      console.error('Error fetching random number:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>RelayKit</h1>
      <p>Frontend running</p>
      
      <div style={{ marginTop: '2rem' }}>
        <button onClick={handleClick} disabled={loading}>
          {loading ? 'Loading...' : 'Get Random Number'}
        </button>
        
        {number !== null && (
          <p style={{ marginTop: '1rem', fontSize: '2rem' }}>
            Random Number: <strong>{number}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

export default App;

