import { useEffect, useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

type AppShellProps = {
  children: ReactNode;
};

const SIDEBAR_WIDTH = 260;
const TOPBAR_HEIGHT = 72;
const MOBILE_BREAKPOINT = 980;

export default function AppShell({ children }: AppShellProps) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= MOBILE_BREAKPOINT;
  });

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const openSidebar = () => setSidebarOpen(true);

  const closeSidebar = () => {
    if (isMobile) setSidebarOpen(false);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #071426 0%, #0b1f3a 100%)',
        color: '#f5f7fb',
      }}
    >
      {isMobile && sidebarOpen ? (
        <div
          onClick={closeSidebar}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(3, 12, 24, 0.62)',
            WebkitBackdropFilter: 'blur(4px)',
            backdropFilter: 'blur(4px)',
            zIndex: 1190,
          }}
        />
      ) : null}

      <div
        style={{
          position: 'fixed',
          top: 0,
          left: isMobile ? (sidebarOpen ? 0 : -SIDEBAR_WIDTH - 24) : 0,
          width: SIDEBAR_WIDTH,
          height: '100vh',
          overflowY: 'auto',
          zIndex: 1200,
          background: 'linear-gradient(180deg, #071426 0%, #0b1f3a 100%)',
          color: '#f5f7fb',
          transition: 'left 0.28s ease',
          boxShadow: isMobile ? '0 18px 42px rgba(0,0,0,0.36)' : 'none',
        }}
      >
        <Sidebar onNavigate={closeSidebar} />
      </div>

      <div
        style={{
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          minWidth: 0,
          minHeight: '100vh',
          color: '#f5f7fb',
        }}
      >
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: isMobile ? 0 : SIDEBAR_WIDTH,
            right: 0,
            height: TOPBAR_HEIGHT,
            zIndex: 1100,
            background: 'linear-gradient(180deg, #071426 0%, #0b1f3a 100%)',
            color: '#f5f7fb',
          }}
        >
          <Topbar
            showMenuButton={isMobile}
            onMenuClick={sidebarOpen ? closeSidebar : openSidebar}
            isSidebarOpen={sidebarOpen}
          />
        </div>

        <main
          style={{
            padding: isMobile ? 16 : 24,
            paddingTop: TOPBAR_HEIGHT + (isMobile ? 16 : 24),
            minHeight: '100vh',
            boxSizing: 'border-box',
            color: '#f5f7fb',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}