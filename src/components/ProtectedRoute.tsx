import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase/auth';

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(auth.currentUser);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  if (!authReady) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(180deg, #071426 0%, #0b1f3a 100%)',
          color: '#ffffff',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: 24,
            borderRadius: 18,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            minWidth: 280,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.22)',
              borderTopColor: '#d4af37',
              margin: '0 auto 14px',
              animation: 'panthers-spin 0.8s linear infinite',
            }}
          />
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            Checking session...
          </div>

          <style>
            {`
              @keyframes panthers-spin {
                to { transform: rotate(360deg); }
              }
            `}
          </style>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}