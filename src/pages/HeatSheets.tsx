import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../firebase/db.js';
import AppShell from '../components/AppShell';

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
  relay?: boolean;
  name?: string;
  active?: boolean;
  round?: string;
};

type EntryRow = {
  id: string;
  swimmerId?: string;
  swimmerName?: string;
  gender?: string;
  ageGroup?: string;
  teamId?: string;
  teamName?: string;
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  laneSeedTime?: string;
  status?: string;
  active?: boolean;
  createdAt?: number;
  createdBy?: string;
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

type PrintEventRow = {
  event: EventRow;
  seeding: SavedSeedingNode;
  heats: HeatRow[];
};

type TabKey = 'select' | 'preview';

function flattenSavedHeats(
  node?: SavedSeedingNode | null,
  validEntriesById?: Record<string, EntryRow>
) {
  if (!node?.heats) return [] as HeatRow[];

  const heats: HeatRow[] = Object.values(node.heats)
    .map((heatNode) => {
      const lanes = Object.values(heatNode?.lanes || {})
        .map((lane) => {
          const entryId = String(lane?.entryId || '');
          const matchedEntry = entryId
            ? validEntriesById?.[entryId]
            : undefined;

          if (validEntriesById && (!entryId || !matchedEntry)) return null;

          return {
            laneNumber: Number(lane?.laneNumber || 0),
            entryId,
            swimmerId: String(matchedEntry?.swimmerId || lane?.swimmerId || ''),
            swimmerName: String(
              matchedEntry?.swimmerName || lane?.swimmerName || ''
            ),
            teamId: String(matchedEntry?.teamId || lane?.teamId || ''),
            teamName: String(matchedEntry?.teamName || lane?.teamName || ''),
            seedTime: String(
              matchedEntry?.laneSeedTime || lane?.seedTime || ''
            ),
            heatNumber: Number(lane?.heatNumber || heatNode?.heatNumber || 0),
          };
        })
        .filter((lane): lane is LaneRow => !!lane && lane.laneNumber > 0)
        .sort((a, b) => a.laneNumber - b.laneNumber);

      return {
        heatNumber: Number(heatNode?.heatNumber || 0),
        lanes,
      };
    })
    .filter((heat) => heat.heatNumber > 0 && heat.lanes.length > 0)
    .sort((a, b) => a.heatNumber - b.heatNumber);

  return heats;
}

function formatGeneratedAt(value?: number) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBlankRowsHtml(count: number) {
  return Array.from({ length: count }, () => {
    return `
      <tr>
        <td class="center">—</td>
        <td></td>
        <td></td>
        <td class="center"></td>
        <td class="center"></td>
      </tr>
    `;
  }).join('');
}

function buildPreviewBlankRows(count: number) {
  return Array.from({ length: count }, (_, idx) => (
    <tr key={`blank-preview-${idx}`}>
      <td className="hs-center">—</td>
      <td></td>
      <td></td>
      <td className="hs-center"></td>
      <td className="hs-center"></td>
    </tr>
  ));
}

function buildPrintHtml(args: {
  meet: MeetRow | null;
  printEvents: PrintEventRow[];
}) {
  const { meet, printEvents } = args;

  const meetName = escapeHtml(meet?.name || 'Swim Meet');
  const venue = escapeHtml(meet?.venue || '—');
  const date = escapeHtml(meet?.date || '—');
  const poolLength = escapeHtml(String(meet?.poolLength || '—'));

  const eventsHtml = printEvents
    .map(({ event, seeding, heats }) => {
      const eventNumber = escapeHtml(String(event.eventNumber || '—'));
      const eventName = escapeHtml(event.name || 'Unnamed Event');
      const gender = escapeHtml(event.gender || '—');
      const ageGroup = escapeHtml(event.ageGroup || '—');
      const eventType = escapeHtml(event.eventType || '—');
      const stroke = escapeHtml(event.stroke || '—');
      const laneCount = Number(seeding?.laneCount || meet?.laneCount || 8);

      const heatsHtml = heats
        .map((heat) => {
          const rowsHtml =
            heat.lanes
              .map((lane) => {
                return `
                  <tr>
                    <td class="center">${lane.laneNumber}</td>
                    <td>${escapeHtml(lane.swimmerName || '—')}</td>
                    <td>${escapeHtml(lane.teamName || '—')}</td>
                    <td class="center">${escapeHtml(lane.seedTime || '—')}</td>
                    <td class="center"></td>
                  </tr>
                `;
              })
              .join('') +
            (heat.lanes.length < laneCount
              ? buildBlankRowsHtml(laneCount - heat.lanes.length)
              : '');

          return `
            <div class="heat-block">
              <div class="heat-head">Heat ${heat.heatNumber}</div>
              <table class="heat-table">
                <thead>
                  <tr>
                    <th class="center lane-col">Lane</th>
                    <th>Name</th>
                    <th class="team-col">Team</th>
                    <th class="center seed-col">Seed Time</th>
                    <th class="center hf-col">H/F Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
          `;
        })
        .join('');

      return `
        <section class="event-card">
          <div class="event-title">Event ${eventNumber}</div>
          <div class="event-subtitle">${eventName}</div>
          <div class="event-meta">
            <span>Gender: ${gender}</span>
            <span>Category: ${ageGroup}</span>
            <span>Type: ${eventType}</span>
            <span>Stroke: ${stroke}</span>
          </div>
          ${heatsHtml}
        </section>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${meetName} - Heat Sheets</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: "Times New Roman", Georgia, serif;
            color: #111;
            background: #fff;
          }

          .page-header {
            text-align: center;
            margin-bottom: 10px;
          }

          .meet-name {
            font-size: 20px;
            font-weight: 700;
            line-height: 1.2;
          }

          .meet-sub {
            margin-top: 4px;
            font-size: 12px;
            line-height: 1.4;
          }

          .events-grid {
            column-count: 2;
            column-gap: 18px;
          }

          .event-card {
            break-inside: avoid;
            page-break-inside: avoid;
            margin-bottom: 14px;
            padding-bottom: 6px;
          }

          .event-title {
            font-size: 14px;
            font-weight: 700;
            border-bottom: 2px solid #333;
            padding-bottom: 2px;
            margin-bottom: 3px;
          }

          .event-subtitle {
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 4px;
          }

          .event-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 12px;
            font-size: 10px;
            margin-bottom: 6px;
          }

          .heat-block {
            margin-top: 6px;
          }

          .heat-head {
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 2px;
          }

          .heat-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .heat-table th,
          .heat-table td {
            padding: 1px 4px;
            font-size: 11px;
            vertical-align: top;
          }

          .heat-table thead th {
            border-top: 1px solid #444;
            border-bottom: 1px solid #444;
            text-align: left;
            font-weight: 700;
          }

          .center {
            text-align: center !important;
          }

          .lane-col {
            width: 42px;
          }

          .team-col {
            width: 26%;
          }

          .seed-col {
            width: 72px;
          }

          .hf-col {
            width: 72px;
          }

          @media print {
            .print-note {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="page-header">
          <div class="meet-name">${meetName}</div>
          <div class="meet-sub">
            Venue: ${venue} &nbsp;&nbsp; Date: ${date} &nbsp;&nbsp; Pool: ${poolLength} m
          </div>
        </div>

        <div class="events-grid">
          ${eventsHtml}
        </div>

        <script>
          window.onload = function () {
            window.print();
            window.onafterprint = function () {
              window.close();
            };
          };
        </script>
      </body>
    </html>
  `;
}

export default function HeatSheets() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [allSeeding, setAllSeeding] = useState<
    Record<string, SavedSeedingNode>
  >({});
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectedPrintEventNo, setSelectedPrintEventNo] = useState('ALL');
  const [selectedRoundFilter, setSelectedRoundFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState<TabKey>('select');
  const [msg, setMsg] = useState('');

  const activeEvents = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false)
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const seededEventOptions = useMemo(() => {
    return activeEvents.filter((event) => !!allSeeding[event.id]);
  }, [activeEvents, allSeeding]);

  const selectedEvent = useMemo(() => {
    return activeEvents.find((event) => event.id === selectedEventId) || null;
  }, [activeEvents, selectedEventId]);

  const selectedSeeding = useMemo(() => {
    return allSeeding[selectedEventId] || null;
  }, [allSeeding, selectedEventId]);

  const entriesByEventId = useMemo(() => {
    const map: Record<string, Record<string, EntryRow>> = {};

    entries.forEach((entry) => {
      const eventId = String(entry.eventId || '');
      const entryId = String(entry.id || '');
      const status = String(entry.status || 'Entered')
        .trim()
        .toLowerCase();

      if (!eventId || !entryId) return;
      if (entry.active === false) return;
      if (status === 'scratch') return;

      if (!map[eventId]) map[eventId] = {};
      map[eventId][entryId] = entry;
    });

    return map;
  }, [entries]);

  const selectedHeats = useMemo(() => {
    return flattenSavedHeats(
      selectedSeeding,
      selectedEventId ? entriesByEventId[selectedEventId] || {} : undefined
    );
  }, [selectedSeeding, selectedEventId, entriesByEventId]);

  const printEvents = useMemo(() => {
    return seededEventOptions
      .map((event) => {
        const seeding = allSeeding[event.id];
        const heats = flattenSavedHeats(
          seeding,
          entriesByEventId[event.id] || {}
        );

        return {
          event,
          seeding,
          heats,
        };
      })
      .filter((row) => row.heats.length > 0);
  }, [seededEventOptions, allSeeding]);

  const filteredPrintEvents = useMemo(() => {
    return printEvents.filter((row) => {
      const eventNoMatch =
        selectedPrintEventNo === 'ALL' ||
        String(row.event.eventNumber || '') === selectedPrintEventNo;

      const roundValue = String(row.event.round || '')
        .trim()
        .toLowerCase();
      const roundMatch =
        selectedRoundFilter === 'ALL' ||
        (selectedRoundFilter === 'HEAT' && roundValue.includes('heat')) ||
        (selectedRoundFilter === 'FINAL' && roundValue.includes('final'));

      return eventNoMatch && roundMatch;
    });
  }, [printEvents, selectedPrintEventNo, selectedRoundFilter]);

  const selectedPrintEvents = useMemo(() => {
    return filteredPrintEvents.filter((row) =>
      selectedEventIds.includes(row.event.id)
    );
  }, [filteredPrintEvents, selectedEventIds]);

  const printableEventNumbers = useMemo(() => {
    return Array.from(
      new Set(
        printEvents
          .map((row) => String(row.event.eventNumber || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => Number(a) - Number(b));
  }, [printEvents]);

  const laneCount = Number(
    selectedSeeding?.laneCount || activeMeet?.laneCount || 8
  );

  const allFilteredPrintableSelected =
    filteredPrintEvents.length > 0 &&
    filteredPrintEvents.every((row) => selectedEventIds.includes(row.event.id));

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  useEffect(() => {
    const activeRef = ref(db, 'appState/activeMeetId');

    const unsub = onValue(activeRef, (snap) => {
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
      setEntries([]);
      setAllSeeding({});
      setSelectedEventId('');
      setSelectedEventIds([]);
      return;
    }

    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const entriesRef = ref(db, `meets/${activeMeetId}/entries`);
    const seedingRef = ref(db, `meets/${activeMeetId}/seeding`);

    const unsubEvents = onValue(eventsRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setEvents([]);
        setSelectedEventId('');
        setSelectedEventIds([]);
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

    const unsubEntries = onValue(entriesRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setEntries([]);
        return;
      }

      const rows: EntryRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      setEntries(rows);
    });

    const unsubSeeding = onValue(seedingRef, (snap) => {
      const val = (snap.val() || {}) as Record<string, SavedSeedingNode>;
      setAllSeeding(val);
    });

    return () => {
      unsubEvents();
      unsubEntries();
      unsubSeeding();
    };
  }, [activeMeetId]);

  useEffect(() => {
    if (!seededEventOptions.length) {
      setSelectedEventId('');
      return;
    }

    setSelectedEventId((prev) => {
      if (prev && seededEventOptions.some((event) => event.id === prev))
        return prev;
      return seededEventOptions[0].id;
    });
  }, [seededEventOptions]);

  useEffect(() => {
    const validIds = new Set(filteredPrintEvents.map((row) => row.event.id));
    setSelectedEventIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [filteredPrintEvents]);

  useEffect(() => {
    if (!selectedEventId) {
      setMsg('');
      return;
    }

    if (!selectedSeeding) {
      setMsg('No saved seeding found for the selected event.');
      return;
    }

    setMsg('');
  }, [selectedEventId, selectedSeeding]);

  const openPrintWindow = (rowsToPrint: PrintEventRow[], emptyMsg: string) => {
    if (!rowsToPrint.length) {
      setMsg(emptyMsg);
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=900');
    if (!printWindow) {
      setMsg('Popup blocked. Please allow popups and try again.');
      return;
    }

    const html = buildPrintHtml({
      meet: activeMeet,
      printEvents: rowsToPrint,
    });

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handlePrintAll = () => {
    openPrintWindow(printEvents, 'No seeded events available to print.');
  };

  const handlePrintSelected = () => {
    openPrintWindow(
      selectedPrintEvents,
      'Please select at least one seeded event to print.'
    );
  };

  const toggleSelectedPrintEvent = (eventId: string) => {
    setSelectedEventIds((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
  };

  const handleToggleSelectAllFiltered = () => {
    if (allFilteredPrintableSelected) {
      const filteredIds = new Set(
        filteredPrintEvents.map((row) => row.event.id)
      );
      setSelectedEventIds((prev) => prev.filter((id) => !filteredIds.has(id)));
      return;
    }

    const merged = new Set(selectedEventIds);
    filteredPrintEvents.forEach((row) => merged.add(row.event.id));
    setSelectedEventIds(Array.from(merged));
  };

  return (
    <AppShell>
      <style>{`
        .hs-root {
          display: grid;
          gap: 20px;
        }

        .hs-card {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          padding: 20px;
        }

        .hs-preview-sheet {
          background: #fff;
          color: #111;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 12px 28px rgba(0,0,0,0.18);
          font-family: "Times New Roman", Georgia, serif;
        }

        .hs-print-header {
          text-align: center;
          margin-bottom: 10px;
        }

        .hs-meet-name {
          font-size: 20px;
          font-weight: 700;
          line-height: 1.2;
          color: #111;
        }

        .hs-meet-sub {
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.4;
          color: #333;
        }

        .hs-events-grid {
          column-count: 2;
          column-gap: 18px;
        }

        .hs-event-card {
          break-inside: avoid;
          margin-bottom: 14px;
          padding-bottom: 6px;
        }

        .hs-event-title {
          font-size: 14px;
          font-weight: 700;
          border-bottom: 2px solid #333;
          padding-bottom: 2px;
          margin-bottom: 3px;
          color: #111;
        }

        .hs-event-subtitle {
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 4px;
          color: #111;
        }

        .hs-event-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 12px;
          font-size: 10px;
          margin-bottom: 6px;
          color: #333;
        }

        .hs-heat-block {
          margin-top: 6px;
        }

        .hs-heat-head {
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 2px;
          color: #111;
        }

        .hs-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .hs-table th,
        .hs-table td {
          padding: 1px 4px;
          font-size: 11px;
          vertical-align: top;
          color: #111;
        }

        .hs-table thead th {
          border-top: 1px solid #444;
          border-bottom: 1px solid #444;
          text-align: left;
          font-weight: 700;
        }

        .hs-center {
          text-align: center !important;
        }

        .hs-lane-col {
          width: 42px;
        }

        .hs-team-col {
          width: 26%;
        }

        .hs-seed-col {
          width: 72px;
        }

        .hs-hf-col {
          width: 72px;
        }

        .hs-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          margin-top: 18px;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.12);
        }

        .hs-tab-btn {
          width: 100%;
          padding: 14px;
          border: none;
          background: rgba(19, 148, 9);
          color: #ffffff;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .hs-tab-btn:not(:last-child) {
          border-right: 1px solid rgba(255,255,255,0.08);
        }

        .hs-tab-btn:hover {
          background: rgba(255,255,255,0.10);
          color: #ffffff;
        }

        .hs-tab-btn.active {
          background: linear-gradient(135deg, #d4af37, #f5d76e);
          color: #071426;
        }

        @media (max-width: 600px) {
          .hs-tabs {
            grid-template-columns: 1fr;
          }
        }

        .hs-tab-panel {
          margin-top: 18px;
        }

        .hs-select-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 10px;
        }

        .hs-select-scroll {
          max-height: 420px;
          overflow: auto;
          padding-right: 6px;
          margin-top: 14px;
        }

        .hs-preview-scroll {
          max-height: 70vh;
          overflow: auto;
        }

        .hs-select-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.04);
        }

        .hs-select-card input {
          margin-top: 3px;
          transform: scale(1.15);
        }

        .hs-select-title {
          font-weight: 700;
          color: #fff;
        }

        .hs-select-sub {
          color: #9fb3c8;
          font-size: 13px;
          margin-top: 4px;
          line-height: 1.35;
        }

        @media (max-width: 900px) {
          .hs-events-grid {
            column-count: 1;
          }
        }
      `}</style>

      <div className="hs-root">
        <div className="hs-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div>
              <h1 style={{ marginTop: 0, marginBottom: 6 }}>Heat Sheets</h1>
              <div style={{ color: '#9fb3c8' }}>
                Use tabs to select multiple events for printing or preview one
                heat sheet.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={handlePrintSelected}
                disabled={selectedPrintEvents.length === 0}
                style={
                  selectedPrintEvents.length === 0
                    ? disabledBtnStyle
                    : secondaryBtnStyle
                }
              >
                Print Selected Heat Sheets
              </button>

              <button
                onClick={handlePrintAll}
                disabled={printEvents.length === 0}
                style={
                  printEvents.length === 0 ? disabledBtnStyle : primaryBtnStyle
                }
              >
                Print All Heat Sheets
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              background: activeMeetId
                ? 'rgba(46,175,109,0.10)'
                : 'rgba(217,83,79,0.10)',
              border: activeMeetId
                ? '1px solid rgba(46,175,109,0.28)'
                : '1px solid rgba(217,83,79,0.28)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Active Meet</div>
            <div style={{ color: activeMeetId ? '#d7ffe8' : '#ffd6d3' }}>
              {activeMeetLabel}
            </div>
          </div>

          <div className="hs-tabs">
            <button
              className={`hs-tab-btn ${activeTab === 'select' ? 'active' : ''}`}
              onClick={() => setActiveTab('select')}
            >
              Select Events to Print
            </button>
            <button
              className={`hs-tab-btn ${
                activeTab === 'preview' ? 'active' : ''
              }`}
              onClick={() => setActiveTab('preview')}
            >
              Preview Heat Sheet
            </button>
          </div>

          {activeTab === 'select' ? (
            <div className="hs-tab-panel">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 14,
                }}
              >
                <div>
                  <label style={labelStyle}>Event Filter</label>
                  <select
                    value={selectedPrintEventNo}
                    onChange={(e) => setSelectedPrintEventNo(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="ALL">All Events</option>
                    {printableEventNumbers.map((eventNo) => (
                      <option key={eventNo} value={eventNo}>
                        Event {eventNo}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Round Filter</label>
                  <select
                    value={selectedRoundFilter}
                    onChange={(e) => setSelectedRoundFilter(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="ALL">All</option>
                    <option value="HEAT">Heat</option>
                    <option value="FINAL">Final</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Selected for Print</label>
                  <input
                    value={`${selectedPrintEvents.length} of ${filteredPrintEvents.length}`}
                    disabled
                    readOnly
                    style={inputStyle}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Select Events to Print
                  </div>
                  <div style={{ color: '#9fb3c8', fontSize: 13 }}>
                    Filtered results: {filteredPrintEvents.length}
                  </div>
                </div>

                <button
                  onClick={handleToggleSelectAllFiltered}
                  disabled={filteredPrintEvents.length === 0}
                  style={
                    filteredPrintEvents.length === 0
                      ? disabledBtnStyle
                      : secondaryBtnStyle
                  }
                >
                  {allFilteredPrintableSelected
                    ? 'Clear Filtered'
                    : 'Select Filtered'}
                </button>
              </div>

              <div className="hs-select-scroll">
                <div className="hs-select-grid">
                  {filteredPrintEvents.length === 0 ? (
                    <div style={{ color: '#9fb3c8' }}>
                      No seeded events match the selected filters.
                    </div>
                  ) : (
                    filteredPrintEvents.map(({ event, heats }) => (
                      <label key={event.id} className="hs-select-card">
                        <input
                          type="checkbox"
                          checked={selectedEventIds.includes(event.id)}
                          onChange={() => toggleSelectedPrintEvent(event.id)}
                        />
                        <div>
                          <div className="hs-select-title">
                            Event {event.eventNumber || '—'} •{' '}
                            {event.name || 'Unnamed Event'}
                          </div>
                          <div className="hs-select-sub">
                            {event.round || '—'} • {event.gender || '—'} •{' '}
                            {event.ageGroup || '—'} • {heats.length} heat(s)
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="hs-tab-panel">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 14,
                  marginBottom: 18,
                }}
              >
                <div>
                  <label style={labelStyle}>Preview Event</label>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    style={inputStyle}
                  >
                    {seededEventOptions.length === 0 ? (
                      <option value="">No saved seeding found</option>
                    ) : (
                      seededEventOptions.map((event) => (
                        <option key={event.id} value={event.id}>
                          Event {event.eventNumber || '—'} • {event.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Lane Count</label>
                  <input
                    value={String(laneCount)}
                    disabled
                    readOnly
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Preview Heats</label>
                  <input
                    value={String(selectedHeats.length)}
                    disabled
                    readOnly
                    style={inputStyle}
                  />
                </div>
              </div>

              <div className="hs-preview-scroll">
                {!selectedEvent || selectedHeats.length === 0 ? (
                  <div className="hs-preview-sheet">
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: '#111',
                        marginBottom: 8,
                      }}
                    >
                      Heat Sheet Preview
                    </div>
                    <div style={{ color: '#333' }}>
                      Select an event with saved seeding to preview it here.
                    </div>
                  </div>
                ) : (
                  <div className="hs-preview-sheet">
                    <div className="hs-print-header">
                      <div className="hs-meet-name">
                        {activeMeet?.name || 'Swim Meet'}
                      </div>
                      <div className="hs-meet-sub">
                        Venue: {activeMeet?.venue || '—'} &nbsp;&nbsp; Date:{' '}
                        {activeMeet?.date || '—'} &nbsp;&nbsp; Pool:{' '}
                        {activeMeet?.poolLength || '—'} m
                      </div>
                    </div>

                    <div className="hs-events-grid">
                      <section className="hs-event-card">
                        <div className="hs-event-title">
                          Event {selectedEvent.eventNumber || '—'}
                        </div>
                        <div className="hs-event-subtitle">
                          {selectedEvent.name || 'Unnamed Event'}
                        </div>

                        <div className="hs-event-meta">
                          <span>Gender: {selectedEvent.gender || '—'}</span>
                          <span>Category: {selectedEvent.ageGroup || '—'}</span>
                          <span>Type: {selectedEvent.eventType || '—'}</span>
                          <span>Stroke: {selectedEvent.stroke || '—'}</span>
                          <span>
                            Generated:{' '}
                            {formatGeneratedAt(selectedSeeding?.generatedAt)}
                          </span>
                        </div>

                        {selectedHeats.map((heat) => (
                          <div key={heat.heatNumber} className="hs-heat-block">
                            <div className="hs-heat-head">
                              Heat {heat.heatNumber}
                            </div>

                            <table className="hs-table">
                              <thead>
                                <tr>
                                  <th className="hs-center hs-lane-col">
                                    Lane
                                  </th>
                                  <th>Name</th>
                                  <th className="hs-team-col">Team</th>
                                  <th className="hs-center hs-seed-col">
                                    Seed Time
                                  </th>
                                  <th className="hs-center hs-hf-col">
                                    H/F Time
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {heat.lanes.map((lane) => (
                                  <tr
                                    key={`preview-heat-${heat.heatNumber}-lane-${lane.laneNumber}`}
                                  >
                                    <td className="hs-center">
                                      {lane.laneNumber}
                                    </td>
                                    <td>{lane.swimmerName || '—'}</td>
                                    <td>{lane.teamName || '—'}</td>
                                    <td className="hs-center">
                                      {lane.seedTime || '—'}
                                    </td>
                                    <td className="hs-center"></td>
                                  </tr>
                                ))}

                                {heat.lanes.length < laneCount
                                  ? buildPreviewBlankRows(
                                      laneCount - heat.lanes.length
                                    )
                                  : null}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </section>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {msg ? (
            <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: 'white',
  outline: 'none',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: 'none',
  background: '#d4af37',
  color: '#071426',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'white',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledBtnStyle: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: 'none',
  background: 'rgba(255,255,255,0.10)',
  color: 'rgba(255,255,255,0.55)',
  fontWeight: 700,
  cursor: 'not-allowed',
};
