import { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref, update } from 'firebase/database';
import { auth } from '../firebase/auth.js';
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

type TableLaneRow = {
  laneNumber: number;
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  teamId: string;
  teamName: string;
  seedTime: string;
  heatNumber: number;
  displayTime: string;
  computedPlace: number | null;
  status: string;
};

type FanNotifySwimmerRow = {
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  teamId: string;
  teamName: string;
  laneNumber: number;
  heatNumber: number;
  eventId: string;
  eventNumber: number;
  eventName: string;
};

type FanNotifyResultRow = FanNotifySwimmerRow & {
  time: string;
  status: string;
  place: number | null;
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

function normalizeStatus(value?: string) {
  const s = String(value || 'OK')
    .trim()
    .toUpperCase();
  if (['OK', 'DQ', 'NS', 'SCR'].includes(s)) return s;
  return 'OK';
}

function eventStatusFromEntriesAndResults(
  eventEntries: EntryRow[],
  resultsMap: Record<string, ResultRow>
) {
  if (!eventEntries.length) return 'NOT_READY';

  let completedCount = 0;
  let startedCount = 0;

  for (const entry of eventEntries) {
    const result = resultsMap[entry.id];
    if (!result) continue;

    const status = normalizeStatus(result.status);
    const time = String(result.heatFinalTime || '').trim();

    if (status !== 'OK' || !!time) startedCount += 1;

    const isCompleted =
      status === 'DQ' ||
      status === 'NS' ||
      status === 'SCR' ||
      (status === 'OK' && !!time);

    if (isCompleted) completedCount += 1;
  }

  if (completedCount === eventEntries.length && eventEntries.length > 0) {
    return 'COMPLETED';
  }

  if (startedCount > 0) return 'IN_PROGRESS';

  return 'NOT_STARTED';
}

function statusColor(status: string) {
  if (status === 'COMPLETED') return '#43a047';
  if (status === 'IN_PROGRESS') return '#f4c542';
  if (status === 'NOT_READY') return '#d9dee5';
  return '#4f89ff';
}

function makeTriggerId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function RunMeet() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [allSeeding, setAllSeeding] = useState<
    Record<string, SavedSeedingNode>
  >({});
  const [allResults, setAllResults] = useState<Record<string, ResultRow>>({});

  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedHeatNumber, setSelectedHeatNumber] = useState(1);

  const [timeDigitsByEntryId, setTimeDigitsByEntryId] = useState<
    Record<string, string>
  >({});
  const [statusByEntryId, setStatusByEntryId] = useState<
    Record<string, string>
  >({});
  const [selectedLaneEntryIds, setSelectedLaneEntryIds] = useState<string[]>(
    []
  );
  const [activeRowEntryId, setActiveRowEntryId] = useState('');
  const [msg, setMsg] = useState('');
  const [displayBoardEnabled, setDisplayBoardEnabled] = useState(true);

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const saveTimersRef = useRef<Record<string, number>>({});

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

  const selectedEventIndex = useMemo(() => {
    return seededEventOptions.findIndex(
      (event) => event.id === selectedEventId
    );
  }, [seededEventOptions, selectedEventId]);

  const canGoPrevEvent = selectedEventIndex > 0;
  const canGoNextEvent =
    selectedEventIndex >= 0 &&
    selectedEventIndex < seededEventOptions.length - 1;

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

  const tableRows = useMemo(() => {
    if (!selectedHeat) return [] as TableLaneRow[];

    const baseRows = selectedHeat.lanes.map((lane) => {
      const result = allResults[lane.entryId];
      const displayTime = formatSwimTimeFromDigits(
        timeDigitsByEntryId[lane.entryId] || result?.heatFinalTime || ''
      );
      const status = normalizeStatus(
        statusByEntryId[lane.entryId] || result?.status || 'OK'
      );

      return {
        ...lane,
        displayTime,
        status,
      };
    });

    const ranked = [...baseRows].sort((a, b) => {
      if (a.status === 'OK' && b.status === 'OK') {
        const aTime = parseSwimTimeToHundredths(a.displayTime);
        const bTime = parseSwimTimeToHundredths(b.displayTime);

        if (aTime !== null && bTime !== null) return aTime - bTime;
        if (aTime !== null) return -1;
        if (bTime !== null) return 1;
      }

      const score = (status: string) => {
        if (status === 'OK') return 0;
        if (status === 'NS') return 1;
        if (status === 'DQ') return 2;
        if (status === 'SCR') return 3;
        return 9;
      };

      const diff = score(a.status) - score(b.status);
      if (diff !== 0) return diff;

      return a.laneNumber - b.laneNumber;
    });

    const placeByEntryId: Record<string, number | null> = {};
    let runningPlace = 1;

    ranked.forEach((row) => {
      const time = parseSwimTimeToHundredths(row.displayTime);

      if (row.status === 'OK' && time !== null) {
        placeByEntryId[row.entryId] = runningPlace;
        runningPlace += 1;
      } else {
        placeByEntryId[row.entryId] = null;
      }
    });

    return baseRows.map((row) => ({
      ...row,
      computedPlace: placeByEntryId[row.entryId] ?? null,
    }));
  }, [selectedHeat, allResults, timeDigitsByEntryId, statusByEntryId]);

  const selectedCount = selectedLaneEntryIds.length;

  const heatSavedCount = useMemo(() => {
    return tableRows.filter((row) => row.status !== 'OK' || !!row.displayTime)
      .length;
  }, [tableRows]);

  const eventNavRows = useMemo(() => {
    return seededEventOptions.map((event) => {
      const eventEntries = entries.filter(
        (entry) =>
          entry.eventId === event.id &&
          entry.active !== false &&
          String(entry.status || 'Entered').toLowerCase() !== 'scratch'
      );

      return {
        event,
        entryCount: eventEntries.length,
        eventStatus: eventStatusFromEntriesAndResults(eventEntries, allResults),
        totalHeats: flattenSavedHeats(allSeeding[event.id]).length,
      };
    });
  }, [seededEventOptions, entries, allResults, allSeeding]);

  const currentEventStatus = useMemo(() => {
    const row = eventNavRows.find((item) => item.event.id === selectedEventId);
    return row?.eventStatus || 'NOT_STARTED';
  }, [eventNavRows, selectedEventId]);

  const eventRailCount = Math.max(eventNavRows.length, 1);
  const isRailUltraDense = eventRailCount >= 60;
  const isRailDense = eventRailCount >= 40;
  const eventRailGap = isRailUltraDense ? 2 : isRailDense ? 3 : 4;
  const eventRailPadding = isRailUltraDense
    ? '4px 3px'
    : isRailDense
    ? '5px 3px'
    : '6px 4px';
  const eventRailFontSize = isRailUltraDense ? 8 : isRailDense ? 9 : 11;
  const eventRailBorderRadius = isRailUltraDense ? 6 : 8;

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
      setAllResults({});
      setSelectedEventId('');
      setSelectedHeatNumber(1);
      return;
    }

    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const entriesRef = ref(db, `meets/${activeMeetId}/entries`);
    const seedingRef = ref(db, `meets/${activeMeetId}/seeding`);
    const resultsRef = ref(db, `meets/${activeMeetId}/results`);
    const liveDisplayRef = ref(db, `meets/${activeMeetId}/liveDisplay`);

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
      setAllSeeding((snap.val() as Record<string, SavedSeedingNode>) || {});
    });

    const unsubResults = onValue(resultsRef, (snap) => {
      setAllResults((snap.val() as Record<string, ResultRow>) || {});
    });

    const unsubLiveDisplay = onValue(liveDisplayRef, (snap) => {
      const value = snap.val() || {};
      if (typeof value.showScoreboard === 'boolean') {
        setDisplayBoardEnabled(value.showScoreboard);
      } else {
        setDisplayBoardEnabled(true);
      }
    });

    return () => {
      unsubEvents();
      unsubEntries();
      unsubSeeding();
      unsubResults();
      unsubLiveDisplay();
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
    if (!selectedEventHeats.length) {
      setSelectedHeatNumber(1);
      return;
    }

    setSelectedHeatNumber((prev) => {
      if (selectedEventHeats.some((heat) => heat.heatNumber === prev))
        return prev;
      return selectedEventHeats[0].heatNumber;
    });
  }, [selectedEventHeats]);

  useEffect(() => {
    if (!selectedHeat) {
      setSelectedLaneEntryIds([]);
      setActiveRowEntryId('');
      return;
    }

    const nextDigits: Record<string, string> = {};
    const nextStatuses: Record<string, string> = {};

    selectedHeat.lanes.forEach((lane) => {
      const result = allResults[lane.entryId];
      nextDigits[lane.entryId] = digitsOnly(result?.heatFinalTime || '');
      nextStatuses[lane.entryId] = normalizeStatus(result?.status || 'OK');
    });

    setTimeDigitsByEntryId(nextDigits);
    setStatusByEntryId(nextStatuses);
    setSelectedLaneEntryIds([]);
    setActiveRowEntryId(selectedHeat.lanes[0]?.entryId || '');
  }, [selectedHeat, allResults]);

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((id) =>
        window.clearTimeout(id)
      );
    };
  }, []);

  const saveRow = async (
    row: TableLaneRow,
    forcedStatus?: string,
    forcedDigits?: string
  ) => {
    if (!activeMeetId || !selectedEvent) return;

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const status = normalizeStatus(
      forcedStatus || statusByEntryId[row.entryId] || row.status || 'OK'
    );
    const formattedTime = formatSwimTimeFromDigits(
      forcedDigits !== undefined
        ? forcedDigits
        : timeDigitsByEntryId[row.entryId] || ''
    );

    try {
      await update(ref(db, `meets/${activeMeetId}/results/${row.entryId}`), {
        entryId: row.entryId,
        swimmerId: row.swimmerId,
        swimmerName: row.swimmerName,
        teamId: row.teamId,
        teamName: row.teamName,
        eventId: selectedEvent.id,
        eventNumber: selectedEvent.eventNumber || 0,
        eventName: selectedEvent.name || '',
        heatNumber: row.heatNumber,
        laneNumber: row.laneNumber,
        seedTime: row.seedTime || '',
        heatFinalTime: formattedTime,
        status,
        place: row.computedPlace ?? null,
        active: true,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      });

      await update(ref(db, `meets/${activeMeetId}/entries/${row.entryId}`), {
        status: status === 'OK' ? 'Completed' : status,
      });

      setMsg(`Lane ${row.laneNumber} saved`);
    } catch (error: any) {
      setMsg(error.message || 'Failed to save lane');
    }
  };

  const queueAutoSave = (
    row: TableLaneRow,
    forcedStatus?: string,
    forcedDigits?: string
  ) => {
    if (saveTimersRef.current[row.entryId]) {
      window.clearTimeout(saveTimersRef.current[row.entryId]);
    }

    saveTimersRef.current[row.entryId] = window.setTimeout(() => {
      saveRow(row, forcedStatus, forcedDigits);
    }, 80);
  };

  const goToHeat = (delta: number) => {
    if (!selectedEventHeats.length) return;
    const currentIndex = selectedEventHeats.findIndex(
      (heat) => heat.heatNumber === selectedHeatNumber
    );
    if (currentIndex === -1) return;

    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= selectedEventHeats.length) return;

    setSelectedHeatNumber(selectedEventHeats[nextIndex].heatNumber);
  };

  const goToEvent = (delta: number) => {
    if (!seededEventOptions.length || selectedEventIndex === -1) return;
    const nextIndex = selectedEventIndex + delta;
    if (nextIndex < 0 || nextIndex >= seededEventOptions.length) return;

    const nextEvent = seededEventOptions[nextIndex];
    setSelectedEventId(nextEvent.id);
    setMsg('');
  };

  const toggleLaneSelection = (entryId: string) => {
    setSelectedLaneEntryIds((prev) => {
      if (prev.includes(entryId)) return prev.filter((id) => id !== entryId);
      return [...prev, entryId];
    });
  };

  const handleSelectAllRows = () => {
    setSelectedLaneEntryIds(tableRows.map((row) => row.entryId));
  };

  const handleClearSelection = () => {
    setSelectedLaneEntryIds([]);
    setMsg('Selection cleared');
  };

  const applyBulkStatus = (nextStatus: 'DQ' | 'NS' | 'SCR') => {
    if (!selectedCount) {
      setMsg('Please select at least one row');
      return;
    }

    setStatusByEntryId((prev) => {
      const next = { ...prev };
      selectedLaneEntryIds.forEach((entryId) => {
        next[entryId] = nextStatus;
      });
      return next;
    });

    const affected = tableRows.filter((row) =>
      selectedLaneEntryIds.includes(row.entryId)
    );
    affected.forEach((row) => {
      queueAutoSave(row, nextStatus);
    });

    setMsg(`Applied ${nextStatus} to ${selectedCount} row(s)`);
  };

  const handleClearSelectedData = () => {
    if (!selectedCount) {
      setMsg('Please select at least one row');
      return;
    }

    setTimeDigitsByEntryId((prev) => {
      const next = { ...prev };
      selectedLaneEntryIds.forEach((entryId) => {
        next[entryId] = '';
      });
      return next;
    });

    setStatusByEntryId((prev) => {
      const next = { ...prev };
      selectedLaneEntryIds.forEach((entryId) => {
        next[entryId] = 'OK';
      });
      return next;
    });

    const affected = tableRows.filter((row) =>
      selectedLaneEntryIds.includes(row.entryId)
    );
    affected.forEach((row) => {
      queueAutoSave(row, 'OK', '');
    });

    setMsg(`Cleared time and status for ${selectedCount} row(s)`);
  };

  const focusRow = (entryId: string) => {
    setActiveRowEntryId(entryId);
    rowRefs.current[entryId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  const handleToggleDisplayBoard = async (checked: boolean) => {
    if (!activeMeetId) {
      setMsg('No active meet selected');
      return;
    }

    try {
      setDisplayBoardEnabled(checked);
      await update(ref(db, `meets/${activeMeetId}/liveDisplay`), {
        showScoreboard: checked,
        updatedAt: Date.now(),
      });
      setMsg(
        checked
          ? 'LED scoreboard display enabled'
          : 'LED scoreboard switched to promotional loop'
      );
    } catch (error: any) {
      setMsg(error.message || 'Failed to update LED display toggle');
    }
  };

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  const buildLedRowsPayload = (withTimes: boolean) => {
    const rowsPayload: Record<
      string,
      {
        laneNumber: number;
        swimmerName: string;
        teamName: string;
        time: string;
        status: string;
        place: number | null;
      }
    > = {};

    const rowsInLaneOrder = [...tableRows].sort(
      (a, b) => a.laneNumber - b.laneNumber
    );

    rowsInLaneOrder.forEach((row) => {
      rowsPayload[`lane${row.laneNumber}`] = {
        laneNumber: row.laneNumber,
        swimmerName: row.swimmerName || '',
        teamName: row.teamName || '',
        time: withTimes ? row.displayTime || '' : '',
        status: row.status || 'OK',
        place: row.computedPlace ?? null,
      };
    });

    return rowsPayload;
  };

  const buildFanCurrentHeatPayload = () => {
    if (!selectedEvent || !selectedHeat) return null;

    const swimmers: FanNotifySwimmerRow[] = [...tableRows]
      .sort((a, b) => a.laneNumber - b.laneNumber)
      .map((row) => ({
        entryId: row.entryId,
        swimmerId: row.swimmerId || '',
        swimmerName: row.swimmerName || '',
        teamId: row.teamId || '',
        teamName: row.teamName || '',
        laneNumber: row.laneNumber,
        heatNumber: row.heatNumber,
        eventId: selectedEvent.id,
        eventNumber: Number(selectedEvent.eventNumber || 0),
        eventName: selectedEvent.name || '',
      }));

    return {
      triggerId: makeTriggerId('ready'),
      triggerAt: Date.now(),
      type: 'READY_DISPLAY',
      meetId: activeMeetId,
      eventId: selectedEvent.id,
      eventNumber: Number(selectedEvent.eventNumber || 0),
      eventName: selectedEvent.name || '',
      gender: selectedEvent.gender || '',
      ageGroup: selectedEvent.ageGroup || '',
      stroke: selectedEvent.stroke || '',
      round: selectedEvent.round || 'Heat',
      heatNumber: Number(selectedHeatNumber || 0),
      laneCount: Number(laneCount || 0),
      swimmers,
    };
  };

  const buildFanResultPublishPayload = () => {
    if (!selectedEvent || !selectedHeat) return null;

    const swimmers: FanNotifyResultRow[] = [...tableRows]
      .sort((a, b) => {
        const aPlace =
          typeof a.computedPlace === 'number' ? a.computedPlace : 9999;
        const bPlace =
          typeof b.computedPlace === 'number' ? b.computedPlace : 9999;
        if (aPlace !== bPlace) return aPlace - bPlace;
        return a.laneNumber - b.laneNumber;
      })
      .map((row) => ({
        entryId: row.entryId,
        swimmerId: row.swimmerId || '',
        swimmerName: row.swimmerName || '',
        teamId: row.teamId || '',
        teamName: row.teamName || '',
        laneNumber: row.laneNumber,
        heatNumber: row.heatNumber,
        eventId: selectedEvent.id,
        eventNumber: Number(selectedEvent.eventNumber || 0),
        eventName: selectedEvent.name || '',
        time: row.displayTime || '',
        status: normalizeStatus(row.status || 'OK'),
        place: row.computedPlace ?? null,
      }));

    return {
      triggerId: makeTriggerId('result'),
      triggerAt: Date.now(),
      type: 'RESULT_PUBLISH',
      meetId: activeMeetId,
      eventId: selectedEvent.id,
      eventNumber: Number(selectedEvent.eventNumber || 0),
      eventName: selectedEvent.name || '',
      gender: selectedEvent.gender || '',
      ageGroup: selectedEvent.ageGroup || '',
      stroke: selectedEvent.stroke || '',
      round: selectedEvent.round || 'Heat',
      heatNumber: Number(selectedHeatNumber || 0),
      laneCount: Number(laneCount || 0),
      swimmers,
    };
  };

  const handleReadyDisplay = async () => {
    if (!activeMeetId || !selectedEvent || !selectedHeat) {
      setMsg('Please select a seeded event and heat first');
      return;
    }

    const fanPayload = buildFanCurrentHeatPayload();
    if (!fanPayload) {
      setMsg('Could not build fan notification payload');
      return;
    }

    try {
      await update(ref(db, `meets/${activeMeetId}`), {
        'liveDisplay/mode': 'LED_SCOREBOARD',
        'liveDisplay/showScoreboard': true,
        'liveDisplay/scoreboard/eventId': selectedEvent?.id || '',
        'liveDisplay/scoreboard/eventNumber': selectedEvent?.eventNumber || 0,
        'liveDisplay/scoreboard/eventName': selectedEvent?.name || '',
        'liveDisplay/scoreboard/gender': selectedEvent?.gender || '',
        'liveDisplay/scoreboard/ageGroup': selectedEvent?.ageGroup || '',
        'liveDisplay/scoreboard/stroke': selectedEvent?.stroke || '',
        'liveDisplay/scoreboard/round': selectedEvent?.round || 'Heat',
        'liveDisplay/scoreboard/heatNumber': selectedHeatNumber || 0,
        'liveDisplay/scoreboard/laneCount': laneCount,
        'liveDisplay/scoreboard/showTimes': false,
        'liveDisplay/scoreboard/updatedAt': Date.now(),
        'liveDisplay/scoreboard/rows': buildLedRowsPayload(false),
        'fanNotifications/currentHeat': fanPayload,
      });

      setMsg(
        'Ready display sent to LED scoreboard and fan app trigger updated'
      );
    } catch (error: any) {
      setMsg(error.message || 'Failed to send ready display');
    }
  };

  const handlePublishResultsDisplay = async () => {
    if (!activeMeetId || !selectedEvent || !selectedHeat) {
      setMsg('Please select a seeded event and heat first');
      return;
    }

    const fanPayload = buildFanResultPublishPayload();
    if (!fanPayload) {
      setMsg('Could not build fan result payload');
      return;
    }

    try {
      await update(ref(db, `meets/${activeMeetId}`), {
        'liveDisplay/mode': 'LED_SCOREBOARD',
        'liveDisplay/showScoreboard': true,
        'liveDisplay/scoreboard/eventId': selectedEvent?.id || '',
        'liveDisplay/scoreboard/eventNumber': selectedEvent?.eventNumber || 0,
        'liveDisplay/scoreboard/eventName': selectedEvent?.name || '',
        'liveDisplay/scoreboard/gender': selectedEvent?.gender || '',
        'liveDisplay/scoreboard/ageGroup': selectedEvent?.ageGroup || '',
        'liveDisplay/scoreboard/stroke': selectedEvent?.stroke || '',
        'liveDisplay/scoreboard/round': selectedEvent?.round || 'Heat',
        'liveDisplay/scoreboard/heatNumber': selectedHeatNumber || 0,
        'liveDisplay/scoreboard/laneCount': laneCount,
        'liveDisplay/scoreboard/showTimes': true,
        'liveDisplay/scoreboard/updatedAt': Date.now(),
        'liveDisplay/scoreboard/rows': buildLedRowsPayload(true),
        'fanNotifications/resultPublish': fanPayload,
      });

      setMsg('Results published on LED scoreboard and fan app trigger updated');
    } catch (error: any) {
      setMsg(error.message || 'Failed to publish results display');
    }
  };

  return (
    <>
      <style>{`
        :root {
          --rm-bg: #eef3f8;
          --rm-panel: #ffffff;
          --rm-panel-2: #f7f9fc;
          --rm-line: #d4dbe5;
          --rm-text: #1d2b3a;
          --rm-sub: #60758a;
          --rm-blue: #4f89ff;
          --rm-yellow: #f4c542;
          --rm-green: #43a047;
          --rm-red: #d9534f;
          --rm-navy: #1f4f82;
          --rm-gold: #d4af37;
        }

        body {
          background: var(--rm-bg);
        }

        .runmeet-page {
          min-height: 100vh;
          background: var(--rm-bg);
          color: var(--rm-text);
          padding: 10px 10px 84px;
          font-family: Arial, Helvetica, sans-serif;
        }

        .runmeet-layout {
          display: grid;
          grid-template-columns: 72px minmax(0, 1fr);
          gap: 10px;
          align-items: start;
        }

        .runmeet-events-rail {
          position: sticky;
          top: 10px;
          height: calc(100vh - 84px);
          display: grid;
          align-content: stretch;
          background: var(--rm-panel);
          border: 1px solid var(--rm-line);
          overflow: hidden;
        }

        .runmeet-event-btn {
          border: 1px solid rgba(0,0,0,0.08);
          width: 100%;
          height: 100%;
          min-height: 0;
          font-weight: 800;
          cursor: pointer;
          color: #10233a;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          line-height: 1;
          overflow: hidden;
          white-space: nowrap;
        }

        .runmeet-event-btn.active {
          outline: 3px solid #1f4f82;
          outline-offset: -3px;
        }

        .runmeet-main {
          display: grid;
          gap: 10px;
        }

        .runmeet-strip,
        .runmeet-header,
        .runmeet-toolbar,
        .runmeet-heat-tabs-wrap,
        .runmeet-table-wrap,
        .runmeet-footer {
          background: var(--rm-panel);
          border: 1px solid var(--rm-line);
        }

        .runmeet-strip {
          padding: 8px 12px;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          background: linear-gradient(90deg, #0f2d52 0%, #1f4f82 55%, #d4af37 100%);
          color: #fff;
        }

        .runmeet-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 800;
          letter-spacing: 0.2px;
          font-size: 28px;
        }

        .runmeet-brand img {
          width: 34px;
          height: 34px;
          object-fit: contain;
          background: rgba(255,255,255,0.92);
          padding: 3px;
          border-radius: 8px;
        }

        .runmeet-brand-sub {
          font-size: 12px;
          opacity: 0.92;
          font-weight: 600;
        }

        .runmeet-header {
          padding: 10px;
          display: grid;
          gap: 10px;
        }

        .runmeet-header-top {
          display: grid;
          grid-template-columns: 110px minmax(0, 1.5fr) minmax(220px, 0.9fr);
          gap: 10px;
          align-items: center;
        }

        .runmeet-title-big {
          font-size: 48px;
          font-weight: 800;
          line-height: 1;
          padding-left: 10px;
        }

        .runmeet-title {
          font-size: 24px;
          font-weight: 800;
          color: var(--rm-navy);
        }

        .runmeet-sub {
          color: var(--rm-sub);
          font-size: 13px;
          margin-top: 4px;
        }

        .runmeet-pill-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .runmeet-pill {
          border: 1px solid var(--rm-line);
          background: var(--rm-panel-2);
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--rm-text);
        }

        .runmeet-toolbar {
          padding: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        }

        .runmeet-toolbar-left {
          font-size: 13px;
          color: var(--rm-sub);
        }

        .runmeet-toolbar-right {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .runmeet-heat-tabs-wrap {
          padding: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .runmeet-heat-nav {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .runmeet-heat-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .runmeet-heat-tab {
          min-width: 42px;
          height: 38px;
          border: 1px solid #bfc9d6;
          background: #fff;
          color: var(--rm-text);
          font-weight: 700;
          cursor: pointer;
        }

        .runmeet-heat-tab.active {
          background: #e8f0ff;
          color: #143e74;
          border-color: #8fb3e6;
        }

        .runmeet-btn,
        .runmeet-input {
          border: 1px solid #bfc9d6;
          background: #fff;
          color: var(--rm-text);
          min-height: 38px;
          padding: 8px 10px;
          font-size: 13px;
        }

        .runmeet-btn {
          cursor: pointer;
          font-weight: 700;
        }

        .runmeet-btn.primary {
          background: #e8f0ff;
          color: #143e74;
        }

        .runmeet-btn.warn {
          background: #fff8dd;
          color: #6d5600;
        }

        .runmeet-btn.danger {
          background: #ffe6e5;
          color: #7b1e1b;
        }

        .runmeet-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .runmeet-table-wrap {
          overflow: auto;
        }

        .runmeet-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          min-width: 1120px;
        }

        .runmeet-table th,
        .runmeet-table td {
          border: 1px solid var(--rm-line);
          padding: 6px 8px;
          font-size: 13px;
          vertical-align: middle;
          background: #fff;
        }

        .runmeet-table th {
          background: #edf2f7;
          color: #19334d;
          font-weight: 700;
          text-align: left;
        }

        .runmeet-table .center {
          text-align: center;
        }

        .runmeet-table tr.active-row td {
          background: #eef5ff;
        }

        .runmeet-lane-cell {
          font-weight: 800;
          color: #143e74;
        }

        .runmeet-name {
          font-weight: 700;
        }

        .runmeet-muted {
          color: var(--rm-sub);
          font-size: 12px;
        }

        .runmeet-check {
          transform: scale(1.15);
          cursor: pointer;
        }

        .runmeet-footer {
          position: sticky;
          bottom: 0;
          padding: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          box-shadow: 0 -4px 12px rgba(0,0,0,0.06);
        }

        .runmeet-msg {
          color: #7b5a00;
          font-weight: 700;
          font-size: 13px;
        }

        .runmeet-event-number-nav {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }

        .runmeet-nav-icon-btn {
          width: 42px;
          height: 38px;
          border: 1px solid #bfc9d6;
          font-weight: 800;
          font-size: 16px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .runmeet-nav-icon-btn-prev {
          background: #fff4db;
          color: #7a5600;
          border-color: #e7cf8a;
        }

        .runmeet-nav-icon-btn-next {
          background: #e7f6eb;
          color: #1f6a35;
          border-color: #9fd0ac;
        }

        .runmeet-nav-icon-btn:hover:not(:disabled) {
          filter: brightness(0.98);
        }

        .runmeet-nav-icon-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .runmeet-event-nav-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 12px;
        }

        .runmeet-btn-event-prev {
          background: #fff4db;
          color: #7a5600;
          border: 1px solid #e7cf8a;
        }

        .runmeet-btn-event-next {
          background: #e7f6eb;
          color: #1f6a35;
          border: 1px solid #9fd0ac;
        }

        .runmeet-display-actions {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          width: 100%;
        }

        .runmeet-btn-display-race {
          background: #e8f0ff;
          color: #143e74;
          border: 1px solid #8fb3e6;
        }

        .runmeet-btn-display-results {
          background: #e7f6eb;
          color: #1f6a35;
          border: 1px solid #9fd0ac;
        }

        .runmeet-display-toggle {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border: 1px solid #bfc9d6;
          background: #fff;
          color: var(--rm-text);
          font-size: 13px;
          font-weight: 700;
          min-height: 38px;
        }

        .runmeet-switch {
          position: relative;
          width: 54px;
          height: 30px;
          display: inline-block;
          flex: 0 0 auto;
        }

        .runmeet-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .runmeet-slider {
          position: absolute;
          inset: 0;
          cursor: pointer;
          background: #c7d1de;
          transition: 0.2s ease;
          border-radius: 999px;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);
        }

        .runmeet-slider:before {
          content: '';
          position: absolute;
          height: 24px;
          width: 24px;
          left: 3px;
          top: 3px;
          background: #fff;
          transition: 0.2s ease;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        }

        .runmeet-switch input:checked + .runmeet-slider {
          background: linear-gradient(135deg, #43a047 0%, #7bd67f 100%);
        }

        .runmeet-switch input:checked + .runmeet-slider:before {
          transform: translateX(24px);
        }

        @media (max-width: 900px) {
          .runmeet-layout {
            grid-template-columns: 1fr;
          }

          .runmeet-events-rail {
            position: static;
            height: auto;
            display: flex;
            gap: 6px;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 6px;
          }

          .runmeet-events-rail::-webkit-scrollbar {
            height: 6px;
          }

          .runmeet-events-rail::-webkit-scrollbar-thumb {
            background: #c3ccd8;
            border-radius: 6px;
          }

          .runmeet-event-btn {
            min-width: 64px;
            height: 44px;
            flex-shrink: 0;
            font-size: 11px;
          }

          .runmeet-header-top {
            grid-template-columns: 1fr;
          }

          .runmeet-heat-tabs-wrap {
            align-items: flex-start;
          }
        }
      `}</style>

      <div className="runmeet-page">
        <div className="runmeet-layout">
          <div
            className="runmeet-events-rail"
            style={{
              gridTemplateRows: `repeat(${eventRailCount}, minmax(0, 1fr))`,
              gap: eventRailGap,
              padding: eventRailPadding,
            }}
          >
            {eventNavRows.length === 0 ? (
              <div className="runmeet-muted" style={{ padding: 6 }}>
                No seeded events
              </div>
            ) : (
              eventNavRows.map((row) => (
                <button
                  key={row.event.id}
                  type="button"
                  className={`runmeet-event-btn ${
                    selectedEventId === row.event.id ? 'active' : ''
                  }`}
                  style={{
                    background: statusColor(row.eventStatus),
                    fontSize: eventRailFontSize,
                    borderRadius: eventRailBorderRadius,
                  }}
                  title={`Event ${row.event.eventNumber || '—'} | ${
                    row.event.name || 'Unnamed Event'
                  } | ${row.event.gender || '—'} ${row.event.ageGroup || '—'}`}
                  onClick={() => {
                    setSelectedEventId(row.event.id);
                    setMsg('');
                  }}
                >
                  {row.event.eventNumber || '—'}
                </button>
              ))
            )}
          </div>

          <div className="runmeet-main">
            <div className="runmeet-strip">
              <div className="runmeet-brand">
                <img
                  src="https://tbspanthers.british-school.org/wp-content/uploads/2024/12/TBS.png"
                  alt="Panthers"
                />
                <div>
                  <div>Panthers Swim Meet Manager</div>
                  <div className="runmeet-brand-sub">Scorekeeper Console</div>
                </div>
              </div>

              <div style={{ fontWeight: 700 }}>{activeMeetLabel}</div>
            </div>

            <div className="runmeet-header">
              <div className="runmeet-header-top">
                <div>
                  <div className="runmeet-muted">Event No.</div>
                  <div className="runmeet-title-big">
                    {selectedEvent?.eventNumber || '—'}
                  </div>

                  <div className="runmeet-event-number-nav">
                    <button
                      type="button"
                      className="runmeet-nav-icon-btn runmeet-nav-icon-btn-prev"
                      onClick={() => goToEvent(-1)}
                      disabled={!canGoPrevEvent}
                      title="Previous Event"
                    >
                      ◀
                    </button>

                    <button
                      type="button"
                      className="runmeet-nav-icon-btn runmeet-nav-icon-btn-next"
                      onClick={() => goToEvent(1)}
                      disabled={!canGoNextEvent}
                      title="Next Event"
                    >
                      ▶
                    </button>
                  </div>
                </div>

                <div>
                  <div className="runmeet-muted">Event</div>
                  <div className="runmeet-title">
                    {selectedEvent?.name || 'Selected seeded event'}
                  </div>
                  <div className="runmeet-sub">
                    {(selectedEvent?.gender || '—') +
                      ' • ' +
                      (selectedEvent?.ageGroup || '—') +
                      ' • ' +
                      (selectedEvent?.stroke || '—')}
                  </div>
                </div>

                <div>
                  <div className="runmeet-pill-row">
                    <span className="runmeet-pill">
                      Heats: {selectedEventHeats.length}
                    </span>
                    <span className="runmeet-pill">Lanes: {laneCount}</span>
                    <span className="runmeet-pill">
                      Saved in Heat: {heatSavedCount}/{tableRows.length || 0}
                    </span>
                    <span className="runmeet-pill">
                      Event Status:{' '}
                      {currentEventStatus === 'COMPLETED'
                        ? 'Completed'
                        : currentEventStatus === 'IN_PROGRESS'
                        ? 'In Progress'
                        : currentEventStatus === 'NOT_READY'
                        ? 'Not Ready'
                        : 'Not Started'}
                    </span>
                  </div>
                </div>
              </div>

              {msg ? <div className="runmeet-msg">{msg}</div> : null}
            </div>

            <div className="runmeet-toolbar">
              <div className="runmeet-toolbar-left">
                Bulk tools for the selected heat. Use individual row checkboxes
                for single corrections. Use bulk buttons only when multiple rows
                need the same action.
              </div>

              <div className="runmeet-toolbar-right">
                <button
                  className="runmeet-btn"
                  onClick={handleSelectAllRows}
                  disabled={!tableRows.length}
                >
                  Select All
                </button>

                <button
                  className="runmeet-btn"
                  onClick={handleClearSelection}
                  disabled={!selectedCount}
                >
                  Clear Selection
                </button>

                <button
                  className="runmeet-btn danger"
                  onClick={handleClearSelectedData}
                  disabled={!selectedCount}
                >
                  Clear
                </button>

                <button
                  className="runmeet-btn warn"
                  onClick={() => applyBulkStatus('DQ')}
                  disabled={!selectedCount}
                >
                  DQ Selected
                </button>

                <button
                  className="runmeet-btn warn"
                  onClick={() => applyBulkStatus('NS')}
                  disabled={!selectedCount}
                >
                  NS Selected
                </button>

                <button
                  className="runmeet-btn danger"
                  onClick={() => applyBulkStatus('SCR')}
                  disabled={!selectedCount}
                >
                  SCR Selected
                </button>
              </div>
            </div>

            <div className="runmeet-heat-tabs-wrap">
              <div className="runmeet-heat-nav">
                <button
                  className="runmeet-btn"
                  onClick={() => goToHeat(-1)}
                  disabled={
                    !selectedEventHeats.length ||
                    selectedHeatNumber === selectedEventHeats[0]?.heatNumber
                  }
                >
                  ← Prev Heat
                </button>

                <button
                  className="runmeet-btn"
                  onClick={() => goToHeat(1)}
                  disabled={
                    !selectedEventHeats.length ||
                    selectedHeatNumber ===
                      selectedEventHeats[selectedEventHeats.length - 1]
                        ?.heatNumber
                  }
                >
                  Next Heat →
                </button>
              </div>

              <div className="runmeet-heat-tabs">
                {selectedEventHeats.length === 0 ? (
                  <span className="runmeet-muted">No heats</span>
                ) : (
                  selectedEventHeats.map((heat) => (
                    <button
                      key={heat.heatNumber}
                      type="button"
                      className={`runmeet-heat-tab ${
                        selectedHeatNumber === heat.heatNumber ? 'active' : ''
                      }`}
                      onClick={() => setSelectedHeatNumber(heat.heatNumber)}
                      title={`Heat ${heat.heatNumber}`}
                    >
                      {heat.heatNumber}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="runmeet-table-wrap">
              <table className="runmeet-table">
                <thead>
                  <tr>
                    <th className="center" style={{ width: 46 }}>
                      ✓
                    </th>
                    <th style={{ width: 64 }}>Lane</th>
                    <th style={{ width: 150 }}>Team</th>
                    <th>Swimmer</th>
                    <th style={{ width: 94 }}>Seed Time</th>
                    <th style={{ width: 110 }}>H/F Time</th>
                    <th className="center" style={{ width: 70 }}>
                      DQ
                    </th>
                    <th className="center" style={{ width: 70 }}>
                      NS
                    </th>
                    <th className="center" style={{ width: 76 }}>
                      SCR
                    </th>
                    <th className="center" style={{ width: 70 }}>
                      Place
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        style={{ textAlign: 'center', padding: 20 }}
                      >
                        Select a seeded event and heat to start.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((row) => (
                      <tr
                        key={row.entryId}
                        ref={(el) => {
                          rowRefs.current[row.entryId] = el;
                        }}
                        className={
                          activeRowEntryId === row.entryId ? 'active-row' : ''
                        }
                        onClick={() => {
                          setActiveRowEntryId(row.entryId);
                          focusRow(row.entryId);
                        }}
                      >
                        <td className="center">
                          <input
                            className="runmeet-check"
                            type="checkbox"
                            checked={selectedLaneEntryIds.includes(row.entryId)}
                            onChange={() => toggleLaneSelection(row.entryId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>

                        <td className="runmeet-lane-cell">{row.laneNumber}</td>
                        <td>{row.teamName || '—'}</td>

                        <td>
                          <div className="runmeet-name">
                            {row.swimmerName || 'Unnamed Swimmer'}
                          </div>
                        </td>

                        <td>{row.seedTime || '—'}</td>

                        <td>
                          <input
                            className="runmeet-input"
                            style={{ width: '100%' }}
                            type="text"
                            value={row.displayTime}
                            readOnly
                            inputMode="numeric"
                            placeholder="00:00.00"
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => setActiveRowEntryId(row.entryId)}
                            onKeyDown={(e) => {
                              const key = e.key;

                              if (/^\d$/.test(key)) {
                                e.preventDefault();
                                setTimeDigitsByEntryId((prev) => ({
                                  ...prev,
                                  [row.entryId]: appendDigit(
                                    prev[row.entryId] || '',
                                    key
                                  ),
                                }));
                                return;
                              }

                              if (key === 'Backspace') {
                                e.preventDefault();
                                setTimeDigitsByEntryId((prev) => ({
                                  ...prev,
                                  [row.entryId]: removeLastDigit(
                                    prev[row.entryId] || ''
                                  ),
                                }));
                                return;
                              }

                              if (key === 'Delete') {
                                e.preventDefault();
                                setTimeDigitsByEntryId((prev) => ({
                                  ...prev,
                                  [row.entryId]: '',
                                }));
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
                              setTimeDigitsByEntryId((prev) => ({
                                ...prev,
                                [row.entryId]: digitsOnly(
                                  e.clipboardData.getData('text')
                                ),
                              }));
                            }}
                            onBlur={() => queueAutoSave(row)}
                          />
                        </td>

                        <td className="center">
                          <input
                            className="runmeet-check"
                            type="checkbox"
                            checked={row.status === 'DQ'}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextStatus = e.target.checked ? 'DQ' : 'OK';
                              setStatusByEntryId((prev) => ({
                                ...prev,
                                [row.entryId]: nextStatus,
                              }));
                              queueAutoSave(row, nextStatus);
                            }}
                          />
                        </td>

                        <td className="center">
                          <input
                            className="runmeet-check"
                            type="checkbox"
                            checked={row.status === 'NS'}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextStatus = e.target.checked ? 'NS' : 'OK';
                              setStatusByEntryId((prev) => ({
                                ...prev,
                                [row.entryId]: nextStatus,
                              }));
                              queueAutoSave(row, nextStatus);
                            }}
                          />
                        </td>

                        <td className="center">
                          <input
                            className="runmeet-check"
                            type="checkbox"
                            checked={row.status === 'SCR'}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextStatus = e.target.checked
                                ? 'SCR'
                                : 'OK';
                              setStatusByEntryId((prev) => ({
                                ...prev,
                                [row.entryId]: nextStatus,
                              }));
                              queueAutoSave(row, nextStatus);
                            }}
                          />
                        </td>

                        <td className="center">{row.computedPlace ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="runmeet-footer">
              <div className="runmeet-pill-row">
                <span className="runmeet-pill">
                  Current Event: {selectedEvent?.eventNumber || '—'}
                </span>
                <span className="runmeet-pill">
                  Heat: {selectedHeatNumber || '—'}
                </span>
                <span className="runmeet-pill">
                  Selected Rows: {selectedCount}
                </span>
              </div>

              <div className="runmeet-pill-row">
                <span className="runmeet-pill">
                  Saved in Heat: {heatSavedCount}/{tableRows.length || 0}
                </span>
                <span className="runmeet-pill">
                  Event Status:{' '}
                  {currentEventStatus === 'COMPLETED'
                    ? 'Completed'
                    : currentEventStatus === 'IN_PROGRESS'
                    ? 'In Progress'
                    : currentEventStatus === 'NOT_READY'
                    ? 'Not Ready'
                    : 'Not Started'}
                </span>
              </div>

              <div className="runmeet-display-actions">
                <button
                  type="button"
                  className="runmeet-btn runmeet-btn-display-race"
                  onClick={handleReadyDisplay}
                  disabled={!selectedEvent || !selectedHeat}
                >
                  Ready Display
                </button>

                <button
                  type="button"
                  className="runmeet-btn runmeet-btn-display-results"
                  onClick={handlePublishResultsDisplay}
                  disabled={!selectedEvent || !selectedHeat}
                >
                  Publish Result on Display
                </button>

                <div className="runmeet-display-toggle">
                  <span>LED Board</span>
                  <label
                    className="runmeet-switch"
                    title="Toggle LED scoreboard on or off"
                  >
                    <input
                      type="checkbox"
                      checked={displayBoardEnabled}
                      onChange={(e) =>
                        handleToggleDisplayBoard(e.target.checked)
                      }
                    />
                    <span className="runmeet-slider"></span>
                  </label>
                  <span>{displayBoardEnabled ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
