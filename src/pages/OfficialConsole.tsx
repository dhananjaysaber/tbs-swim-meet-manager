import { useEffect, useMemo, useState } from 'react';
import { onValue, push, ref, remove, set, update } from 'firebase/database';
import AppShell from '../components/AppShell';
import { auth } from '../firebase/auth.js';
import { db } from '../firebase/db.js';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  laneCount?: number;
};

type EventRound = 'Heats' | 'Final' | 'Timed Final';

type EventRow = {
  id: string;
  eventNumber?: number;
  distance?: string;
  stroke?: string;
  gender?: string;
  ageGroup?: string;
  eventType?: string;
  round?: EventRound;
  qualifiesToEventId?: string;
  qualifyCount?: number;
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

type RankedQualifierRow = {
  resultId: string;
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  teamId: string;
  teamName: string;
  heatNumber: number;
  laneNumber: number;
  time: string;
  hundredths: number;
  status: string;
  rank: number | null;
  qualified: boolean;
  alreadyInFinal: boolean;
};

type FinalEntryView = {
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  teamId: string;
  teamName: string;
  seedTime: string;
  status: string;
};

type BulkRow = {
  heatsEvent: EventRow;
  finalEvent: EventRow | null;
  totalEntries: number;
  completedEntries: number;
  isComplete: boolean;
  qualifyCount: number;
  qualifiedRows: RankedQualifierRow[];
  finalEntries: FinalEntryView[];
};

type TabKey = 'single' | 'bulk';
type BulkMode = 'promote' | 'reseed' | null;

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

  const match = text.match(/^(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return null;

  const mm = Number(match[1]);
  const ss = Number(match[2]);
  const hh = Number(match[3]);

  if (Number.isNaN(mm) || Number.isNaN(ss) || Number.isNaN(hh)) return null;

  return mm * 6000 + ss * 100 + hh;
}

function getLaneOrder(laneCount: number) {
  if (laneCount === 6) return [3, 4, 2, 5, 1, 6];
  if (laneCount === 8) return [4, 5, 3, 6, 2, 7, 1, 8];
  if (laneCount === 10) return [5, 6, 4, 7, 3, 8, 2, 9, 1, 10];
  return Array.from({ length: laneCount || 8 }, (_, i) => i + 1);
}

function isEntryCompleted(
  entryId: string,
  resultsById: Record<string, ResultRow>
) {
  const result = Object.values(resultsById).find(
    (row) => String(row.entryId || '') === entryId
  );
  if (!result) return false;

  const status = normalizeStatus(result.status);
  const time = String(result.heatFinalTime || '').trim();

  return (
    status === 'DQ' ||
    status === 'NS' ||
    status === 'SCR' ||
    (status === 'OK' && !!time)
  );
}

function buildBulkRow(args: {
  heatsEvent: EventRow;
  events: EventRow[];
  entries: EntryRow[];
  resultsById: Record<string, ResultRow>;
  activeMeet: MeetRow | null;
}) {
  const { heatsEvent, events, entries, resultsById, activeMeet } = args;
  const finalEvent =
    events.find((e) => e.id === heatsEvent.qualifiesToEventId) || null;

  const heatsEntries = entries
    .filter(
      (entry) =>
        entry.eventId === heatsEvent.id &&
        entry.active !== false &&
        String(entry.status || '').toLowerCase() !== 'scratch'
    )
    .sort((a, b) =>
      String(a.swimmerName || '').localeCompare(String(b.swimmerName || ''))
    );

  const totalEntries = heatsEntries.length;
  const completedEntries = heatsEntries.filter((entry) =>
    isEntryCompleted(entry.id, resultsById)
  ).length;
  const isComplete = totalEntries > 0 && totalEntries === completedEntries;

  const finalEntries: FinalEntryView[] = finalEvent
    ? entries
        .filter(
          (entry) => entry.eventId === finalEvent.id && entry.active !== false
        )
        .map((entry) => ({
          entryId: entry.id,
          swimmerId: String(entry.swimmerId || ''),
          swimmerName: String(entry.swimmerName || ''),
          teamId: String(entry.teamId || ''),
          teamName: String(entry.teamName || ''),
          seedTime: String(entry.laneSeedTime || ''),
          status: String(entry.status || 'Entered'),
        }))
        .sort((a, b) => a.swimmerName.localeCompare(b.swimmerName))
    : [];

  const finalSwimmerIds = new Set(
    finalEntries.map((row) => row.swimmerId).filter(Boolean)
  );

  const explicit = Number(heatsEvent.qualifyCount || 0);
  const qualifyCount =
    explicit > 0 ? explicit : Number(activeMeet?.laneCount || 0);

  const rows = heatsEntries
    .map((entry) => {
      const resultPair = Object.entries(resultsById).find(
        ([, result]) => String(result.entryId || '') === entry.id
      );
      const resultId = resultPair?.[0] || '';
      const result = resultPair?.[1];

      const status = normalizeStatus(result?.status || 'OK');
      const time = String(result?.heatFinalTime || '').trim();
      const hundredths =
        status === 'OK' && time ? parseSwimTimeToHundredths(time) : null;

      return {
        resultId,
        entryId: entry.id,
        swimmerId: String(entry.swimmerId || ''),
        swimmerName: String(entry.swimmerName || ''),
        teamId: String(entry.teamId || ''),
        teamName: String(entry.teamName || ''),
        heatNumber: Number(result?.heatNumber || 0),
        laneNumber: Number(result?.laneNumber || 0),
        time,
        hundredths: hundredths ?? Number.MAX_SAFE_INTEGER,
        status,
        rank: null,
        qualified: false,
        alreadyInFinal: finalSwimmerIds.has(String(entry.swimmerId || '')),
      } as RankedQualifierRow;
    })
    .filter((row) => !!row.swimmerId);

  const sorted = [...rows].sort((a, b) => {
    const aValid =
      a.status === 'OK' && a.time && a.hundredths !== Number.MAX_SAFE_INTEGER;
    const bValid =
      b.status === 'OK' && b.time && b.hundredths !== Number.MAX_SAFE_INTEGER;

    if (aValid && bValid) {
      if (a.hundredths !== b.hundredths) return a.hundredths - b.hundredths;
    } else if (aValid && !bValid) {
      return -1;
    } else if (!aValid && bValid) {
      return 1;
    }

    const statusOrder = (status: string) => {
      if (status === 'OK') return 0;
      if (status === 'NS') return 1;
      if (status === 'DQ') return 2;
      if (status === 'SCR') return 3;
      return 9;
    };

    const diff = statusOrder(a.status) - statusOrder(b.status);
    if (diff !== 0) return diff;

    if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
    if (a.laneNumber !== b.laneNumber) return a.laneNumber - b.laneNumber;

    return a.swimmerName.localeCompare(b.swimmerName);
  });

  let currentRank = 1;
  const validRows = sorted.filter(
    (row) =>
      row.status === 'OK' &&
      row.time &&
      row.hundredths !== Number.MAX_SAFE_INTEGER
  );

  const qualifiedSwimmerIds = new Set(
    validRows.slice(0, qualifyCount).map((row) => row.swimmerId)
  );

  const qualifiedRows = sorted
    .map((row) => {
      const isRanked =
        row.status === 'OK' &&
        row.time &&
        row.hundredths !== Number.MAX_SAFE_INTEGER;
      return {
        ...row,
        rank: isRanked ? currentRank++ : null,
        qualified: qualifiedSwimmerIds.has(row.swimmerId),
      };
    })
    .filter((row) => row.qualified);

  return {
    heatsEvent,
    finalEvent,
    totalEntries,
    completedEntries,
    isComplete,
    qualifyCount,
    qualifiedRows,
    finalEntries,
  } as BulkRow;
}

export default function OfficialConsole() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [resultsById, setResultsById] = useState<Record<string, ResultRow>>({});

  const [selectedHeatsEventId, setSelectedHeatsEventId] = useState('');
  const [msg, setMsg] = useState('');
  const [working, setWorking] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('single');
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);
  const [bulkSelectedHeatsIds, setBulkSelectedHeatsIds] = useState<string[]>(
    []
  );

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'} • ${activeMeet.laneCount || '—'} lanes`;
  }, [activeMeet]);

  const heatsEventOptions = useMemo(() => {
    return [...events]
      .filter(
        (event) =>
          event.active !== false &&
          event.round === 'Heats' &&
          !!String(event.qualifiesToEventId || '').trim()
      )
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const bulkRows = useMemo(() => {
    return heatsEventOptions.map((heatsEvent) =>
      buildBulkRow({
        heatsEvent,
        events,
        entries,
        resultsById,
        activeMeet,
      })
    );
  }, [heatsEventOptions, events, entries, resultsById, activeMeet]);

  const selectedHeatsEvent = useMemo(() => {
    return (
      heatsEventOptions.find((event) => event.id === selectedHeatsEventId) ||
      null
    );
  }, [heatsEventOptions, selectedHeatsEventId]);

  const selectedBulkRow = useMemo(() => {
    return (
      bulkRows.find((row) => row.heatsEvent.id === selectedHeatsEventId) || null
    );
  }, [bulkRows, selectedHeatsEventId]);

  const linkedFinalEvent = selectedBulkRow?.finalEvent || null;

  const finalEventEntries = selectedBulkRow?.finalEntries || [];
  const completionSummary = useMemo(() => {
    return {
      total: selectedBulkRow?.totalEntries || 0,
      completed: selectedBulkRow?.completedEntries || 0,
      isComplete: !!selectedBulkRow?.isComplete,
    };
  }, [selectedBulkRow]);

  const qualifyCount = selectedBulkRow?.qualifyCount || 0;
  const rankedQualifiers = selectedBulkRow?.qualifiedRows || [];
  const qualifiedRows = rankedQualifiers;

  const canPromote = useMemo(() => {
    return (
      !!selectedHeatsEvent &&
      !!linkedFinalEvent &&
      qualifiedRows.length > 0 &&
      completionSummary.isComplete
    );
  }, [
    selectedHeatsEvent,
    linkedFinalEvent,
    qualifiedRows.length,
    completionSummary.isComplete,
  ]);

  const promoteableBulkRows = useMemo(() => {
    return bulkRows.filter((row) => !!row.finalEvent);
  }, [bulkRows]);

  const reseedableBulkRows = useMemo(() => {
    return bulkRows.filter(
      (row) => !!row.finalEvent && row.finalEntries.length > 0
    );
  }, [bulkRows]);

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
      setResultsById({});
      setSelectedHeatsEventId('');
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
      setResultsById((snap.val() as Record<string, ResultRow>) || {});
    });

    return () => {
      unsubEvents();
      unsubEntries();
      unsubResults();
    };
  }, [activeMeetId]);

  useEffect(() => {
    if (!heatsEventOptions.length) {
      setSelectedHeatsEventId('');
      return;
    }

    setSelectedHeatsEventId((prev) => {
      if (prev && heatsEventOptions.some((event) => event.id === prev))
        return prev;
      return heatsEventOptions[0].id;
    });
  }, [heatsEventOptions]);

  useEffect(() => {
    const validPromoteIds = new Set(
      promoteableBulkRows.map((row) => row.heatsEvent.id)
    );
    setBulkSelectedHeatsIds((prev) =>
      prev.filter((id) => validPromoteIds.has(id))
    );
  }, [promoteableBulkRows]);

  const toggleBulkSelected = (eventId: string) => {
    setBulkSelectedHeatsIds((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
  };

  const handleOpenBulkModal = (mode: BulkMode) => {
    setBulkMode(mode);
    setBulkSelectedHeatsIds([]);
  };

  const handleCloseBulkModal = () => {
    setBulkMode(null);
    setBulkSelectedHeatsIds([]);
  };

  const processPromoteForRow = async (row: BulkRow) => {
    if (!activeMeetId || !row.finalEvent) return;
    const user = auth.currentUser;
    if (!user) throw new Error('You are not logged in');

    const existingFinalEntries = entries.filter(
      (entry) => entry.eventId === row.finalEvent!.id && entry.active !== false
    );

    const existingBySwimmerId = new Map<string, EntryRow>();
    existingFinalEntries.forEach((entry) => {
      if (entry.swimmerId) {
        existingBySwimmerId.set(String(entry.swimmerId), entry);
      }
    });

    for (const qualifier of row.qualifiedRows) {
      const existing = existingBySwimmerId.get(qualifier.swimmerId);

      if (existing) {
        await update(ref(db, `meets/${activeMeetId}/entries/${existing.id}`), {
          swimmerId: qualifier.swimmerId,
          swimmerName: qualifier.swimmerName,
          gender: row.finalEvent.gender || row.heatsEvent.gender || '',
          ageGroup: row.finalEvent.ageGroup || row.heatsEvent.ageGroup || '',
          teamId: qualifier.teamId,
          teamName: qualifier.teamName,
          eventId: row.finalEvent.id,
          eventNumber: row.finalEvent.eventNumber || 0,
          eventName: row.finalEvent.name || '',
          laneSeedTime: qualifier.time || '',
          status: 'Qualified',
          active: true,
        });
      } else {
        const newEntryRef = push(ref(db, `meets/${activeMeetId}/entries`));
        await set(newEntryRef, {
          swimmerId: qualifier.swimmerId,
          swimmerName: qualifier.swimmerName,
          gender: row.finalEvent.gender || row.heatsEvent.gender || '',
          ageGroup: row.finalEvent.ageGroup || row.heatsEvent.ageGroup || '',
          teamId: qualifier.teamId,
          teamName: qualifier.teamName,
          eventId: row.finalEvent.id,
          eventNumber: row.finalEvent.eventNumber || 0,
          eventName: row.finalEvent.name || '',
          laneSeedTime: qualifier.time || '',
          status: 'Qualified',
          active: true,
          createdAt: Date.now(),
          createdBy: user.uid,
        });
      }
    }
  };

  const processReseedForRow = async (row: BulkRow) => {
    if (!activeMeetId || !row.finalEvent) return;
    const user = auth.currentUser;
    if (!user) throw new Error('You are not logged in');

    const finalEntriesForEvent = entries.filter(
      (entry) =>
        entry.eventId === row.finalEvent!.id &&
        entry.active !== false &&
        row.qualifiedRows.some(
          (q) => q.swimmerId === String(entry.swimmerId || '')
        )
    );

    const finalEntriesBySwimmerId = new Map<string, EntryRow>();
    finalEntriesForEvent.forEach((entry) => {
      if (entry.swimmerId) {
        finalEntriesBySwimmerId.set(String(entry.swimmerId), entry);
      }
    });

    const qualifiers = [...row.qualifiedRows].sort(
      (a, b) => a.hundredths - b.hundredths
    );
    const laneCount = Number(
      activeMeet?.laneCount || row.qualifyCount || qualifiers.length || 6
    );
    const laneOrder = getLaneOrder(laneCount);

    const lanePayload: Record<
      string,
      {
        laneNumber: number;
        entryId: string;
        swimmerId: string;
        swimmerName: string;
        teamId: string;
        teamName: string;
        seedTime: string;
        heatNumber: number;
      }
    > = {};

    qualifiers.slice(0, laneOrder.length).forEach((qualifier, index) => {
      const laneNumber = laneOrder[index];
      const finalEntry = finalEntriesBySwimmerId.get(qualifier.swimmerId);
      if (!finalEntry) return;

      lanePayload[`lane${laneNumber}`] = {
        laneNumber,
        entryId: finalEntry.id,
        swimmerId: qualifier.swimmerId,
        swimmerName: qualifier.swimmerName,
        teamId: qualifier.teamId,
        teamName: qualifier.teamName,
        seedTime: qualifier.time || '',
        heatNumber: 1,
      };
    });

    await set(ref(db, `meets/${activeMeetId}/seeding/${row.finalEvent.id}`), {
      generatedAt: Date.now(),
      generatedBy: user.uid,
      laneCount,
      eventId: row.finalEvent.id,
      eventNumber: row.finalEvent.eventNumber || 0,
      eventName: row.finalEvent.name || '',
      heats: {
        heat1: {
          heatNumber: 1,
          lanes: lanePayload,
        },
      },
      meta: {
        seededCount: Object.keys(lanePayload).length,
        unseededCount: 0,
      },
    });
  };

  const handlePromoteFinalists = async (alsoSeed: boolean) => {
    if (!selectedBulkRow || !selectedBulkRow.finalEvent) {
      setMsg('Please select a valid heats event');
      return;
    }

    if (!selectedBulkRow.qualifiedRows.length) {
      setMsg('No qualified swimmers found');
      return;
    }

    if (!selectedBulkRow.isComplete) {
      setMsg('Heats are not complete yet for this event');
      return;
    }

    const ok = window.confirm(
      alsoSeed
        ? `Promote qualified swimmers to ${
            selectedBulkRow.finalEvent.name || 'Final'
          } and reseed final lanes?`
        : `Promote qualified swimmers to ${
            selectedBulkRow.finalEvent.name || 'Final'
          }?`
    );
    if (!ok) return;

    setWorking(true);
    setMsg(
      alsoSeed ? 'Promoting and seeding finalists...' : 'Promoting finalists...'
    );

    try {
      await processPromoteForRow(selectedBulkRow);
      if (alsoSeed) {
        await processReseedForRow(selectedBulkRow);
      }

      setMsg(
        alsoSeed
          ? `Qualified swimmers promoted and final seeded for ${
              selectedBulkRow.finalEvent.name || 'Final'
            }`
          : `Qualified swimmers promoted to ${
              selectedBulkRow.finalEvent.name || 'Final'
            }`
      );
    } catch (error: any) {
      setMsg(error.message || 'Failed to build finalists');
    } finally {
      setWorking(false);
    }
  };

  const handleBulkPromote = async () => {
    const selectedRows = promoteableBulkRows.filter((row) =>
      bulkSelectedHeatsIds.includes(row.heatsEvent.id)
    );
    const validRows = selectedRows.filter(
      (row) => row.isComplete && row.qualifiedRows.length > 0 && row.finalEvent
    );

    if (!validRows.length) {
      setMsg(
        'Please select at least one completed heats event with qualifiers'
      );
      return;
    }

    const ok = window.confirm(
      `Promote finalists for ${validRows.length} selected event(s)?`
    );
    if (!ok) return;

    setWorking(true);
    setMsg('Promoting selected finalists...');

    try {
      for (const row of validRows) {
        await processPromoteForRow(row);
      }
      setMsg(`Promoted finalists for ${validRows.length} selected event(s)`);
      handleCloseBulkModal();
    } catch (error: any) {
      setMsg(error.message || 'Failed to promote selected finalists');
    } finally {
      setWorking(false);
    }
  };

  const handleBulkReseed = async () => {
    const selectedRows = reseedableBulkRows.filter((row) =>
      bulkSelectedHeatsIds.includes(row.heatsEvent.id)
    );

    if (!selectedRows.length) {
      setMsg('Please select at least one promoted final to reseed');
      return;
    }

    const ok = window.confirm(
      `Reseed ${selectedRows.length} selected promoted final(s)?`
    );
    if (!ok) return;

    setWorking(true);
    setMsg('Reseeding selected finals...');

    try {
      for (const row of selectedRows) {
        await processReseedForRow(row);
      }
      setMsg(`Reseeded ${selectedRows.length} selected final(s)`);
      handleCloseBulkModal();
    } catch (error: any) {
      setMsg(error.message || 'Failed to reseed selected finals');
    } finally {
      setWorking(false);
    }
  };

  const handleClearFinalEntries = async () => {
    if (!activeMeetId || !linkedFinalEvent) {
      setMsg('No linked final event selected');
      return;
    }

    const ok = window.confirm(
      `Clear all current finalists and seeding for ${
        linkedFinalEvent.name || 'Final'
      }?`
    );
    if (!ok) return;

    setWorking(true);
    setMsg('Clearing final event entries and seeding...');

    try {
      const finalEntries = entries.filter(
        (entry) =>
          entry.eventId === linkedFinalEvent.id && entry.active !== false
      );

      for (const entry of finalEntries) {
        await remove(ref(db, `meets/${activeMeetId}/entries/${entry.id}`));
      }

      await remove(
        ref(db, `meets/${activeMeetId}/seeding/${linkedFinalEvent.id}`)
      );

      setMsg(
        `Cleared finalists and seeding for ${linkedFinalEvent.name || 'Final'}`
      );
    } catch (error: any) {
      setMsg(error.message || 'Failed to clear final event');
    } finally {
      setWorking(false);
    }
  };

  const modalRows =
    bulkMode === 'promote' ? promoteableBulkRows : reseedableBulkRows;

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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h1 style={{ marginTop: 0, marginBottom: 6 }}>
                Official Console
              </h1>
              <p style={{ color: '#9fb3c8', marginTop: 0, marginBottom: 0 }}>
                Build finalists from completed heats and reseed finals safely.
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'flex-start',
              }}
            >
              <button
                onClick={() => handleOpenBulkModal('promote')}
                disabled={!promoteableBulkRows.length || working}
                style={
                  !promoteableBulkRows.length || working
                    ? disabledBtnStyle
                    : primaryBtnStyle
                }
              >
                Promote ALL Finals
              </button>
              <button
                onClick={() => handleOpenBulkModal('reseed')}
                disabled={!reseedableBulkRows.length || working}
                style={
                  !reseedableBulkRows.length || working
                    ? disabledBtnStyle
                    : secondaryBtnStyle
                }
              >
                Reseed Promoted Finals
              </button>
            </div>
          </div>

          <div style={tabsWrapStyle}>
            <button
              type="button"
              onClick={() => setActiveTab('single')}
              style={{
                ...tabBtnStyle,
                ...(activeTab === 'single' ? activeTabBtnStyle : {}),
              }}
            >
              Single Event
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bulk')}
              style={{
                ...tabBtnStyle,
                ...(activeTab === 'bulk' ? activeTabBtnStyle : {}),
              }}
            >
              Bulk Actions
            </button>
          </div>

          {activeTab === 'single' ? (
            <>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Heats Event</label>
                  <select
                    value={selectedHeatsEventId}
                    onChange={(e) => setSelectedHeatsEventId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Select Heats event</option>
                    {heatsEventOptions.map((event) => {
                      const row = bulkRows.find(
                        (r) => r.heatsEvent.id === event.id
                      );
                      return (
                        <option key={event.id} value={event.id}>
                          Event {event.eventNumber || '—'} •{' '}
                          {event.name || 'Unnamed Event'}
                          {row?.isComplete ? ' • Complete' : ' • Incomplete'}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Linked Final Event</label>
                  <div style={readOnlyBoxStyle}>
                    {linkedFinalEvent
                      ? `Event ${linkedFinalEvent.eventNumber || '—'} • ${
                          linkedFinalEvent.name || 'Unnamed Final'
                        }`
                      : 'No linked final event'}
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Qualify Count</label>
                  <div style={readOnlyBoxStyle}>{qualifyCount || '—'}</div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginTop: 16,
                }}
              >
                <span style={pillStyle}>
                  Heats Entries: {completionSummary.total}
                </span>
                <span style={pillStyle}>
                  Completed: {completionSummary.completed}/
                  {completionSummary.total}
                </span>
                <span
                  style={{
                    ...pillStyle,
                    background: completionSummary.isComplete
                      ? 'rgba(46,175,109,0.16)'
                      : 'rgba(217,83,79,0.18)',
                    border: completionSummary.isComplete
                      ? '1px solid rgba(46,175,109,0.35)'
                      : '1px solid rgba(217,83,79,0.35)',
                    color: completionSummary.isComplete ? '#d7ffe8' : '#ffd6d3',
                  }}
                >
                  {completionSummary.isComplete
                    ? 'Heats Complete'
                    : 'Heats Incomplete'}
                </span>
                <span style={pillStyle}>
                  Finalists Found: {qualifiedRows.length}
                </span>
                <span style={pillStyle}>
                  Already in Final: {finalEventEntries.length}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginTop: 18,
                }}
              >
                <button
                  onClick={() => handlePromoteFinalists(false)}
                  disabled={!canPromote || working}
                  style={
                    !canPromote || working ? disabledBtnStyle : primaryBtnStyle
                  }
                >
                  {working ? 'Working...' : 'Promote Finalists'}
                </button>

                <button
                  onClick={() => handlePromoteFinalists(true)}
                  disabled={!canPromote || working}
                  style={
                    !canPromote || working
                      ? disabledBtnStyle
                      : secondaryBtnStyle
                  }
                >
                  {working ? 'Working...' : 'Promote + Reseed Final'}
                </button>

                <button
                  onClick={handleClearFinalEntries}
                  disabled={!linkedFinalEvent || working}
                  style={
                    !linkedFinalEvent || working
                      ? disabledBtnStyle
                      : dangerBtnStyle
                  }
                >
                  Clear Final Entries + Seeding
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              <div style={{ color: '#9fb3c8' }}>
                Auto-highlighted heats below show which linked-final events are
                incomplete and which are ready for batch promotion/reseeding.
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: 960,
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        'Heats Event',
                        'Linked Final',
                        'Completed',
                        'Status',
                        'Qualified',
                        'Promoted',
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
                    {bulkRows.map((row) => (
                      <tr
                        key={row.heatsEvent.id}
                        style={{
                          background: row.isComplete
                            ? 'transparent'
                            : 'rgba(217,83,79,0.08)',
                        }}
                      >
                        <td style={tdStyle}>
                          Event {row.heatsEvent.eventNumber || '—'} •{' '}
                          {row.heatsEvent.name || 'Unnamed Event'}
                        </td>
                        <td style={tdStyle}>
                          {row.finalEvent
                            ? `Event ${row.finalEvent.eventNumber || '—'} • ${
                                row.finalEvent.name || 'Unnamed Final'
                              }`
                            : '—'}
                        </td>
                        <td style={tdStyle}>
                          {row.completedEntries}/{row.totalEntries}
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              ...pillStyle,
                              background: row.isComplete
                                ? 'rgba(46,175,109,0.16)'
                                : 'rgba(217,83,79,0.18)',
                              border: row.isComplete
                                ? '1px solid rgba(46,175,109,0.35)'
                                : '1px solid rgba(217,83,79,0.35)',
                              color: row.isComplete ? '#d7ffe8' : '#ffd6d3',
                            }}
                          >
                            {row.isComplete ? 'Complete' : 'Incomplete'}
                          </span>
                        </td>
                        <td style={tdStyle}>{row.qualifiedRows.length}</td>
                        <td style={tdStyle}>{row.finalEntries.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        {activeTab === 'single' ? (
          <>
            <div style={panelStyle}>
              <h2 style={{ marginTop: 0 }}>Qualified Swimmers</h2>

              {!selectedHeatsEvent ? (
                <p style={{ color: '#9fb3c8' }}>
                  Select a heats event to see qualifiers.
                </p>
              ) : rankedQualifiers.length === 0 ? (
                <p style={{ color: '#9fb3c8' }}>
                  No swimmers/results found for this heats event.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      minWidth: 980,
                    }}
                  >
                    <thead>
                      <tr>
                        {[
                          'Rank',
                          'Qualified',
                          'Already in Final',
                          'Swimmer',
                          'Team',
                          'Heat',
                          'Lane',
                          'Time',
                          'Status',
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
                      {rankedQualifiers.map((row) => (
                        <tr key={`${row.resultId}-${row.entryId}`}>
                          <td style={tdStyle}>{row.rank ?? '—'}</td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                ...pillStyle,
                                background: row.qualified
                                  ? 'rgba(46,175,109,0.16)'
                                  : 'rgba(255,255,255,0.06)',
                                border: row.qualified
                                  ? '1px solid rgba(46,175,109,0.35)'
                                  : '1px solid rgba(255,255,255,0.08)',
                                color: row.qualified ? '#d7ffe8' : '#fff',
                              }}
                            >
                              {row.qualified ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                ...pillStyle,
                                background: row.alreadyInFinal
                                  ? 'rgba(212,175,55,0.18)'
                                  : 'rgba(255,255,255,0.06)',
                                border: row.alreadyInFinal
                                  ? '1px solid rgba(212,175,55,0.35)'
                                  : '1px solid rgba(255,255,255,0.08)',
                                color: row.alreadyInFinal ? '#fff0b5' : '#fff',
                              }}
                            >
                              {row.alreadyInFinal ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 700 }}>
                              {row.swimmerName || '—'}
                            </div>
                          </td>
                          <td style={tdStyle}>{row.teamName || '—'}</td>
                          <td style={tdStyle}>{row.heatNumber || '—'}</td>
                          <td style={tdStyle}>{row.laneNumber || '—'}</td>
                          <td style={tdStyle}>{row.time || '—'}</td>
                          <td style={tdStyle}>{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={panelStyle}>
              <h2 style={{ marginTop: 0 }}>Current Final Event Entries</h2>

              {!linkedFinalEvent ? (
                <p style={{ color: '#9fb3c8' }}>
                  No linked final event selected.
                </p>
              ) : finalEventEntries.length === 0 ? (
                <p style={{ color: '#9fb3c8' }}>
                  No swimmers currently entered in this final.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      minWidth: 760,
                    }}
                  >
                    <thead>
                      <tr>
                        {['Swimmer', 'Team', 'Seed Time', 'Status'].map((h) => (
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
                      {finalEventEntries.map((row) => (
                        <tr key={row.entryId}>
                          <td style={tdStyle}>{row.swimmerName || '—'}</td>
                          <td style={tdStyle}>{row.teamName || '—'}</td>
                          <td style={tdStyle}>{row.seedTime || '—'}</td>
                          <td style={tdStyle}>{row.status || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}

        {bulkMode ? (
          <div style={modalBackdropStyle}>
            <div style={modalCardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>
                    {bulkMode === 'promote'
                      ? 'Promote ALL Finals'
                      : 'Reseed Promoted Finals'}
                  </h2>
                  <p
                    style={{ color: '#9fb3c8', marginTop: 8, marginBottom: 0 }}
                  >
                    {bulkMode === 'promote'
                      ? 'Select heats events with linked finals. Incomplete heats are highlighted and should not be selected.'
                      : 'Select already-promoted finals to generate saved final seeding.'}
                  </p>
                </div>
                <button
                  onClick={handleCloseBulkModal}
                  style={closeIconBtnStyle}
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  marginTop: 18,
                  maxHeight: '55vh',
                  overflow: 'auto',
                  display: 'grid',
                  gap: 10,
                  paddingRight: 4,
                }}
              >
                {modalRows.length === 0 ? (
                  <div style={{ color: '#9fb3c8' }}>
                    No events available for this action.
                  </div>
                ) : (
                  modalRows.map((row) => {
                    const disabled =
                      bulkMode === 'promote'
                        ? !row.isComplete || !row.qualifiedRows.length
                        : !row.finalEntries.length;
                    const checked = bulkSelectedHeatsIds.includes(
                      row.heatsEvent.id
                    );

                    return (
                      <label
                        key={row.heatsEvent.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '24px 1fr',
                          gap: 12,
                          alignItems: 'start',
                          padding: 14,
                          borderRadius: 14,
                          border: row.isComplete
                            ? '1px solid rgba(255,255,255,0.10)'
                            : '1px solid rgba(217,83,79,0.32)',
                          background: row.isComplete
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(217,83,79,0.10)',
                          opacity: disabled ? 0.65 : 1,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleBulkSelected(row.heatsEvent.id)}
                          style={{ marginTop: 2 }}
                        />
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            Event {row.heatsEvent.eventNumber || '—'} •{' '}
                            {row.heatsEvent.name || 'Unnamed Event'}
                          </div>
                          <div
                            style={{
                              color: '#9fb3c8',
                              marginTop: 6,
                              fontSize: 13,
                            }}
                          >
                            Final: {row.finalEvent?.name || '—'} • Completed{' '}
                            {row.completedEntries}/{row.totalEntries} •
                            Qualified {row.qualifiedRows.length} • Promoted{' '}
                            {row.finalEntries.length}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginTop: 18,
                }}
              >
                <button
                  onClick={handleCloseBulkModal}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button
                  onClick={
                    bulkMode === 'promote'
                      ? handleBulkPromote
                      : handleBulkReseed
                  }
                  disabled={!bulkSelectedHeatsIds.length || working}
                  style={
                    !bulkSelectedHeatsIds.length || working
                      ? disabledBtnStyle
                      : primaryBtnStyle
                  }
                >
                  {working
                    ? 'Working...'
                    : bulkMode === 'promote'
                    ? 'Promote to Finals'
                    : 'Reseed Finals'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
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

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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

const readOnlyBoxStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 46,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'white',
  display: 'flex',
  alignItems: 'center',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  verticalAlign: 'top',
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

const dangerBtnStyle: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(217,83,79,0.35)',
  background: 'rgba(217,83,79,0.16)',
  color: '#ffd6d3',
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

const pillStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontSize: 13,
};

const tabsWrapStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 0,
  marginTop: 18,
  borderRadius: 14,
  overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.12)',
};

const tabBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  border: 'none',
  background: 'rgba(255,255,255,0.05)',
  color: '#9fb3c8',
  fontWeight: 700,
  cursor: 'pointer',
};

const activeTabBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #d4af37, #f5d76e)',
  color: '#071426',
};

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(3,12,24,0.62)',
  WebkitBackdropFilter: 'blur(4px)',
  backdropFilter: 'blur(4px)',
  zIndex: 9999,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
};

const modalCardStyle: React.CSSProperties = {
  width: 'min(860px, 100%)',
  maxHeight: '90vh',
  overflow: 'hidden',
  background: 'linear-gradient(180deg, #071426 0%, #0b1f3a 100%)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18,
  padding: 20,
  boxSizing: 'border-box',
  color: '#f5f7fb',
  boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
};

const closeIconBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  cursor: 'pointer',
};
