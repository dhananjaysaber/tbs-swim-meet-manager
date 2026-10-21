import { useEffect, useMemo, useState } from 'react';
import { push, ref, set, onValue, remove, update } from 'firebase/database';
import { auth } from '../firebase/auth.js';
import { db } from '../firebase/db.js';
import AppShell from '../components/AppShell';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
};

type TeamRow = {
  id: string;
  name?: string;
  code?: string;
  seedClub?: string;
  active?: boolean;
  createdAt?: number;
  createdBy?: string;
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

type SwimmerRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  gender?: string;
  ageGroup?: string;
  team?: string;
  teamId?: string;
  teamName?: string;
  dob?: string;
  regNo?: string;
  seedClub?: string;
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

type ViewTab = 'eligible' | 'entries' | 'importExport';

type ImportPreviewRow = {
  lineNo: number;
  eventNumber: number;
  eventName: string;
  regNo: string;
  swimmerName: string;
  teamName: string;
  laneSeedTime: string;
  status: string;
  outcome: 'ready' | 'skip' | 'error';
  message: string;
  swimmerId?: string;
  teamId?: string;
  eventId?: string;
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

function normalizeGender(value?: string) {
  const v = String(value || '')
    .trim()
    .toLowerCase();

  if (['boys', 'boy', 'male', 'm'].includes(v)) return 'boys';
  if (['girls', 'girl', 'female', 'f'].includes(v)) return 'girls';
  if (['mixed', 'mix'].includes(v)) return 'mixed';

  return v;
}

function normalizeAgeGroup(value?: string) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeStatus(value?: string) {
  const v = String(value || '')
    .trim()
    .toLowerCase();

  if (!v) return 'Entered';
  if (v === 'entered') return 'Entered';
  if (v === 'pending') return 'Pending';
  if (v === 'confirmed') return 'Confirmed';
  if (v === 'completed') return 'Completed';
  if (v === 'scratch' || v === 'scratched') return 'Scratch';

  return 'Entered';
}

function normalizeText(value?: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeEntryStatus(value?: string) {
  return String(value || 'Entered')
    .trim()
    .toLowerCase();
}

function escapeCsvValue(value: string | number | undefined | null) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows: Array<Array<string | number | undefined | null>>) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/csv;charset=utf-8;'
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCsv(text: string) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');

  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };

  const headers = parseCsvLine(lines[0]).map((item) => item.trim());
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  return { headers, rows };
}

export default function Entries() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [swimmers, setSwimmers] = useState<SwimmerRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);

  const [selectedEventId, setSelectedEventId] = useState('');
  const [commonSeedTimeDigits, setCommonSeedTimeDigits] = useState('');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState('');
  const [selectedSwimmerIds, setSelectedSwimmerIds] = useState<string[]>([]);
  const [seedTimeDigitsBySwimmerId, setSeedTimeDigitsBySwimmerId] = useState<
    Record<string, string>
  >({});
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);

  const [entriesSearchTerm, setEntriesSearchTerm] = useState('');
  const [entriesTeamFilter, setEntriesTeamFilter] = useState('');
  const [editingEntryId, setEditingEntryId] = useState('');
  const [editEntrySeedDigits, setEditEntrySeedDigits] = useState('');
  const [editEntryStatus, setEditEntryStatus] = useState('Entered');
  const [updatingEntryId, setUpdatingEntryId] = useState('');

  const [activeTab, setActiveTab] = useState<ViewTab>('eligible');
  const [exportTeamIds, setExportTeamIds] = useState<string[]>([]);
  const [importPreviewRows, setImportPreviewRows] = useState<
    ImportPreviewRow[]
  >([]);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [resetTeamIds, setResetTeamIds] = useState<string[]>([]);
  const [resetEventIds, setResetEventIds] = useState<string[]>([]);

  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkRemovingEntries, setBulkRemovingEntries] = useState(false);
  const [bulkResetDeletingEntries, setBulkResetDeletingEntries] =
    useState(false);

  const teamsById = useMemo(() => {
    const map: Record<string, TeamRow> = {};
    teams.forEach((team) => {
      map[team.id] = team;
    });
    return map;
  }, [teams]);

  const swimmersById = useMemo(() => {
    const map: Record<string, SwimmerRow> = {};
    swimmers.forEach((swimmer) => {
      map[swimmer.id] = swimmer;
    });
    return map;
  }, [swimmers]);

  const resolveTeamName = (item: {
    teamId?: string;
    teamName?: string;
    team?: string;
  }) => {
    const currentTeam = item.teamId ? teamsById[item.teamId] : null;
    return currentTeam?.name || item.teamName || item.team || 'No team';
  };

  const activeEvents = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false)
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const activeSwimmers = useMemo(() => {
    return [...swimmers]
      .filter((swimmer) => swimmer.active !== false)
      .sort((a, b) =>
        String(a.fullName || '').localeCompare(String(b.fullName || ''))
      );
  }, [swimmers]);

  const selectedEvent = useMemo(() => {
    return activeEvents.find((event) => event.id === selectedEventId) || null;
  }, [activeEvents, selectedEventId]);

  const eventsById = useMemo(() => {
    const map: Record<string, EventRow> = {};
    activeEvents.forEach((event) => {
      map[event.id] = event;
    });
    return map;
  }, [activeEvents]);

  const findEventForImportRow = (
    eventNumberRaw?: string,
    eventNameRaw?: string
  ) => {
    const eventNumber = Number(String(eventNumberRaw || '').trim());
    const normalizedEventName = normalizeText(eventNameRaw);

    if (!Number.isNaN(eventNumber) && eventNumber > 0) {
      const byNumber = activeEvents.find(
        (event) => Number(event.eventNumber || 0) === eventNumber
      );
      if (byNumber) return byNumber;
    }

    if (normalizedEventName) {
      const byName = activeEvents.find(
        (event) => normalizeText(event.name) === normalizedEventName
      );
      if (byName) return byName;
    }

    return null;
  };

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  const selectedEventEntries = useMemo(() => {
    if (!selectedEventId) return [];

    return entries
      .filter(
        (entry) =>
          entry.eventId === selectedEventId &&
          entry.active !== false &&
          normalizeEntryStatus(entry.status) !== 'scratch'
      )
      .sort((a, b) =>
        String(a.swimmerName || '').localeCompare(String(b.swimmerName || ''))
      );
  }, [entries, selectedEventId]);

  const entrySwimmerIds = useMemo(() => {
    return new Set(selectedEventEntries.map((entry) => entry.swimmerId || ''));
  }, [selectedEventEntries]);

  const eligibleSwimmers = useMemo(() => {
    if (!selectedEvent) return [];

    const eventGender = normalizeGender(selectedEvent.gender);
    const eventAgeGroup = normalizeAgeGroup(selectedEvent.ageGroup);

    return activeSwimmers.filter((swimmer) => {
      const swimmerGender = normalizeGender(swimmer.gender);
      const swimmerAgeGroup = normalizeAgeGroup(swimmer.ageGroup);

      const genderMatch =
        eventGender === 'mixed' ? true : swimmerGender === eventGender;

      const ageGroupMatch = swimmerAgeGroup === eventAgeGroup;

      return genderMatch && ageGroupMatch;
    });
  }, [activeSwimmers, selectedEvent]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();

    eligibleSwimmers.forEach((swimmer) => {
      const id = String(swimmer.teamId || '').trim();
      const name = resolveTeamName(swimmer).trim();
      if (id && name) map.set(id, name);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligibleSwimmers, teamsById]);

  const filteredEligibleSwimmers = useMemo(() => {
    let rows = [...eligibleSwimmers];

    if (selectedTeamFilter) {
      rows = rows.filter(
        (swimmer) => String(swimmer.teamId || '') === selectedTeamFilter
      );
    }

    return rows;
  }, [eligibleSwimmers, selectedTeamFilter]);

  const availableEligibleSwimmers = useMemo(() => {
    return filteredEligibleSwimmers.filter(
      (swimmer) => !entrySwimmerIds.has(swimmer.id)
    );
  }, [filteredEligibleSwimmers, entrySwimmerIds]);

  const selectedCount = useMemo(() => {
    return selectedSwimmerIds.length;
  }, [selectedSwimmerIds]);

  const selectedEntryCount = useMemo(() => {
    return selectedEntryIds.length;
  }, [selectedEntryIds]);

  const allMeetEntryTeamOptions = useMemo(() => {
    const map = new Map<string, string>();

    entries.forEach((entry) => {
      const id = String(entry.teamId || '').trim();
      const name = resolveTeamName({
        teamId: entry.teamId,
        teamName: entry.teamName,
      }).trim();

      if (id && name) map.set(id, name);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, teamsById]);

  const filteredSelectedEventEntries = useMemo(() => {
    let rows = [...selectedEventEntries];

    if (entriesTeamFilter) {
      rows = rows.filter(
        (entry) => String(entry.teamId || '') === entriesTeamFilter
      );
    }

    const q = entriesSearchTerm.trim().toLowerCase();

    if (!q) return rows;

    return rows.filter((entry) => {
      const resolvedTeamName = resolveTeamName({
        teamId: entry.teamId,
        teamName: entry.teamName,
      });

      const haystack = [
        entry.swimmerName || '',
        resolvedTeamName || '',
        entry.gender || '',
        entry.ageGroup || '',
        entry.laneSeedTime || '',
        entry.status || '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [selectedEventEntries, entriesTeamFilter, entriesSearchTerm, teamsById]);

  const exportableEntries = useMemo(() => {
    let rows = [...entries];

    if (exportTeamIds.length > 0) {
      rows = rows.filter((entry) =>
        exportTeamIds.includes(String(entry.teamId || ''))
      );
    }

    return rows.sort((a, b) => {
      const teamCompare = resolveTeamName({
        teamId: a.teamId,
        teamName: a.teamName,
      }).localeCompare(
        resolveTeamName({
          teamId: b.teamId,
          teamName: b.teamName,
        })
      );

      if (teamCompare !== 0) return teamCompare;

      const eventCompare =
        Number(a.eventNumber || 0) - Number(b.eventNumber || 0);
      if (eventCompare !== 0) return eventCompare;

      return String(a.swimmerName || '').localeCompare(
        String(b.swimmerName || '')
      );
    });
  }, [entries, exportTeamIds, teamsById]);

  const resetEventOptions = useMemo(() => {
    const map = new Map<
      string,
      { id: string; label: string; eventNumber: number }
    >();

    entries.forEach((entry) => {
      const id = String(entry.eventId || '').trim();
      if (!id) return;

      const eventNumber = Number(entry.eventNumber || 0);
      const eventName =
        String(entry.eventName || '').trim() || `Event ${eventNumber || '—'}`;

      if (!map.has(id)) {
        map.set(id, {
          id,
          eventNumber,
          label: `Event ${eventNumber || '—'} • ${eventName}`,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
      return a.label.localeCompare(b.label);
    });
  }, [entries]);

  const resettableEntries = useMemo(() => {
    if (resetTeamIds.length === 0 && resetEventIds.length === 0)
      return [] as EntryRow[];

    return entries.filter((entry) => {
      const teamMatch =
        resetTeamIds.length === 0
          ? true
          : resetTeamIds.includes(String(entry.teamId || ''));
      const eventMatch =
        resetEventIds.length === 0
          ? true
          : resetEventIds.includes(String(entry.eventId || ''));

      return teamMatch && eventMatch;
    });
  }, [entries, resetTeamIds, resetEventIds]);

  const importReadyCount = useMemo(() => {
    return importPreviewRows.filter((row) => row.outcome === 'ready').length;
  }, [importPreviewRows]);

  const importSkipCount = useMemo(() => {
    return importPreviewRows.filter((row) => row.outcome === 'skip').length;
  }, [importPreviewRows]);

  const importErrorCount = useMemo(() => {
    return importPreviewRows.filter((row) => row.outcome === 'error').length;
  }, [importPreviewRows]);

  useEffect(() => {
    const activeRef = ref(db, 'appState/activeMeetId');

    const unsub = onValue(activeRef, (snap) => {
      const meetId = snap.val() || '';
      setActiveMeetId(meetId);
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

      const meetData = snap.val();

      setActiveMeet({
        id: activeMeetId,
        ...meetData,
      });
    });

    return () => unsub();
  }, [activeMeetId]);

  useEffect(() => {
    if (!activeMeetId) {
      setTeams([]);
      setEvents([]);
      setSwimmers([]);
      setEntries([]);
      setSelectedEventId('');
      setSelectedSwimmerIds([]);
      setSelectedTeamFilter('');
      setCommonSeedTimeDigits('');
      setSeedTimeDigitsBySwimmerId({});
      setSelectedEntryIds([]);
      setEntriesSearchTerm('');
      setEntriesTeamFilter('');
      setEditingEntryId('');
      setEditEntrySeedDigits('');
      setEditEntryStatus('Entered');
      setExportTeamIds([]);
      setImportPreviewRows([]);
      setImportFileName('');
      setResetTeamIds([]);
      setResetEventIds([]);
      return;
    }

    const teamsRef = ref(db, `meets/${activeMeetId}/teams`);
    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const swimmersRef = ref(db, `meets/${activeMeetId}/swimmers`);
    const entriesRef = ref(db, `meets/${activeMeetId}/entries`);

    const unsubTeams = onValue(teamsRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setTeams([]);
        return;
      }

      const rows: TeamRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      rows.sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''))
      );
      setTeams(rows);
    });

    const unsubEvents = onValue(eventsRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setEvents([]);
        setSelectedEventId('');
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

      setSelectedEventId((prev) => {
        if (
          prev &&
          rows.some((event) => event.id === prev && event.active !== false)
        ) {
          return prev;
        }
        const firstActive = rows.find((event) => event.active !== false);
        return firstActive?.id || '';
      });
    });

    const unsubSwimmers = onValue(swimmersRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setSwimmers([]);
        return;
      }

      const rows: SwimmerRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      rows.sort((a, b) =>
        String(a.fullName || '').localeCompare(String(b.fullName || ''))
      );

      setSwimmers(rows);
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

    return () => {
      unsubTeams();
      unsubEvents();
      unsubSwimmers();
      unsubEntries();
    };
  }, [activeMeetId]);

  useEffect(() => {
    setSelectedSwimmerIds([]);
    setSelectedTeamFilter('');
    setCommonSeedTimeDigits('');
    setSeedTimeDigitsBySwimmerId({});
    setSelectedEntryIds([]);
    setEntriesSearchTerm('');
    setEntriesTeamFilter('');
    setEditingEntryId('');
    setEditEntrySeedDigits('');
    setEditEntryStatus('Entered');
    setExportTeamIds([]);
    setImportPreviewRows([]);
    setImportFileName('');
    setResetEventIds([]);
  }, [selectedEventId]);

  useEffect(() => {
    setSelectedSwimmerIds((prev) =>
      prev.filter((id) =>
        availableEligibleSwimmers.some((swimmer) => swimmer.id === id)
      )
    );

    setSeedTimeDigitsBySwimmerId((prev) => {
      const next: Record<string, string> = {};
      availableEligibleSwimmers.forEach((swimmer) => {
        if (prev[swimmer.id] !== undefined) {
          next[swimmer.id] = prev[swimmer.id];
        }
      });
      return next;
    });
  }, [availableEligibleSwimmers]);

  useEffect(() => {
    setSelectedEntryIds((prev) =>
      prev.filter((id) =>
        filteredSelectedEventEntries.some((entry) => entry.id === id)
      )
    );
  }, [filteredSelectedEventEntries]);

  const toggleSwimmerSelection = (swimmerId: string) => {
    setSelectedSwimmerIds((prev) => {
      if (prev.includes(swimmerId)) {
        return prev.filter((id) => id !== swimmerId);
      }
      return [...prev, swimmerId];
    });
  };

  const handleSelectAllEligible = () => {
    setSelectedSwimmerIds(
      availableEligibleSwimmers.map((swimmer) => swimmer.id)
    );
  };

  const handleClearSelection = () => {
    setSelectedSwimmerIds([]);
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds((prev) => {
      if (prev.includes(entryId)) {
        return prev.filter((id) => id !== entryId);
      }
      return [...prev, entryId];
    });
  };

  const handleSelectAllEntries = () => {
    setSelectedEntryIds(filteredSelectedEventEntries.map((entry) => entry.id));
  };

  const handleClearEntrySelection = () => {
    setSelectedEntryIds([]);
  };

  const toggleExportTeam = (teamId: string) => {
    setExportTeamIds((prev) =>
      prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId]
    );
  };

  const handleSelectAllExportTeams = () => {
    setExportTeamIds(allMeetEntryTeamOptions.map((team) => team.id));
  };

  const handleClearExportTeams = () => {
    setExportTeamIds([]);
  };

  const toggleResetTeam = (teamId: string) => {
    setResetTeamIds((prev) =>
      prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId]
    );
  };

  const handleSelectAllResetTeams = () => {
    setResetTeamIds(allMeetEntryTeamOptions.map((team) => team.id));
  };

  const handleClearResetTeams = () => {
    setResetTeamIds([]);
  };

  const toggleResetEvent = (eventId: string) => {
    setResetEventIds((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
  };

  const handleSelectAllResetEvents = () => {
    setResetEventIds(resetEventOptions.map((event) => event.id));
  };

  const handleClearResetEvents = () => {
    setResetEventIds([]);
  };

  const handleCommonSeedKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const key = e.key;

    if (/^\d$/.test(key)) {
      e.preventDefault();
      setCommonSeedTimeDigits((prev) => appendDigit(prev, key));
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      setCommonSeedTimeDigits((prev) => removeLastDigit(prev));
      return;
    }

    if (key === 'Delete') {
      e.preventDefault();
      setCommonSeedTimeDigits('');
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
  };

  const handleRowSeedKeyDown = (
    swimmerId: string,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const key = e.key;

    if (/^\d$/.test(key)) {
      e.preventDefault();
      setSeedTimeDigitsBySwimmerId((prev) => ({
        ...prev,
        [swimmerId]: appendDigit(prev[swimmerId] || '', key),
      }));
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      setSeedTimeDigitsBySwimmerId((prev) => ({
        ...prev,
        [swimmerId]: removeLastDigit(prev[swimmerId] || ''),
      }));
      return;
    }

    if (key === 'Delete') {
      e.preventDefault();
      setSeedTimeDigitsBySwimmerId((prev) => ({
        ...prev,
        [swimmerId]: '',
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
  };

  const handleEditEntrySeedKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const key = e.key;

    if (/^\d$/.test(key)) {
      e.preventDefault();
      setEditEntrySeedDigits((prev) => appendDigit(prev, key));
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      setEditEntrySeedDigits((prev) => removeLastDigit(prev));
      return;
    }

    if (key === 'Delete') {
      e.preventDefault();
      setEditEntrySeedDigits('');
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
  };

  const handlePasteSeedTime = (
    value: string,
    setDigits: (updater: (prev: string) => string) => void
  ) => {
    const pastedDigits = digitsOnly(value);
    setDigits(() => pastedDigits);
  };

  const resolveSeedTimeForSwimmer = (swimmerId: string) => {
    const rowDigits = digitsOnly(seedTimeDigitsBySwimmerId[swimmerId] || '');
    if (rowDigits) return formatSwimTimeFromDigits(rowDigits);

    const commonDigits = digitsOnly(commonSeedTimeDigits);
    if (commonDigits) return formatSwimTimeFromDigits(commonDigits);

    return '';
  };

  const handleAddEntry = async (swimmer: SwimmerRow) => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!selectedEvent) {
      setMsg('Please select an event');
      return;
    }

    if (entrySwimmerIds.has(swimmer.id)) {
      setMsg('This swimmer is already entered in the selected event');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const resolvedTeamName = resolveTeamName(swimmer);

    setSaving(true);
    setMsg(`Adding ${swimmer.fullName || 'swimmer'} to event...`);

    try {
      const newEntryRef = push(ref(db, `meets/${activeMeetId}/entries`));

      await set(newEntryRef, {
        swimmerId: swimmer.id,
        swimmerName: swimmer.fullName || '',
        gender: swimmer.gender || '',
        ageGroup: swimmer.ageGroup || '',
        teamId: swimmer.teamId || '',
        teamName: resolvedTeamName,
        eventId: selectedEvent.id,
        eventNumber: selectedEvent.eventNumber || 0,
        eventName: selectedEvent.name || '',
        laneSeedTime: resolveSeedTimeForSwimmer(swimmer.id),
        status: 'Entered',
        active: true,
        createdAt: Date.now(),
        createdBy: user.uid,
      });

      setMsg('Entry added successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to add entry');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSelectedSwimmers = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!selectedEvent) {
      setMsg('Please select an event');
      return;
    }

    if (selectedSwimmerIds.length === 0) {
      setMsg('Please select at least one swimmer');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const swimmersToAdd = availableEligibleSwimmers.filter((swimmer) =>
      selectedSwimmerIds.includes(swimmer.id)
    );

    if (swimmersToAdd.length === 0) {
      setMsg('No valid swimmers selected to add');
      return;
    }

    setSaving(true);
    setMsg(`Adding ${swimmersToAdd.length} swimmer(s) to event...`);

    try {
      for (const swimmer of swimmersToAdd) {
        const newEntryRef = push(ref(db, `meets/${activeMeetId}/entries`));
        const resolvedTeamName = resolveTeamName(swimmer);

        await set(newEntryRef, {
          swimmerId: swimmer.id,
          swimmerName: swimmer.fullName || '',
          gender: swimmer.gender || '',
          ageGroup: swimmer.ageGroup || '',
          teamId: swimmer.teamId || '',
          teamName: resolvedTeamName,
          eventId: selectedEvent.id,
          eventNumber: selectedEvent.eventNumber || 0,
          eventName: selectedEvent.name || '',
          laneSeedTime: resolveSeedTimeForSwimmer(swimmer.id),
          status: 'Entered',
          active: true,
          createdAt: Date.now(),
          createdBy: user.uid,
        });
      }

      setMsg(`${swimmersToAdd.length} swimmer(s) added successfully`);
      setSelectedSwimmerIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to add selected swimmers');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEditEntry = (entry: EntryRow) => {
    setEditingEntryId(entry.id);
    setEditEntrySeedDigits(digitsOnly(entry.laneSeedTime || ''));
    setEditEntryStatus(entry.status || 'Entered');
    setMsg('');
  };

  const handleCancelEditEntry = () => {
    setEditingEntryId('');
    setEditEntrySeedDigits('');
    setEditEntryStatus('Entered');
  };

  const handleSaveEntryUpdate = async (entry: EntryRow) => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    setUpdatingEntryId(entry.id);
    setMsg(`Updating ${entry.swimmerName || 'entry'}...`);

    try {
      await update(ref(db, `meets/${activeMeetId}/entries/${entry.id}`), {
        laneSeedTime: formatSwimTimeFromDigits(editEntrySeedDigits),
        status: editEntryStatus || 'Entered',
        teamName: resolveTeamName({
          teamId: entry.teamId,
          teamName: entry.teamName,
        }),
      });

      setMsg('Entry updated successfully');
      handleCancelEditEntry();
    } catch (error: any) {
      setMsg(error.message || 'Failed to update entry');
    } finally {
      setUpdatingEntryId('');
    }
  };

  const handleRemoveEntry = async (entry: EntryRow) => {
    const ok = window.confirm(
      `Remove "${entry.swimmerName || 'swimmer'}" from "${
        entry.eventName || 'event'
      }"?`
    );
    if (!ok) return;

    try {
      await remove(ref(db, `meets/${activeMeetId}/entries/${entry.id}`));
      setMsg('Entry removed successfully');
      setSelectedEntryIds((prev) => prev.filter((id) => id !== entry.id));
    } catch (error: any) {
      setMsg(error.message || 'Failed to remove entry');
    }
  };

  const handleBulkRemoveEntries = async () => {
    if (selectedEntryIds.length === 0) {
      setMsg('Please select at least one entry');
      return;
    }

    const ok = window.confirm(
      `Remove ${selectedEntryIds.length} selected entr${
        selectedEntryIds.length === 1 ? 'y' : 'ies'
      } from this event?`
    );
    if (!ok) return;

    setBulkRemovingEntries(true);
    setMsg(
      `Removing ${selectedEntryIds.length} selected entr${
        selectedEntryIds.length === 1 ? 'y' : 'ies'
      }...`
    );

    try {
      for (const entryId of selectedEntryIds) {
        await remove(ref(db, `meets/${activeMeetId}/entries/${entryId}`));
      }

      setMsg(
        `${selectedEntryIds.length} entr${
          selectedEntryIds.length === 1 ? 'y' : 'ies'
        } removed successfully`
      );
      setSelectedEntryIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to remove selected entries');
    } finally {
      setBulkRemovingEntries(false);
    }
  };

  const handleDownloadImportTemplate = () => {
    const rows = [
      [
        'Event Number',
        'Event Name',
        'Reg No',
        'Swimmer Name',
        'Gender',
        'Category',
        'Team Name',
        'Seed Club',
        'Seed Time',
        'Status',
      ],
      [
        '1',
        '50m Backstroke - Girls - 12 & under - Heats',
        'REG001',
        'Aarav Singh',
        'Girls',
        '12 & under',
        'Panthers',
        'Panthers Club',
        '00:34.25',
        'Entered',
      ],
      [
        '1',
        '50m Backstroke - Girls - 12 & under - Heats',
        'REG002',
        'Reyansh Kumar',
        'Girls',
        '12 & under',
        'Panthers',
        'Panthers Club',
        '00:36.40',
        'Entered',
      ],
    ];

    downloadTextFile('entries-import-template.csv', buildCsv(rows));
    setMsg('Import template downloaded');
  };

  const handleExportEntries = () => {
    if (allMeetEntryTeamOptions.length === 0) {
      setMsg('No team entries available to export in this meet');
      return;
    }

    if (exportableEntries.length === 0) {
      setMsg('No entries available for the selected export team filter');
      return;
    }

    const rows: Array<Array<string | number | undefined | null>> = [
      [
        'Event Number',
        'Event Name',
        'Reg No',
        'Swimmer Name',
        'Gender',
        'Category',
        'Team Name',
        'Seed Club',
        'Seed Time',
        'Status',
      ],
    ];

    exportableEntries.forEach((entry) => {
      const swimmer = entry.swimmerId ? swimmersById[entry.swimmerId] : null;
      rows.push([
        entry.eventNumber || '',
        entry.eventName || '',
        swimmer?.regNo || '',
        entry.swimmerName || '',
        entry.gender || '',
        entry.ageGroup || '',
        resolveTeamName({
          teamId: entry.teamId,
          teamName: entry.teamName,
        }),
        swimmer?.seedClub || '',
        entry.laneSeedTime || '',
        entry.status || 'Entered',
      ]);
    });

    const fileName = `entries-meet-${
      exportTeamIds.length > 0 ? 'selected-teams' : 'all-teams'
    }.csv`;

    downloadTextFile(fileName, buildCsv(rows));
    setMsg(
      `Exported ${exportableEntries.length} entr${
        exportableEntries.length === 1 ? 'y' : 'ies'
      } successfully`
    );
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      const headerMap = parsed.headers.reduce<Record<string, number>>(
        (acc, header, index) => {
          acc[header.trim().toLowerCase()] = index;
          return acc;
        },
        {}
      );

      const hasMultiEventHeaders =
        headerMap['event number'] !== undefined ||
        headerMap['event name'] !== undefined;

      const requiredHeaders = hasMultiEventHeaders
        ? [
            'event number',
            'event name',
            'reg no',
            'swimmer name',
            'seed time',
            'status',
          ]
        : ['reg no', 'swimmer name', 'team name', 'seed time', 'status'];

      const missingHeaders = requiredHeaders.filter(
        (header) => headerMap[header] === undefined
      );

      if (missingHeaders.length > 0) {
        setMsg(
          `Import failed. Missing column(s): ${missingHeaders.join(', ')}`
        );
        setImportPreviewRows([]);
        setImportFileName(file.name);
        e.target.value = '';
        return;
      }

      if (!hasMultiEventHeaders && !selectedEvent) {
        setMsg('Please select an event before importing the simple template');
        setImportPreviewRows([]);
        setImportFileName(file.name);
        e.target.value = '';
        return;
      }

      const preview: ImportPreviewRow[] = parsed.rows.map((row, index) => {
        const eventNumberRaw = String(
          row[headerMap['event number']] || ''
        ).trim();
        const eventNameRaw = String(row[headerMap['event name']] || '').trim();
        const regNo = String(row[headerMap['reg no']] || '').trim();
        const swimmerName = String(row[headerMap['swimmer name']] || '').trim();
        const teamName = String(row[headerMap['team name']] || '').trim();
        const seedTimeRaw = String(row[headerMap['seed time']] || '').trim();
        const status = normalizeStatus(row[headerMap['status']]);

        const targetEvent = hasMultiEventHeaders
          ? findEventForImportRow(eventNumberRaw, eventNameRaw)
          : selectedEvent;

        if (!targetEvent) {
          return {
            lineNo: index + 2,
            eventNumber: Number(eventNumberRaw || 0),
            eventName: eventNameRaw,
            regNo,
            swimmerName,
            teamName,
            laneSeedTime: formatSwimTimeFromDigits(seedTimeRaw),
            status,
            outcome: 'error',
            message: hasMultiEventHeaders
              ? 'Event not found in current meet'
              : 'Please select an event first',
          };
        }

        const matchingSwimmer = activeSwimmers.find((swimmer) => {
          const swimmerReg = String(swimmer.regNo || '')
            .trim()
            .toLowerCase();
          const swimmerFullName = String(swimmer.fullName || '')
            .trim()
            .toLowerCase();
          const importReg = regNo.toLowerCase();
          const importName = swimmerName.toLowerCase();

          if (importReg && swimmerReg && importReg === swimmerReg) return true;
          if (importName && swimmerFullName && importName === swimmerFullName)
            return true;
          return false;
        });

        if (!matchingSwimmer) {
          return {
            lineNo: index + 2,
            eventNumber: Number(targetEvent.eventNumber || 0),
            eventName: targetEvent.name || eventNameRaw,
            regNo,
            swimmerName,
            teamName,
            laneSeedTime: formatSwimTimeFromDigits(seedTimeRaw),
            status,
            outcome: 'error',
            message: 'Swimmer not found in current meet',
            eventId: targetEvent.id,
          };
        }

        const resolvedTeamName = resolveTeamName(matchingSwimmer);
        const swimmerGender = normalizeGender(matchingSwimmer.gender);
        const swimmerAgeGroup = normalizeAgeGroup(matchingSwimmer.ageGroup);
        const eventGender = normalizeGender(targetEvent.gender);
        const eventAgeGroup = normalizeAgeGroup(targetEvent.ageGroup);
        const genderMatch =
          eventGender === 'mixed' ? true : swimmerGender === eventGender;
        const ageGroupMatch = swimmerAgeGroup === eventAgeGroup;

        if (!genderMatch || !ageGroupMatch) {
          return {
            lineNo: index + 2,
            eventNumber: Number(targetEvent.eventNumber || 0),
            eventName: targetEvent.name || eventNameRaw,
            regNo,
            swimmerName:
              matchingSwimmer.fullName || swimmerName || 'Unnamed Swimmer',
            teamName: resolvedTeamName,
            laneSeedTime: formatSwimTimeFromDigits(seedTimeRaw),
            status,
            outcome: 'error',
            message: 'Swimmer does not match event gender/category',
            swimmerId: matchingSwimmer.id,
            teamId: matchingSwimmer.teamId,
            eventId: targetEvent.id,
          };
        }

        const alreadyEntered = entries.some(
          (entry) =>
            String(entry.eventId || '') === String(targetEvent.id) &&
            String(entry.swimmerId || '') === String(matchingSwimmer.id) &&
            entry.active !== false &&
            normalizeEntryStatus(entry.status) !== 'scratch'
        );

        if (alreadyEntered) {
          return {
            lineNo: index + 2,
            eventNumber: Number(targetEvent.eventNumber || 0),
            eventName: targetEvent.name || eventNameRaw,
            regNo,
            swimmerName:
              matchingSwimmer.fullName || swimmerName || 'Unnamed Swimmer',
            teamName: resolvedTeamName,
            laneSeedTime: formatSwimTimeFromDigits(seedTimeRaw),
            status,
            outcome: 'skip',
            message: 'Already entered in this event',
            swimmerId: matchingSwimmer.id,
            teamId: matchingSwimmer.teamId,
            eventId: targetEvent.id,
          };
        }

        return {
          lineNo: index + 2,
          eventNumber: Number(targetEvent.eventNumber || 0),
          eventName: targetEvent.name || eventNameRaw,
          regNo,
          swimmerName:
            matchingSwimmer.fullName || swimmerName || 'Unnamed Swimmer',
          teamName: resolvedTeamName,
          laneSeedTime: formatSwimTimeFromDigits(seedTimeRaw),
          status,
          outcome: 'ready',
          message: 'Ready to import',
          swimmerId: matchingSwimmer.id,
          teamId: matchingSwimmer.teamId,
          eventId: targetEvent.id,
        };
      });

      setImportPreviewRows(preview);
      setImportFileName(file.name);
      setMsg(
        `Import file loaded: ${preview.length} row(s) checked. Ready: ${
          preview.filter((row) => row.outcome === 'ready').length
        }, Skip: ${
          preview.filter((row) => row.outcome === 'skip').length
        }, Error: ${preview.filter((row) => row.outcome === 'error').length}`
      );
    } catch (error: any) {
      setMsg(error.message || 'Failed to read import file');
    } finally {
      e.target.value = '';
    }
  };

  const handleImportConfirmedRows = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    const readyRows = importPreviewRows.filter(
      (row) => row.outcome === 'ready'
    );

    if (readyRows.length === 0) {
      setMsg('No ready rows available to import');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setImporting(true);
    setMsg(`Importing ${readyRows.length} row(s)...`);

    try {
      for (const row of readyRows) {
        const swimmer = row.swimmerId ? swimmersById[row.swimmerId] : null;
        const event = row.eventId ? eventsById[row.eventId] : null;

        if (!swimmer || !event) continue;

        const newEntryRef = push(ref(db, `meets/${activeMeetId}/entries`));

        await set(newEntryRef, {
          swimmerId: swimmer.id,
          swimmerName: swimmer.fullName || row.swimmerName,
          gender: swimmer.gender || '',
          ageGroup: swimmer.ageGroup || '',
          teamId: swimmer.teamId || row.teamId || '',
          teamName: resolveTeamName(swimmer),
          eventId: event.id,
          eventNumber: event.eventNumber || row.eventNumber || 0,
          eventName: event.name || row.eventName || '',
          laneSeedTime: row.laneSeedTime || '',
          status: row.status || 'Entered',
          active: true,
          createdAt: Date.now(),
          createdBy: user.uid,
        });
      }

      setMsg(
        `${readyRows.length} row(s) imported successfully across ${
          new Set(readyRows.map((row) => row.eventId).filter(Boolean)).size
        } event(s)`
      );
      setImportPreviewRows([]);
      setImportFileName('');
      setActiveTab('entries');
    } catch (error: any) {
      setMsg(error.message || 'Failed to import entries');
    } finally {
      setImporting(false);
    }
  };

  const handleResetDeleteEntries = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (resetTeamIds.length === 0 && resetEventIds.length === 0) {
      setMsg(
        'Please select at least one team or one event to reset/delete entries'
      );
      return;
    }

    if (resettableEntries.length === 0) {
      setMsg('No entries found for the selected reset/delete filters');
      return;
    }

    const selectedTeamNames = allMeetEntryTeamOptions
      .filter((team) => resetTeamIds.includes(team.id))
      .map((team) => team.name);

    const selectedEventLabels = resetEventOptions
      .filter((event) => resetEventIds.includes(event.id))
      .map((event) => event.label);

    const filterSummary = [
      selectedTeamNames.length > 0
        ? `Teams: ${selectedTeamNames.join(', ')}`
        : '',
      selectedEventLabels.length > 0
        ? `Events: ${selectedEventLabels.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const ok = window.confirm(
      `Reset/Delete ${resettableEntries.length} entr${
        resettableEntries.length === 1 ? 'y' : 'ies'
      }?\n\n${filterSummary || 'Selected filters'}`
    );
    if (!ok) return;

    setBulkResetDeletingEntries(true);
    setMsg(
      `Resetting/Deleting ${resettableEntries.length} entr${
        resettableEntries.length === 1 ? 'y' : 'ies'
      }...`
    );

    try {
      for (const entry of resettableEntries) {
        await remove(ref(db, `meets/${activeMeetId}/entries/${entry.id}`));
      }

      setMsg(
        `${resettableEntries.length} entr${
          resettableEntries.length === 1 ? 'y' : 'ies'
        } deleted successfully`
      );
      setSelectedEntryIds((prev) =>
        prev.filter((id) => !resettableEntries.some((entry) => entry.id === id))
      );
      setResetTeamIds([]);
      setResetEventIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to reset/delete entries');
    } finally {
      setBulkResetDeletingEntries(false);
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
          <h1 style={{ marginTop: 0 }}>Entries</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            Link swimmers into events for the currently active meet.
          </p>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Select Event</label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                style={inputStyle}
              >
                {activeEvents.length === 0 ? (
                  <option value="">No active events found</option>
                ) : (
                  <>
                    <option value="">Select Event</option>
                    {activeEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        Event {event.eventNumber || '—'} • {event.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Common Optional Seed Time</label>
              <input
                type="text"
                value={formatSwimTimeFromDigits(commonSeedTimeDigits)}
                readOnly
                onKeyDown={handleCommonSeedKeyDown}
                onPaste={(e) => {
                  e.preventDefault();
                  handlePasteSeedTime(
                    e.clipboardData.getData('text'),
                    (updater) => setCommonSeedTimeDigits(updater)
                  );
                }}
                inputMode="numeric"
                placeholder="Enter digits only"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Filter by Team</label>
              <select
                value={selectedTeamFilter}
                onChange={(e) => setSelectedTeamFilter(e.target.value)}
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
          </div>

          {selectedEvent ? (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontWeight: 700, color: '#fff' }}>
                Event {selectedEvent.eventNumber || '—'} •{' '}
                {selectedEvent.name || '—'}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginTop: 10,
                }}
              >
                <span style={pillStyle}>
                  Gender: {selectedEvent.gender || '—'}
                </span>
                <span style={pillStyle}>
                  Category: {selectedEvent.ageGroup || '—'}
                </span>
                <span style={pillStyle}>
                  Type: {selectedEvent.eventType || '—'}
                </span>
                <span style={pillStyle}>
                  Stroke: {selectedEvent.stroke || '—'}
                </span>
              </div>
            </div>
          ) : null}

          <div style={tabsWrapStyle}>
            <button
              type="button"
              onClick={() => setActiveTab('eligible')}
              style={{
                ...tabBtnStyle,
                ...(activeTab === 'eligible'
                  ? activeEligibleTabStyle
                  : inactiveTabStyle),
              }}
            >
              Eligible Swimmers
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('entries')}
              style={{
                ...tabBtnStyle,
                ...(activeTab === 'entries'
                  ? activeEntriesTabStyle
                  : inactiveTabStyle),
              }}
            >
              Entries for Selected Event
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('importExport')}
              style={{
                ...tabBtnStyle,
                ...(activeTab === 'importExport'
                  ? activeImportExportTabStyle
                  : inactiveTabStyle),
              }}
            >
              Import & Export
            </button>
          </div>

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        {activeTab === 'eligible' && (
          <div style={panelStyle}>
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
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>
                  Eligible Swimmers Section
                </h2>
                <div style={{ color: '#9fb3c8' }}>
                  Select swimmers, optionally set seed time, then add selected
                  swimmers.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handleSelectAllEligible}
                  disabled={availableEligibleSwimmers.length === 0}
                  style={
                    availableEligibleSwimmers.length === 0
                      ? disabledBtnStyle
                      : secondaryBtnStyle
                  }
                >
                  Select All Eligible
                </button>

                <button
                  onClick={handleClearSelection}
                  disabled={selectedCount === 0}
                  style={
                    selectedCount === 0 ? disabledBtnStyle : secondaryBtnStyle
                  }
                >
                  Clear Selection
                </button>

                <button
                  onClick={handleAddSelectedSwimmers}
                  disabled={selectedCount === 0 || saving}
                  style={
                    selectedCount === 0 || saving
                      ? disabledBtnStyle
                      : primaryBtnStyle
                  }
                >
                  {saving
                    ? 'Adding...'
                    : `Add Selected Swimmers (${selectedCount})`}
                </button>
              </div>
            </div>

            {!activeMeetId ? (
              <p style={{ color: '#ffd6d3', marginTop: 16 }}>
                Please select an active meet first from the Meets page.
              </p>
            ) : !selectedEvent ? (
              <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                Please select an event first.
              </p>
            ) : filteredEligibleSwimmers.length === 0 ? (
              <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                No eligible swimmers found for this event. Check that swimmer
                gender and category match the selected event.
              </p>
            ) : (
              <div
                style={{
                  marginTop: 16,
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <div
                  style={{
                    maxHeight: 440,
                    overflow: 'auto',
                  }}
                >
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      minWidth: 980,
                    }}
                  >
                    <thead
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        background: '#132238',
                      }}
                    >
                      <tr>
                        {[
                          'Select',
                          'Reg No',
                          'Name',
                          'Team',
                          'Gender',
                          'Category',
                          'Seed Club',
                          'Optional Seed Time',
                          'Status',
                          'Action',
                        ].map((head) => (
                          <th
                            key={head}
                            style={{
                              textAlign: 'left',
                              padding: '12px 14px',
                              fontSize: 13,
                              color: '#f1d67a',
                              borderBottom: '1px solid rgba(255,255,255,0.08)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {filteredEligibleSwimmers.map((swimmer) => {
                        const alreadyEntered = entrySwimmerIds.has(swimmer.id);
                        const isChecked = selectedSwimmerIds.includes(
                          swimmer.id
                        );
                        const resolvedTeamName = resolveTeamName(swimmer);

                        return (
                          <tr
                            key={swimmer.id}
                            style={{
                              opacity: alreadyEntered ? 0.65 : 1,
                              background: alreadyEntered
                                ? 'rgba(46,175,109,0.05)'
                                : 'transparent',
                            }}
                          >
                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={alreadyEntered}
                                onChange={() =>
                                  toggleSwimmerSelection(swimmer.id)
                                }
                                style={{ transform: 'scale(1.1)' }}
                              />
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {swimmer.regNo || '—'}
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {swimmer.fullName || 'Unnamed Swimmer'}
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {resolvedTeamName}
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {swimmer.gender || '—'}
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {swimmer.ageGroup || '—'}
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {swimmer.seedClub || '—'}
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                minWidth: 180,
                              }}
                            >
                              <input
                                type="text"
                                value={formatSwimTimeFromDigits(
                                  seedTimeDigitsBySwimmerId[swimmer.id] || ''
                                )}
                                readOnly
                                onKeyDown={(e) =>
                                  handleRowSeedKeyDown(swimmer.id, e)
                                }
                                onPaste={(e) => {
                                  e.preventDefault();
                                  const pastedText =
                                    e.clipboardData.getData('text');
                                  setSeedTimeDigitsBySwimmerId((prev) => ({
                                    ...prev,
                                    [swimmer.id]: digitsOnly(pastedText),
                                  }));
                                }}
                                inputMode="numeric"
                                placeholder="Enter digits"
                                disabled={alreadyEntered}
                                style={inputStyle}
                              />
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '6px 10px',
                                  borderRadius: 999,
                                  background: alreadyEntered
                                    ? 'rgba(46,175,109,0.16)'
                                    : isChecked
                                    ? 'rgba(212,175,55,0.18)'
                                    : 'rgba(255,255,255,0.06)',
                                  border: alreadyEntered
                                    ? '1px solid rgba(46,175,109,0.35)'
                                    : isChecked
                                    ? '1px solid rgba(212,175,55,0.35)'
                                    : '1px solid rgba(255,255,255,0.12)',
                                  color: alreadyEntered
                                    ? '#d7ffe8'
                                    : isChecked
                                    ? '#f3d97b'
                                    : '#fff',
                                  fontSize: 12,
                                }}
                              >
                                {alreadyEntered
                                  ? 'Already Entered'
                                  : isChecked
                                  ? 'Selected'
                                  : 'Eligible'}
                              </span>
                            </td>

                            <td
                              style={{
                                padding: '12px 14px',
                                borderBottom:
                                  '1px solid rgba(255,255,255,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <button
                                onClick={() => handleAddEntry(swimmer)}
                                disabled={alreadyEntered || saving}
                                style={
                                  alreadyEntered
                                    ? disabledBtnStyle
                                    : secondaryBtnStyle
                                }
                              >
                                {alreadyEntered ? 'Already Added' : 'Add'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'entries' && (
          <div style={panelStyle}>
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
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>
                  Entries for Selected Event Section
                </h2>
                <div style={{ color: '#9fb3c8' }}>
                  Quick search, filter, edit and remove entries in compact table
                  view.
                </div>
              </div>

              {filteredSelectedEventEntries.length > 0 ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={handleSelectAllEntries}
                    disabled={filteredSelectedEventEntries.length === 0}
                    style={
                      filteredSelectedEventEntries.length === 0
                        ? disabledBtnStyle
                        : secondaryBtnStyle
                    }
                  >
                    Select All Entries
                  </button>

                  <button
                    onClick={handleClearEntrySelection}
                    disabled={selectedEntryCount === 0}
                    style={
                      selectedEntryCount === 0
                        ? disabledBtnStyle
                        : secondaryBtnStyle
                    }
                  >
                    Clear Selection
                  </button>

                  <button
                    onClick={handleBulkRemoveEntries}
                    disabled={selectedEntryCount === 0 || bulkRemovingEntries}
                    style={
                      selectedEntryCount === 0 || bulkRemovingEntries
                        ? disabledBtnStyle
                        : dangerBtnStyle
                    }
                  >
                    {bulkRemovingEntries
                      ? 'Removing...'
                      : `Remove Selected (${selectedEntryCount})`}
                  </button>
                </div>
              ) : null}
            </div>

            {!activeMeetId ? (
              <p style={{ color: '#ffd6d3', marginTop: 16 }}>
                Please select an active meet first from the Meets page.
              </p>
            ) : !selectedEvent ? (
              <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                Please select an event first.
              </p>
            ) : selectedEventEntries.length === 0 ? (
              <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                No swimmers entered in this event yet.
              </p>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'minmax(260px, 1fr) minmax(220px, 280px)',
                    gap: 14,
                    marginTop: 16,
                  }}
                >
                  <div>
                    <label style={labelStyle}>Search Swimmer</label>
                    <input
                      value={entriesSearchTerm}
                      onChange={(e) => setEntriesSearchTerm(e.target.value)}
                      placeholder="Search by swimmer, team, category, status..."
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Filter by Team</label>
                    <select
                      value={entriesTeamFilter}
                      onChange={(e) => setEntriesTeamFilter(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="">All Teams</option>
                      {allMeetEntryTeamOptions.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {filteredSelectedEventEntries.length === 0 ? (
                  <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                    No entries found for your filter/search.
                  </p>
                ) : (
                  <div
                    style={{
                      marginTop: 16,
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      overflow: 'hidden',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div
                      style={{
                        maxHeight: 440,
                        overflow: 'auto',
                      }}
                    >
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          minWidth: 1080,
                        }}
                      >
                        <thead
                          style={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            background: '#132238',
                          }}
                        >
                          <tr>
                            {[
                              'Select',
                              'Swimmer',
                              'Team',
                              'Gender',
                              'Category',
                              'Seed Time',
                              'Status',
                              'Action',
                            ].map((head) => (
                              <th
                                key={head}
                                style={{
                                  textAlign: 'left',
                                  padding: '12px 14px',
                                  fontSize: 13,
                                  color: '#f1d67a',
                                  borderBottom:
                                    '1px solid rgba(255,255,255,0.08)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {head}
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          {filteredSelectedEventEntries.map((entry, index) => {
                            const isSelected = selectedEntryIds.includes(
                              entry.id
                            );
                            const isEditing = editingEntryId === entry.id;
                            const resolvedEntryTeamName = resolveTeamName({
                              teamId: entry.teamId,
                              teamName: entry.teamName,
                            });

                            return (
                              <tr
                                key={entry.id}
                                style={{
                                  background:
                                    index % 2 === 0
                                      ? 'rgba(255,255,255,0.02)'
                                      : 'rgba(255,255,255,0.05)',
                                }}
                              >
                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() =>
                                      toggleEntrySelection(entry.id)
                                    }
                                    style={{ transform: 'scale(1.1)' }}
                                  />
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {entry.swimmerName || 'Unnamed Swimmer'}
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {resolvedEntryTeamName}
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {entry.gender || '—'}
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {entry.ageGroup || '—'}
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    minWidth: 170,
                                  }}
                                >
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={formatSwimTimeFromDigits(
                                        editEntrySeedDigits
                                      )}
                                      readOnly
                                      onKeyDown={handleEditEntrySeedKeyDown}
                                      onPaste={(e) => {
                                        e.preventDefault();
                                        const pastedText =
                                          e.clipboardData.getData('text');
                                        setEditEntrySeedDigits(
                                          digitsOnly(pastedText)
                                        );
                                      }}
                                      inputMode="numeric"
                                      placeholder="Enter digits"
                                      style={inputStyle}
                                    />
                                  ) : (
                                    entry.laneSeedTime || '—'
                                  )}
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    minWidth: 150,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {isEditing ? (
                                    <select
                                      value={editEntryStatus}
                                      onChange={(e) =>
                                        setEditEntryStatus(e.target.value)
                                      }
                                      style={inputStyle}
                                    >
                                      <option value="Entered">Entered</option>
                                      <option value="Pending">Pending</option>
                                      <option value="Confirmed">
                                        Confirmed
                                      </option>
                                      <option value="Scratch">Scratch</option>
                                    </select>
                                  ) : (
                                    <span
                                      style={{
                                        display: 'inline-block',
                                        padding: '6px 10px',
                                        borderRadius: 999,
                                        background:
                                          String(
                                            entry.status || 'Entered'
                                          ).toLowerCase() === 'scratch'
                                            ? 'rgba(217,83,79,0.16)'
                                            : 'rgba(46,175,109,0.16)',
                                        border:
                                          String(
                                            entry.status || 'Entered'
                                          ).toLowerCase() === 'scratch'
                                            ? '1px solid rgba(217,83,79,0.35)'
                                            : '1px solid rgba(46,175,109,0.35)',
                                        color:
                                          String(
                                            entry.status || 'Entered'
                                          ).toLowerCase() === 'scratch'
                                            ? '#ffd6d3'
                                            : '#d7ffe8',
                                        fontSize: 12,
                                      }}
                                    >
                                      {entry.status || 'Entered'}
                                    </span>
                                  )}
                                </td>

                                <td
                                  style={{
                                    padding: '12px 14px',
                                    borderBottom:
                                      '1px solid rgba(255,255,255,0.06)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {isEditing ? (
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: 8,
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <button
                                        onClick={() =>
                                          handleSaveEntryUpdate(entry)
                                        }
                                        disabled={updatingEntryId === entry.id}
                                        style={primaryBtnStyle}
                                      >
                                        {updatingEntryId === entry.id
                                          ? 'Saving...'
                                          : 'Save'}
                                      </button>

                                      <button
                                        onClick={handleCancelEditEntry}
                                        style={secondaryBtnStyle}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: 8,
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <button
                                        onClick={() =>
                                          handleStartEditEntry(entry)
                                        }
                                        style={secondaryBtnStyle}
                                      >
                                        Edit
                                      </button>

                                      <button
                                        onClick={() => handleRemoveEntry(entry)}
                                        style={dangerBtnStyle}
                                      >
                                        Remove
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
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'importExport' && (
          <div style={panelStyle}>
            <div
              style={{
                display: 'grid',
                gap: 20,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: 18,
                }}
              >
                <div style={subPanelStyle}>
                  <h2 style={{ marginTop: 0, marginBottom: 8 }}>
                    Export Entries by Team
                  </h2>
                  <div style={{ color: '#9fb3c8', marginBottom: 14 }}>
                    Export all entries across the active meet for the selected
                    teams. Leave all teams unchecked to export every entry in
                    the meet.
                  </div>

                  {allMeetEntryTeamOptions.length === 0 ? (
                    <div style={{ color: '#9fb3c8' }}>
                      No teams available for export in this meet yet.
                    </div>
                  ) : (
                    <>
                      <div
                        style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
                      >
                        <button
                          type="button"
                          onClick={handleSelectAllExportTeams}
                          style={secondaryBtnStyle}
                        >
                          Select All Teams
                        </button>

                        <button
                          type="button"
                          onClick={handleClearExportTeams}
                          style={secondaryBtnStyle}
                        >
                          Clear Teams
                        </button>

                        <button
                          type="button"
                          onClick={handleExportEntries}
                          style={primaryBtnStyle}
                        >
                          Export Meet CSV ({exportableEntries.length})
                        </button>
                      </div>

                      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                        {allMeetEntryTeamOptions.map((team) => (
                          <label key={team.id} style={checkboxCardStyle}>
                            <input
                              type="checkbox"
                              checked={exportTeamIds.includes(team.id)}
                              onChange={() => toggleExportTeam(team.id)}
                            />
                            <span>{team.name}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div style={subPanelStyle}>
                  <h2 style={{ marginTop: 0, marginBottom: 8 }}>
                    Import Swimmer Entries
                  </h2>
                  <div style={{ color: '#9fb3c8', marginBottom: 14 }}>
                    Import either the full team export file with event columns
                    or the simple single-event template. Full export import will
                    add swimmers into all matching events in one click.
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleDownloadImportTemplate}
                      style={secondaryBtnStyle}
                    >
                      Download Template
                    </button>

                    <label style={uploadBtnStyle}>
                      Choose Import CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleImportFileChange}
                        style={{ display: 'none' }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={handleImportConfirmedRows}
                      disabled={importReadyCount === 0 || importing}
                      style={
                        importReadyCount === 0 || importing
                          ? disabledBtnStyle
                          : primaryBtnStyle
                      }
                    >
                      {importing
                        ? 'Importing...'
                        : `Import Ready Rows (${importReadyCount})`}
                    </button>
                  </div>

                  <div style={{ marginTop: 14, color: '#dbe7f3' }}>
                    Selected file: {importFileName || 'No file chosen'}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: 'flex',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={infoPillStyle}>Ready: {importReadyCount}</span>
                    <span style={warnPillStyle}>Skip: {importSkipCount}</span>
                    <span style={errorPillStyle}>
                      Error: {importErrorCount}
                    </span>
                  </div>
                </div>
              </div>

              <div style={subPanelStyle}>
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>
                  Reset / Delete Entries
                </h2>
                <div style={{ color: '#9fb3c8', marginBottom: 14 }}>
                  Select one or more teams and/or events to reset/delete entries
                  across the active meet. If you select both teams and events,
                  only entries matching both selections will be removed.
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 18,
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginBottom: 12,
                      }}
                    >
                      <button
                        type="button"
                        onClick={handleSelectAllResetTeams}
                        disabled={allMeetEntryTeamOptions.length === 0}
                        style={
                          allMeetEntryTeamOptions.length === 0
                            ? disabledBtnStyle
                            : secondaryBtnStyle
                        }
                      >
                        Select All Teams
                      </button>
                      <button
                        type="button"
                        onClick={handleClearResetTeams}
                        disabled={resetTeamIds.length === 0}
                        style={
                          resetTeamIds.length === 0
                            ? disabledBtnStyle
                            : secondaryBtnStyle
                        }
                      >
                        Clear Teams
                      </button>
                    </div>

                    <div
                      style={{
                        color: '#f1d67a',
                        marginBottom: 8,
                        fontWeight: 700,
                      }}
                    >
                      Teams
                    </div>

                    {allMeetEntryTeamOptions.length === 0 ? (
                      <div style={{ color: '#9fb3c8' }}>
                        No teams available for reset/delete in this meet yet.
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gap: 10,
                          maxHeight: 240,
                          overflow: 'auto',
                          paddingRight: 4,
                        }}
                      >
                        {allMeetEntryTeamOptions.map((team) => (
                          <label key={team.id} style={checkboxCardStyle}>
                            <input
                              type="checkbox"
                              checked={resetTeamIds.includes(team.id)}
                              onChange={() => toggleResetTeam(team.id)}
                            />
                            <span>{team.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginBottom: 12,
                      }}
                    >
                      <button
                        type="button"
                        onClick={handleSelectAllResetEvents}
                        disabled={resetEventOptions.length === 0}
                        style={
                          resetEventOptions.length === 0
                            ? disabledBtnStyle
                            : secondaryBtnStyle
                        }
                      >
                        Select All Events
                      </button>
                      <button
                        type="button"
                        onClick={handleClearResetEvents}
                        disabled={resetEventIds.length === 0}
                        style={
                          resetEventIds.length === 0
                            ? disabledBtnStyle
                            : secondaryBtnStyle
                        }
                      >
                        Clear Events
                      </button>
                    </div>

                    <div
                      style={{
                        color: '#f1d67a',
                        marginBottom: 8,
                        fontWeight: 700,
                      }}
                    >
                      Events
                    </div>

                    {resetEventOptions.length === 0 ? (
                      <div style={{ color: '#9fb3c8' }}>
                        No events with entries available for reset/delete yet.
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gap: 10,
                          maxHeight: 240,
                          overflow: 'auto',
                          paddingRight: 4,
                        }}
                      >
                        {resetEventOptions.map((event) => (
                          <label key={event.id} style={checkboxCardStyle}>
                            <input
                              type="checkbox"
                              checked={resetEventIds.includes(event.id)}
                              onChange={() => toggleResetEvent(event.id)}
                            />
                            <span>{event.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <span style={errorPillStyle}>
                    Matching Entries: {resettableEntries.length}
                  </span>

                  <button
                    type="button"
                    onClick={handleResetDeleteEntries}
                    disabled={
                      (resetTeamIds.length === 0 &&
                        resetEventIds.length === 0) ||
                      resettableEntries.length === 0 ||
                      bulkResetDeletingEntries
                    }
                    style={
                      (resetTeamIds.length === 0 &&
                        resetEventIds.length === 0) ||
                      resettableEntries.length === 0 ||
                      bulkResetDeletingEntries
                        ? disabledBtnStyle
                        : dangerBtnStyle
                    }
                  >
                    {bulkResetDeletingEntries
                      ? 'Resetting / Deleting...'
                      : `Reset / Delete Entries (${resettableEntries.length})`}
                  </button>
                </div>
              </div>

              <div style={subPanelStyle}>
                <h3 style={{ marginTop: 0, marginBottom: 10 }}>
                  Import Preview
                </h3>

                {importPreviewRows.length === 0 ? (
                  <div style={{ color: '#9fb3c8' }}>
                    No import file loaded yet.
                  </div>
                ) : (
                  <div
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      overflow: 'hidden',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div style={{ maxHeight: 360, overflow: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          minWidth: 980,
                        }}
                      >
                        <thead
                          style={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            background: '#132238',
                          }}
                        >
                          <tr>
                            {[
                              'Line',
                              'Event No',
                              'Event Name',
                              'Reg No',
                              'Swimmer',
                              'Team',
                              'Seed Time',
                              'Status',
                              'Outcome',
                              'Message',
                            ].map((head) => (
                              <th
                                key={head}
                                style={{
                                  textAlign: 'left',
                                  padding: '12px 14px',
                                  fontSize: 13,
                                  color: '#f1d67a',
                                  borderBottom:
                                    '1px solid rgba(255,255,255,0.08)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {head}
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          {importPreviewRows.map((row) => (
                            <tr
                              key={`${row.lineNo}-${row.regNo}-${row.swimmerName}`}
                            >
                              <td style={tableTdStyle}>{row.lineNo}</td>
                              <td style={tableTdStyle}>
                                {row.eventNumber || '—'}
                              </td>
                              <td style={tableTdStyle}>
                                {row.eventName || '—'}
                              </td>
                              <td style={tableTdStyle}>{row.regNo || '—'}</td>
                              <td style={tableTdStyle}>
                                {row.swimmerName || '—'}
                              </td>
                              <td style={tableTdStyle}>
                                {row.teamName || '—'}
                              </td>
                              <td style={tableTdStyle}>
                                {row.laneSeedTime || '—'}
                              </td>
                              <td style={tableTdStyle}>{row.status || '—'}</td>
                              <td style={tableTdStyle}>
                                <span
                                  style={{
                                    ...previewBadgeBaseStyle,
                                    ...(row.outcome === 'ready'
                                      ? previewReadyStyle
                                      : row.outcome === 'skip'
                                      ? previewSkipStyle
                                      : previewErrorStyle),
                                  }}
                                >
                                  {row.outcome.toUpperCase()}
                                </span>
                              </td>
                              <td style={tableTdStyle}>{row.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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

const subPanelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  padding: 18,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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

const dangerBtnStyle: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(217,83,79,0.35)',
  background: 'rgba(217,83,79,0.16)',
  color: '#ffd6d3',
  fontWeight: 700,
  cursor: 'pointer',
};

const uploadBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px dashed rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.05)',
  color: 'white',
  fontWeight: 700,
  cursor: 'pointer',
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
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
  marginTop: 20,
};

const tabBtnStyle: React.CSSProperties = {
  padding: '14px 16px',
  borderRadius: 14,
  border: 'none',
  color: 'white',
  fontWeight: 800,
  cursor: 'pointer',
  fontSize: 14,
};

const inactiveTabStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  color: '#c7d5e4',
};

const activeEligibleTabStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #178f5a 0%, #2eaf6d 100%)',
  boxShadow: '0 10px 24px rgba(46,175,109,0.24)',
};

const activeEntriesTabStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #d4af37 0%, #f1d67a 100%)',
  color: '#071426',
  boxShadow: '0 10px 24px rgba(212,175,55,0.24)',
};

const activeImportExportTabStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0f63b6 0%, #3e8de0 100%)',
  boxShadow: '0 10px 24px rgba(15,99,182,0.24)',
};

const checkboxCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const infoPillStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(46,175,109,0.16)',
  border: '1px solid rgba(46,175,109,0.35)',
  color: '#d7ffe8',
  fontSize: 12,
  fontWeight: 700,
};

const warnPillStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(212,175,55,0.18)',
  border: '1px solid rgba(212,175,55,0.35)',
  color: '#f3d97b',
  fontSize: 12,
  fontWeight: 700,
};

const errorPillStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(217,83,79,0.16)',
  border: '1px solid rgba(217,83,79,0.35)',
  color: '#ffd6d3',
  fontSize: 12,
  fontWeight: 700,
};

const tableTdStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  whiteSpace: 'nowrap',
};

const previewBadgeBaseStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
};

const previewReadyStyle: React.CSSProperties = {
  background: 'rgba(46,175,109,0.16)',
  border: '1px solid rgba(46,175,109,0.35)',
  color: '#d7ffe8',
};

const previewSkipStyle: React.CSSProperties = {
  background: 'rgba(212,175,55,0.18)',
  border: '1px solid rgba(212,175,55,0.35)',
  color: '#f3d97b',
};

const previewErrorStyle: React.CSSProperties = {
  background: 'rgba(217,83,79,0.16)',
  border: '1px solid rgba(217,83,79,0.35)',
  color: '#ffd6d3',
};
