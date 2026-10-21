import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { ref, get } from 'firebase/database';
import { auth } from '../firebase/auth';
import { db } from '../firebase/db';
import AppShell from '../components/AppShell';

type UserProfile = {
  email?: string;
  name?: string;
  role?: string;
  active?: boolean;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate('/login', { replace: true });
          return;
        }

        const snap = await get(ref(db, `users/${user.uid}`));
        if (snap.exists()) {
          setProfile(snap.val());
        } else {
          setProfile({
            email: user.email || '',
            name: 'User',
            role: 'unknown',
            active: false,
          });
        }
      } catch (err) {
        console.error('Failed to load profile', err);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [navigate]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const handleOpenLedDisplay = () => {
    window.open('/led-scoreboard', '_blank', 'noopener,noreferrer');
  };

  return (
    <AppShell>
      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 18,
            padding: 20,
          }}
        >
          <h1 style={{ marginTop: 0 }}>Admin Dashboard</h1>

          {loading ? (
            <p>Loading profile...</p>
          ) : (
            <>
              <p>
                <strong>Name:</strong> {profile?.name || '—'}
              </p>
              <p>
                <strong>Email:</strong>{' '}
                {profile?.email || auth.currentUser?.email || '—'}
              </p>
              <p>
                <strong>Role:</strong> {profile?.role || '—'}
              </p>
              <p>
                <strong>Status:</strong>{' '}
                {profile?.active ? 'Active' : 'Inactive'}
              </p>
            </>
          )}

          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              marginTop: 16,
            }}
          >
            <button
              onClick={handleOpenLedDisplay}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: 'white',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Open LED Display
            </button>

            <button
              onClick={handleLogout}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: 'none',
                background: '#d4af37',
                color: '#071426',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}