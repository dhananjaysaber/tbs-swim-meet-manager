import { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase/db.js';

type ScoreboardLane = {
  laneNumber?: number;
  swimmerName?: string;
  teamName?: string;
  time?: string;
  status?: string;
  place?: number | null;
};

type ScoreboardBoard = {
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  heatNumber?: number;
  showTimes?: boolean;
  updatedAt?: number;
  rows?: Record<string, ScoreboardLane>;
};

type EventRow = {
  id: string;
  active?: boolean;
  name?: string;
  eventNumber?: number;
  recordTime?: string;
  recordHolder?: string;
  recordYear?: string | number;
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
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  heats?: Record<string, SavedHeatNode>;
  laneCount?: number;
};

type DisplayRow = {
  key: string;
  lane: number;
  name: string;
  team: string;
  time: string;
  status: string;
  place: number | null;
};

type IdleSlide = {
  kicker: string;
  title: string;
  subtitle: string;
};

function compactEventTitle(
  eventNumber?: number,
  eventName?: string,
  heatNumber?: number
) {
  const raw = String(eventName || '').trim();

  if (!raw) {
    return `EVENT ${eventNumber || '—'} | ${
      heatNumber ? `HEAT ${heatNumber}` : 'READY'
    }`;
  }

  let title = raw;
  title = title.replace(/\s*[—-]\s*Heats?$/i, '');
  title = title.replace(/\s*[—-]\s*Finals?$/i, '');
  title = title.replace(/\s*[—-]\s*Timed Finals?$/i, '');
  title = title.replace(/\s+/g, ' ').trim();

  const isFinal = /final/i.test(raw) && !/heat/i.test(raw);
  const suffix = isFinal ? 'FINAL' : `HEAT ${heatNumber || 1}`;

  return `EVENT ${eventNumber || '—'} | ${title.toUpperCase()} | ${suffix}`;
}

function lanePalette(lane: number) {
  const colors = [
    {
      bg: 'linear-gradient(135deg, #d40011 0%, #ff2f2f 100%)',
      glow: 'rgba(255, 47, 47, 0.48)',
    },
    {
      bg: 'linear-gradient(135deg, #c98a00 0%, #ffcc27 100%)',
      glow: 'rgba(255, 204, 39, 0.44)',
    },
    {
      bg: 'linear-gradient(135deg, #148c18 0%, #33df58 100%)',
      glow: 'rgba(51, 223, 88, 0.44)',
    },
    {
      bg: 'linear-gradient(135deg, #0e73ba 0%, #27b6ff 100%)',
      glow: 'rgba(39, 182, 255, 0.44)',
    },
    {
      bg: 'linear-gradient(135deg, #4e1ca8 0%, #8c4dff 100%)',
      glow: 'rgba(140, 77, 255, 0.42)',
    },
    {
      bg: 'linear-gradient(135deg, #9b2c8f 0%, #ea5fda 100%)',
      glow: 'rgba(234, 95, 218, 0.4)',
    },
    {
      bg: 'linear-gradient(135deg, #0d8b85 0%, #24d9c8 100%)',
      glow: 'rgba(36, 217, 200, 0.42)',
    },
    {
      bg: 'linear-gradient(135deg, #6e4a18 0%, #c9923d 100%)',
      glow: 'rgba(201, 146, 61, 0.42)',
    },
  ];

  return colors[(Math.max(1, lane) - 1) % colors.length];
}

function heatHasLanes(heat?: SavedHeatNode | null) {
  if (!heat?.lanes) return false;

  return Object.values(heat.lanes).some(
    (lane) => Number(lane?.laneNumber || 0) > 0
  );
}

function countValidBoardRows(board?: ScoreboardBoard | null) {
  if (!board?.rows) return 0;

  return Object.values(board.rows).filter((row) => {
    return (
      Number(row?.laneNumber || 0) > 0 &&
      (String(row?.swimmerName || '').trim() ||
        String(row?.teamName || '').trim() ||
        String(row?.time || '').trim())
    );
  }).length;
}

function normalizeStatus(value?: string) {
  const s = String(value || 'OK')
    .trim()
    .toUpperCase();
  if (['OK', 'DQ', 'NS', 'SCR'].includes(s)) return s;
  return 'OK';
}

function parseSwimTimeToHundredths(value?: string) {
  const text = String(value || '').trim();
  if (!text) return null;

  const mmss = text.match(/^(\d{1,2}):(\d{2})\.(\d{2})$/);
  if (mmss) {
    const mm = Number(mmss[1]);
    const ss = Number(mmss[2]);
    const hh = Number(mmss[3]);
    if ([mm, ss, hh].some((n) => Number.isNaN(n))) return null;
    return mm * 6000 + ss * 100 + hh;
  }

  const ss = text.match(/^(\d{1,2})\.(\d{2})$/);
  if (ss) {
    const sec = Number(ss[1]);
    const hh = Number(ss[2]);
    if ([sec, hh].some((n) => Number.isNaN(n))) return null;
    return sec * 100 + hh;
  }

  return null;
}

export default function LEDScoreboard() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [meetName, setMeetName] = useState('');
  const [board, setBoard] = useState<ScoreboardBoard | null>(null);
  const [eventsMap, setEventsMap] = useState<Record<string, EventRow>>({});
  const [allSeeding, setAllSeeding] = useState<
    Record<string, SavedSeedingNode>
  >({});
  const [animateToken, setAnimateToken] = useState(0);
  const [resultsFlash, setResultsFlash] = useState(false);
  const [idleIndex, setIdleIndex] = useState(0);
  const [displayBoardEnabled, setDisplayBoardEnabled] = useState(true);

  const prevUpdatedAtRef = useRef<number>(0);
  const prevShowTimesRef = useRef<boolean>(false);
  const resultsFlashTimeoutRef = useRef<number | null>(null);

  const idleSlides: IdleSlide[] = useMemo(
    () => [
      {
        kicker: 'Panthers Swim Meet Manager',
        title: 'Scoreboard Ready',
        subtitle: 'Heat and lane display for the Meet.',
      },
      {
        kicker: 'Live Meet Display',
        title: 'Panthers Swimming',
        subtitle:
          'Professional meet for events, lanes, team names and results.',
      },
      {
        kicker: 'Standby Screen',
        title: meetName || 'Swim Meet In Progress',
        subtitle: 'Waiting for the next valid seeded heat.',
      },
    ],
    [meetName]
  );

  useEffect(() => {
    const unsub = onValue(ref(db, 'appState/activeMeetId'), (snap) => {
      setActiveMeetId(snap.val() || '');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeMeetId) {
      setMeetName('');
      setBoard(null);
      setEventsMap({});
      setAllSeeding({});
      return;
    }

    const meetRef = ref(db, `meets/${activeMeetId}`);
    const liveRef = ref(db, `meets/${activeMeetId}/liveDisplay`);
    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const seedingRef = ref(db, `meets/${activeMeetId}/seeding`);

    const unsubMeet = onValue(meetRef, (snap) => {
      setMeetName(snap.val()?.name || '');
    });

    const unsubLive = onValue(liveRef, (snap) => {
      const liveValue = snap.val() || {};
      const nextBoard = liveValue?.scoreboard || null;
      const nextUpdatedAt = Number(nextBoard?.updatedAt || 0);
      const nextShowTimes = !!nextBoard?.showTimes;

      if (typeof liveValue?.showScoreboard === 'boolean') {
        setDisplayBoardEnabled(liveValue.showScoreboard);
      } else {
        setDisplayBoardEnabled(true);
      }

      const shouldAnimate =
        !!nextBoard &&
        (nextUpdatedAt !== prevUpdatedAtRef.current ||
          nextShowTimes !== prevShowTimesRef.current);

      setBoard(nextBoard);

      if (shouldAnimate) {
        setAnimateToken((v) => v + 1);

        if (nextShowTimes) {
          setResultsFlash(true);

          if (resultsFlashTimeoutRef.current) {
            window.clearTimeout(resultsFlashTimeoutRef.current);
          }

          resultsFlashTimeoutRef.current = window.setTimeout(() => {
            setResultsFlash(false);
          }, 1500);
        }
      }

      prevUpdatedAtRef.current = nextUpdatedAt;
      prevShowTimesRef.current = nextShowTimes;
    });

    const unsubEvents = onValue(eventsRef, (snap) => {
      const value = snap.val() || {};
      const nextMap: Record<string, EventRow> = {};

      Object.entries(value).forEach(([id, item]: any) => {
        nextMap[id] = {
          id,
          ...item,
        };
      });

      setEventsMap(nextMap);
    });

    const unsubSeeding = onValue(seedingRef, (snap) => {
      setAllSeeding((snap.val() as Record<string, SavedSeedingNode>) || {});
    });

    return () => {
      unsubMeet();
      unsubLive();
      unsubEvents();
      unsubSeeding();

      if (resultsFlashTimeoutRef.current) {
        window.clearTimeout(resultsFlashTimeoutRef.current);
      }
    };
  }, [activeMeetId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIdleIndex((prev) => (prev + 1) % idleSlides.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, [idleSlides.length]);

  const boardIsValid = useMemo(() => {
    if (!activeMeetId) return false;
    if (!displayBoardEnabled) return false;
    if (!board) return false;

    const eventId = String(board.eventId || '').trim();
    const heatNumber = Number(board.heatNumber || 0);
    const boardRowCount = countValidBoardRows(board);

    if (!eventId) return false;
    if (heatNumber <= 0) return false;
    if (boardRowCount <= 0) return false;

    const event = eventsMap[eventId];
    if (!event || event.active === false) return false;

    const seedingNode = allSeeding[eventId];
    if (!seedingNode?.heats) return false;

    const matchingHeat = Object.values(seedingNode.heats).find((heat) => {
      return Number(heat?.heatNumber || 0) === heatNumber;
    });

    if (!matchingHeat) return false;
    if (!heatHasLanes(matchingHeat)) return false;

    return true;
  }, [activeMeetId, displayBoardEnabled, board, eventsMap, allSeeding]);

  const rows = useMemo(() => {
    if (!boardIsValid || !board?.rows) return [] as DisplayRow[];

    const data = Object.entries(board.rows).map(([key, r]) => ({
      key,
      lane: Number(r.laneNumber || 0),
      name: String(r.swimmerName || '').trim(),
      team: String(r.teamName || '').trim(),
      time: String(r.time || '').trim(),
      status: String(r.status || 'OK'),
      place:
        typeof r.place === 'number' && !Number.isNaN(r.place) ? r.place : null,
    })) as DisplayRow[];

    if (board?.showTimes) {
      data.sort((a, b) => {
        const aTime = parseSwimTimeToHundredths(a.time);
        const bTime = parseSwimTimeToHundredths(b.time);

        if (aTime === null && bTime === null) return a.lane - b.lane;
        if (aTime === null) return 1;
        if (bTime === null) return -1;

        return aTime - bTime;
      });
    } else {
      data.sort((a, b) => a.lane - b.lane);
    }

    return data.filter((r) => r.lane > 0);
  }, [boardIsValid, board]);

  const rowCount = rows.length || 8;

  const layoutVars = useMemo(() => {
    if (rowCount <= 4) {
      return {
        outerPad: '20px',
        topPad: '18px',
        logoFont: 'clamp(2.5rem, 5vw, 4.8rem)',
        resultsFont: 'clamp(1.4rem, 2.5vw, 2.4rem)',
        meetFont: 'clamp(1.2rem, 1.6vw, 1.35rem)',
        eventFont: 'clamp(1.55rem, 2vw, 1.8rem)',
        laneLabelFont: 'clamp(1rem, 1.7vw, 1.45rem)',
        laneNumFont: 'clamp(2rem, 4vw, 3.4rem)',
        nameFont: 'clamp(2.2rem, 3.4vw, 3rem)',
        teamFont: 'clamp(1.1rem, 2vw, 1.65rem)',
        timeFont: 'clamp(2.2rem, 3.7vw, 3.4rem)',
        rowH: '102px',
      };
    }

    if (rowCount <= 6) {
      return {
        outerPad: '18px',
        topPad: '16px',
        logoFont: 'clamp(2.15rem, 4.6vw, 4.3rem)',
        resultsFont: 'clamp(1.2rem, 2.2vw, 2rem)',
        meetFont: 'clamp(1.8rem, 1.4vw, 1.22rem)',
        eventFont: 'clamp(1.05rem, 1.7vw, 1.55rem)',
        laneLabelFont: 'clamp(0.9rem, 1.4vw, 1.2rem)',
        laneNumFont: 'clamp(1.75rem, 3.4vw, 2.9rem)',
        nameFont: 'clamp(1.7rem, 2.8vw, 2.45rem)',
        teamFont: 'clamp(1rem, 1.7vw, 1.45rem)',
        timeFont: 'clamp(2.2rem, 3.1vw, 2.9rem)',
        rowH: '98px',
      };
    }

    if (rowCount <= 8) {
      return {
        outerPad: '16px',
        topPad: '14px',
        logoFont: 'clamp(1.9rem, 4vw, 3.8rem)',
        resultsFont: 'clamp(1.05rem, 1.8vw, 1.7rem)',
        meetFont: 'clamp(0.82rem, 1.25vw, 1.08rem)',
        eventFont: 'clamp(0.98rem, 1.45vw, 1.3rem)',
        laneLabelFont: 'clamp(0.82rem, 1.1vw, 1rem)',
        laneNumFont: 'clamp(1.45rem, 2.5vw, 2.25rem)',
        nameFont: 'clamp(1.6rem, 2vw, 1.85rem)',
        teamFont: 'clamp(0.9rem, 1.35vw, 1.15rem)',
        timeFont: 'clamp(1.55rem, 2.7vw, 2.3rem)',
        rowH: '68px',
      };
    }

    return {
      outerPad: '14px',
      topPad: '12px',
      logoFont: 'clamp(1.6rem, 3.2vw, 3rem)',
      resultsFont: 'clamp(0.95rem, 1.45vw, 1.35rem)',
      meetFont: 'clamp(0.75rem, 1vw, 0.95rem)',
      eventFont: 'clamp(0.85rem, 1.1vw, 1.05rem)',
      laneLabelFont: 'clamp(0.72rem, 0.9vw, 0.86rem)',
      laneNumFont: 'clamp(1.2rem, 2vw, 1.8rem)',
      nameFont: 'clamp(1rem, 1.4vw, 1.45rem)',
      teamFont: 'clamp(0.8rem, 1vw, 0.96rem)',
      timeFont: 'clamp(1.2rem, 2vw, 1.9rem)',
      rowH: '56px',
    };
  }, [rowCount]);

  const showTimes = boardIsValid && !!board?.showTimes;

  const currentEvent = useMemo(() => {
    if (!boardIsValid || !board?.eventId) return null;
    return eventsMap[String(board.eventId)] || null;
  }, [boardIsValid, board, eventsMap]);

  const recordInfo = useMemo(() => {
    if (!showTimes) {
      return {
        mode: 'record',
        recordTime: currentEvent?.recordTime || '',
        recordHolder: currentEvent?.recordHolder || '',
        recordYear: currentEvent?.recordYear || '',
      } as const;
    }

    const recordTime = String(currentEvent?.recordTime || '').trim();
    const recordHundredths = parseSwimTimeToHundredths(recordTime);

    if (recordHundredths === null) {
      return {
        mode: 'record',
        recordTime: '',
        recordHolder: currentEvent?.recordHolder || '',
        recordYear: currentEvent?.recordYear || '',
      } as const;
    }

    const validRows = rows
      .filter((row) => normalizeStatus(row.status) === 'OK')
      .filter((row) => parseSwimTimeToHundredths(row.time) !== null)
      .sort((a, b) => {
        const aTime = parseSwimTimeToHundredths(a.time) || 0;
        const bTime = parseSwimTimeToHundredths(b.time) || 0;
        return aTime - bTime;
      });

    const bestRow = validRows[0];
    if (!bestRow) {
      return {
        mode: 'record',
        recordTime,
        recordHolder: currentEvent?.recordHolder || '',
        recordYear: currentEvent?.recordYear || '',
      } as const;
    }

    const bestHundredths = parseSwimTimeToHundredths(bestRow.time);
    if (bestHundredths !== null && bestHundredths < recordHundredths) {
      return {
        mode: 'new_record',
        swimmerName: bestRow.name,
        teamName: bestRow.team,
        time: bestRow.time,
        oldRecordTime: recordTime,
        recordHolder: currentEvent?.recordHolder || '',
        recordYear: currentEvent?.recordYear || '',
      } as const;
    }

    return {
      mode: 'record',
      recordTime,
      recordHolder: currentEvent?.recordHolder || '',
      recordYear: currentEvent?.recordYear || '',
    } as const;
  }, [showTimes, currentEvent, rows]);

  const displayTitle = boardIsValid
    ? compactEventTitle(board?.eventNumber, board?.eventName, board?.heatNumber)
    : 'READY FOR NEXT EVENT';

  const currentIdleSlide = idleSlides[idleIndex];

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      <style>{`
        :root {
          --outerPad: ${layoutVars.outerPad};
          --topPad: ${layoutVars.topPad};
          --logoFont: ${layoutVars.logoFont};
          --resultsFont: ${layoutVars.resultsFont};
          --meetFont: ${layoutVars.meetFont};
          --eventFont: ${layoutVars.eventFont};
          --laneLabelFont: ${layoutVars.laneLabelFont};
          --laneNumFont: ${layoutVars.laneNumFont};
          --nameFont: ${layoutVars.nameFont};
          --teamFont: ${layoutVars.teamFont};
          --timeFont: ${layoutVars.timeFont};
          --rowH: ${layoutVars.rowH};
        }

        * {
          box-sizing: border-box;
        }

        html,
        body,
        #root {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background:
            radial-gradient(circle at top, rgba(33, 103, 197, 0.28), transparent 28%),
            radial-gradient(circle at bottom, rgba(16, 45, 94, 0.38), transparent 26%),
            linear-gradient(180deg, #01050e 0%, #041126 40%, #020816 100%);
        }

        body {
          font-family: 'Poppins', sans-serif;
          color: #fff;
        }

        .led-page {
          width: 100%;
          height: 100vh;
          padding: var(--outerPad);
          display: flex;
          align-items: stretch;
          justify-content: center;
          background:
            radial-gradient(circle at 50% 0%, rgba(76, 164, 255, 0.14), transparent 24%),
            linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 16%),
            linear-gradient(180deg, #020612 0%, #031022 45%, #020714 100%);
          overflow: hidden;
        }

        .led-shell {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 26px;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          border: 1px solid rgba(121, 184, 255, 0.28);
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.04),
            inset 0 0 65px rgba(0, 110, 255, 0.1),
            0 0 38px rgba(0,0,0,0.5);
          background:
            linear-gradient(180deg, rgba(8, 18, 37, 0.98) 0%, rgba(4, 13, 29, 0.985) 100%);
        }

        .led-shell::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 10% 50%, rgba(0, 168, 255, 0.18), transparent 12%),
            radial-gradient(circle at 90% 50%, rgba(0, 168, 255, 0.18), transparent 12%),
            linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.025) 50%, transparent 100%);
          opacity: 0.8;
        }

        .hero {
          position: relative;
          padding: var(--topPad) 22px 12px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: end;
          border-bottom: 1px solid rgba(135, 196, 255, 0.24);
          background:
            linear-gradient(180deg, rgba(18, 66, 138, 0.34) 0%, rgba(10, 28, 62, 0.14) 100%);
        }

        .hero::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 3px;
          background: linear-gradient(90deg, transparent, rgba(135,196,255,0.9), transparent);
          box-shadow: 0 0 12px rgba(103, 194, 255, 0.55);
        }

        .hero-left {
          min-width: 0;
        }

        .sport-line {
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }

        .sport-icon {
          width: clamp(54px, 6vw, 84px);
          height: clamp(54px, 6vw, 84px);
          flex: 0 0 auto;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 35% 35%, #67d7ff 0%, #1777d0 45%, #08234c 100%);
          box-shadow:
            inset 0 0 16px rgba(255,255,255,0.12),
            0 0 20px rgba(50, 166, 255, 0.28);
          border: 1px solid rgba(162, 219, 255, 0.45);
        }

        .sport-icon svg {
          width: 72%;
          height: 72%;
          opacity: 0.98;
        }

        .sport-title-wrap {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .sport-title {
          margin: 0;
          line-height: 0.9;
          font-size: var(--logoFont);
          font-weight: 900;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: #f6fbff;
          text-shadow:
            0 1px 0 rgba(255,255,255,0.1),
            0 0 18px rgba(82, 172, 255, 0.2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .sport-subtitle {
          margin: 0;
          font-size: var(--resultsFont);
          line-height: 1;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 3px;
          color: ${showTimes ? '#d9b249' : '#8fd2ff'};
          text-shadow: 0 0 12px ${
            showTimes ? 'rgba(217, 178, 73, 0.28)' : 'rgba(143, 210, 255, 0.24)'
          };
        }

        .hero-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: center;
          gap: 8px;
          min-width: 180px;
        }

        .meet-chip {
          max-width: min(34vw, 480px);
          padding: 7px 14px;
          border-radius: 999px;
          border: 1px solid rgba(135, 196, 255, 0.24);
          background: rgba(4, 17, 36, 0.6);
          color: #eaf6ff;
          font-size: var(--meetFont);
          font-weight: 700;
          line-height: 1;
          text-transform: uppercase;
          letter-spacing: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 9px 14px;
          border-radius: 999px;
          font-size: var(--meetFont);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.3px;
          border: 1px solid ${
            showTimes ? 'rgba(212, 166, 42, 0.45)' : 'rgba(88, 233, 158, 0.45)'
          };
          color: ${showTimes ? '#ffd76a' : '#9cffc5'};
          background: ${
            showTimes ? 'rgba(57, 38, 3, 0.34)' : 'rgba(4, 43, 23, 0.34)'
          };
          box-shadow: inset 0 0 12px rgba(255,255,255,0.03);
        }

        .status-light {
          width: clamp(10px, 1.1vw, 14px);
          height: clamp(10px, 1.1vw, 14px);
          border-radius: 50%;
          background: ${showTimes ? '#ffd76a' : '#58e99e'};
          box-shadow:
            0 0 10px ${
              showTimes ? 'rgba(255, 215, 106, 0.9)' : 'rgba(88, 233, 158, 0.9)'
            },
            0 0 20px ${
              showTimes
                ? 'rgba(255, 215, 106, 0.45)'
                : 'rgba(88, 233, 158, 0.45)'
            };
          animation: pulseLight 1.15s ease-in-out infinite;
        }

        @keyframes pulseLight {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(0.85);
            opacity: 0.5;
          }
        }

        .event-strip {
          position: relative;
          padding: 12px 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          background:
            linear-gradient(180deg, rgba(15, 49, 101, 0.95) 0%, rgba(6, 24, 58, 0.95) 100%);
          border-top: 1px solid rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.05);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.08),
            inset 0 -1px 0 rgba(255,255,255,0.06);
        }

        .event-strip::before,
        .event-strip::after {
          content: '';
          position: absolute;
          top: 50%;
          width: 80px;
          height: 2px;
          transform: translateY(-50%);
          background: linear-gradient(90deg, transparent, rgba(144, 209, 255, 0.95));
          box-shadow: 0 0 8px rgba(144, 209, 255, 0.55);
        }

        .event-strip::before {
          left: 20px;
        }

        .event-strip::after {
          right: 20px;
          transform: translateY(-50%) rotate(180deg);
        }

        .event-text {
          margin: 0;
          padding: 0 90px;
          width: 100%;
          color: #f5fbff;
          font-size: var(--eventFont);
          line-height: 1.1;
          font-weight: 800;
          letter-spacing: 1.25px;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 0 8px rgba(135, 196, 255, 0.18);
        }

        .rows-wrap {
          position: relative;
          min-height: 0;
          padding: 16px 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: hidden;
          background:
            linear-gradient(180deg, rgba(2, 9, 22, 0.55) 0%, rgba(3, 10, 25, 0.86) 100%);
        }

        .row {
          position: relative;
          min-height: var(--rowH);
          height: var(--rowH);
          display: grid;
          grid-template-columns: minmax(110px, 13%) minmax(0, 39%) minmax(0, 25%) minmax(120px, 23%);
          align-items: stretch;
          gap: 0;
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(122, 188, 255, 0.18);
          background:
            linear-gradient(180deg, rgba(18, 41, 84, 0.98) 0%, rgba(8, 20, 45, 0.98) 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.06),
            inset 0 -1px 0 rgba(0,0,0,0.36),
            0 0 14px rgba(0,0,0,0.18);
          opacity: 0;
          transform: translateY(18px) scale(0.985);
          animation: rowIn 520ms cubic-bezier(.2,.8,.2,1) forwards;
          will-change: transform, opacity;
        }

        .row::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(90deg, rgba(255,255,255,0.07) 0%, transparent 16%, transparent 84%, rgba(255,255,255,0.03) 100%);
        }

        .row.top-place {
          box-shadow:
            inset 0 0 0 1px rgba(255, 215, 106, 0.18),
            inset 0 1px 0 rgba(255,255,255,0.06),
            0 0 22px rgba(255, 215, 106, 0.08);
        }

        .row.record-breaker {
          border-color: rgba(255, 215, 106, 0.55);
          box-shadow:
            inset 0 0 0 1px rgba(255, 215, 106, 0.3),
            0 0 28px rgba(255, 215, 106, 0.18);
        }

        @keyframes rowIn {
          from {
            opacity: 0;
            transform: translateY(18px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .lane-box {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px 0 10px;
          color: #fff;
          font-weight: 900;
          text-transform: uppercase;
          clip-path: polygon(0 0, 88% 0, 100% 50%, 88% 100%, 0 100%);
          border-right: 1px solid rgba(255,255,255,0.08);
        }

        .lane-label {
          display: flex;
          flex-direction: column;
          line-height: 0.9;
          min-width: 0;
        }

        .lane-label span:first-child {
          font-size: var(--laneLabelFont);
          opacity: 0.95;
          letter-spacing: 1px;
        }

        .lane-number {
          font-size: var(--laneNumFont);
          line-height: 1;
          text-shadow: 0 0 10px rgba(255,255,255,0.18);
        }

        .row-main,
        .row-team,
        .row-time {
          min-width: 0;
          display: flex;
          align-items: center;
        }

        .row-main {
          padding: 0 16px 0 18px;
          border-right: 1px solid rgba(255,255,255,0.06);
        }

        .row-team {
          padding: 0 14px;
          justify-content: center;
          border-right: 1px solid rgba(255,255,255,0.06);
        }

        .row-time {
          justify-content: flex-end;
          padding: 0 20px 0 14px;
          position: relative;
          gap: 10px;
        }

        .name-text {
          width: 100%;
          font-size: var(--nameFont);
          line-height: 1;
          font-weight: 800;
          letter-spacing: 0.5px;
          color: #f4f8ff;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 0 10px rgba(255,255,255,0.05);
        }

        .team-text {
          width: 100%;
          font-size: var(--teamFont);
          line-height: 1.05;
          font-weight: 700;
          letter-spacing: 0.6px;
          color: #d9e9ff;
          text-transform: uppercase;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: 0.95;
        }

        .time-text {
          font-size: var(--timeFont);
          line-height: 1;
          font-weight: 900;
          letter-spacing: 0.4px;
          color: ${showTimes ? '#f7f8fb' : 'rgba(247,248,251,0.2)'};
          text-transform: uppercase;
          text-shadow: ${
            showTimes ? '0 0 12px rgba(255,255,255,0.08)' : 'none'
          };
          white-space: nowrap;
        }

        .time-text.gold {
          color: #ffd76a;
          text-shadow: 0 0 15px rgba(255, 215, 106, 0.26);
        }

        .time-hidden-slot {
          display: inline-block;
          min-width: 5.8ch;
          text-align: right;
          color: transparent;
          user-select: none;
        }

        .time-flash {
          animation: timeFlash 1.25s ease;
        }

        @keyframes timeFlash {
          0% {
            filter: brightness(1.8);
            transform: scale(1.04);
          }
          100% {
            filter: brightness(1);
            transform: scale(1);
          }
        }

        .record-pill {
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(255, 215, 106, 0.16);
          border: 1px solid rgba(255, 215, 106, 0.38);
          color: #ffe89e;
          font-size: clamp(0.7rem, 0.95vw, 0.9rem);
          font-weight: 900;
          letter-spacing: 0.9px;
          text-transform: uppercase;
          white-space: nowrap;
          animation: recordPulse 1.5s ease-in-out infinite;
        }

        @keyframes recordPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }

        .idle-stage {
          position: relative;
          min-height: 0;
          overflow: hidden;
          background:
            radial-gradient(circle at 20% 25%, rgba(57, 171, 255, 0.16), transparent 18%),
            radial-gradient(circle at 78% 32%, rgba(0, 140, 255, 0.14), transparent 20%),
            radial-gradient(circle at 50% 100%, rgba(0, 66, 145, 0.18), transparent 32%),
            linear-gradient(180deg, rgba(3, 15, 33, 0.9) 0%, rgba(1, 10, 24, 0.97) 100%);
        }

        .idle-stage::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.03) 48%, transparent 100%);
          animation: sweep 6s linear infinite;
        }

        @keyframes sweep {
          0% { transform: translateX(-30%); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateX(30%); opacity: 0; }
        }

        .idle-water {
          position: absolute;
          left: -10%;
          right: -10%;
          bottom: -2%;
          height: 40%;
          background:
            radial-gradient(circle at 20% 40%, rgba(94, 207, 255, 0.15), transparent 20%),
            radial-gradient(circle at 60% 50%, rgba(48, 166, 255, 0.16), transparent 22%),
            radial-gradient(circle at 84% 40%, rgba(67, 196, 255, 0.12), transparent 18%);
          filter: blur(16px);
          opacity: 0.95;
        }

        .idle-content {
          position: relative;
          z-index: 2;
          height: 100%;
          display: grid;
          place-items: center;
          padding: 22px;
        }

        .idle-card {
          width: min(1180px, 92%);
          min-height: 58%;
          padding: 42px 46px;
          display: grid;
          grid-template-columns: minmax(260px, 320px) 1fr;
          gap: 34px;
          align-items: center;
          border-radius: 34px;
          border: 1px solid rgba(121, 184, 255, 0.24);
          background:
            linear-gradient(180deg, rgba(12, 33, 74, 0.82) 0%, rgba(5, 17, 38, 0.9) 100%);
          box-shadow:
            inset 0 0 30px rgba(255,255,255,0.03),
            0 0 28px rgba(0,0,0,0.2);
          overflow: hidden;
        }

        .idle-card-left {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .idle-emblem {
          width: clamp(160px, 18vw, 260px);
          height: clamp(160px, 18vw, 260px);
          border-radius: 50%;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 35% 35%, #67d7ff 0%, #1777d0 45%, #08234c 100%);
          box-shadow:
            inset 0 0 22px rgba(255,255,255,0.12),
            0 0 28px rgba(50, 166, 255, 0.28);
          border: 1px solid rgba(162, 219, 255, 0.45);
        }

        .idle-emblem svg {
          width: 72%;
          height: 72%;
        }

        .idle-card-right {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 14px;
          min-width: 0;
        }

        .idle-kicker {
          margin: 0;
          color: #90d2ff;
          font-size: clamp(0.95rem, 1.3vw, 1.2rem);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 2.4px;
        }

        .idle-title {
          margin: 0;
          color: #f6fbff;
          font-size: clamp(2rem, 4vw, 4.4rem);
          line-height: 0.95;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
          text-shadow: 0 0 18px rgba(82, 172, 255, 0.15);
        }

        .idle-subtitle {
          margin: 0;
          color: #d8ebff;
          font-size: clamp(1rem, 1.55vw, 1.42rem);
          line-height: 1.5;
          font-weight: 500;
          max-width: 760px;
        }

        .idle-dots {
          display: flex;
          gap: 10px;
          margin-top: 8px;
        }

        .idle-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: rgba(151, 209, 255, 0.26);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
          transition: transform 220ms ease, background 220ms ease, box-shadow 220ms ease;
        }

        .idle-dot.active {
          background: #ffd76a;
          transform: scale(1.14);
          box-shadow: 0 0 14px rgba(255, 215, 106, 0.5);
        }

        .footer {
          position: relative;
          padding: 14px 18px 16px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 16px;
          align-items: center;
          border-top: 1px solid rgba(135, 196, 255, 0.18);
          background:
            linear-gradient(180deg, rgba(9, 28, 58, 0.7) 0%, rgba(4, 12, 28, 0.85) 100%);
        }

        .footer::before {
          content: '';
          position: absolute;
          top: 0;
          left: 10%;
          right: 10%;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(103, 194, 255, 0.8), transparent);
          box-shadow: 0 0 10px rgba(103, 194, 255, 0.4);
        }

        .record-slot {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(212, 166, 42, 0.28);
          background: rgba(38, 26, 2, 0.26);
          color: #ffd76a;
          font-size: var(--meetFont);
          font-weight: 900;
          letter-spacing: 1.1px;
          text-transform: uppercase;
          width: fit-content;
          box-shadow: inset 0 0 12px rgba(255,255,255,0.03);
          flex-wrap: wrap;
        }

        .record-value {
          color: #fff3c4;
          opacity: 0.95;
        }

        .record-sub {
          color: #cfe7ff;
          opacity: 0.9;
        }

        .footer-right {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: #9bcfff;
          font-size: var(--meetFont);
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          opacity: 0.9;
        }

        .footer-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: ${showTimes ? '#ffd76a' : '#67d7ff'};
          box-shadow: 0 0 10px ${
            showTimes ? 'rgba(255, 215, 106, 0.7)' : 'rgba(103, 215, 255, 0.7)'
          };
        }

        @media (max-width: 1200px) {
          .hero {
            grid-template-columns: 1fr;
            align-items: center;
          }

          .hero-right {
            align-items: flex-start;
            min-width: 0;
          }

          .meet-chip {
            max-width: 100%;
          }

          .idle-card {
            grid-template-columns: 1fr;
            text-align: center;
          }

          .idle-card-right {
            align-items: center;
          }

          .idle-subtitle {
            max-width: 100%;
          }

          .idle-dots {
            justify-content: center;
          }
        }

        @media (max-width: 900px) {
          .event-strip::before,
          .event-strip::after {
            width: 36px;
          }

          .event-text {
            padding: 0 44px;
          }

          .row {
            grid-template-columns: minmax(90px, 16%) minmax(0, 39%) minmax(0, 23%) minmax(90px, 22%);
          }
        }

        @media (max-width: 700px) {
          .led-page {
            padding: 8px;
          }

          .led-shell {
            border-radius: 18px;
          }

          .hero {
            padding: 12px 12px 10px;
            gap: 10px;
          }

          .sport-line {
            gap: 10px;
          }

          .event-strip {
            padding: 10px 12px;
          }

          .event-strip::before,
          .event-strip::after {
            display: none;
          }

          .event-text {
            padding: 0;
          }

          .rows-wrap {
            padding: 10px 10px 10px;
            gap: 8px;
          }

          .row {
            grid-template-columns: 92px 1fr;
            grid-template-rows: 1fr 1fr;
            min-height: auto;
            height: auto;
          }

          .lane-box {
            grid-row: 1 / span 2;
          }

          .row-main {
            padding: 10px 12px 4px 12px;
            border-right: none;
          }

          .row-team {
            justify-content: flex-start;
            padding: 0 12px 10px 12px;
            border-right: none;
          }

          .row-time {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 40%;
            justify-content: flex-end;
            padding: 0 12px;
            background: linear-gradient(90deg, rgba(7,18,41,0) 0%, rgba(7,18,41,0.35) 25%, rgba(7,18,41,0) 100%);
          }

          .row-main,
          .row-team {
            padding-right: 42%;
          }

          .footer {
            grid-template-columns: 1fr;
            justify-items: start;
          }
        }
      `}</style>

      <div className="led-page">
        <div className="led-shell">
          <div className="hero">
            <div className="hero-left">
              <div className="sport-line">
                <div className="sport-icon" aria-hidden="true">
                  <svg viewBox="0 0 100 100" fill="none">
                    <circle
                      cx="63"
                      cy="24"
                      r="10"
                      fill="white"
                      fillOpacity="0.98"
                    />
                    <path
                      d="M18 44C31 34 44 29 55 30C64 31 71 36 79 44C67 46 59 47 49 48C39 49 28 48 18 44Z"
                      fill="white"
                      fillOpacity="0.98"
                    />
                    <path
                      d="M12 58C29 54 48 56 66 63C76 67 84 72 90 77C72 76 56 73 40 68C28 64 18 61 12 58Z"
                      fill="#9ad8ff"
                    />
                    <path
                      d="M10 72C23 69 37 70 52 74C63 77 74 82 84 89C71 88 58 86 45 82C31 78 19 75 10 72Z"
                      fill="#42b5ff"
                    />
                  </svg>
                </div>

                <div className="sport-title-wrap">
                  <h1 className="sport-title">Swimming</h1>
                  <p className="sport-subtitle">
                    {showTimes ? 'Results' : 'Ready'}
                  </p>
                </div>
              </div>
            </div>

            <div className="hero-right">
              <div className="meet-chip">
                {meetName || 'Panthers Swim Meet'}
              </div>
              <div className="status-pill">
                <span className="status-light" />
                <span>{showTimes ? 'Official Time' : 'Standby Mode'}</span>
              </div>
            </div>
          </div>

          <div className="event-strip">
            <p className="event-text">{displayTitle}</p>
          </div>

          {!boardIsValid ? (
            <div className="idle-stage">
              <div className="idle-water" />

              <div className="idle-content">
                <div className="idle-card">
                  <div className="idle-card-left">
                    <div className="idle-emblem" aria-hidden="true">
                      <svg viewBox="0 0 100 100" fill="none">
                        <circle
                          cx="63"
                          cy="24"
                          r="10"
                          fill="white"
                          fillOpacity="0.98"
                        />
                        <path
                          d="M18 44C31 34 44 29 55 30C64 31 71 36 79 44C67 46 59 47 49 48C39 49 28 48 18 44Z"
                          fill="white"
                          fillOpacity="0.98"
                        />
                        <path
                          d="M12 58C29 54 48 56 66 63C76 67 84 72 90 77C72 76 56 73 40 68C28 64 18 61 12 58Z"
                          fill="#9ad8ff"
                        />
                        <path
                          d="M10 72C23 69 37 70 52 74C63 77 74 82 84 89C71 88 58 86 45 82C31 78 19 75 10 72Z"
                          fill="#42b5ff"
                        />
                      </svg>
                    </div>
                  </div>

                  <div className="idle-card-right">
                    <p className="idle-kicker">{currentIdleSlide.kicker}</p>
                    <h2 className="idle-title">{currentIdleSlide.title}</h2>
                    <p className="idle-subtitle">{currentIdleSlide.subtitle}</p>

                    <div className="idle-dots">
                      {idleSlides.map((_, index) => (
                        <span
                          key={index}
                          className={`idle-dot ${
                            index === idleIndex ? 'active' : ''
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rows-wrap" key={animateToken}>
              {rows.map((r, index) => {
                const palette = lanePalette(r.lane || index + 1);
                const isTop = showTimes && (r.place === 1 || index === 0);
                const isRecordBreaker =
                  recordInfo.mode === 'new_record' &&
                  r.name === recordInfo.swimmerName &&
                  r.time === recordInfo.time;

                return (
                  <div
                    key={`${animateToken}-${r.key}-${r.lane}-${r.name}-${r.time}`}
                    className={`row ${isTop ? 'top-place' : ''} ${
                      isRecordBreaker ? 'record-breaker' : ''
                    }`}
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <div
                      className="lane-box"
                      style={{
                        background: palette.bg,
                        boxShadow: `inset 0 0 16px rgba(255,255,255,0.08), 0 0 16px ${palette.glow}`,
                      }}
                    >
                      <div className="lane-label">
                        <span>Lane</span>
                      </div>
                      <div className="lane-number">{r.lane || '—'}</div>
                    </div>

                    <div className="row-main">
                      <div className="name-text">{r.name || '—'}</div>
                    </div>

                    <div className="row-team">
                      <div className="team-text">{r.team || '—'}</div>
                    </div>

                    <div className="row-time">
                      {isRecordBreaker ? (
                        <span className="record-pill">New Record</span>
                      ) : null}

                      <div
                        className={`time-text ${
                          showTimes && isTop ? 'gold' : ''
                        } ${resultsFlash && showTimes ? 'time-flash' : ''}`}
                      >
                        {showTimes ? (
                          normalizeStatus(r.status) !== 'OK' ? (
                            normalizeStatus(r.status)
                          ) : (
                            r.time || '—'
                          )
                        ) : (
                          <span className="time-hidden-slot">00:00.00</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="footer">
            <div className="record-slot">
              {recordInfo.mode === 'new_record' ? (
                <>
                  <span>New Record:</span>
                  <span className="record-value">{recordInfo.time}</span>
                  <span className="record-sub">
                    {recordInfo.swimmerName || 'Swimmer'}
                    {recordInfo.teamName ? ` • ${recordInfo.teamName}` : ''}
                  </span>
                </>
              ) : recordInfo.recordTime ? (
                <>
                  <span>Record Time:</span>
                  <span className="record-value">{recordInfo.recordTime}</span>
                  {recordInfo.recordHolder ? (
                    <span className="record-sub">
                      {recordInfo.recordHolder}
                      {recordInfo.recordYear
                        ? ` • ${recordInfo.recordYear}`
                        : ''}
                    </span>
                  ) : recordInfo.recordYear ? (
                    <span className="record-sub">{recordInfo.recordYear}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span>Record Time:</span>
                  <span className="record-value">--:--.--</span>
                </>
              )}
            </div>

            <div className="footer-right"></div>
          </div>
        </div>
      </div>
    </>
  );
}
