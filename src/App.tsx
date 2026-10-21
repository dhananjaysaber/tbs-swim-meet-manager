import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';

import Home from './pages/Home';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import Meets from './pages/Meets';
import Swimmers from './pages/Swimmers';
import Teams from './pages/Teams';
import Events from './pages/Events';
import Entries from './pages/Entries';
import TeamEntries from './pages/TeamEntries';
import Seeding from './pages/Seeding';
import HeatSheets from './pages/HeatSheets';
import RunMeet from './pages/RunMeet';
import RunMeet1 from './pages/RunMeet1';
import Results from './pages/Results';
import Reports from './pages/Reports';
import OfficialConsole from './pages/OfficialConsole';
import LEDScoreboard from './pages/LEDScoreboard';
import LEDResults from './pages/LEDResults';
import Starter from './pages/Starter';
import LaneTimer from './pages/LaneTimer';

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;

  const iosStandalone =
    'standalone' in window.navigator &&
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true;

  const mediaStandalone = window.matchMedia(
    '(display-mode: standalone)'
  ).matches;

  return iosStandalone || mediaStandalone;
}

function RouteFallback() {
  if (isStandaloneMode()) {
    return <Navigate to="/" replace />;
  }

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
          maxWidth: 560,
          width: '100%',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 18,
          padding: 24,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 10 }}>Page not found</h1>
        <p style={{ margin: 0, color: '#9fb3c8' }}>
          The route you opened does not exist in the current app.
        </p>
      </div>
    </div>
  );
}

function ProtectedAppRoute({ element }: { element: React.ReactNode }) {
  return <ProtectedRoute>{element}</ProtectedRoute>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public launcher + access routes */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/team-entries" element={<TeamEntries />} />
        <Route path="/lane-timer" element={<LaneTimer />} />

        {/* Protected standalone starter */}
        <Route
          path="/starter"
          element={<ProtectedAppRoute element={<Starter />} />}
        />

        {/* Protected admin pages */}
        <Route
          path="/dashboard"
          element={<ProtectedAppRoute element={<AdminDashboard />} />}
        />
        <Route
          path="/meets"
          element={<ProtectedAppRoute element={<Meets />} />}
        />
        <Route
          path="/swimmers"
          element={<ProtectedAppRoute element={<Swimmers />} />}
        />
        <Route
          path="/teams"
          element={<ProtectedAppRoute element={<Teams />} />}
        />
        <Route
          path="/events"
          element={<ProtectedAppRoute element={<Events />} />}
        />
        <Route
          path="/entries"
          element={<ProtectedAppRoute element={<Entries />} />}
        />
        <Route
          path="/seeding"
          element={<ProtectedAppRoute element={<Seeding />} />}
        />
        <Route
          path="/heatsheets"
          element={<ProtectedAppRoute element={<HeatSheets />} />}
        />
        <Route
          path="/runmeet"
          element={<ProtectedAppRoute element={<RunMeet />} />}
        />
        <Route
          path="/runmeet1"
          element={<ProtectedAppRoute element={<RunMeet1 />} />}
        />
        <Route
          path="/results"
          element={<ProtectedAppRoute element={<Results />} />}
        />
        <Route
          path="/reports"
          element={<ProtectedAppRoute element={<Reports />} />}
        />
        <Route
          path="/official-console"
          element={<ProtectedAppRoute element={<OfficialConsole />} />}
        />

        {/* Display pages */}
        <Route path="/led-scoreboard" element={<LEDScoreboard />} />
        <Route
          path="/led-results"
          element={<ProtectedAppRoute element={<LEDResults />} />}
        />

        {/* Fallback */}
        <Route path="*" element={<RouteFallback />} />
      </Routes>
    </BrowserRouter>
  );
}
