import { Link, useLocation } from 'react-router-dom';

type SidebarProps = {
  onNavigate?: () => void;
};

const links = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Meets', path: '/meets' },
  { label: 'Teams', path: '/teams' },
  { label: 'Swimmers', path: '/swimmers' },
  { label: 'Events', path: '/events' },
  { label: 'Entries', path: '/entries' },
  { label: 'Seeding', path: '/seeding' },
  { label: 'Heat Sheets', path: '/heatsheets' },
  { label: 'Run Meet', path: '/runmeet' },
  { label: 'Results', path: '/results' },
  { label: 'Reports', path: '/reports' },
  { label: 'Official Console', path: '/official-console' },
  { label: 'Starter', path: '/starter' },
];

export default function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation();

  return (
    <>
      <style>{`
        .panthers-sidebar {
          width: 100%;
          min-height: 100vh;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          border-right: 1px solid rgba(255,255,255,0.08);
          background:
            radial-gradient(circle at top left, rgba(212,175,55,0.12), transparent 24%),
            linear-gradient(180deg, #081a2c 0%, #0b1f3a 50%, #07111f 100%);
          box-sizing: border-box;
          overflow: hidden;
        }

        .panthers-sidebar-inner {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 18px 14px 22px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: rgba(212,175,55,0.35) transparent;
        }

        .panthers-sidebar-inner::-webkit-scrollbar {
          width: 8px;
        }

        .panthers-sidebar-inner::-webkit-scrollbar-track {
          background: transparent;
        }

        .panthers-sidebar-inner::-webkit-scrollbar-thumb {
          background: rgba(212,175,55,0.28);
          border-radius: 999px;
        }

        .panthers-sidebar-brand {
          position: relative;
          overflow: hidden;
          padding: 16px 16px 14px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.08);
          background:
            linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%);
          box-shadow:
            0 12px 26px rgba(0,0,0,0.18),
            inset 0 1px 0 rgba(255,255,255,0.04);
          margin-bottom: 18px;
        }

        .panthers-sidebar-brand::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
          pointer-events: none;
        }

        .panthers-sidebar-logoRow {
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          z-index: 1;
        }

        .panthers-sidebar-logoWrap {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 8px 18px rgba(0,0,0,0.14);
          flex-shrink: 0;
        }

        .panthers-sidebar-logo {
          width: 30px;
          height: 30px;
          object-fit: contain;
          display: block;
        }

        .panthers-sidebar-brandText {
          min-width: 0;
        }

        .panthers-sidebar-title {
          margin: 0;
          color: #f1d67a;
          font-size: 1.25rem;
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.02em;
        }

        .panthers-sidebar-subtitle {
          margin: 5px 0 0;
          color: #b7cadb;
          font-size: 0.82rem;
          line-height: 1.35;
          font-weight: 600;
        }

        .panthers-sidebar-sectionTitle {
          margin: 16px 2px 10px;
          color: #8fa6bd;
          font-size: 0.72rem;
          line-height: 1;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-weight: 800;
        }

        .panthers-sidebar-nav {
          display: grid;
          gap: 8px;
        }

        .panthers-sidebar-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 13px;
          border-radius: 14px;
          border: 1px solid transparent;
          background: transparent;
          color: #f5f7fb;
          text-decoration: none;
          transition:
            background 0.18s ease,
            border-color 0.18s ease,
            transform 0.18s ease,
            color 0.18s ease,
            box-shadow 0.18s ease;
          box-sizing: border-box;
          min-height: 46px;
        }

        .panthers-sidebar-link:hover {
          background: rgba(255,255,255,0.06);
          border-color: rgba(255,255,255,0.08);
          transform: translateX(2px);
          box-shadow: 0 8px 18px rgba(0,0,0,0.10);
        }

        .panthers-sidebar-link.active {
          background: linear-gradient(135deg, rgba(212,175,55,0.18) 0%, rgba(212,175,55,0.10) 100%);
          border-color: rgba(212,175,55,0.40);
          color: #f4dd87;
          box-shadow: 0 10px 24px rgba(0,0,0,0.14);
        }

        .panthers-sidebar-linkDot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: rgba(255,255,255,0.22);
          flex-shrink: 0;
          transition: background 0.18s ease, box-shadow 0.18s ease;
        }

        .panthers-sidebar-link.active .panthers-sidebar-linkDot {
          background: #d4af37;
          box-shadow: 0 0 0 5px rgba(212,175,55,0.12);
        }

        .panthers-sidebar-linkLabel {
          min-width: 0;
          font-size: 0.95rem;
          line-height: 1.25;
          font-weight: 700;
          word-break: break-word;
        }

        .panthers-sidebar-footer {
          margin-top: 16px;
          padding: 12px 14px 0;
          color: #7f95ab;
          font-size: 0.76rem;
          line-height: 1.45;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        @media (max-width: 900px) {
          .panthers-sidebar {
            min-height: 100dvh;
            height: 100dvh;
            border-right: 1px solid rgba(255,255,255,0.08);
          }

          .panthers-sidebar-inner {
            padding: 14px 12px 18px;
          }

          .panthers-sidebar-brand {
            padding: 14px;
            border-radius: 16px;
            margin-bottom: 14px;
          }

          .panthers-sidebar-logoWrap {
            width: 42px;
            height: 42px;
            border-radius: 12px;
          }

          .panthers-sidebar-logo {
            width: 28px;
            height: 28px;
          }

          .panthers-sidebar-title {
            font-size: 1.12rem;
          }

          .panthers-sidebar-subtitle {
            font-size: 0.78rem;
          }

          .panthers-sidebar-link {
            min-height: 44px;
            padding: 11px 12px;
            border-radius: 13px;
          }

          .panthers-sidebar-linkLabel {
            font-size: 0.92rem;
          }
        }

        @media (max-width: 640px) {
          .panthers-sidebar-inner {
            padding: 12px 10px 16px;
          }

          .panthers-sidebar-brand {
            padding: 13px;
            margin-bottom: 12px;
          }

          .panthers-sidebar-logoRow {
            gap: 10px;
          }

          .panthers-sidebar-logoWrap {
            width: 40px;
            height: 40px;
          }

          .panthers-sidebar-title {
            font-size: 1.02rem;
          }

          .panthers-sidebar-subtitle {
            font-size: 0.75rem;
          }

          .panthers-sidebar-sectionTitle {
            margin: 14px 2px 9px;
          }

          .panthers-sidebar-nav {
            gap: 7px;
          }

          .panthers-sidebar-link {
            min-height: 42px;
            padding: 10px 11px;
          }

          .panthers-sidebar-linkLabel {
            font-size: 0.9rem;
          }

          .panthers-sidebar-footer {
            padding: 10px 12px 0;
            font-size: 0.74rem;
          }
        }
      `}</style>

      <aside className="panthers-sidebar">
        <div className="panthers-sidebar-inner">
          <div className="panthers-sidebar-brand">
            <div className="panthers-sidebar-logoRow">
              <div className="panthers-sidebar-logoWrap">
                <img
                  className="panthers-sidebar-logo"
                  src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                  alt="Panthers"
                />
              </div>

              <div className="panthers-sidebar-brandText">
                <h2 className="panthers-sidebar-title">Panthers</h2>
                <p className="panthers-sidebar-subtitle">Swim Meet Manager</p>
              </div>
            </div>
          </div>

          <div className="panthers-sidebar-sectionTitle"></div>

          <nav className="panthers-sidebar-nav">
            {links.map((item) => {
              const active = location.pathname === item.path;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onNavigate}
                  className={`panthers-sidebar-link ${active ? 'active' : ''}`}
                >
                  <span className="panthers-sidebar-linkDot" />
                  <span className="panthers-sidebar-linkLabel">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="panthers-sidebar-footer">
            Built for meet setup, entries, seeding, live control, and results.
          </div>
        </div>
      </aside>
    </>
  );
}