import { useEffect, useMemo, useState } from 'react';
import { onValue, ref, set, update } from 'firebase/database';
import { db } from '../firebase/db.js';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  laneCount?: number;
  poolLength?: string | number;
};

type EventRow = {
  id: string;
  eventNumber?: number;
  distance?: string;
  stroke?: string;
  gender?: string;
  ageGroup?: string;
  eventType?: string;
  round?: string;
  relay?: boolean;
  name?: string;
  active?: boolean;
};

type SavedHeatNode = {
  heatNumber?: number;
  lanes?: Record<
    string,
    {
      laneNumber?: number;
      entryId?: string;
      swimmerId?: string;
      swimmerName?: string;
      teamId?: string;
      teamName?: string;
      seedTime?: string;
      heatNumber?: number;
    }
  >;
};

type SavedSeedingNode = {
  generatedAt?: number;
  generatedBy?: string;
  laneCount?: number;
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  heats?: Record<string, SavedHeatNode>;
  meta?: {
    seededCount?: number;
    unseededCount?: number;
  };
};

type LaneRow = {
  laneNumber: number;
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  teamId: string;
  teamName: string;
  seedTime: string;
  heatNumber: number;
};

type HeatRow = {
  heatNumber: number;
  lanes: LaneRow[];
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

type InlineNoticeState = {
  show: boolean;
  title: string;
  message: string;
  tone: 'success' | 'info';
};

function flattenSavedHeats(node?: SavedSeedingNode | null) {
  if (!node?.heats) return [] as HeatRow[];

  return Object.values(node.heats)
    .map((heatNode) => {
      const lanes = Object.values(heatNode?.lanes || {})
        .map((lane) => ({
          laneNumber: Number(lane?.laneNumber || 0),
          entryId: String(lane?.entryId || ''),
          swimmerId: String(lane?.swimmerId || ''),
          swimmerName: String(lane?.swimmerName || ''),
          teamId: String(lane?.teamId || ''),
          teamName: String(lane?.teamName || ''),
          seedTime: String(lane?.seedTime || ''),
          heatNumber: Number(lane?.heatNumber || heatNode?.heatNumber || 0),
        }))
        .filter((lane) => lane.laneNumber > 0)
        .sort((a, b) => a.laneNumber - b.laneNumber);

      return {
        heatNumber: Number(heatNode?.heatNumber || 0),
        lanes,
      };
    })
    .filter((heat) => heat.heatNumber > 0)
    .sort((a, b) => a.heatNumber - b.heatNumber);
}

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function formatDateTime(value?: number | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function laneStatusLabel(
  lane: StarterLaneSessionRow | undefined,
  sessionStatus?: string
) {
  if (!lane) return 'No Lane';
  if (lane.submitted) return 'Submitted';
  if (lane.stopAt) return 'Stopped';
  if (sessionStatus === 'RUNNING') return 'Running';
  if (lane.readyConfirmed) return 'Ready';
  if (sessionStatus === 'READY_CHECK') return 'Waiting';
  return 'Loaded';
}

function laneStatusColor(
  lane: StarterLaneSessionRow | undefined,
  sessionStatus?: string
) {
  const label = laneStatusLabel(lane, sessionStatus);
  if (label === 'Submitted') return '#43a047';
  if (label === 'Stopped') return '#f4c542';
  if (label === 'Running') return '#4f89ff';
  if (label === 'Ready') return '#1f6a35';
  if (label === 'Waiting') return '#b89018';
  return '#60758a';
}

function buildLaneLink(meetId: string, laneNumber: number) {
  const origin = window.location.origin;
  return `${origin}/lane-timer?meetId=${encodeURIComponent(
    meetId
  )}&lane=${encodeURIComponent(String(laneNumber))}`;
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

export default function Starter() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [allSeeding, setAllSeeding] = useState<
    Record<string, SavedSeedingNode>
  >({});
  const [laneDevices, setLaneDevices] = useState<Record<string, LaneDeviceRow>>(
    {}
  );
  const [starterSession, setStarterSession] =
    useState<StarterSessionRow | null>(null);

  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedHeatNumber, setSelectedHeatNumber] = useState(1);

  const [busy, setBusy] = useState(false);
  const [essentialMode, setEssentialMode] = useState(false);
  const [startModeOpen, setStartModeOpen] = useState(false);

  const [modal, setModal] = useState<ModalState>({
    open: false,
    title: '',
    message: '',
  });

  const [inlineNotice, setInlineNotice] = useState<InlineNoticeState>({
    show: false,
    title: '',
    message: '',
    tone: 'success',
  });

  const [starterNow, setStarterNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStarterNow(Date.now());
    }, 50);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!inlineNotice.show) return;

    const timer = window.setTimeout(() => {
      setInlineNotice((prev) => ({ ...prev, show: false }));
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [inlineNotice.show]);

  const showInlineNotice = (
    title: string,
    message: string,
    tone: 'success' | 'info' = 'success'
  ) => {
    setInlineNotice({
      show: true,
      title,
      message,
      tone,
    });
  };

  const openModal = (title: string, message: string) => {
    setModal({ open: true, title, message });
  };

  const closeModal = () => {
    setModal({ open: false, title: '', message: '' });
  };

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  const seededEventOptions = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false && !!allSeeding[event.id])
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events, allSeeding]);

  const selectedEvent = useMemo(() => {
    return (
      seededEventOptions.find((event) => event.id === selectedEventId) || null
    );
  }, [seededEventOptions, selectedEventId]);

  const selectedEventSeeding = useMemo(() => {
    return allSeeding[selectedEventId] || null;
  }, [allSeeding, selectedEventId]);

  const selectedEventHeats = useMemo(() => {
    return flattenSavedHeats(selectedEventSeeding);
  }, [selectedEventSeeding]);

  const selectedHeat = useMemo(() => {
    return (
      selectedEventHeats.find(
        (heat) => heat.heatNumber === selectedHeatNumber
      ) || null
    );
  }, [selectedEventHeats, selectedHeatNumber]);

  const laneCount = useMemo(() => {
    return Number(
      selectedEventSeeding?.laneCount || activeMeet?.laneCount || 8
    );
  }, [selectedEventSeeding, activeMeet]);

  const sessionLaneRows = useMemo(() => {
    return Object.values(starterSession?.lanes || {})
      .map((lane) => ({
        laneNumber: Number(lane?.laneNumber || 0),
        entryId: String(lane?.entryId || ''),
        swimmerId: String(lane?.swimmerId || ''),
        swimmerName: String(lane?.swimmerName || ''),
        teamId: String(lane?.teamId || ''),
        teamName: String(lane?.teamName || ''),
        seedTime: String(lane?.seedTime || ''),
        readyConfirmed: !!lane?.readyConfirmed,
        readyAt: lane?.readyAt || null,
        stopAt: lane?.stopAt || null,
        provisionalMs:
          typeof lane?.provisionalMs === 'number' ? lane.provisionalMs : null,
        heatFinalTime: String(lane?.heatFinalTime || ''),
        status: String(lane?.status || 'OK'),
        submitted: !!lane?.submitted,
        submittedAt: lane?.submittedAt || null,
      }))
      .filter((lane) => lane.laneNumber > 0)
      .sort((a, b) => a.laneNumber - b.laneNumber);
  }, [starterSession]);

  const sessionSummary = useMemo(() => {
    const total = sessionLaneRows.length;
    const ready = sessionLaneRows.filter((lane) => lane.readyConfirmed).length;
    const stopped = sessionLaneRows.filter((lane) => !!lane.stopAt).length;
    const submitted = sessionLaneRows.filter((lane) => lane.submitted).length;

    return { total, ready, stopped, submitted };
  }, [sessionLaneRows]);

  const starterElapsedMs = useMemo(() => {
    if (
      starterSession?.status !== 'RUNNING' ||
      !starterSession?.startedAtServer
    ) {
      return 0;
    }
    return Math.max(0, starterNow - starterSession.startedAtServer);
  }, [starterNow, starterSession]);

  const starterDisplayTime = useMemo(() => {
    return formatElapsed(starterElapsedMs);
  }, [starterElapsedMs]);

  useEffect(() => {
    const activeMeetRef = ref(db, 'appState/activeMeetId');
    const unsub = onValue(activeMeetRef, (snap) => {
      setActiveMeetId(snap.val() || '');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeMeetId) {
      setActiveMeet(null);
      return;
    }

    const meetRef = ref(db, `meets/${activeMeetId}`);
    const unsub = onValue(meetRef, (snap) => {
      if (!snap.exists()) {
        setActiveMeet(null);
        return;
      }

      setActiveMeet({
        id: activeMeetId,
        ...snap.val(),
      });
    });

    return () => unsub();
  }, [activeMeetId]);

  useEffect(() => {
    if (!activeMeetId) {
      setEvents([]);
      setAllSeeding({});
      setLaneDevices({});
      setStarterSession(null);
      setSelectedEventId('');
      setSelectedHeatNumber(1);
      return;
    }

    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const seedingRef = ref(db, `meets/${activeMeetId}/seeding`);
    const laneDevicesRef = ref(db, `meets/${activeMeetId}/laneDevices`);
    const starterSessionRef = ref(
      db,
      `meets/${activeMeetId}/starterSession/current`
    );

    const unsubEvents = onValue(eventsRef, (snap) => {
      const val = snap.val();
      if (!val) {
        setEvents([]);
        return;
      }

      const rows: EventRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      rows.sort(
        (a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0)
      );
      setEvents(rows);
    });

    const unsubSeeding = onValue(seedingRef, (snap) => {
      setAllSeeding((snap.val() as Record<string, SavedSeedingNode>) || {});
    });

    const unsubLaneDevices = onValue(laneDevicesRef, (snap) => {
      setLaneDevices((snap.val() as Record<string, LaneDeviceRow>) || {});
    });

    const unsubStarterSession = onValue(starterSessionRef, (snap) => {
      setStarterSession((snap.val() as StarterSessionRow) || null);
    });

    return () => {
      unsubEvents();
      unsubSeeding();
      unsubLaneDevices();
      unsubStarterSession();
    };
  }, [activeMeetId]);

  useEffect(() => {
    if (!seededEventOptions.length) {
      setSelectedEventId('');
      return;
    }

    setSelectedEventId((prev) => {
      if (prev && seededEventOptions.some((event) => event.id === prev)) {
        return prev;
      }
      return seededEventOptions[0].id;
    });
  }, [seededEventOptions]);

  useEffect(() => {
    if (!selectedEventHeats.length) {
      setSelectedHeatNumber(1);
      return;
    }

    setSelectedHeatNumber((prev) => {
      if (selectedEventHeats.some((heat) => heat.heatNumber === prev)) {
        return prev;
      }
      return selectedEventHeats[0].heatNumber;
    });
  }, [selectedEventHeats]);

  const handleLoadHeat = async () => {
    if (!activeMeetId || !selectedEvent || !selectedHeat) {
      openModal(
        'Selection needed',
        'Please choose an event and heat before loading the starter session.'
      );
      return;
    }

    setBusy(true);

    try {
      const lanesPayload: Record<string, StarterLaneSessionRow> = {};

      selectedHeat.lanes.forEach((lane) => {
        lanesPayload[String(lane.laneNumber)] = {
          laneNumber: lane.laneNumber,
          entryId: lane.entryId,
          swimmerId: lane.swimmerId,
          swimmerName: lane.swimmerName,
          teamId: lane.teamId,
          teamName: lane.teamName,
          seedTime: lane.seedTime || '',
          readyConfirmed: false,
          readyAt: null,
          stopAt: null,
          provisionalMs: null,
          heatFinalTime: '',
          status: 'OK',
          submitted: false,
          submittedAt: null,
        };
      });

      await set(ref(db, `meets/${activeMeetId}/starterSession/current`), {
        eventId: selectedEvent.id,
        eventNumber: selectedEvent.eventNumber || 0,
        eventName: selectedEvent.name || '',
        gender: selectedEvent.gender || '',
        ageGroup: selectedEvent.ageGroup || '',
        stroke: selectedEvent.stroke || '',
        heatNumber: selectedHeat.heatNumber,
        laneCount,
        status: 'IDLE',
        startedAtServer: null,
        readyCheckSentAt: null,
        updatedAt: Date.now(),
        lanes: lanesPayload,
      });

      showInlineNotice(
        'Heat loaded',
        `Event ${selectedEvent.eventNumber || '—'} Heat ${
          selectedHeat.heatNumber
        } is now loaded into the starter console.`
      );
    } catch (error: any) {
      openModal(
        'Load failed',
        error?.message || 'The selected heat could not be loaded right now.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSendReadyCheck = async () => {
    if (!activeMeetId || !starterSession?.eventId) {
      openModal(
        'No heat loaded',
        'Please load a heat first, then send the ready check to lane timekeepers.'
      );
      return;
    }

    setBusy(true);

    try {
      await update(ref(db, `meets/${activeMeetId}/starterSession/current`), {
        status: 'READY_CHECK',
        readyCheckSentAt: Date.now(),
        updatedAt: Date.now(),
      });

      openModal(
        'Ready check sent',
        'A ready check has been sent. Each lane timekeeper can now confirm their swimmer details.'
      );
    } catch (error: any) {
      openModal(
        'Action failed',
        error?.message || 'The ready check could not be sent.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStartRace = async () => {
    if (!activeMeetId || !starterSession?.eventId) {
      openModal(
        'No heat loaded',
        'Please load a heat first before starting the race.'
      );
      return;
    }

    setBusy(true);

    try {
      await update(ref(db, `meets/${activeMeetId}/starterSession/current`), {
        status: 'RUNNING',
        startedAtServer: Date.now(),
        updatedAt: Date.now(),
      });

      setStartModeOpen(false);

      showInlineNotice(
        'Race started',
        'The race has started and all connected lane timers are now synced from the starter time.'
      );
    } catch (error: any) {
      openModal(
        'Start failed',
        error?.message || 'The race could not be started.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGeneratePins = async () => {
    if (!activeMeetId) {
      openModal(
        'No active meet',
        'Please select an active meet before generating lane PINs.'
      );
      return;
    }

    setBusy(true);

    try {
      const nextDevices: Record<string, LaneDeviceRow> = {};

      for (let lane = 1; lane <= laneCount; lane += 1) {
        nextDevices[String(lane)] = {
          laneNumber: lane,
          pin: generatePin(),
          active: true,
          updatedAt: Date.now(),
        };
      }

      await set(ref(db, `meets/${activeMeetId}/laneDevices`), nextDevices);

      openModal(
        'PINs generated',
        `Fresh PINs have been generated for lanes 1 to ${laneCount}.`
      );
    } catch (error: any) {
      openModal(
        'Generation failed',
        error?.message || 'Lane PINs could not be generated.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleResetPin = async (laneNumber: number) => {
    if (!activeMeetId) return;

    setBusy(true);

    try {
      await update(ref(db, `meets/${activeMeetId}/laneDevices/${laneNumber}`), {
        laneNumber,
        pin: generatePin(),
        active: true,
        updatedAt: Date.now(),
      });

      openModal(
        'PIN reset',
        `Lane ${laneNumber} has a new PIN and is now active.`
      );
    } catch (error: any) {
      openModal(
        'Reset failed',
        error?.message || `The PIN for lane ${laneNumber} could not be reset.`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleToggleLaneActive = async (
    laneNumber: number,
    nextActive: boolean
  ) => {
    if (!activeMeetId) return;

    setBusy(true);

    try {
      await update(ref(db, `meets/${activeMeetId}/laneDevices/${laneNumber}`), {
        laneNumber,
        active: nextActive,
        updatedAt: Date.now(),
      });

      openModal(
        nextActive ? 'Lane activated' : 'Lane deactivated',
        `Lane ${laneNumber} has been ${
          nextActive ? 'activated' : 'deactivated'
        }.`
      );
    } catch (error: any) {
      openModal(
        'Update failed',
        error?.message || `Lane ${laneNumber} could not be updated right now.`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLaneLink = async (laneNumber: number) => {
    if (!activeMeetId) return;

    try {
      const url = buildLaneLink(activeMeetId, laneNumber);
      await navigator.clipboard.writeText(url);

      openModal(
        'Link copied',
        `The lane ${laneNumber} timer link has been copied to your clipboard.`
      );
    } catch {
      openModal(
        'Copy failed',
        'The lane link could not be copied. Please try again.'
      );
    }
  };

  const handleOpenLaneLink = (laneNumber: number) => {
    if (!activeMeetId) return;

    const url = buildLaneLink(activeMeetId, laneNumber);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const renderEssentialReadyCards = () => {
    return (
      <div className="starter-essential-grid">
        {Array.from({ length: laneCount }, (_, i) => i + 1).map(
          (laneNumber) => {
            const laneSession = starterSession?.lanes?.[String(laneNumber)];
            const statusLabel = laneStatusLabel(
              laneSession,
              starterSession?.status
            );
            const isReadyWithTimestamp =
              statusLabel === 'Ready' && !!laneSession?.readyAt;

            return (
              <div
                className={`starter-essential-card ${
                  isReadyWithTimestamp ? 'ready' : ''
                }`}
                key={`essential-${laneNumber}`}
              >
                <div className="starter-essential-top">
                  <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
                    <div className="starter-lane-number">{laneNumber}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="starter-lane-name">
                        {laneSession?.swimmerName || 'No swimmer loaded'}
                      </div>
                      <div className="starter-lane-team">
                        {laneSession?.teamName || 'No team assigned'}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`starter-status-chip ${
                      isReadyWithTimestamp ? 'ready-chip' : ''
                    }`}
                    style={
                      isReadyWithTimestamp
                        ? undefined
                        : {
                            background: laneStatusColor(
                              laneSession,
                              starterSession?.status
                            ),
                          }
                    }
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
            );
          }
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        :root {
          color-scheme: dark;
        }

        * {
          box-sizing: border-box;
        }

        html, body, #root {
          min-height: 100%;
        }

        body {
          margin: 0;
          background:
            radial-gradient(circle at top, rgba(212,175,55,0.14), transparent 24%),
            linear-gradient(180deg, #07111f 0%, #081a2c 38%, #0b1f3a 100%);
        }

        .starter-standalone-page {
          min-height: 100vh;
          color: #f5f7fb;
          background:
            radial-gradient(circle at 15% 0%, rgba(212,175,55,0.12), transparent 22%),
            radial-gradient(circle at 85% 10%, rgba(79,137,255,0.12), transparent 24%),
            linear-gradient(180deg, #07111f 0%, #081a2c 38%, #0b1f3a 100%);
        }

        .starter-shell {
          width: 100%;
          max-width: 1680px;
          margin: 0 auto;
          padding: 26px 22px 40px;
        }

        .starter-page {
          display: grid;
          gap: 18px;
        }

        .starter-inline-notice {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.12);
          background: linear-gradient(180deg, rgba(67,160,71,0.18) 0%, rgba(31,106,53,0.22) 100%);
          box-shadow: 0 12px 28px rgba(0,0,0,0.18);
        }

        .starter-inline-notice.info {
          background: linear-gradient(180deg, rgba(67,136,239,0.16) 0%, rgba(31,79,130,0.20) 100%);
        }

        .starter-inline-notice-title {
          font-size: 15px;
          font-weight: 900;
          color: #ffffff;
          margin-bottom: 4px;
        }

        .starter-inline-notice-message {
          font-size: 13px;
          line-height: 1.55;
          color: #dce8f4;
        }

        .starter-inline-close {
          min-width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
          color: #ffffff;
          cursor: pointer;
          font-weight: 900;
        }

        .starter-card {
          position: relative;
          background: linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.045) 100%);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 22px;
          padding: 22px;
          box-shadow:
            0 18px 40px rgba(0,0,0,0.20),
            inset 0 1px 0 rgba(255,255,255,0.04);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          min-width: 0;
        }

        .starter-hero {
          position: relative;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
          gap: 18px;
          align-items: stretch;
          background:
            radial-gradient(circle at top right, rgba(212,175,55,0.22), transparent 28%),
            linear-gradient(135deg, rgba(7,17,31,0.98) 0%, rgba(11,31,58,0.97) 45%, rgba(15,54,105,0.95) 100%);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 28px;
          padding: 24px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.26);
        }

        .starter-hero::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
          pointer-events: none;
        }

        .starter-hero-left {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 18px;
          position: relative;
          z-index: 1;
        }

        .starter-brand-row {
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }

        .starter-logo {
          width: 72px;
          height: 72px;
          object-fit: contain;
          border-radius: 18px;
          background: rgba(255,255,255,0.08);
          padding: 8px;
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 10px 24px rgba(0,0,0,0.18);
          flex-shrink: 0;
        }

        .starter-title {
          font-size: clamp(2rem, 3vw, 3rem);
          font-weight: 900;
          line-height: 1.04;
          letter-spacing: -0.02em;
          color: #ffffff;
          word-break: break-word;
        }

        .starter-sub {
          margin-top: 7px;
          color: #cfdbeb;
          font-size: 14px;
          line-height: 1.55;
          max-width: 900px;
          word-break: break-word;
        }

        .starter-pill-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .starter-pill {
          padding: 9px 13px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          font-size: 12px;
          font-weight: 800;
          color: #ffffff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
          max-width: 100%;
          overflow-wrap: anywhere;
        }

        .starter-hero-meta {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .starter-meta-card {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 18px;
          padding: 16px;
          min-width: 0;
        }

        .starter-meta-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #a9bfd6;
          margin-bottom: 8px;
        }

        .starter-meta-value {
          font-size: 18px;
          font-weight: 900;
          color: #ffffff;
          line-height: 1.2;
          word-break: break-word;
        }

        .starter-meta-sub {
          margin-top: 6px;
          font-size: 12px;
          color: #bdd0e2;
          line-height: 1.45;
          word-break: break-word;
        }

        .starter-hero-right {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
          justify-content: space-between;
          min-width: 0;
        }

        .starter-primary-panel {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-height: 100%;
          justify-content: center;
          background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 22px;
          padding: 20px;
        }

        .starter-primary-eyebrow {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 900;
          color: #f1d67a;
        }

        .starter-primary-title {
          font-size: 28px;
          line-height: 1.1;
          font-weight: 900;
          color: #ffffff;
          word-break: break-word;
        }

        .starter-primary-sub {
          font-size: 14px;
          line-height: 1.6;
          color: #d2deec;
          word-break: break-word;
        }

        .starter-hero-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .starter-btn {
          width: auto;
          min-height: 46px;
          padding: 11px 16px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: #ffffff;
          font-weight: 800;
          font-size: 14px;
          line-height: 1.2;
          cursor: pointer;
          transition: transform 0.15s ease, opacity 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
          box-shadow: 0 10px 22px rgba(0,0,0,0.12);
          max-width: 100%;
          white-space: normal;
        }

        .starter-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          background: rgba(255,255,255,0.10);
        }

        .starter-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
        }

        .starter-btn.primary {
          background: linear-gradient(180deg, #f2cb55 0%, #d4af37 52%, #b89018 100%);
          color: #071426;
          border: none;
          box-shadow: 0 18px 34px rgba(212,175,55,0.28);
        }

        .starter-btn.primary:hover:not(:disabled) {
          background: linear-gradient(180deg, #f6d46a 0%, #d8b949 52%, #bd941d 100%);
          color: #071426;
        }

        .starter-btn.blue {
          background: linear-gradient(180deg, #4388ef 0%, #2f73d9 60%, #1f4f82 100%);
          border: none;
        }

        .starter-btn.green {
          background: linear-gradient(180deg, #4db15a 0%, #43a047 55%, #1f6a35 100%);
          border: none;
        }

        .starter-btn.warn {
          background: linear-gradient(180deg, #f4cf62 0%, #f4c542 60%, #b89018 100%);
          color: #071426;
          border: none;
        }

        .starter-btn.warn:hover:not(:disabled) {
          color: #ffffff !important;
        }

        .starter-btn.red {
          background: linear-gradient(180deg, #e3625e 0%, #d9534f 55%, #9f2f2b 100%);
          border: none;
        }

        .starter-btn.small {
          min-height: 36px;
          padding: 8px 11px;
          border-radius: 11px;
          font-size: 12px;
          box-shadow: none;
        }

        .starter-btn.start-mode {
          min-height: 60px;
          font-size: 18px;
          border-radius: 18px;
          width: 100%;
        }

        .starter-simple-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 18px;
          background: rgba(7,17,31,0.82);
          border: 1px solid rgba(255,255,255,0.10);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          box-shadow: 0 16px 34px rgba(0,0,0,0.24);
        }

        .starter-sticky-bar {
          position: sticky;
          top: 10px;
          z-index: 80;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: center;
          padding: 14px 16px;
          border-radius: 20px;
          background: rgba(7,17,31,0.82);
          border: 1px solid rgba(255,255,255,0.10);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
          box-shadow: 0 16px 34px rgba(0,0,0,0.24);
        }

        .starter-sticky-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .starter-sticky-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.10);
          font-size: 12px;
          font-weight: 800;
          color: #ffffff;
          white-space: nowrap;
          max-width: 100%;
        }

        .starter-sticky-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #60758a;
          box-shadow: 0 0 0 4px rgba(255,255,255,0.04);
          flex-shrink: 0;
        }

        .starter-sticky-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .starter-mode-switch {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.10);
          font-size: 12px;
          font-weight: 800;
          color: #ffffff;
        }

        .starter-toggle {
          position: relative;
          width: 56px;
          height: 30px;
          border-radius: 999px;
          background: rgba(255,255,255,0.18);
          border: 1px solid rgba(255,255,255,0.18);
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
          flex-shrink: 0;
        }

        .starter-toggle.active {
          background: linear-gradient(180deg, #43a047 0%, #1f6a35 100%);
          border-color: rgba(67,160,71,0.6);
        }

        .starter-toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.24);
          transition: transform 0.2s ease;
        }

        .starter-toggle.active .starter-toggle-knob {
          transform: translateX(26px);
        }

        .starter-top-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
          gap: 18px;
          align-items: stretch;
        }

        .starter-toolbar-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
          align-items: end;
        }

        .starter-field {
          min-width: 0;
        }

        .starter-field label {
          display: block;
          font-size: 13px;
          font-weight: 800;
          color: #cfdbeb;
          margin-bottom: 8px;
        }

        .starter-select {
          width: 100%;
          min-height: 48px;
          padding: 11px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: #ffffff;
          outline: none;
          box-sizing: border-box;
          font-size: 14px;
          appearance: none;
        }

        .starter-select option {
          color: #000;
        }

        .starter-readonly {
          width: 100%;
          min-height: 48px;
          padding: 11px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: #ffffff;
          display: flex;
          align-items: center;
          box-sizing: border-box;
          line-height: 1.45;
          word-break: break-word;
        }

        .starter-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 16px;
        }

        .starter-section-title {
          font-size: 22px;
          font-weight: 900;
          margin-bottom: 4px;
          color: #ffffff;
          word-break: break-word;
        }

        .starter-section-sub {
          color: #a9bfd6;
          font-size: 13px;
          line-height: 1.6;
          margin-bottom: 16px;
          word-break: break-word;
        }

        .starter-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .starter-stat {
          border-radius: 18px;
          padding: 18px;
          background: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.035) 100%);
          border: 1px solid rgba(255,255,255,0.09);
          min-width: 0;
        }

        .starter-stat-value {
          font-size: clamp(1.9rem, 2.8vw, 2.5rem);
          font-weight: 900;
          color: #f1d67a;
          line-height: 1;
        }

        .starter-stat-label {
          margin-top: 8px;
          color: #bad0e3;
          font-size: 13px;
          font-weight: 700;
        }

        .starter-timer-card {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 100%;
          background:
            radial-gradient(circle at top right, rgba(212,175,55,0.16), transparent 30%),
            linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.035) 100%);
        }

        .starter-timer-wrap {
          display: grid;
          place-items: center;
          padding: 14px 0 10px;
        }

        .starter-timer-display {
          font-size: clamp(3rem, 6vw, 4.9rem);
          font-weight: 900;
          line-height: 1;
          letter-spacing: 1px;
          color: #ffffff;
          text-align: center;
          text-shadow: 0 8px 24px rgba(0,0,0,0.26);
          word-break: break-word;
        }

        .starter-timer-status {
          margin-top: 16px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 13px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          flex-wrap: wrap;
          justify-content: center;
          text-align: center;
        }

        .starter-timer-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #60758a;
          flex-shrink: 0;
        }

        .starter-timer-footer {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .starter-mobile-note {
          display: none;
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          color: #cfe0ef;
          font-size: 12px;
          line-height: 1.5;
        }

        .starter-table-wrap {
          overflow: auto;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          background: rgba(255,255,255,0.03);
          -webkit-overflow-scrolling: touch;
        }

        .starter-table {
          width: 100%;
          min-width: 1120px;
          border-collapse: collapse;
          background: transparent;
        }

        .starter-table th,
        .starter-table td {
          border-bottom: 1px solid rgba(255,255,255,0.08);
          padding: 13px 12px;
          text-align: left;
          vertical-align: top;
          font-size: 13px;
          line-height: 1.4;
        }

        .starter-table th {
          background: rgba(255,255,255,0.06);
          color: #f1d67a;
          font-weight: 900;
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .starter-row-title {
          font-size: 15px;
          font-weight: 900;
          color: #ffffff;
          margin-bottom: 4px;
          word-break: break-word;
        }

        .starter-status-chip {
          display: inline-block;
          padding: 6px 10px;
          border-radius: 999px;
          color: #fff;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
          max-width: 100%;
        }

        .starter-status-chip.ready-chip {
          background: rgba(255,255,255,0.18) !important;
          color: #ffffff;
          border: 1px solid rgba(255,255,255,0.20);
        }

        .starter-actions-inline {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .starter-mobile-lanes {
          display: none;
          gap: 12px;
        }

        .starter-lane-card,
        .starter-essential-card {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          background: rgba(255,255,255,0.04);
          padding: 14px;
          display: grid;
          gap: 12px;
        }

        .starter-essential-card.ready {
          background: linear-gradient(180deg, rgba(20,84,35,0.96) 0%, rgba(19,70,31,0.96) 100%);
          border-color: rgba(67,160,71,0.55);
          color: #ffffff;
        }

        .starter-essential-card.ready .starter-lane-name,
        .starter-essential-card.ready .starter-lane-team,
        .starter-essential-card.ready .starter-lane-number {
          color: #ffffff;
        }

        .starter-essential-card.ready .starter-lane-number {
          background: rgba(255,255,255,0.14);
          border-color: rgba(255,255,255,0.18);
        }

        .starter-lane-card-top,
        .starter-essential-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .starter-lane-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(79,137,255,0.18);
          border: 1px solid rgba(79,137,255,0.32);
          font-size: 18px;
          font-weight: 900;
          color: #ffffff;
          flex-shrink: 0;
        }

        .starter-lane-name {
          font-size: 16px;
          font-weight: 900;
          color: #ffffff;
          line-height: 1.3;
          word-break: break-word;
        }

        .starter-lane-team {
          margin-top: 4px;
          font-size: 13px;
          color: #c9d9e7;
          line-height: 1.45;
          word-break: break-word;
        }

        .starter-lane-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .starter-lane-meta {
          border-radius: 14px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          min-width: 0;
        }

        .starter-lane-meta-label {
          font-size: 11px;
          font-weight: 800;
          color: #9fb8cc;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        .starter-lane-meta-value {
          font-size: 13px;
          font-weight: 800;
          color: #ffffff;
          line-height: 1.45;
          word-break: break-word;
        }

        .starter-lane-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .starter-lane-actions .starter-btn {
          width: 100%;
          justify-content: center;
        }

        .starter-essential-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .starter-essential-layout {
          display: grid;
          gap: 18px;
        }

        .starter-essential-top-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 0.75fr);
          gap: 18px;
          align-items: stretch;
        }

        .starter-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(3, 12, 24, 0.78);
          -webkit-backdrop-filter: blur(7px);
          backdrop-filter: blur(7px);
          z-index: 5000;
          display: grid;
          place-items: center;
          padding: 24px;
        }

        .starter-modal {
          width: 100%;
          max-width: 460px;
          background:
            radial-gradient(circle at top right, rgba(212,175,55,0.16), transparent 30%),
            rgba(11,31,58,0.98);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 22px;
          padding: 22px;
          box-shadow: 0 22px 64px rgba(0,0,0,0.35);
        }

        .starter-modal.start-mode-modal {
          max-width: 620px;
          text-align: center;
        }

        .starter-modal-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .starter-modal-header.centered {
          justify-content: center;
        }

        .starter-modal-logo {
          width: 42px;
          height: 42px;
          object-fit: contain;
          border-radius: 10px;
          background: rgba(255,255,255,0.08);
          padding: 4px;
          flex-shrink: 0;
        }

        .starter-modal-title {
          font-size: 20px;
          font-weight: 900;
          word-break: break-word;
        }

        .starter-modal-sub {
          font-size: 13px;
          color: #9fb3c8;
          margin-top: 2px;
        }

        .starter-modal-body {
          color: #f5f7fb;
          line-height: 1.6;
          margin-bottom: 18px;
          word-break: break-word;
        }

        .starter-start-modal-button {
          min-height: 128px;
          width: 100%;
          font-size: 1.8rem;
          border-radius: 24px;
          margin-top: 8px;
          box-shadow: 0 22px 42px rgba(31,106,53,0.34);
        }

        @media (max-width: 1180px) {
          .starter-hero,
          .starter-top-grid,
          .starter-essential-top-grid {
            grid-template-columns: 1fr;
          }

          .starter-hero-meta {
            grid-template-columns: 1fr;
          }

          .starter-primary-panel {
            min-height: auto;
          }
        }

        @media (max-width: 920px) {
          .starter-sticky-bar {
            grid-template-columns: 1fr;
            align-items: stretch;
          }

          .starter-sticky-actions {
            justify-content: stretch;
          }

          .starter-sticky-actions .starter-btn {
            flex: 1 1 180px;
          }

          .starter-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .starter-essential-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .starter-shell {
            padding: 14px 12px 28px;
          }

          .starter-page {
            gap: 14px;
          }

          .starter-card,
          .starter-hero {
            padding: 16px;
            border-radius: 20px;
          }

          .starter-brand-row {
            align-items: flex-start;
            gap: 12px;
          }

          .starter-logo {
            width: 58px;
            height: 58px;
            border-radius: 14px;
          }

          .starter-title {
            font-size: 26px;
          }

          .starter-primary-title {
            font-size: 24px;
          }

          .starter-btn {
            width: 100%;
          }

          .starter-actions,
          .starter-sticky-actions,
          .starter-actions-inline,
          .starter-lane-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .starter-stats {
            grid-template-columns: 1fr;
          }

          .starter-toolbar-grid {
            grid-template-columns: 1fr;
          }

          .starter-timer-display {
            font-size: clamp(2.4rem, 14vw, 4rem);
          }

          .starter-mobile-note {
            display: block;
          }

          .starter-table-wrap {
            display: none;
          }

          .starter-mobile-lanes {
            display: grid;
          }

          .starter-sticky-bar {
            top: 8px;
            padding: 12px;
            border-radius: 18px;
          }

          .starter-sticky-left {
            gap: 8px;
          }

          .starter-sticky-chip {
            width: 100%;
            justify-content: center;
            white-space: normal;
            text-align: center;
          }

          .starter-lane-grid {
            grid-template-columns: 1fr;
          }

          .starter-mode-switch {
            width: 100%;
            justify-content: space-between;
          }

          .starter-simple-topbar {
            flex-direction: column;
            align-items: stretch;
          }

          .starter-inline-notice {
            flex-direction: column;
            align-items: stretch;
          }

          .starter-start-modal-button {
            min-height: 190px;
            font-size: 1.45rem;
            border-radius: 22px;
          }
        }

        @media (max-width: 480px) {
          .starter-shell {
            padding: 12px 10px 24px;
          }

          .starter-card,
          .starter-hero {
            padding: 14px;
            border-radius: 18px;
          }

          .starter-title {
            font-size: 24px;
          }

          .starter-section-title {
            font-size: 20px;
          }

          .starter-primary-title {
            font-size: 22px;
          }

          .starter-pill,
          .starter-timer-status,
          .starter-sticky-chip {
            font-size: 11px;
          }

          .starter-stat {
            padding: 16px;
          }

          .starter-modal {
            padding: 18px;
            border-radius: 18px;
          }

          .starter-lane-number {
            min-width: 40px;
            height: 40px;
            border-radius: 12px;
            font-size: 17px;
          }

          .starter-start-modal-button {
            min-height: 230px;
            font-size: 1.45rem;
          }
        }
      `}</style>

      <div className="starter-standalone-page">
        {modal.open && (
          <div className="starter-modal-backdrop">
            <div className="starter-modal">
              <div className="starter-modal-header">
                <img
                  className="starter-modal-logo"
                  src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                  alt="Panthers"
                />
                <div>
                  <div className="starter-modal-title">{modal.title}</div>
                  <div className="starter-modal-sub">Starter Console</div>
                </div>
              </div>

              <div className="starter-modal-body">{modal.message}</div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="starter-btn primary" onClick={closeModal}>
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        {startModeOpen && (
          <div className="starter-modal-backdrop">
            <div className="starter-modal start-mode-modal">
              <div className="starter-modal-header centered">
                <img
                  className="starter-modal-logo"
                  src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                  alt="Panthers"
                />
                <div>
                  <div className="starter-modal-title">Start Mode</div>
                  <div className="starter-modal-sub">
                    Confirm and start the race timer for the loaded heat
                  </div>
                </div>
              </div>

              <div className="starter-modal-body">
                Event{' '}
                {starterSession?.eventNumber ||
                  selectedEvent?.eventNumber ||
                  '—'}{' '}
                • Heat {starterSession?.heatNumber || selectedHeatNumber || '—'}
              </div>

              <button
                className="starter-btn green starter-start-modal-button"
                onClick={handleStartRace}
                disabled={busy || !starterSession?.eventId}
              >
                Start Race
              </button>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  marginTop: 12,
                }}
              >
                <button
                  className="starter-btn"
                  onClick={() => setStartModeOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="starter-shell">
          <div className="starter-page">
            {inlineNotice.show && (
              <div
                className={`starter-inline-notice ${
                  inlineNotice.tone === 'info' ? 'info' : ''
                }`}
              >
                <div>
                  <div className="starter-inline-notice-title">
                    {inlineNotice.title}
                  </div>
                  <div className="starter-inline-notice-message">
                    {inlineNotice.message}
                  </div>
                </div>

                <button
                  className="starter-inline-close"
                  onClick={() =>
                    setInlineNotice((prev) => ({ ...prev, show: false }))
                  }
                  aria-label="Dismiss message"
                >
                  ×
                </button>
              </div>
            )}

            {!essentialMode && (
              <div className="starter-hero">
                <div className="starter-hero-left">
                  <div className="starter-brand-row">
                    <img
                      className="starter-logo"
                      src="https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png"
                      alt="Panthers"
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="starter-title">Starter Console</div>
                      <div className="starter-sub">{activeMeetLabel}</div>
                    </div>
                  </div>

                  <div className="starter-pill-row">
                    <span className="starter-pill">
                      Event: {selectedEvent?.eventNumber || '—'}
                    </span>
                    <span className="starter-pill">
                      Heat: {selectedHeatNumber || '—'}
                    </span>
                    <span className="starter-pill">
                      Session: {starterSession?.status || 'Not Loaded'}
                    </span>
                    <span className="starter-pill">Lanes: {laneCount}</span>
                  </div>

                  <div className="starter-hero-meta">
                    <div className="starter-meta-card">
                      <div className="starter-meta-label">Current Event</div>
                      <div className="starter-meta-value">
                        {selectedEvent?.name || 'No event selected'}
                      </div>
                      <div className="starter-meta-sub">
                        {selectedEvent?.stroke || '—'} •{' '}
                        {selectedEvent?.gender || '—'} •{' '}
                        {selectedEvent?.ageGroup || '—'}
                      </div>
                    </div>

                    <div className="starter-meta-card">
                      <div className="starter-meta-label">Heat Status</div>
                      <div className="starter-meta-value">
                        {starterSession?.status || 'Waiting'}
                      </div>
                      <div className="starter-meta-sub">
                        Ready: {sessionSummary.ready} / {sessionSummary.total}
                      </div>
                    </div>

                    <div className="starter-meta-card">
                      <div className="starter-meta-label">Live Stopwatch</div>
                      <div className="starter-meta-value">
                        {starterDisplayTime}
                      </div>
                      <div className="starter-meta-sub">
                        Started:{' '}
                        {formatDateTime(starterSession?.startedAtServer)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="starter-hero-right">
                  <div className="starter-primary-panel">
                    <div className="starter-primary-eyebrow">
                      Starter Action
                    </div>
                    <div className="starter-primary-title">
                      Race Start Control
                    </div>
                    <div className="starter-primary-sub">
                      This is the primary starter action for the loaded heat.
                      Once triggered, all connected lane timers will sync to the
                      starter time.
                    </div>

                    <div className="starter-hero-actions">
                      <button
                        className="starter-btn green"
                        onClick={() => setStartModeOpen(true)}
                        disabled={busy || !starterSession?.eventId}
                      >
                        Start Mode
                      </button>

                      <button
                        className="starter-btn blue"
                        onClick={handleSendReadyCheck}
                        disabled={busy || !starterSession?.eventId}
                      >
                        Send Ready Check
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {essentialMode ? (
              <div className="starter-simple-topbar">
                <div style={{ fontWeight: 900, color: '#ffffff' }}>
                  Essential Starter Mode
                </div>

                <div className="starter-mode-switch">
                  <span>{essentialMode ? 'Essential Mode' : 'Full Mode'}</span>
                  <button
                    type="button"
                    className={`starter-toggle ${
                      essentialMode ? 'active' : ''
                    }`}
                    onClick={() => setEssentialMode((prev) => !prev)}
                    aria-label="Toggle essential starter mode"
                    aria-pressed={essentialMode}
                  >
                    <span className="starter-toggle-knob" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="starter-sticky-bar">
                <div className="starter-sticky-left">
                  <span className="starter-sticky-chip">
                    <span
                      className="starter-sticky-dot"
                      style={{
                        background:
                          starterSession?.status === 'RUNNING'
                            ? '#43a047'
                            : starterSession?.status === 'READY_CHECK'
                            ? '#f4c542'
                            : starterSession?.status === 'IDLE'
                            ? '#4f89ff'
                            : '#60758a',
                      }}
                    />
                    {starterSession?.status === 'RUNNING'
                      ? 'Race Running'
                      : starterSession?.status === 'READY_CHECK'
                      ? 'Ready Check Sent'
                      : starterSession?.status === 'IDLE'
                      ? 'Heat Loaded'
                      : 'Waiting to Start'}
                  </span>

                  <span className="starter-sticky-chip">
                    Event{' '}
                    {starterSession?.eventNumber ||
                      selectedEvent?.eventNumber ||
                      '—'}
                  </span>

                  <span className="starter-sticky-chip">
                    Heat{' '}
                    {starterSession?.heatNumber || selectedHeatNumber || '—'}
                  </span>

                  <span className="starter-sticky-chip">
                    Timer {starterDisplayTime}
                  </span>

                  <div className="starter-mode-switch">
                    <span>
                      {essentialMode ? 'Essential Mode' : 'Full Mode'}
                    </span>
                    <button
                      type="button"
                      className={`starter-toggle ${
                        essentialMode ? 'active' : ''
                      }`}
                      onClick={() => setEssentialMode((prev) => !prev)}
                      aria-label="Toggle essential starter mode"
                      aria-pressed={essentialMode}
                    >
                      <span className="starter-toggle-knob" />
                    </button>
                  </div>
                </div>

                <div className="starter-sticky-actions">
                  <button
                    className="starter-btn primary"
                    onClick={handleLoadHeat}
                    disabled={busy || !selectedEvent || !selectedHeat}
                  >
                    Load Heat
                  </button>

                  <button
                    className="starter-btn warn"
                    onClick={handleGeneratePins}
                    disabled={busy || !activeMeetId}
                  >
                    Generate Lane PINs
                  </button>
                </div>
              </div>
            )}

            {essentialMode ? (
              <div className="starter-essential-layout">
                <div className="starter-essential-top-grid">
                  <div className="starter-card">
                    <div className="starter-section-title">
                      Select and Load Heat
                    </div>
                    <div className="starter-section-sub">
                      Choose the seeded event and heat, then load it into the
                      starter console.
                    </div>

                    <div className="starter-toolbar-grid">
                      <div className="starter-field">
                        <label>Event</label>
                        <select
                          className="starter-select"
                          value={selectedEventId}
                          onChange={(e) => setSelectedEventId(e.target.value)}
                        >
                          <option value="">Select event</option>
                          {seededEventOptions.map((event) => (
                            <option key={event.id} value={event.id}>
                              {event.eventNumber || '—'} -{' '}
                              {event.name || 'Unnamed Event'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="starter-field">
                        <label>Heat</label>
                        <select
                          className="starter-select"
                          value={selectedHeatNumber}
                          onChange={(e) =>
                            setSelectedHeatNumber(Number(e.target.value))
                          }
                        >
                          {selectedEventHeats.length === 0 ? (
                            <option value={1}>No heats</option>
                          ) : (
                            selectedEventHeats.map((heat) => (
                              <option
                                key={heat.heatNumber}
                                value={heat.heatNumber}
                              >
                                Heat {heat.heatNumber}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      <div className="starter-field">
                        <label>Heat Summary</label>
                        <div className="starter-readonly">
                          {selectedHeat
                            ? `${selectedHeat.lanes.length} lane(s) loaded in this heat`
                            : 'Select event and heat'}
                        </div>
                      </div>
                    </div>

                    <div className="starter-actions">
                      <button
                        className="starter-btn primary"
                        onClick={handleLoadHeat}
                        disabled={busy || !selectedEvent || !selectedHeat}
                      >
                        Load Heat
                      </button>

                      <button
                        className="starter-btn green start-mode"
                        onClick={() => setStartModeOpen(true)}
                        disabled={busy || !starterSession?.eventId}
                      >
                        Start Mode
                      </button>
                    </div>
                  </div>

                  <div className="starter-card starter-timer-card">
                    <div>
                      <div className="starter-section-title">
                        Starter Stopwatch
                      </div>
                      <div className="starter-section-sub">
                        Live starter timer for the currently loaded heat.
                      </div>
                    </div>

                    <div className="starter-timer-wrap">
                      <div className="starter-timer-display">
                        {starterDisplayTime}
                      </div>

                      <div className="starter-timer-status">
                        <span
                          className="starter-timer-dot"
                          style={{
                            background:
                              starterSession?.status === 'RUNNING'
                                ? '#43a047'
                                : starterSession?.status === 'READY_CHECK'
                                ? '#f4c542'
                                : '#60758a',
                          }}
                        />
                        {starterSession?.status === 'RUNNING'
                          ? 'Race Running'
                          : starterSession?.status === 'READY_CHECK'
                          ? 'Ready Check Sent'
                          : starterSession?.status === 'IDLE'
                          ? 'Heat Loaded'
                          : 'Waiting to Start'}
                      </div>
                    </div>

                    <div className="starter-timer-footer">
                      <span className="starter-pill">
                        Started At:{' '}
                        {formatDateTime(starterSession?.startedAtServer)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="starter-card">
                  <div className="starter-section-title">Lane Ready Status</div>
                  <div className="starter-section-sub">
                    Essential starter view showing only the required lane
                    readiness cards.
                  </div>
                  {renderEssentialReadyCards()}
                </div>
              </div>
            ) : (
              <>
                <div className="starter-top-grid">
                  <div className="starter-card">
                    <div className="starter-section-title">
                      Load Event and Heat
                    </div>
                    <div className="starter-section-sub">
                      Select the seeded event and heat you want to control from
                      the starter console.
                    </div>

                    <div className="starter-toolbar-grid">
                      <div className="starter-field">
                        <label>Event</label>
                        <select
                          className="starter-select"
                          value={selectedEventId}
                          onChange={(e) => setSelectedEventId(e.target.value)}
                        >
                          <option value="">Select event</option>
                          {seededEventOptions.map((event) => (
                            <option key={event.id} value={event.id}>
                              {event.eventNumber || '—'} -{' '}
                              {event.name || 'Unnamed Event'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="starter-field">
                        <label>Heat</label>
                        <select
                          className="starter-select"
                          value={selectedHeatNumber}
                          onChange={(e) =>
                            setSelectedHeatNumber(Number(e.target.value))
                          }
                        >
                          {selectedEventHeats.length === 0 ? (
                            <option value={1}>No heats</option>
                          ) : (
                            selectedEventHeats.map((heat) => (
                              <option
                                key={heat.heatNumber}
                                value={heat.heatNumber}
                              >
                                Heat {heat.heatNumber}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      <div className="starter-field">
                        <label>Heat Summary</label>
                        <div className="starter-readonly">
                          {selectedHeat
                            ? `${selectedHeat.lanes.length} lane(s) loaded in this heat`
                            : 'Select event and heat'}
                        </div>
                      </div>
                    </div>

                    <div className="starter-actions">
                      <button
                        className="starter-btn primary"
                        onClick={handleLoadHeat}
                        disabled={busy || !selectedEvent || !selectedHeat}
                      >
                        Load Heat
                      </button>

                      <button
                        className="starter-btn blue"
                        onClick={handleSendReadyCheck}
                        disabled={busy || !starterSession?.eventId}
                      >
                        Send Ready Check
                      </button>

                      <button
                        className="starter-btn green"
                        onClick={() => setStartModeOpen(true)}
                        disabled={busy || !starterSession?.eventId}
                      >
                        Start Mode
                      </button>

                      <button
                        className="starter-btn warn"
                        onClick={handleGeneratePins}
                        disabled={busy || !activeMeetId}
                      >
                        Generate Lane PINs
                      </button>
                    </div>
                  </div>

                  <div className="starter-card starter-timer-card">
                    <div>
                      <div className="starter-section-title">
                        Starter Stopwatch
                      </div>
                      <div className="starter-section-sub">
                        Visual race timer for the starter. It begins when the
                        Start Mode button is confirmed and follows the live
                        starter session.
                      </div>
                    </div>

                    <div className="starter-timer-wrap">
                      <div className="starter-timer-display">
                        {starterDisplayTime}
                      </div>

                      <div className="starter-timer-status">
                        <span
                          className="starter-timer-dot"
                          style={{
                            background:
                              starterSession?.status === 'RUNNING'
                                ? '#43a047'
                                : starterSession?.status === 'READY_CHECK'
                                ? '#f4c542'
                                : '#60758a',
                          }}
                        />
                        {starterSession?.status === 'RUNNING'
                          ? 'Race Running'
                          : starterSession?.status === 'READY_CHECK'
                          ? 'Ready Check Sent'
                          : starterSession?.status === 'IDLE'
                          ? 'Heat Loaded'
                          : 'Waiting to Start'}
                      </div>
                    </div>

                    <div className="starter-timer-footer">
                      <span className="starter-pill">
                        Started At:{' '}
                        {formatDateTime(starterSession?.startedAtServer)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="starter-card">
                  <div className="starter-section-title">
                    Starter Session Overview
                  </div>
                  <div className="starter-section-sub">
                    Monitor readiness, stop states, and final submissions from
                    all lane devices.
                  </div>

                  <div className="starter-stats">
                    <div className="starter-stat">
                      <div className="starter-stat-value">
                        {sessionSummary.total}
                      </div>
                      <div className="starter-stat-label">Lanes in Session</div>
                    </div>

                    <div className="starter-stat">
                      <div className="starter-stat-value">
                        {sessionSummary.ready}
                      </div>
                      <div className="starter-stat-label">Ready Confirmed</div>
                    </div>

                    <div className="starter-stat">
                      <div className="starter-stat-value">
                        {sessionSummary.stopped}
                      </div>
                      <div className="starter-stat-label">Stopped</div>
                    </div>

                    <div className="starter-stat">
                      <div className="starter-stat-value">
                        {sessionSummary.submitted}
                      </div>
                      <div className="starter-stat-label">Submitted</div>
                    </div>
                  </div>
                </div>

                <div className="starter-card">
                  <div className="starter-section-title">
                    Lane Devices and Live Status
                  </div>
                  <div className="starter-section-sub">
                    Manage lane links, PINs, active state, and monitor each lane
                    timer in a live operational table.
                  </div>

                  <div className="starter-mobile-note">
                    Mobile view shows each lane as a card for easier control. On
                    larger screens, the full operational table is shown.
                  </div>

                  <div className="starter-table-wrap">
                    <table className="starter-table">
                      <thead>
                        <tr>
                          <th style={{ width: 70 }}>Lane</th>
                          <th style={{ width: 220 }}>Swimmer</th>
                          <th style={{ width: 160 }}>Team</th>
                          <th style={{ width: 100 }}>Seed Time</th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 90 }}>PIN</th>
                          <th style={{ width: 90 }}>Device</th>
                          <th style={{ width: 170 }}>Ready At</th>
                          <th style={{ width: 170 }}>Submitted At</th>
                          <th style={{ width: 280 }}>Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {Array.from({ length: laneCount }, (_, i) => i + 1).map(
                          (laneNumber) => {
                            const laneSession =
                              starterSession?.lanes?.[String(laneNumber)];
                            const laneDevice =
                              laneDevices?.[String(laneNumber)];
                            const chipColor = laneStatusColor(
                              laneSession,
                              starterSession?.status
                            );

                            return (
                              <tr key={laneNumber}>
                                <td>
                                  <div className="starter-row-title">
                                    {laneNumber}
                                  </div>
                                </td>

                                <td>
                                  <div className="starter-row-title">
                                    {laneSession?.swimmerName ||
                                      'No swimmer loaded'}
                                  </div>
                                </td>

                                <td>
                                  <div className="starter-row-title">
                                    {laneSession?.teamName ||
                                      'No team assigned'}
                                  </div>
                                </td>

                                <td>{laneSession?.seedTime || '—'}</td>

                                <td>
                                  <span
                                    className="starter-status-chip"
                                    style={{ background: chipColor }}
                                  >
                                    {laneStatusLabel(
                                      laneSession,
                                      starterSession?.status
                                    )}
                                  </span>
                                </td>

                                <td>{laneDevice?.pin || '—'}</td>

                                <td>
                                  <span
                                    className="starter-status-chip"
                                    style={{
                                      background:
                                        laneDevice?.active === false
                                          ? '#d9534f'
                                          : '#43a047',
                                    }}
                                  >
                                    {laneDevice?.active === false
                                      ? 'Inactive'
                                      : 'Active'}
                                  </span>
                                </td>

                                <td>{formatDateTime(laneSession?.readyAt)}</td>

                                <td>
                                  {formatDateTime(laneSession?.submittedAt)}
                                </td>

                                <td>
                                  <div className="starter-actions-inline">
                                    <button
                                      className="starter-btn small"
                                      onClick={() =>
                                        handleCopyLaneLink(laneNumber)
                                      }
                                      disabled={busy || !activeMeetId}
                                    >
                                      Copy Link
                                    </button>

                                    <button
                                      className="starter-btn small"
                                      onClick={() =>
                                        handleOpenLaneLink(laneNumber)
                                      }
                                      disabled={busy || !activeMeetId}
                                    >
                                      Open Link
                                    </button>

                                    <button
                                      className="starter-btn small warn"
                                      onClick={() => handleResetPin(laneNumber)}
                                      disabled={busy || !activeMeetId}
                                    >
                                      Reset PIN
                                    </button>

                                    <button
                                      className={
                                        laneDevice?.active === false
                                          ? 'starter-btn small green'
                                          : 'starter-btn small red'
                                      }
                                      onClick={() =>
                                        handleToggleLaneActive(
                                          laneNumber,
                                          laneDevice?.active === false
                                        )
                                      }
                                      disabled={busy || !activeMeetId}
                                    >
                                      {laneDevice?.active === false
                                        ? 'Activate'
                                        : 'Deactivate'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="starter-mobile-lanes">
                    {Array.from({ length: laneCount }, (_, i) => i + 1).map(
                      (laneNumber) => {
                        const laneSession =
                          starterSession?.lanes?.[String(laneNumber)];
                        const laneDevice = laneDevices?.[String(laneNumber)];
                        const chipColor = laneStatusColor(
                          laneSession,
                          starterSession?.status
                        );

                        return (
                          <div
                            className="starter-lane-card"
                            key={`mobile-${laneNumber}`}
                          >
                            <div className="starter-lane-card-top">
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 12,
                                  minWidth: 0,
                                }}
                              >
                                <div className="starter-lane-number">
                                  {laneNumber}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div className="starter-lane-name">
                                    {laneSession?.swimmerName ||
                                      'No swimmer loaded'}
                                  </div>
                                  <div className="starter-lane-team">
                                    {laneSession?.teamName ||
                                      'No team assigned'}
                                  </div>
                                </div>
                              </div>

                              <span
                                className="starter-status-chip"
                                style={{ background: chipColor }}
                              >
                                {laneStatusLabel(
                                  laneSession,
                                  starterSession?.status
                                )}
                              </span>
                            </div>

                            <div className="starter-lane-grid">
                              <div className="starter-lane-meta">
                                <div className="starter-lane-meta-label">
                                  Seed Time
                                </div>
                                <div className="starter-lane-meta-value">
                                  {laneSession?.seedTime || '—'}
                                </div>
                              </div>

                              <div className="starter-lane-meta">
                                <div className="starter-lane-meta-label">
                                  PIN
                                </div>
                                <div className="starter-lane-meta-value">
                                  {laneDevice?.pin || '—'}
                                </div>
                              </div>

                              <div className="starter-lane-meta">
                                <div className="starter-lane-meta-label">
                                  Device
                                </div>
                                <div className="starter-lane-meta-value">
                                  <span
                                    className="starter-status-chip"
                                    style={{
                                      background:
                                        laneDevice?.active === false
                                          ? '#d9534f'
                                          : '#43a047',
                                    }}
                                  >
                                    {laneDevice?.active === false
                                      ? 'Inactive'
                                      : 'Active'}
                                  </span>
                                </div>
                              </div>

                              <div className="starter-lane-meta">
                                <div className="starter-lane-meta-label">
                                  Ready At
                                </div>
                                <div className="starter-lane-meta-value">
                                  {formatDateTime(laneSession?.readyAt)}
                                </div>
                              </div>

                              <div className="starter-lane-meta">
                                <div className="starter-lane-meta-label">
                                  Submitted At
                                </div>
                                <div className="starter-lane-meta-value">
                                  {formatDateTime(laneSession?.submittedAt)}
                                </div>
                              </div>
                            </div>

                            <div className="starter-lane-actions">
                              <button
                                className="starter-btn small"
                                onClick={() => handleCopyLaneLink(laneNumber)}
                                disabled={busy || !activeMeetId}
                              >
                                Copy Link
                              </button>

                              <button
                                className="starter-btn small"
                                onClick={() => handleOpenLaneLink(laneNumber)}
                                disabled={busy || !activeMeetId}
                              >
                                Open Link
                              </button>

                              <button
                                className="starter-btn small warn"
                                onClick={() => handleResetPin(laneNumber)}
                                disabled={busy || !activeMeetId}
                              >
                                Reset PIN
                              </button>

                              <button
                                className={
                                  laneDevice?.active === false
                                    ? 'starter-btn small green'
                                    : 'starter-btn small red'
                                }
                                onClick={() =>
                                  handleToggleLaneActive(
                                    laneNumber,
                                    laneDevice?.active === false
                                  )
                                }
                                disabled={busy || !activeMeetId}
                              >
                                {laneDevice?.active === false
                                  ? 'Activate'
                                  : 'Deactivate'}
                              </button>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
