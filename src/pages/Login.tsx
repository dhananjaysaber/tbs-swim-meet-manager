import { useEffect, useState } from 'react';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase/auth';

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        navigate('/dashboard', { replace: true });
      }
    });

    return () => unsub();
  }, [navigate]);

  const handleLogin = async () => {
    if (!email || !password) {
      setMsg('Please enter email and password');
      return;
    }

    setLoading(true);
    setMsg('Signing in...');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setMsg('Login successful');
      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      setMsg(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background:
          'radial-gradient(circle at top, #123e74 0%, #0b1f3a 40%, #071426 100%)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '22px',
          padding: '28px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.28)',
          WebkitBackdropFilter: 'blur(10px)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            marginBottom: '14px',
          }}
        >
          <img
            src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
            alt="Panthers"
            style={{
              width: '120px',
              height: '120px',
              objectFit: 'contain',
              borderRadius: '18px',
              padding: '8px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <h1
          style={{
            marginTop: 0,
            marginBottom: 8,
            textAlign: 'center',
            color: '#ffffff',
            fontSize: '30px',
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          Swim Meet Manager
        </h1>

        <p
          style={{
            marginTop: 0,
            marginBottom: '20px',
            color: '#9fb3c8',
            textAlign: 'center',
            fontSize: '14px',
          }}
        >
          Sign in to continue
        </p>

        <div style={{ display: 'grid', gap: '12px', marginTop: '20px' }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: '14px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: 'white',
              outline: 'none',
              fontSize: '15px',
              boxSizing: 'border-box',
            }}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: '14px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: 'white',
              outline: 'none',
              fontSize: '15px',
              boxSizing: 'border-box',
            }}
          />

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              padding: '14px',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(180deg, #d4af37 0%, #b89018 100%)',
              color: '#071426',
              fontWeight: 800,
              fontSize: '15px',
              cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 10px 22px rgba(0,0,0,0.18)',
            }}
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </div>

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <p
            style={{
              color: '#f1d67a',
              minHeight: '20px',
              marginBottom: '10px',
            }}
          >
            {msg}
          </p>

          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#9fb3c8',
              fontSize: '13px',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}