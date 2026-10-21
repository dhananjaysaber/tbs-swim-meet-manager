import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase/db.js';

type ResultDisplayRow = {
  laneNumber?: number;
  swimmerName?: string;
  teamName?: string;
  time?: string;
  status?: string;
  place?: number | null;
};

type LiveResultsBoard = {
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  gender?: string;
  ageGroup?: string;
  stroke?: string;
  round?: string;
  heatNumber?: number;
  publishedAt?: number;
  rows?: Record<string, ResultDisplayRow>;
};

type LiveDisplayRoot = {
  mode?: 'RACE' | 'RESULTS';
  results?: LiveResultsBoard;
};

type ActiveMeetMeta = {
  meetId: string;
  meetName?: string;
  venue?: string;
  date?: string;
};

export default function LEDResults() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [board, setBoard] = useState<LiveResultsBoard | null>(null);
  const [meetMeta, setMeetMeta] = useState<ActiveMeetMeta | null>(null);
  const [displayMode, setDisplayMode] = useState<'RACE' | 'RESULTS'>('RESULTS');
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const activeRef = ref(db, 'appState/activeMeetId');
    const unsub = onValue(activeRef, (snap) => {
      setActiveMeetId(String(snap.val() || ''));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeMeetId) {
      setBoard(null);
      setMeetMeta(null);
      return;
    }

    const meetRef = ref(db, `meets/${activeMeetId}`);
    const boardRef = ref(db, `meets/${activeMeetId}/liveDisplay`);

    const unsubMeet = onValue(meetRef, (snap) => {
      const val = snap.val() || {};
      setMeetMeta({
        meetId: activeMeetId,
        meetName: String(val.name || ''),
        venue: String(val.venue || ''),
        date: String(val.date || ''),
      });
    });

    const unsubBoard = onValue(boardRef, (snap) => {
      const root = (snap.val() as LiveDisplayRoot) || {};
      setDisplayMode((root.mode as 'RACE' | 'RESULTS') || 'RESULTS');
      setBoard(root.results || null);
    });

    return () => {
      unsubMeet();
      unsubBoard();
    };
  }, [activeMeetId]);

  useEffect(() => {
    if (displayMode === 'RACE') {
      setTransitioning(true);
      const timer = window.setTimeout(() => {
        window.location.replace('/led-scoreboard');
      }, 700);
      return () => window.clearTimeout(timer);
    }
  }, [displayMode]);

  const rows = useMemo(() => {
    return Object.values(board?.rows || {})
      .map((row) => ({
        laneNumber: Number(row?.laneNumber || 0),
        swimmerName: String(row?.swimmerName || ''),
        teamName: String(row?.teamName || ''),
        time: String(row?.time || ''),
        status: String(row?.status || ''),
        place: typeof row?.place === 'number' ? row.place : null,
      }))
      .sort((a, b) => {
        const aPlace = a.place ?? 9999;
        const bPlace = b.place ?? 9999;
        if (aPlace !== bPlace) return aPlace - bPlace;
        return a.laneNumber - b.laneNumber;
      });
  }, [board]);

  return (
    <>
      <style>{`
        :root {
          --bg: #05070a;
          --panel: #11161d;
          --line: #242c36;
          --white: #f8fbff;
          --amber: #ffbf00;
          --green: #45e07d;
          --red: #ff5b5b;
        }

        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: var(--bg);
          overflow: hidden;
          font-family: Arial, Helvetica, sans-serif;
        }

        .led-results-page {
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #030507 0%, #0a0f15 100%);
          color: var(--white);
          display: grid;
          grid-template-rows: auto 1fr auto;
          padding: 18px 22px;
          box-sizing: border-box;
          gap: 14px;
          position: relative;
        }

        .led-transition {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.86);
          display: grid;
          place-items: center;
          z-index: 20;
          font-size: 56px;
          font-weight: 900;
          color: var(--amber);
          letter-spacing: 1px;
        }

        .led-top {
          border: 2px solid var(--line);
          background: #0e141b;
          padding: 14px 18px;
          display: grid;
          gap: 8px;
        }

        .led-kicker {
          font-size: 18px;
          color: #9fb0c4;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .led-title {
          font-size: 42px;
          font-weight: 900;
          line-height: 1.05;
          color: var(--white);
        }

        .led-sub {
          font-size: 20px;
          color: #bfd1e4;
          font-weight: 700;
        }

        .led-table-wrap {
          border: 2px solid var(--line);
          background: #0e141b;
          overflow: hidden;
        }

        .led-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .led-table th,
        .led-table td {
          border: 1px solid #1d2630;
          padding: 10px 12px;
        }

        .led-table th {
          font-size: 18px;
          text-transform: uppercase;
          color: #9fb0c4;
          background: #101923;
          text-align: left;
        }

        .led-table td {
          font-size: 28px;
          font-weight: 800;
          color: var(--white);
          background: #0c1218;
        }

        .place-col {
          width: 90px;
          text-align: center;
          color: var(--amber);
        }

        .lane-col {
          width: 90px;
          text-align: center;
          color: #b9c9d8;
        }

        .team-col {
          width: 220px;
          color: #b9c9d8;
        }

        .time-col {
          width: 170px;
          text-align: center;
          color: var(--green);
        }

        .status-col {
          width: 120px;
          text-align: center;
        }

        .status-badge {
          display: inline-block;
          min-width: 74px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 18px;
          font-weight: 900;
          background: #16202a;
          color: #fff;
        }

        .status-badge.ok {
          background: rgba(69, 224, 125, 0.18);
          color: var(--green);
        }

        .status-badge.bad {
          background: rgba(255, 91, 91, 0.18);
          color: var(--red);
        }

        .led-footer {
          border: 2px solid var(--line);
          background: #0e141b;
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          font-size: 18px;
          font-weight: 700;
          color: #c7d7e7;
        }

        @media (max-width: 1200px) {
          .led-title {
            font-size: 30px;
          }
          .led-table td {
            font-size: 22px;
          }
        }
      `}</style>

      <div className="led-results-page">
        {transitioning ? (
          <div className="led-transition">RETURNING TO RACE…</div>
        ) : null}

        <div className="led-top">
          <div className="led-kicker">Published Results</div>
          <div className="led-title">
            {board?.eventNumber ? `Event ${board.eventNumber} • ` : ''}
            {board?.eventName || 'No results published'}
          </div>
          <div className="led-sub">
            {(board?.gender || '—') +
              ' • ' +
              (board?.ageGroup || '—') +
              ' • ' +
              (board?.stroke || '—') +
              ' • ' +
              (board?.round || '—') +
              ' • Heat ' +
              String(board?.heatNumber || '—')}
          </div>
        </div>

        <div className="led-table-wrap">
          <table className="led-table">
            <thead>
              <tr>
                <th className="place-col">Place</th>
                <th className="lane-col">Lane</th>
                <th>Swimmer</th>
                <th className="team-col">Team</th>
                <th className="time-col">Time</th>
                <th className="status-col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: 'center',
                      padding: '30px 12px',
                      fontSize: 28,
                      color: '#9fb0c4',
                    }}
                  >
                    Waiting for published results
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`result-${row.laneNumber}-${row.swimmerName}`}>
                    <td className="place-col">{row.place ?? '—'}</td>
                    <td className="lane-col">{row.laneNumber || '—'}</td>
                    <td>{row.swimmerName || '—'}</td>
                    <td className="team-col">{row.teamName || '—'}</td>
                    <td className="time-col">{row.time || '—'}</td>
                    <td className="status-col">
                      <span
                        className={`status-badge ${
                          row.status === 'OK' ? 'ok' : 'bad'
                        }`}
                      >
                        {row.status || '—'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="led-footer">
          <div>{meetMeta?.meetName || 'Panthers Swim Meet Manager'}</div>
          <div>
            {(meetMeta?.venue || '—') + ' • ' + (meetMeta?.date || '—')}
          </div>
        </div>
      </div>
    </>
  );
}
