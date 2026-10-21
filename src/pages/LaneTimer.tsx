import { useEffect, useMemo, useState } from 'react';
import { onValue, ref, update } from 'firebase/database';
import { db } from '../firebase/db.js';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  laneCount?: number;
  poolLength?: string | number;
};

type LaneDeviceRow = {
  laneNumber?: number;
  pin?: string;
  active?: boolean;
  updatedAt?: number;
};

type StarterLaneSessionRow = {
  laneNumber?: number;
  entryId?: string;
  swimmerId?: string;
  swimmerName?: string;
  teamId?: string;
  teamName?: string;
  seedTime?: string;
  readyConfirmed?: boolean;
  readyAt?: number | null;
  stopAt?: number | null;
  provisionalMs?: number | null;
  heatFinalTime?: string;
  status?: string;
  submitted?: boolean;
  submittedAt?: number | null;
};

type StarterSessionRow = {
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  gender?: string;
  ageGroup?: string;
  stroke?: string;
  heatNumber?: number;
  laneCount?: number;
  status?: 'IDLE' | 'READY_CHECK' | 'RUNNING' | 'FINISHED' | 'CLOSED';
  startedAtServer?: number | null;
  readyCheckSentAt?: number | null;
  updatedAt?: number;
  lanes?: Record<string, StarterLaneSessionRow>;
};

type ModalState = {
  open: boolean;
  title: string;
  message: string;
};

function digitsOnly(value: string) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

function formatSwimTimeFromDigits(value: string) {
  const digits = digitsOnly(value);
  if (!digits) return '';

  const padded = digits.padStart(6, '0');
  const mm = padded.slice(0, 2);
  const ss = padded.slice(2, 4);
  const hh = padded.slice(4, 6);

  return `${mm}:${ss}.${hh}`;
}

function appendDigit(currentDigits: string, digit: string) {
  return digitsOnly(`${currentDigits}${digit}`);
}

function removeLastDigit(currentDigits: string) {
  return digitsOnly(currentDigits).slice(0, -1);
}

function normalizeStatus(value?: string) {
  const s = String(value || 'OK')
    .trim()
    .toUpperCase();

  if (['OK', 'DQ', 'NS', 'SCR'].includes(s)) return s;
  return 'OK';
}

function formatDateTime(value?: number | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function formatElapsed(ms: number) {
  const totalHundredths = Math.floor(ms / 10);
  const hh = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60);

  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(
    2,
    '0'
  )}.${String(hh).padStart(2, '0')}`;
}

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const meetId = String(params.get('meetId') || '').trim();
  const lane = Number(params.get('lane') || 0);

  return {
    meetId,
    laneNumber: Number.isFinite(lane) ? lane : 0,
  };
}

function getSessionStorageKey(meetId: string, laneNumber: number) {
  return `laneTimerAccess:${meetId}:${laneNumber}`;
}

function laneSessionStatusLabel(
  sessionStatus?: string,
  lane?: StarterLaneSessionRow
) {
  if (!lane?.entryId) return 'No swimmer loaded';
  if (lane.submitted) return 'Submitted';
  if (lane.stopAt) return 'Stopped';
  if (sessionStatus === 'RUNNING') return 'Running';
  if (lane.readyConfirmed) return 'Ready Confirmed';
  if (sessionStatus === 'READY_CHECK') return 'Waiting for Ready';
  if (sessionStatus === 'IDLE') return 'Heat Loaded';
  return 'Waiting';
}

function laneSessionStatusColor(
  sessionStatus?: string,
  lane?: StarterLaneSessionRow
) {
  const label = laneSessionStatusLabel(sessionStatus, lane);
  if (label === 'Submitted') return '#43a047';
  if (label === 'Stopped') return '#f4c542';
  if (label === 'Running') return '#2f73d9';
  if (label === 'Ready Confirmed') return '#1f6a35';
  if (label === 'Waiting for Ready') return '#b89018';
  if (label === 'Heat Loaded') return '#4f89ff';
  return '#60758a';
}

export default function LaneTimer() {
  const initialParams = useMemo(() => getQueryParams(), []);

  const [meetId, setMeetId] = useState(initialParams.meetId);
  const [laneNumber, setLaneNumber] = useState(initialParams.laneNumber);

  const [meetsList, setMeetsList] = useState<MeetRow[]>([]);
  const [selectedMeetId, setSelectedMeetId] = useState(initialParams.meetId);
  const [laneInput, setLaneInput] = useState(
    initialParams.laneNumber ? String(initialParams.laneNumber) : ''
  );

  const storageKey = useMemo(
    () => getSessionStorageKey(meetId, laneNumber),
    [meetId, laneNumber]
  );

  const [meet, setMeet] = useState<MeetRow | null>(null);
  const [laneDevice, setLaneDevice] = useState<LaneDeviceRow | null>(null);
  const [starterSession, setStarterSession] =
    useState<StarterSessionRow | null>(null);

  const [pinInput, setPinInput] = useState('');
  const [isAuthorized, setIsAuthorized] = useState(false);

  const [nowMs, setNowMs] = useState(Date.now());
  const [timeDigits, setTimeDigits] = useState('');
  const [statusValue, setStatusValue] = useState<'OK' | 'DQ' | 'NS' | 'SCR'>(
    'OK'
  );
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState<ModalState>({
    open: false,
    title: '',
    message: '',
  });

  useEffect(() => {
    const meetsRef = ref(db, 'meets');

    const unsub = onValue(meetsRef, (snap) => {
      if (!snap.exists()) {
        setMeetsList([]);
        return;
      }

      const val = snap.val();
      const rows: MeetRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      rows.sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''))
      );

      setMeetsList(rows);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!meetId || !laneNumber) return;

    const unlocked = window.sessionStorage.getItem(storageKey);
    if (unlocked === '1') {
      setIsAuthorized(true);
    } else {
      setIsAuthorized(false);
    }
  }, [meetId, laneNumber, storageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 50);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!meetId) {
      setMeet(null);
      setStarterSession(null);
      setLaneDevice(null);
      return;
    }

    const meetRef = ref(db, `meets/${meetId}`);
    const sessionRef = ref(db, `meets/${meetId}/starterSession/current`);
    const laneDeviceRef = ref(db, `meets/${meetId}/laneDevices/${laneNumber}`);

    const unsubMeet = onValue(meetRef, (snap) => {
      if (!snap.exists()) {
        setMeet(null);
        return;
      }
      setMeet({
        id: meetId,
        ...snap.val(),
      });
    });

    const unsubSession = onValue(sessionRef, (snap) => {
      setStarterSession((snap.val() as StarterSessionRow) || null);
    });

    const unsubLaneDevice = onValue(laneDeviceRef, (snap) => {
      setLaneDevice((snap.val() as LaneDeviceRow) || null);
    });

    return () => {
      unsubMeet();
      unsubSession();
      unsubLaneDevice();
    };
  }, [meetId, laneNumber]);

  const laneSession = useMemo(() => {
    return starterSession?.lanes?.[String(laneNumber)] || null;
  }, [starterSession, laneNumber]);

  const liveElapsedMs = useMemo(() => {
    if (
      starterSession?.status !== 'RUNNING' ||
      !starterSession?.startedAtServer ||
      laneSession?.stopAt
    ) {
      return 0;
    }

    return Math.max(0, nowMs - starterSession.startedAtServer);
  }, [starterSession, laneSession, nowMs]);

  const liveDisplayTime = useMemo(() => {
    if (laneSession?.stopAt && typeof laneSession?.provisionalMs === 'number') {
      return formatElapsed(laneSession.provisionalMs);
    }

    if (starterSession?.status === 'RUNNING') {
      return formatElapsed(liveElapsedMs);
    }

    return formatSwimTimeFromDigits(timeDigits) || '00:00.00';
  }, [laneSession, starterSession, liveElapsedMs, timeDigits]);

  useEffect(() => {
    const nextStatus = normalizeStatus(laneSession?.status || 'OK') as
      | 'OK'
      | 'DQ'
      | 'NS'
      | 'SCR';

    setStatusValue(nextStatus);

    if (laneSession?.heatFinalTime) {
      setTimeDigits(digitsOnly(laneSession.heatFinalTime));
      return;
    }

    if (typeof laneSession?.provisionalMs === 'number') {
      setTimeDigits(digitsOnly(formatElapsed(laneSession.provisionalMs)));
      return;
    }

    setTimeDigits('');
  }, [
    laneSession?.heatFinalTime,
    laneSession?.provisionalMs,
    laneSession?.status,
  ]);

  const openModal = (title: string, message: string) => {
    setModal({ open: true, title, message });
  };

  const closeModal = () => {
    setModal({ open: false, title: '', message: '' });
  };

  const meetLabel = useMemo(() => {
    if (!meet) return 'Meet not available';
    return `${meet.name || 'Unnamed Meet'} • ${meet.venue || 'No venue'} • ${
      meet.date || 'No date'
    }`;
  }, [meet]);

  const canConfirmReady = useMemo(() => {
    return (
      isAuthorized &&
      laneDevice?.active !== false &&
      !!laneSession?.entryId &&
      (starterSession?.status === 'IDLE' ||
        starterSession?.status === 'READY_CHECK') &&
      !laneSession?.readyConfirmed
    );
  }, [isAuthorized, laneDevice, laneSession, starterSession]);

  const canStop = useMemo(() => {
    return (
      isAuthorized &&
      laneDevice?.active !== false &&
      !!laneSession?.entryId &&
      starterSession?.status === 'RUNNING' &&
      !laneSession?.stopAt
    );
  }, [isAuthorized, laneDevice, laneSession, starterSession]);

  const canSubmit = useMemo(() => {
    return (
      isAuthorized &&
      laneDevice?.active !== false &&
      !!laneSession?.entryId &&
      !!starterSession?.eventId &&
      (laneSession?.stopAt || statusValue !== 'OK') &&
      !laneSession?.submitted
    );
  }, [isAuthorized, laneDevice, laneSession, starterSession, statusValue]);

  const canClearStoppedTime = useMemo(() => {
    return (
      isAuthorized &&
      laneDevice?.active !== false &&
      !!laneSession?.entryId &&
      !!laneSession?.stopAt &&
      !laneSession?.submitted
    );
  }, [isAuthorized, laneDevice, laneSession]);

  const isRunningAndAwaitingStop = useMemo(() => {
    return (
      isAuthorized &&
      starterSession?.status === 'RUNNING' &&
      !!laneSession?.entryId &&
      !laneSession?.stopAt &&
      laneDevice?.active !== false
    );
  }, [isAuthorized, starterSession, laneSession, laneDevice]);

  const swimmerLine = useMemo(() => {
    const swimmer = laneSession?.swimmerName || 'No swimmer loaded';
    const team = laneSession?.teamName || 'No team assigned';
    return `${swimmer} (${team})`;
  }, [laneSession]);

  const handleLoadLaneLink = () => {
    const cleanMeetId = String(selectedMeetId || '').trim();
    const cleanLane = Number(String(laneInput || '').replace(/\D/g, ''));

    if (!cleanMeetId || !cleanLane) {
      openModal(
        'Missing details',
        'Please select a meet and enter lane number.'
      );
      return;
    }

    const nextUrl = `/lane-timer?meetId=${encodeURIComponent(
      cleanMeetId
    )}&lane=${cleanLane}`;

    setMeetId(cleanMeetId);
    setLaneNumber(cleanLane);
    setIsAuthorized(false);
    setPinInput('');
    window.location.replace(nextUrl);
  };

  const handleUnlock = () => {
    if (!meetId || !laneNumber) {
      openModal('Invalid setup', 'Please select a meet and lane number first.');
      return;
    }

    if (!laneDevice?.pin) {
      openModal(
        'PIN not available',
        'This lane does not have an active PIN yet. Please contact the starter.'
      );
      return;
    }

    if (laneDevice?.active === false) {
      openModal(
        'Lane inactive',
        'This lane device has been deactivated by the starter.'
      );
      return;
    }

    if (pinInput.trim() !== String(laneDevice.pin || '').trim()) {
      openModal(
        'Incorrect PIN',
        'The PIN entered for this lane is not correct.'
      );
      return;
    }

    window.sessionStorage.setItem(storageKey, '1');
    setIsAuthorized(true);
    setPinInput('');
    openModal(
      'Lane unlocked',
      `Lane ${laneNumber} is now ready for timing on this device.`
    );
  };

  const handleLogoutLane = () => {
    window.sessionStorage.removeItem(storageKey);
    setIsAuthorized(false);
    setPinInput('');
    openModal(
      'Access removed',
      `Lane ${laneNumber} has been locked on this device.`
    );
  };

  const handleConfirmReady = async () => {
    if (!meetId || !laneSession?.entryId) return;

    setBusy(true);
    try {
      await update(
        ref(db, `meets/${meetId}/starterSession/current/lanes/${laneNumber}`),
        {
          readyConfirmed: true,
          readyAt: Date.now(),
        }
      );

      openModal(
        'Ready confirmed',
        `Lane ${laneNumber} has confirmed swimmer details and is ready.`
      );
    } catch (error: any) {
      openModal(
        'Update failed',
        error?.message || 'Ready confirmation could not be saved.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStopTimer = async () => {
    if (
      !meetId ||
      !laneSession?.entryId ||
      !starterSession?.startedAtServer ||
      starterSession?.status !== 'RUNNING'
    ) {
      return;
    }

    const stopAt = Date.now();
    const provisionalMs = Math.max(0, stopAt - starterSession.startedAtServer);
    const formatted = formatElapsed(provisionalMs);

    setBusy(true);
    try {
      await update(
        ref(db, `meets/${meetId}/starterSession/current/lanes/${laneNumber}`),
        {
          stopAt,
          provisionalMs,
          heatFinalTime: formatted,
          status: normalizeStatus(statusValue),
        }
      );
    } finally {
      setBusy(false);
    }
  };

  const handleClearStoppedTime = async () => {
    if (!meetId || !laneSession?.entryId) return;

    setBusy(true);
    try {
      await update(
        ref(db, `meets/${meetId}/starterSession/current/lanes/${laneNumber}`),
        {
          stopAt: null,
          provisionalMs: null,
          heatFinalTime: '',
          submitted: false,
          submittedAt: null,
          status: 'OK',
        }
      );

      setTimeDigits('');
      setStatusValue('OK');

      openModal(
        'Stopped time cleared',
        `Lane ${laneNumber} timing data has been cleared and is ready again.`
      );
    } catch (error: any) {
      openModal(
        'Clear failed',
        error?.message || 'The lane timing data could not be cleared.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitLaneTime = async () => {
    if (!meetId || !starterSession?.eventId || !laneSession?.entryId) return;

    const normalizedStatus = normalizeStatus(statusValue);
    const finalTime =
      normalizedStatus === 'OK' ? formatSwimTimeFromDigits(timeDigits) : '';

    if (normalizedStatus === 'OK' && !finalTime) {
      openModal(
        'Time required',
        'Please stop the timer or enter a valid time before submitting.'
      );
      return;
    }

    setBusy(true);

    try {
      await update(
        ref(db, `meets/${meetId}/starterSession/current/lanes/${laneNumber}`),
        {
          heatFinalTime: finalTime,
          status: normalizedStatus,
          submitted: true,
          submittedAt: Date.now(),
        }
      );

      await update(ref(db, `meets/${meetId}/results/${laneSession.entryId}`), {
        entryId: laneSession.entryId,
        swimmerId: laneSession.swimmerId || '',
        swimmerName: laneSession.swimmerName || '',
        teamId: laneSession.teamId || '',
        teamName: laneSession.teamName || '',
        eventId: starterSession.eventId || '',
        eventNumber: starterSession.eventNumber || 0,
        eventName: starterSession.eventName || '',
        heatNumber: starterSession.heatNumber || 0,
        laneNumber,
        seedTime: laneSession.seedTime || '',
        heatFinalTime: finalTime,
        status: normalizedStatus,
        place: null,
        active: true,
        updatedAt: Date.now(),
        updatedBy: `lane-${laneNumber}`,
      });

      await update(ref(db, `meets/${meetId}/entries/${laneSession.entryId}`), {
        status: normalizedStatus === 'OK' ? 'Completed' : normalizedStatus,
      });

      openModal(
        'Lane submitted',
        `Lane ${laneNumber} has submitted ${
          normalizedStatus === 'OK' ? finalTime : normalizedStatus
        } successfully.`
      );
    } catch (error: any) {
      openModal(
        'Submit failed',
        error?.message || 'The lane result could not be submitted.'
      );
    } finally {
      setBusy(false);
    }
  };

  const currentStatusLabel = laneSessionStatusLabel(
    starterSession?.status,
    laneSession || undefined
  );

  const currentStatusColor = laneSessionStatusColor(
    starterSession?.status,
    laneSession || undefined
  );

  return (
    <>
      <style>{`
        :root {
          --lt-navy-1: #071426;
          --lt-navy-2: #0b1f3a;
          --lt-navy-3: #123e74;
          --lt-blue: #2f73d9;
          --lt-gold: #d4af37;
          --lt-gold-2: #f1d67a;
          --lt-green: #43a047;
          --lt-red: #d9534f;
          --lt-text: #f5f7fb;
          --lt-sub: #b8c9da;
          --lt-line: rgba(255,255,255,0.10);
          --lt-panel: rgba(255,255,255,0.06);
        }

        html, body, #root {
          margin: 0;
          min-height: 100%;
          background: radial-gradient(circle at top, #123e74 0%, #0b1f3a 35%, #071426 100%);
          overscroll-behavior: none;
          font-family: Arial, Helvetica, sans-serif;
        }

        body {
          overflow-x: hidden;
        }

        .lane-timer-page {
          min-height: 100vh;
          box-sizing: border-box;
          padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)) 16px;
          color: var(--lt-text);
          display: grid;
          place-items: center;
        }

        .lane-timer-shell {
          width: 100%;
          max-width: 720px;
          margin: 0 auto;
          display: grid;
          gap: 14px;
        }

        .lane-card {
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--lt-line);
          border-radius: 24px;
          padding: 18px;
          box-shadow: 0 16px 38px rgba(0,0,0,0.22);
          -webkit-backdrop-filter: blur(10px);
          backdrop-filter: blur(10px);
        }

        .lane-card.locked-card {
          max-width: 560px;
          width: 100%;
          margin: 0 auto;
          text-align: center;
          padding: 24px 20px;
        }

        .lane-lock-logo {
          width: 68px;
          height: 68px;
          object-fit: contain;
          border-radius: 18px;
          background: rgba(255,255,255,0.08);
          padding: 8px;
          margin: 0 auto 14px;
          box-sizing: border-box;
        }

        .lane-lock-title {
          font-size: 2rem;
          font-weight: 900;
          color: #ffffff;
          line-height: 1.1;
          margin-bottom: 8px;
        }

        .lane-lock-sub {
          color: var(--lt-sub);
          font-size: 14px;
          line-height: 1.45;
          margin-bottom: 14px;
        }

        .lane-lock-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 38px;
          padding: 0 16px;
          border-radius: 999px;
          background: linear-gradient(180deg, var(--lt-gold) 0%, #b89018 100%);
          color: #071426;
          font-size: 13px;
          font-weight: 900;
          margin-bottom: 18px;
          box-shadow: 0 8px 18px rgba(0,0,0,0.18);
        }

        .lane-pin-label {
          font-size: 13px;
          font-weight: 800;
          color: var(--lt-sub);
          text-transform: uppercase;
          letter-spacing: 0.6px;
          margin-bottom: 10px;
          text-align: left;
        }

        .lane-pin-input {
          width: 100%;
          min-height: 60px;
          border-radius: 18px;
          border: 1px solid var(--lt-line);
          background: rgba(255,255,255,0.08);
          color: #ffffff;
          font-size: 24px;
          font-weight: 900;
          text-align: center;
          outline: none;
          box-sizing: border-box;
          letter-spacing: 6px;
          padding: 0 18px;
          appearance: none;
          -webkit-appearance: none;
          caret-color: #ffffff;
        }

        .lane-pin-input::placeholder {
          color: rgba(255,255,255,0.28);
          letter-spacing: 1px;
          font-weight: 700;
        }

        .lane-pin-input:focus,
        .lane-select:focus,
        .lane-time-input:focus {
          border-color: rgba(212,175,55,0.7);
          box-shadow: 0 0 0 3px rgba(212,175,55,0.12);
        }

        .lane-note {
          color: var(--lt-sub);
          font-size: 12px;
          line-height: 1.5;
          margin-top: 10px;
        }

        .lane-warning {
          padding: 14px;
          border-radius: 16px;
          border: 1px solid rgba(217,83,79,0.35);
          background: rgba(217,83,79,0.16);
          color: #ffd4d2;
          font-size: 13px;
          line-height: 1.5;
          margin-top: 12px;
        }

        .lane-btn {
          width: 100%;
          min-height: 54px;
          border: none;
          border-radius: 16px;
          font-size: 16px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
          box-shadow: 0 10px 22px rgba(0,0,0,0.18);
        }

        .lane-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .lane-btn:disabled {
          opacity: 0.52;
          cursor: not-allowed;
          transform: none;
          filter: none;
        }

        .lane-btn-gold {
          background: linear-gradient(180deg, var(--lt-gold) 0%, #b89018 100%);
          color: #071426;
          margin-top: 14px;
        }

        .lane-btn-blue {
          background: linear-gradient(180deg, #2f73d9 0%, #1f4f82 100%);
          color: #ffffff;
        }

        .lane-btn-green {
          background: linear-gradient(180deg, #43a047 0%, #1f6a35 100%);
          color: #ffffff;
        }

        .lane-btn-red {
          background: linear-gradient(180deg, #d9534f 0%, #9f2f2b 100%);
          color: #ffffff;
        }

        .lane-btn-ghost {
          background: rgba(255,255,255,0.06);
          color: #ffffff;
          border: 1px solid var(--lt-line);
        }

        .lane-hero {
          background: linear-gradient(135deg, rgba(11,31,58,0.98) 0%, rgba(18,62,116,0.96) 58%, rgba(212,175,55,0.20) 100%);
          display: grid;
          gap: 14px;
        }

        .lane-hero-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .lane-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .lane-logo {
          width: 56px;
          height: 56px;
          object-fit: contain;
          border-radius: 14px;
          background: rgba(255,255,255,0.08);
          padding: 6px;
          box-sizing: border-box;
        }

        .lane-title {
          font-size: 28px;
          font-weight: 900;
          line-height: 1;
          color: #ffffff;
        }

        .lane-sub {
          margin-top: 6px;
          color: var(--lt-sub);
          font-size: 13px;
          line-height: 1.4;
        }

        .lane-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 36px;
          min-width: 82px;
          padding: 0 14px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
          background: linear-gradient(180deg, var(--lt-gold) 0%, #b89018 100%);
          color: #071426;
          box-shadow: 0 8px 18px rgba(0,0,0,0.18);
        }

        .lane-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .lane-pill {
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          border: 1px solid var(--lt-line);
          font-size: 12px;
          font-weight: 800;
          color: #ffffff;
        }

        .lane-grid-2 {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          text-align: center;
        }

        .lane-label {
          font-size: 12px;
          color: var(--lt-sub);
          font-weight: 700;
          margin-bottom: 6px;
        }

        .lane-value {
          font-size: 17px;
          font-weight: 800;
          color: #ffffff;
          line-height: 1.35;
          word-break: break-word;
        }

        .lane-status-bar {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid var(--lt-line);
          background: rgba(255,255,255,0.08);
          font-size: 13px;
          font-weight: 900;
          color: #ffffff;
          width: fit-content;
          max-width: 100%;
          box-sizing: border-box;
        }

        .lane-status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          flex: 0 0 12px;
          box-shadow: 0 0 0 4px rgba(255,255,255,0.06);
        }

        .lane-stopwatch-wrap {
          display: grid;
          gap: 12px;
          justify-items: center;
          text-align: center;
        }

        .lane-stopwatch {
          width: 100%;
          border-radius: 22px;
          background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%);
          border: 1px solid var(--lt-line);
          padding: 24px 16px;
          box-sizing: border-box;
        }

        .lane-stopwatch-label {
          font-size: 13px;
          color: var(--lt-sub);
          font-weight: 800;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .lane-stopwatch-time {
          font-size: clamp(3rem, 12vw, 5.6rem);
          font-weight: 900;
          color: #ffffff;
          line-height: 1;
          letter-spacing: 1px;
          text-shadow: 0 10px 26px rgba(0,0,0,0.24);
          font-variant-numeric: tabular-nums;
        }

        .lane-swimmer-line {
          margin-top: 12px;
          font-size: clamp(1rem, 4vw, 1.35rem);
          font-weight: 800;
          color: var(--lt-gold-2);
          line-height: 1.3;
        }

        .lane-stopwatch-sub {
          margin-top: 10px;
          color: var(--lt-sub);
          font-size: 13px;
          font-weight: 800;
        }

        .lane-actions {
          display: grid;
          gap: 10px;
        }

        .lane-manual-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .lane-time-input {
          width: 100%;
          min-height: 56px;
          border-radius: 16px;
          border: 1px solid var(--lt-line);
          background: rgba(255,255,255,0.08);
          color: #ffffff;
          font-size: 28px;
          font-weight: 900;
          text-align: center;
          outline: none;
          box-sizing: border-box;
          font-variant-numeric: tabular-nums;
        }

        .lane-select {
          width: 100%;
          min-height: 56px;
          border-radius: 16px;
          border: 1px solid var(--lt-line);
          background: rgba(255,255,255,0.08);
          color: #ffffff;
          font-size: 16px;
          font-weight: 800;
          outline: none;
          box-sizing: border-box;
          padding: 0 14px;
          appearance: none;
          -webkit-appearance: none;
        }

        .lane-select option {
          color: #000000;
        }

        .lane-meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .lane-meta-box {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--lt-line);
          border-radius: 18px;
          padding: 14px;
          box-sizing: border-box;
        }

        .lane-success {
          padding: 14px;
          border-radius: 16px;
          border: 1px solid rgba(67,160,71,0.35);
          background: rgba(67,160,71,0.14);
          color: #d9f2db;
          font-size: 13px;
          line-height: 1.5;
          margin-top: 12px;
        }

        .lane-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(3, 12, 24, 0.76);
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          z-index: 9999;
          display: grid;
          place-items: center;
          padding: 20px;
          box-sizing: border-box;
        }

        .lane-modal {
          width: 100%;
          max-width: 420px;
          background: rgba(11,31,58,0.98);
          border: 1px solid var(--lt-line);
          border-radius: 22px;
          padding: 20px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.35);
        }

        .lane-modal-head {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .lane-modal-logo {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: rgba(255,255,255,0.08);
          object-fit: contain;
          padding: 4px;
          box-sizing: border-box;
        }

        .lane-modal-title {
          font-size: 19px;
          font-weight: 900;
          color: #ffffff;
        }

        .lane-modal-sub {
          font-size: 12px;
          color: var(--lt-sub);
          margin-top: 2px;
        }

        .lane-modal-body {
          color: #f5f7fb;
          font-size: 14px;
          line-height: 1.55;
          margin-bottom: 18px;
        }

        .lane-big-stop-wrap {
          min-height: calc(100vh - 160px);
          display: grid;
          place-items: center;
        }

        .lane-big-stop-shell {
          width: 100%;
          display: grid;
          gap: 18px;
          justify-items: center;
          text-align: center;
        }

        .lane-big-stop-button {
          width: min(72vw, 320px);
          height: min(72vw, 320px);
          border: none;
          border-radius: 28px;
          background: linear-gradient(180deg, #d9534f 0%, #9f2f2b 100%);
          color: #ffffff;
          font-size: clamp(1.6rem, 6vw, 2.5rem);
          font-weight: 900;
          line-height: 1.1;
          box-shadow:
            0 18px 40px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255,255,255,0.18);
          cursor: pointer;
          transition: transform 0.12s ease, filter 0.12s ease, opacity 0.12s ease;
        }

        .lane-big-stop-button:hover:not(:disabled),
        .lane-big-stop-button:active:not(:disabled) {
          transform: scale(0.99);
          filter: brightness(1.03);
        }

        .lane-big-stop-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .lane-big-stop-caption {
          max-width: 440px;
          color: var(--lt-sub);
          font-size: 14px;
          line-height: 1.5;
        }

        @media (min-width: 640px) {
          .lane-manual-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 420px) {
          .lane-lock-title {
            font-size: 1.7rem;
          }

          .lane-stopwatch-time {
            font-size: clamp(2.5rem, 14vw, 4rem);
          }

          .lane-meta-grid {
            grid-template-columns: 1fr;
          }

          .lane-big-stop-button {
            width: min(78vw, 300px);
            height: min(78vw, 300px);
            border-radius: 24px;
          }
        }
      `}</style>

      {modal.open && (
        <div className="lane-modal-backdrop">
          <div className="lane-modal">
            <div className="lane-modal-head">
              <img
                className="lane-modal-logo"
                src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                alt="Panthers"
              />
              <div>
                <div className="lane-modal-title">{modal.title}</div>
                <div className="lane-modal-sub">Lane Timer</div>
              </div>
            </div>

            <div className="lane-modal-body">{modal.message}</div>

            <button className="lane-btn lane-btn-gold" onClick={closeModal}>
              OK
            </button>
          </div>
        </div>
      )}

      <div className="lane-timer-page">
        <div className="lane-timer-shell">
          {!meetId || !laneNumber ? (
            <div className="lane-card locked-card">
              <img
                className="lane-lock-logo"
                src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                alt="Panthers"
              />

              <div className="lane-lock-title">Lane Timer</div>

              <div className="lane-lock-sub">
                Select your meet and lane number to begin.
              </div>

              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <div>
                  <div className="lane-pin-label">Select Meet</div>
                  <select
                    className="lane-select"
                    value={selectedMeetId}
                    onChange={(e) => setSelectedMeetId(e.target.value)}
                  >
                    <option value="">-- Select Meet --</option>
                    {meetsList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || 'Unnamed Meet'} ({m.date || 'No date'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="lane-pin-label">Lane Number</div>
                  <input
                    className="lane-pin-input"
                    type="text"
                    value={laneInput}
                    onChange={(e) =>
                      setLaneInput(
                        String(e.target.value || '')
                          .replace(/\D/g, '')
                          .slice(0, 2)
                      )
                    }
                    inputMode="numeric"
                    placeholder="Enter Lane"
                    autoComplete="off"
                    spellCheck={false}
                    style={{
                      letterSpacing: '2px',
                    }}
                  />
                </div>
              </div>

              <div className="lane-note">
                Select the meet and enter the lane number provided by the
                starter. You will still need the lane PIN to unlock this device.
              </div>

              <button
                className="lane-btn lane-btn-gold"
                onClick={handleLoadLaneLink}
              >
                Open Lane Timer
              </button>
            </div>
          ) : !isAuthorized ? (
            <div className="lane-card locked-card">
              <img
                className="lane-lock-logo"
                src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                alt="Panthers"
              />

              <div className="lane-lock-title">Lane Timer</div>

              <div className="lane-lock-sub">{meetLabel}</div>

              <div className="lane-lock-pill">Lane {laneNumber}</div>

              <div className="lane-pin-label">Lane Access PIN</div>

              <input
                className="lane-pin-input"
                type="text"
                value={pinInput}
                onChange={(e) =>
                  setPinInput(
                    String(e.target.value || '')
                      .replace(/\D/g, '')
                      .slice(0, 6)
                  )
                }
                inputMode="numeric"
                placeholder="Enter PIN"
                autoComplete="one-time-code"
                spellCheck={false}
              />

              <div className="lane-note">
                Enter the PIN provided for this designated lane to unlock this
                timer device.
              </div>

              {laneDevice?.active === false ? (
                <div className="lane-warning">
                  This lane device is currently inactive. Please contact the
                  starter.
                </div>
              ) : null}

              <button className="lane-btn lane-btn-gold" onClick={handleUnlock}>
                Unlock Lane {laneNumber}
              </button>
            </div>
          ) : (
            <>
              <div className="lane-card lane-hero">
                <div className="lane-hero-top">
                  <div className="lane-brand">
                    <img
                      className="lane-logo"
                      src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                      alt="Panthers"
                    />
                    <div>
                      <div className="lane-title">Lane Timer</div>
                      <div className="lane-sub">{meetLabel}</div>
                    </div>
                  </div>

                  <div className="lane-chip">Lane {laneNumber || '—'}</div>
                </div>

                <div className="lane-pills">
                  <span className="lane-pill">
                    Event: {starterSession?.eventNumber || '—'}
                  </span>
                  <span className="lane-pill">
                    Heat: {starterSession?.heatNumber || '—'}
                  </span>
                  <span className="lane-pill">
                    Session: {starterSession?.status || 'Not Loaded'}
                  </span>
                </div>
              </div>

              <div className="lane-card">
                <div className="lane-grid-2">
                  <div>
                    <div className="lane-value">
                      {starterSession?.eventName || 'No event loaded'}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 14, textAlign: 'center' }}>
                  <div className="lane-status-bar">
                    <span
                      className="lane-status-dot"
                      style={{ background: currentStatusColor }}
                    />
                    {currentStatusLabel}
                  </div>
                </div>
              </div>

              {isRunningAndAwaitingStop ? (
                <div className="lane-card lane-big-stop-wrap">
                  <div className="lane-big-stop-shell">
                    <div className="lane-stopwatch">
                      <div className="lane-stopwatch-label">Lane Time</div>
                      <div className="lane-stopwatch-time">
                        {liveDisplayTime}
                      </div>
                      <div className="lane-swimmer-line">{swimmerLine}</div>
                      <div className="lane-stopwatch-sub">
                        Seed Time: {laneSession?.seedTime || '—'}
                      </div>
                    </div>

                    <button
                      className="lane-big-stop-button"
                      onClick={handleStopTimer}
                      disabled={busy || !canStop}
                    >
                      Stop
                      <br />
                      Timer
                    </button>

                    <div className="lane-big-stop-caption">
                      Tap the button as the swimmer touches the wall.
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="lane-card">
                    <div className="lane-stopwatch-wrap">
                      <div className="lane-stopwatch">
                        <div className="lane-stopwatch-label">Lane Time</div>
                        <div className="lane-stopwatch-time">
                          {liveDisplayTime}
                        </div>
                        <div className="lane-swimmer-line">{swimmerLine}</div>
                      </div>
                    </div>
                  </div>

                  <div className="lane-card">
                    <div className="lane-actions">
                      <button
                        className="lane-btn lane-btn-blue"
                        onClick={handleConfirmReady}
                        disabled={busy || !canConfirmReady}
                      >
                        Confirm Ready
                      </button>

                      <button
                        className="lane-btn lane-btn-red"
                        onClick={handleClearStoppedTime}
                        disabled={busy || !canClearStoppedTime}
                      >
                        Clear Stopped Time
                      </button>
                    </div>
                  </div>

                  <div className="lane-card">
                    <div className="lane-manual-grid">
                      <div>
                        <div className="lane-label">Final Time</div>
                        <input
                          className="lane-time-input"
                          type="text"
                          value={formatSwimTimeFromDigits(timeDigits)}
                          readOnly
                          inputMode="numeric"
                          placeholder="00:00.00"
                          onKeyDown={(e) => {
                            const key = e.key;

                            if (/^\d$/.test(key)) {
                              e.preventDefault();
                              setTimeDigits((prev) => appendDigit(prev, key));
                              return;
                            }

                            if (key === 'Backspace') {
                              e.preventDefault();
                              setTimeDigits((prev) => removeLastDigit(prev));
                              return;
                            }

                            if (key === 'Delete') {
                              e.preventDefault();
                              setTimeDigits('');
                              return;
                            }

                            if (
                              key === 'Tab' ||
                              key === 'Enter' ||
                              key === 'ArrowLeft' ||
                              key === 'ArrowRight' ||
                              key === 'ArrowUp' ||
                              key === 'ArrowDown' ||
                              key === 'Home' ||
                              key === 'End'
                            ) {
                              return;
                            }

                            e.preventDefault();
                          }}
                          onPaste={(e) => {
                            e.preventDefault();
                            setTimeDigits(
                              digitsOnly(e.clipboardData.getData('text'))
                            );
                          }}
                        />
                      </div>

                      <div>
                        <div className="lane-label">Lane Status</div>
                        <select
                          className="lane-select"
                          value={statusValue}
                          onChange={(e) =>
                            setStatusValue(
                              normalizeStatus(e.target.value) as
                                | 'OK'
                                | 'DQ'
                                | 'NS'
                                | 'SCR'
                            )
                          }
                        >
                          <option value="OK">OK</option>
                          <option value="DQ">DQ</option>
                          <option value="NS">NS</option>
                          <option value="SCR">SCR</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <button
                        className="lane-btn lane-btn-green"
                        onClick={handleSubmitLaneTime}
                        disabled={busy || !canSubmit}
                      >
                        Submit Lane Result
                      </button>
                    </div>
                  </div>

                  <div className="lane-card">
                    <div className="lane-meta-grid">
                      <div className="lane-meta-box">
                        <div className="lane-label">Ready At</div>
                        <div className="lane-value">
                          {formatDateTime(laneSession?.readyAt)}
                        </div>
                      </div>

                      <div className="lane-meta-box">
                        <div className="lane-label">Submitted At</div>
                        <div className="lane-value">
                          {formatDateTime(laneSession?.submittedAt)}
                        </div>
                      </div>
                    </div>

                    {laneSession?.submitted ? (
                      <div className="lane-success">
                        This lane has already submitted its result for the
                        current heat.
                      </div>
                    ) : null}

                    {laneDevice?.active === false ? (
                      <div className="lane-warning">
                        This lane has been deactivated by the starter. Actions
                        are disabled.
                      </div>
                    ) : null}

                    <div style={{ marginTop: 14 }}>
                      <button
                        className="lane-btn lane-btn-ghost"
                        onClick={handleLogoutLane}
                      >
                        Lock This Lane on This Device
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
