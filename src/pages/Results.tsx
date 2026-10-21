import { useEffect, useMemo, useState } from 'react';
import { onValue, ref, update } from 'firebase/database';
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

type ResultRow = {
  entryId?: string;
  swimmerId?: string;
  swimmerName?: string;
  teamId?: string;
  teamName?: string;
  eventId?: string;
  eventNumber?: number;
  eventName?: string;
  heatNumber?: number;
  laneNumber?: number;
  seedTime?: string;
  heatFinalTime?: string;
  status?: string;
  place?: number | null;
  active?: boolean;
  updatedAt?: number;
  updatedBy?: string;
};

type ResultViewRow = {
  resultId: string;
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  teamId: string;
  teamName: string;
  eventId: string;
  eventNumber: number;
  eventName: string;
  heatNumber: number;
  laneNumber: number;
  seedTime: string;
  heatFinalTime: string;
  status: string;
  place: number | null;
  gender: string;
  ageGroup: string;
  stroke: string;
  eventType: string;
  relay: boolean;
};

function normalizeStatus(value?: string) {
  const s = String(value || 'OK')
    .trim()
    .toUpperCase();
  if (['OK', 'DQ', 'NS', 'SCR'].includes(s)) return s;
  return 'OK';
}

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

function parseSwimTimeToHundredths(value?: string) {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/^(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return null;

  const mm = Number(match[1]);
  const ss = Number(match[2]);
  const hh = Number(match[3]);

  if (Number.isNaN(mm) || Number.isNaN(ss) || Number.isNaN(hh)) return null;

  return mm * 6000 + ss * 100 + hh;
}

function statusSortScore(status: string) {
  if (status === 'OK') return 0;
  if (status === 'NS') return 1;
  if (status === 'DQ') return 2;
  if (status === 'SCR') return 3;
  return 9;
}

function sortRowsForRanking(rows: ResultViewRow[]) {
  return [...rows].sort((a, b) => {
    const aStatus = normalizeStatus(a.status);
    const bStatus = normalizeStatus(b.status);

    if (aStatus === 'OK' && bStatus === 'OK') {
      const aTime = parseSwimTimeToHundredths(a.heatFinalTime);
      const bTime = parseSwimTimeToHundredths(b.heatFinalTime);

      if (aTime !== null && bTime !== null) return aTime - bTime;
      if (aTime !== null) return -1;
      if (bTime !== null) return 1;
    }

    const diff = statusSortScore(aStatus) - statusSortScore(bStatus);
    if (diff !== 0) return diff;

    if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
    if (a.laneNumber !== b.laneNumber) return a.laneNumber - b.laneNumber;

    return a.swimmerName.localeCompare(b.swimmerName);
  });
}

function computePlaces(rows: ResultViewRow[]) {
  const ranked = sortRowsForRanking(rows);
  const placeMap: Record<string, number | null> = {};
  let runningPlace = 1;

  ranked.forEach((row) => {
    const status = normalizeStatus(row.status);
    const time = parseSwimTimeToHundredths(row.heatFinalTime);

    if (status === 'OK' && time !== null) {
      placeMap[row.resultId] = runningPlace;
      runningPlace += 1;
    } else {
      placeMap[row.resultId] = null;
    }
  });

  return placeMap;
}

export default function Results() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [results, setResults] = useState<Record<string, ResultRow>>({});

  const [eventFilter, setEventFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [ageGroupFilter, setAgeGroupFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [heatFilter, setHeatFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [editingResultId, setEditingResultId] = useState('');
  const [editTimeDigits, setEditTimeDigits] = useState('');
  const [editStatus, setEditStatus] = useState('OK');
  const [savingResultId, setSavingResultId] = useState('');
  const [msg, setMsg] = useState('');

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  const resultRows = useMemo(() => {
    const eventMap = new Map<string, EventRow>();
    events.forEach((event) => eventMap.set(event.id, event));

    const entryMap = new Map<string, EntryRow>();
    entries.forEach((entry) => entryMap.set(entry.id, entry));

    const rows: ResultViewRow[] = Object.entries(results).map(
      ([resultId, result]) => {
        const entry = entryMap.get(String(result.entryId || ''));
        const event = eventMap.get(
          String(result.eventId || entry?.eventId || '')
        );

        return {
          resultId,
          entryId: String(result.entryId || ''),
          swimmerId: String(result.swimmerId || entry?.swimmerId || ''),
          swimmerName: String(result.swimmerName || entry?.swimmerName || ''),
          teamId: String(result.teamId || entry?.teamId || ''),
          teamName: String(result.teamName || entry?.teamName || ''),
          eventId: String(result.eventId || entry?.eventId || ''),
          eventNumber: Number(
            result.eventNumber || entry?.eventNumber || event?.eventNumber || 0
          ),
          eventName: String(
            result.eventName || entry?.eventName || event?.name || ''
          ),
          heatNumber: Number(result.heatNumber || 0),
          laneNumber: Number(result.laneNumber || 0),
          seedTime: String(result.seedTime || entry?.laneSeedTime || ''),
          heatFinalTime: String(result.heatFinalTime || ''),
          status: normalizeStatus(result.status || 'OK'),
          place: typeof result.place === 'number' ? result.place : null,
          gender: String(entry?.gender || event?.gender || ''),
          ageGroup: String(entry?.ageGroup || event?.ageGroup || ''),
          stroke: String(event?.stroke || ''),
          eventType: String(event?.eventType || ''),
          relay: !!event?.relay,
        };
      }
    );

    return rows.sort((a, b) => {
      if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
      if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
      if (a.laneNumber !== b.laneNumber) return a.laneNumber - b.laneNumber;
      return a.swimmerName.localeCompare(b.swimmerName);
    });
  }, [results, events, entries]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return resultRows.filter((row) => {
      if (eventFilter && row.eventId !== eventFilter) return false;
      if (genderFilter && row.gender !== genderFilter) return false;
      if (ageGroupFilter && row.ageGroup !== ageGroupFilter) return false;
      if (teamFilter && row.teamId !== teamFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (heatFilter && String(row.heatNumber) !== heatFilter) return false;

      if (!q) return true;

      const haystack = [
        row.swimmerName,
        row.teamName,
        row.eventName,
        row.gender,
        row.ageGroup,
        row.stroke,
        row.eventType,
        row.heatFinalTime,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [
    resultRows,
    eventFilter,
    genderFilter,
    ageGroupFilter,
    teamFilter,
    statusFilter,
    heatFilter,
    searchTerm,
  ]);

  const recomputedFilteredRows = useMemo(() => {
    if (!filteredRows.length) return [];

    const grouped = new Map<string, ResultViewRow[]>();

    filteredRows.forEach((row) => {
      const key = row.eventId || `event-${row.eventNumber}`;
      const current = grouped.get(key) || [];
      current.push(row);
      grouped.set(key, current);
    });

    const output: ResultViewRow[] = [];

    grouped.forEach((groupRows) => {
      const placeMap = computePlaces(groupRows);
      const sortedGroup = sortRowsForRanking(groupRows).map((row) => ({
        ...row,
        place: placeMap[row.resultId] ?? null,
      }));
      output.push(...sortedGroup);
    });

    return output.sort((a, b) => {
      if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
      if ((a.place ?? 9999) !== (b.place ?? 9999)) {
        return (a.place ?? 9999) - (b.place ?? 9999);
      }
      if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
      if (a.laneNumber !== b.laneNumber) return a.laneNumber - b.laneNumber;
      return a.swimmerName.localeCompare(b.swimmerName);
    });
  }, [filteredRows]);

  const eventOptions = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false)
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const genderOptions = useMemo(() => {
    return Array.from(
      new Set(resultRows.map((row) => row.gender).filter(Boolean))
    ).sort();
  }, [resultRows]);

  const ageGroupOptions = useMemo(() => {
    return Array.from(
      new Set(resultRows.map((row) => row.ageGroup).filter(Boolean))
    ).sort();
  }, [resultRows]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    resultRows.forEach((row) => {
      if (row.teamId && row.teamName) map.set(row.teamId, row.teamName);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [resultRows]);

  const heatOptions = useMemo(() => {
    if (!resultRows.length) return [] as number[];

    if (eventFilter) {
      const eventRows = resultRows.filter((row) => row.eventId === eventFilter);
      const maxHeatForEvent = Math.max(
        0,
        ...eventRows.map((row) => Number(row.heatNumber || 0))
      );

      return Array.from({ length: maxHeatForEvent }, (_, i) => i + 1);
    }

    const maxHeatAcrossMeet = Math.max(
      0,
      ...resultRows.map((row) => Number(row.heatNumber || 0))
    );

    return Array.from({ length: maxHeatAcrossMeet }, (_, i) => i + 1);
  }, [resultRows, eventFilter]);

  useEffect(() => {
    if (!heatFilter) return;

    const heatNumber = Number(heatFilter);
    if (!heatOptions.includes(heatNumber)) {
      setHeatFilter('');
    }
  }, [heatFilter, heatOptions]);

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
      setResults({});
      return;
    }

    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const entriesRef = ref(db, `meets/${activeMeetId}/entries`);
    const resultsRef = ref(db, `meets/${activeMeetId}/results`);

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

    const unsubResults = onValue(resultsRef, (snap) => {
      setResults((snap.val() as Record<string, ResultRow>) || {});
    });

    return () => {
      unsubEvents();
      unsubEntries();
      unsubResults();
    };
  }, [activeMeetId]);

  const startEdit = (row: ResultViewRow) => {
    setEditingResultId(row.resultId);
    setEditTimeDigits(digitsOnly(row.heatFinalTime));
    setEditStatus(normalizeStatus(row.status));
  };

  const cancelEdit = () => {
    setEditingResultId('');
    setEditTimeDigits('');
    setEditStatus('OK');
  };

  const saveEdit = async (row: ResultViewRow) => {
    if (!activeMeetId) {
      setMsg('No active meet selected');
      return;
    }

    setSavingResultId(row.resultId);
    setMsg('Saving result...');

    try {
      const updatedRows = recomputedFilteredRows.map((r) =>
        r.resultId === row.resultId
          ? {
              ...r,
              heatFinalTime: formatSwimTimeFromDigits(editTimeDigits),
              status: normalizeStatus(editStatus),
            }
          : r
      );

      const sameEventRows = updatedRows.filter(
        (r) => r.eventId === row.eventId
      );
      const placeMap = computePlaces(sameEventRows);

      await update(ref(db, `meets/${activeMeetId}/results/${row.resultId}`), {
        heatFinalTime: formatSwimTimeFromDigits(editTimeDigits),
        status: normalizeStatus(editStatus),
        place: placeMap[row.resultId] ?? null,
        updatedAt: Date.now(),
      });

      setMsg('Result updated successfully');
      cancelEdit();
    } catch (error: any) {
      setMsg(error.message || 'Failed to update result');
    } finally {
      setSavingResultId('');
    }
  };

  return (
    <AppShell>
      <div style={{ display: 'grid', gap: 20 }}>
        <div
          style={{
            background: activeMeetId
              ? 'rgba(46,175,109,0.10)'
              : 'rgba(217,83,79,0.10)',
            border: activeMeetId
              ? '1px solid rgba(46,175,109,0.28)'
              : '1px solid rgba(217,83,79,0.28)',
            borderRadius: 18,
            padding: 18,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Active Meet</h2>
          <div style={{ color: activeMeetId ? '#d7ffe8' : '#ffd6d3' }}>
            {activeMeetLabel}
          </div>
        </div>

        <div style={panelStyle}>
          <h1 style={{ marginTop: 0 }}>Results</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            View, filter, rank, and edit saved results for the active meet.
          </p>

          <div style={filtersGridStyle}>
            <div>
              <label style={labelStyle}>Event</label>
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Events</option>
                {eventOptions.map((event) => (
                  <option key={event.id} value={event.id}>
                    Event {event.eventNumber || '—'} • {event.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Gender</label>
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Genders</option>
                {genderOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={ageGroupFilter}
                onChange={(e) => setAgeGroupFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Categories</option>
                {ageGroupOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Team</label>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Teams</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Statuses</option>
                <option value="OK">OK</option>
                <option value="DQ">DQ</option>
                <option value="NS">NS</option>
                <option value="SCR">SCR</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Heat</label>
              <select
                value={heatFilter}
                onChange={(e) => setHeatFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Heats</option>
                {heatOptions.map((heatNo) => (
                  <option key={heatNo} value={String(heatNo)}>
                    Heat {heatNo}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Search</label>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search swimmer, team, event, category..."
                style={inputStyle}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 14,
            }}
          >
            <span style={pillStyle}>
              Results: {recomputedFilteredRows.length}
            </span>
            <span style={pillStyle}>Events: {eventOptions.length}</span>
            <span style={pillStyle}>Teams: {teamOptions.length}</span>
            <span style={pillStyle}>
              Heat Options:{' '}
              {heatOptions.length
                ? `1 to ${heatOptions[heatOptions.length - 1]}`
                : '—'}
            </span>
          </div>

          {msg ? (
            <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
          ) : null}
        </div>

        <div style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Saved Results</h2>

          {recomputedFilteredRows.length === 0 ? (
            <p style={{ color: '#9fb3c8' }}>
              No results found for the selected filters.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: 1180,
                }}
              >
                <thead>
                  <tr>
                    {[
                      'Place',
                      'Event',
                      'Heat',
                      'Lane',
                      'Swimmer',
                      'Team',
                      'Category',
                      'Seed',
                      'H/F Time',
                      'Status',
                      'Action',
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderBottom: '1px solid rgba(255,255,255,0.12)',
                          color: '#cfe0f1',
                          background: 'rgba(255,255,255,0.04)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recomputedFilteredRows.map((row) => {
                    const isEditing = editingResultId === row.resultId;

                    return (
                      <tr key={row.resultId}>
                        <td style={tdStyle}>{row.place ?? '—'}</td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 700 }}>
                            {row.eventNumber || '—'}
                          </div>
                          <div style={{ color: '#9fb3c8', fontSize: 12 }}>
                            {row.eventName || '—'}
                          </div>
                        </td>
                        <td style={tdStyle}>{row.heatNumber || '—'}</td>
                        <td style={tdStyle}>{row.laneNumber || '—'}</td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 700 }}>
                            {row.swimmerName || '—'}
                          </div>
                          <div style={{ color: '#9fb3c8', fontSize: 12 }}>
                            {row.gender || '—'} • {row.stroke || '—'}
                          </div>
                        </td>
                        <td style={tdStyle}>{row.teamName || '—'}</td>
                        <td style={tdStyle}>{row.ageGroup || '—'}</td>
                        <td style={tdStyle}>{row.seedTime || '—'}</td>

                        <td style={tdStyle}>
                          {isEditing ? (
                            <input
                              value={formatSwimTimeFromDigits(editTimeDigits)}
                              readOnly
                              onKeyDown={(e) => {
                                const key = e.key;

                                if (/^\d$/.test(key)) {
                                  e.preventDefault();
                                  setEditTimeDigits((prev) =>
                                    digitsOnly(`${prev}${key}`)
                                  );
                                  return;
                                }

                                if (key === 'Backspace') {
                                  e.preventDefault();
                                  setEditTimeDigits((prev) =>
                                    prev.slice(0, -1)
                                  );
                                  return;
                                }

                                if (key === 'Delete') {
                                  e.preventDefault();
                                  setEditTimeDigits('');
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
                              style={{ ...inputStyle, minWidth: 120 }}
                            />
                          ) : (
                            row.heatFinalTime || '—'
                          )}
                        </td>

                        <td style={tdStyle}>
                          {isEditing ? (
                            <select
                              value={editStatus}
                              onChange={(e) => setEditStatus(e.target.value)}
                              style={{ ...inputStyle, minWidth: 90 }}
                            >
                              <option value="OK">OK</option>
                              <option value="DQ">DQ</option>
                              <option value="NS">NS</option>
                              <option value="SCR">SCR</option>
                            </select>
                          ) : (
                            <span
                              style={{
                                ...pillStyle,
                                background:
                                  row.status === 'OK'
                                    ? 'rgba(46,175,109,0.16)'
                                    : row.status === 'NS'
                                    ? 'rgba(212,175,55,0.18)'
                                    : 'rgba(217,83,79,0.16)',
                                border:
                                  row.status === 'OK'
                                    ? '1px solid rgba(46,175,109,0.35)'
                                    : row.status === 'NS'
                                    ? '1px solid rgba(212,175,55,0.35)'
                                    : '1px solid rgba(217,83,79,0.35)',
                              }}
                            >
                              {row.status}
                            </span>
                          )}
                        </td>

                        <td style={tdStyle}>
                          {!isEditing ? (
                            <button
                              onClick={() => startEdit(row)}
                              style={secondaryBtnStyle}
                            >
                              Edit
                            </button>
                          ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => saveEdit(row)}
                                disabled={savingResultId === row.resultId}
                                style={
                                  savingResultId === row.resultId
                                    ? disabledBtnStyle
                                    : primaryBtnStyle
                                }
                              >
                                {savingResultId === row.resultId
                                  ? 'Saving...'
                                  : 'Save'}
                              </button>
                              <button
                                onClick={cancelEdit}
                                style={secondaryBtnStyle}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 18,
  padding: 20,
};

const filtersGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
  marginTop: 18,
};

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

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  verticalAlign: 'top',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: 'none',
  background: '#d4af37',
  color: '#071426',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'white',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: 'none',
  background: 'rgba(255,255,255,0.10)',
  color: 'rgba(255,255,255,0.55)',
  fontWeight: 700,
  cursor: 'not-allowed',
};

const pillStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontSize: 12,
  fontWeight: 700,
  color: 'white',
};
