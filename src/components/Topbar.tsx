import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase/auth';

type TopbarProps = {
  showMenuButton?: boolean;
  onMenuClick?: () => void;
  isSidebarOpen?: boolean;
};

export default function Topbar({
  showMenuButton = false,
  onMenuClick,
  isSidebarOpen = false,
}: TopbarProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });

    return () => unsub();
  }, []);

  return (
    <>
      <style>{`
        .panthers-topbar {
          position: sticky;
          top: 0;
          z-index: 100;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 0 16px;
          background:
            linear-gradient(180deg, rgba(7,17,31,0.85) 0%, rgba(7,17,31,0.75) 100%);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          box-sizing: border-box;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          flex: 1;
        }

        .menu-btn {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: #fff;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .menu-btn:hover {
          background: rgba(255,255,255,0.12);
          transform: translateY(-1px);
        }

        .brand-wrap {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .brand-title {
          font-size: 18px;
          font-weight: 900;
          color: #ffffff;
          letter-spacing: -0.02em;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .brand-sub {
          font-size: 12px;
          color: #9fb3c8;
          font-weight: 600;
          margin-top: 2px;
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .user-chip {
          padding: 10px 14px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.10);
          font-size: 13px;
          font-weight: 700;
          color: #f1d67a;
          display: flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }

        .user-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #43a047;
        }

        /* Mobile */
        @media (max-width: 640px) {
          .panthers-topbar {
            height: 64px;
            padding: 0 12px;
          }

          .brand-title {
            font-size: 15px;
          }

          .brand-sub {
            font-size: 11px;
          }

          .user-chip {
            padding: 8px 10px;
            font-size: 12px;
          }

          .menu-btn {
            width: 38px;
            height: 38px;
            border-radius: 10px;
          }
        }

        /* Very small devices */
        @media (max-width: 420px) {
          .brand-sub {
            display: none;
          }

          .user-chip {
            font-size: 11px;
            padding: 7px 9px;
          }
        }
      `}</style>

      <header className="panthers-topbar">
        <div className="topbar-left">
          {showMenuButton && (
            <button
              onClick={onMenuClick}
              aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
              className="menu-btn"
            >
              ☰
            </button>
          )}

          <div className="brand-wrap">
            <div className="brand-title">Panthers Swim Manager</div>
            <div className="brand-sub">Admin Console</div>
          </div>
        </div>

        <div className="topbar-right">
          <div className="user-chip">
            <span className="user-dot" />
            {user ? 'Signed In' : 'Guest'}
          </div>
        </div>
      </header>
    </>
  );
}