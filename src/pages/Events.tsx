import { useEffect, useMemo, useRef, useState } from 'react';
import {
  push,
  ref,
  set,
  onValue,
  update,
  remove,
  get,
} from 'firebase/database';
import { auth } from '../firebase/auth.js';
import { db } from '../firebase/db.js';
import AppShell from '../components/AppShell';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  laneCount?: number;
  settings?: {
    categories?: Record<string, string>;
  };
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
  recordTime?: string;
  recordHolder?: string;
  recordYear?: string | number;
  createdAt?: number;
  createdBy?: string;
};

type CsvImportRow = {
  eventNumber: string;
  distance: string;
  stroke: string;
  gender: string;
  ageGroup: string;
  eventType: string;
  round: string;
  qualifiesToEventNumber: string;
  qualifyCount: string;
  active: string;
  recordTime: string;
  recordHolder: string;
  recordYear: string;
};

const strokeOptions = [
  'Freestyle',
  'Backstroke',
  'Breaststroke',
  'Butterfly',
  'Individual Medley',
  'Medley Relay',
  'Freestyle Relay',
];

const genderOptions = ['Boys', 'Girls', 'Mixed'];
const eventTypeOptions = ['Individual', 'Relay'];
const roundOptions: EventRound[] = ['Heats', 'Final', 'Timed Final'];

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result.map((value) => value.replace(/^"(.*)"$/, '$1').trim());
}

function toCsvValue(value: string | number | boolean | null | undefined) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function normalizeRecordTimeInput(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';

  const cleaned = text.replace(/\s+/g, '');
  const mmss = cleaned.match(/^(\d{1,2}):(\d{2})\.(\d{2})$/);
  if (mmss) {
    const mm = mmss[1].padStart(2, '0');
    return `${mm}:${mmss[2]}.${mmss[3]}`;
  }

  const ss = cleaned.match(/^(\d{1,2})\.(\d{2})$/);
  if (ss) {
    return `00:${ss[1].padStart(2, '0')}.${ss[2]}`;
  }

  return cleaned;
}

function formatSwimTimeFromDigits(value: string) {
  const digits = String(value || '')
    .replace(/\D/g, '')
    .slice(-6);
  if (!digits) return '';

  const padded = digits.padStart(6, '0');
  const minutes = padded.slice(0, 2);
  const seconds = padded.slice(2, 4);
  const hundredths = padded.slice(4, 6);

  return `${minutes}:${seconds}.${hundredths}`;
}

export default function Events() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);
  const [meetCategories, setMeetCategories] = useState<string[]>([]);

  const [eventNumber, setEventNumber] = useState('');
  const [distance, setDistance] = useState('');
  const [stroke, setStroke] = useState('Freestyle');
  const [gender, setGender] = useState('Boys');
  const [ageGroup, setAgeGroup] = useState('');
  const [eventType, setEventType] = useState('Individual');
  const [round, setRound] = useState<EventRound>('Heats');
  const [qualifiesToEventId, setQualifiesToEventId] = useState('');
  const [qualifyCount, setQualifyCount] = useState('');
  const [active, setActive] = useState(true);
  const [recordTimeDigits, setRecordTimeDigits] = useState('');
  const [recordHolder, setRecordHolder] = useState('');
  const [recordYear, setRecordYear] = useState('');

  const [events, setEvents] = useState<EventRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [editingEventId, setEditingEventId] = useState('');
  const [editEventNumber, setEditEventNumber] = useState('');
  const [editDistance, setEditDistance] = useState('');
  const [editStroke, setEditStroke] = useState('Freestyle');
  const [editGender, setEditGender] = useState('Boys');
  const [editAgeGroup, setEditAgeGroup] = useState('');
  const [editEventType, setEditEventType] = useState('Individual');
  const [editRound, setEditRound] = useState<EventRound>('Heats');
  const [editQualifiesToEventId, setEditQualifiesToEventId] = useState('');
  const [editQualifyCount, setEditQualifyCount] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editRecordTimeDigits, setEditRecordTimeDigits] = useState('');
  const [editRecordHolder, setEditRecordHolder] = useState('');
  const [editRecordYear, setEditRecordYear] = useState('');
  const [updatingEventId, setUpdatingEventId] = useState('');

  const recordTime = formatSwimTimeFromDigits(recordTimeDigits);
  const editRecordTime = formatSwimTimeFromDigits(editRecordTimeDigits);

  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const [filterDistance, setFilterDistance] = useState('');
  const [filterStroke, setFilterStroke] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterAgeGroup, setFilterAgeGroup] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const meetLaneCount = Number(activeMeet?.laneCount || 0);

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const numA = Number(a.eventNumber || 0);
      const numB = Number(b.eventNumber || 0);

      if (numA !== numB) return numA - numB;

      const roundOrder = (value?: string) => {
        if (value === 'Heats') return 1;
        if (value === 'Final') return 2;
        if (value === 'Timed Final') return 3;
        return 99;
      };

      const roundDiff = roundOrder(a.round) - roundOrder(b.round);
      if (roundDiff !== 0) return roundDiff;

      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [events]);

  const distanceOptions = useMemo(() => {
    return Array.from(
      new Set(
        events
          .map((event) => String(event.distance || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => Number(a) - Number(b));
  }, [events]);

  const strokeFilterOptions = useMemo(() => {
    return Array.from(
      new Set(
        events.map((event) => String(event.stroke || '').trim()).filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const genderFilterOptions = useMemo(() => {
    return Array.from(
      new Set(
        events.map((event) => String(event.gender || '').trim()).filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const ageGroupFilterOptions = useMemo(() => {
    return Array.from(
      new Set(
        events
          .map((event) => String(event.ageGroup || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const filteredEvents = useMemo(() => {
    return sortedEvents.filter((event) => {
      if (
        filterDistance &&
        String(event.distance || '').trim() !== filterDistance
      ) {
        return false;
      }
      if (filterStroke && String(event.stroke || '').trim() !== filterStroke) {
        return false;
      }
      if (filterGender && String(event.gender || '').trim() !== filterGender) {
        return false;
      }
      if (
        filterAgeGroup &&
        String(event.ageGroup || '').trim() !== filterAgeGroup
      ) {
        return false;
      }
      return true;
    });
  }, [
    sortedEvents,
    filterDistance,
    filterStroke,
    filterGender,
    filterAgeGroup,
  ]);

  const finalEventOptions = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false && event.round === 'Final')
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const allVisibleSelected =
    filteredEvents.length > 0 &&
    filteredEvents.every((event) => selectedEventIds.includes(event.id));

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
      setMeetCategories([]);
      setAgeGroup('');
      setEditAgeGroup('');
      return;
    }

    const meetRef = ref(db, `meets/${activeMeetId}`);

    const unsub = onValue(meetRef, (snap) => {
      if (!snap.exists()) {
        setActiveMeet(null);
        setMeetCategories([]);
        setAgeGroup('');
        setEditAgeGroup('');
        return;
      }

      const meetData = snap.val();

      setActiveMeet({
        id: activeMeetId,
        ...meetData,
      });

      const categoriesObj = meetData?.settings?.categories || {};
      const categories = Object.values(categoriesObj).filter(
        Boolean
      ) as string[];
      setMeetCategories(categories);

      setAgeGroup((prev) => {
        if (prev && categories.includes(prev)) return prev;
        return categories[0] || '';
      });

      setEditAgeGroup((prev) => {
        if (prev && categories.includes(prev)) return prev;
        return categories[0] || '';
      });
    });

    return () => unsub();
  }, [activeMeetId]);

  useEffect(() => {
    if (!activeMeetId) {
      setEvents([]);
      setSelectedEventIds([]);
      return;
    }

    const eventsRef = ref(db, `meets/${activeMeetId}/events`);

    const unsub = onValue(eventsRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setEvents([]);
        setSelectedEventIds([]);
        return;
      }

      const rows: EventRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      setEvents(rows);
      setSelectedEventIds((prev) =>
        prev.filter((id) => rows.some((r) => r.id === id))
      );
    });

    return () => unsub();
  }, [activeMeetId]);

  useEffect(() => {
    if (round === 'Heats') {
      if (!qualifyCount && meetLaneCount > 0) {
        setQualifyCount(String(meetLaneCount));
      }
    } else {
      setQualifiesToEventId('');
      setQualifyCount('');
    }
  }, [round, meetLaneCount, qualifyCount]);

  useEffect(() => {
    if (editRound === 'Heats') {
      if (!editQualifyCount && meetLaneCount > 0) {
        setEditQualifyCount(String(meetLaneCount));
      }
    } else {
      setEditQualifiesToEventId('');
      setEditQualifyCount('');
    }
  }, [editRound, meetLaneCount, editQualifyCount]);

  const buildEventName = (
    distanceValue: string,
    strokeValue: string,
    genderValue: string,
    ageGroupValue: string,
    eventTypeValue: string,
    roundValue: EventRound
  ) => {
    const relayLabel = eventTypeValue === 'Relay' ? ' Relay' : '';
    return `${distanceValue}m ${strokeValue}${relayLabel} - ${genderValue} - ${ageGroupValue} - ${roundValue}`;
  };

  const getEventDisplayLabel = (event: EventRow) => {
    return `Event ${event.eventNumber || '—'} • ${
      event.name || 'Unnamed Event'
    }`;
  };

  const resetForm = () => {
    setEventNumber('');
    setDistance('');
    setStroke('Freestyle');
    setGender('Boys');
    setAgeGroup(meetCategories[0] || '');
    setEventType('Individual');
    setRound('Heats');
    setQualifiesToEventId('');
    setQualifyCount(meetLaneCount > 0 ? String(meetLaneCount) : '');
    setActive(true);
    setRecordTimeDigits('');
    setRecordHolder('');
    setRecordYear('');
  };

  const validateHeatsFields = (
    currentRound: EventRound,
    currentQualifiesToEventId: string,
    currentQualifyCount: string
  ) => {
    if (currentRound !== 'Heats') return null;

    if (!currentQualifiesToEventId.trim()) {
      return 'Please select the Final event this Heats event qualifies to';
    }

    if (!currentQualifyCount.trim()) {
      return 'Please enter qualify count';
    }

    const parsed = Number(currentQualifyCount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 'Qualify count must be a valid number greater than 0';
    }

    return null;
  };

  const handleSaveEvent = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!eventNumber.trim()) {
      setMsg('Please enter event number');
      return;
    }

    if (!distance.trim()) {
      setMsg('Please enter distance');
      return;
    }

    if (!ageGroup.trim()) {
      setMsg('Please select category / age group');
      return;
    }

    const heatsValidation = validateHeatsFields(
      round,
      qualifiesToEventId,
      qualifyCount
    );
    if (heatsValidation) {
      setMsg(heatsValidation);
      return;
    }

    const duplicateEventNumber = events.find(
      (event) => String(event.eventNumber || '') === eventNumber.trim()
    );

    if (duplicateEventNumber) {
      setMsg(
        'An event with this event number already exists in the active meet'
      );
      return;
    }

    const name = buildEventName(
      distance.trim(),
      stroke,
      gender,
      ageGroup,
      eventType,
      round
    );

    const duplicateName = events.find(
      (event) =>
        String(event.name || '')
          .trim()
          .toLowerCase() === name.trim().toLowerCase()
    );

    if (duplicateName) {
      setMsg('This event already exists in the active meet');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setSaving(true);
    setMsg('Saving event...');

    try {
      const newEventRef = push(ref(db, `meets/${activeMeetId}/events`));

      await set(newEventRef, {
        eventNumber: Number(eventNumber),
        distance: distance.trim(),
        stroke,
        gender,
        ageGroup,
        eventType,
        round,
        qualifiesToEventId: round === 'Heats' ? qualifiesToEventId : '',
        qualifyCount: round === 'Heats' ? Number(qualifyCount) : 0,
        relay: eventType === 'Relay',
        name,
        active,
        recordTime: recordTime || '',
        recordHolder: recordHolder.trim(),
        recordYear: recordYear.trim(),
        createdAt: Date.now(),
        createdBy: user.uid,
      });

      setMsg('Event saved successfully');
      resetForm();
    } catch (error: any) {
      setMsg(error.message || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (event: EventRow) => {
    setEditingEventId(event.id);
    setEditEventNumber(String(event.eventNumber || ''));
    setEditDistance(String(event.distance || ''));
    setEditStroke(String(event.stroke || 'Freestyle'));
    setEditGender(String(event.gender || 'Boys'));
    setEditAgeGroup(String(event.ageGroup || meetCategories[0] || ''));
    setEditEventType(String(event.eventType || 'Individual'));
    setEditRound((event.round as EventRound) || 'Heats');
    setEditQualifiesToEventId(String(event.qualifiesToEventId || ''));
    setEditQualifyCount(
      event.round === 'Heats'
        ? String(event.qualifyCount || meetLaneCount || '')
        : ''
    );
    setEditActive(event.active !== false);
    setEditRecordTimeDigits(
      String(event.recordTime || '')
        .replace(/\D/g, '')
        .slice(-6)
    );
    setEditRecordHolder(String(event.recordHolder || ''));
    setEditRecordYear(String(event.recordYear || ''));
  };

  const handleCancelEdit = () => {
    setEditingEventId('');
    setEditEventNumber('');
    setEditDistance('');
    setEditStroke('Freestyle');
    setEditGender('Boys');
    setEditAgeGroup('');
    setEditEventType('Individual');
    setEditRound('Heats');
    setEditQualifiesToEventId('');
    setEditQualifyCount('');
    setEditActive(true);
    setEditRecordTimeDigits('');
    setEditRecordHolder('');
    setEditRecordYear('');
  };

  const handleUpdateEvent = async (eventId: string) => {
    if (!editEventNumber.trim()) {
      setMsg('Please enter event number');
      return;
    }

    if (!editDistance.trim()) {
      setMsg('Please enter distance');
      return;
    }

    if (!editAgeGroup.trim()) {
      setMsg('Please select category / age group');
      return;
    }

    const heatsValidation = validateHeatsFields(
      editRound,
      editQualifiesToEventId,
      editQualifyCount
    );
    if (heatsValidation) {
      setMsg(heatsValidation);
      return;
    }

    const duplicateEventNumber = events.find(
      (event) =>
        event.id !== eventId &&
        String(event.eventNumber || '') === editEventNumber.trim()
    );

    if (duplicateEventNumber) {
      setMsg('Another event with this event number already exists');
      return;
    }

    const name = buildEventName(
      editDistance.trim(),
      editStroke,
      editGender,
      editAgeGroup,
      editEventType,
      editRound
    );

    const duplicateName = events.find(
      (event) =>
        event.id !== eventId &&
        String(event.name || '')
          .trim()
          .toLowerCase() === name.trim().toLowerCase()
    );

    if (duplicateName) {
      setMsg('Another event with the same setup already exists');
      return;
    }

    setUpdatingEventId(eventId);
    setMsg('Updating event...');

    try {
      await update(ref(db, `meets/${activeMeetId}/events/${eventId}`), {
        eventNumber: Number(editEventNumber),
        distance: editDistance.trim(),
        stroke: editStroke,
        gender: editGender,
        ageGroup: editAgeGroup,
        eventType: editEventType,
        round: editRound,
        qualifiesToEventId: editRound === 'Heats' ? editQualifiesToEventId : '',
        qualifyCount: editRound === 'Heats' ? Number(editQualifyCount) : 0,
        relay: editEventType === 'Relay',
        name,
        active: editActive,
        recordTime: editRecordTime || '',
        recordHolder: editRecordHolder.trim(),
        recordYear: editRecordYear.trim(),
      });

      setMsg('Event updated successfully');
      handleCancelEdit();
    } catch (error: any) {
      setMsg(error.message || 'Failed to update event');
    } finally {
      setUpdatingEventId('');
    }
  };

  const handleToggleEventActive = async (event: EventRow) => {
    try {
      const nextValue = !event.active;
      await update(ref(db, `meets/${activeMeetId}/events/${event.id}`), {
        active: nextValue,
      });
      setMsg(nextValue ? 'Event activated' : 'Event marked inactive');
    } catch (error: any) {
      setMsg(error.message || 'Failed to update event status');
    }
  };

  const handleDeleteEvent = async (event: EventRow) => {
    const ok = window.confirm(
      `Delete event "${event.name || 'Unnamed Event'}"?`
    );
    if (!ok) return;

    try {
      await remove(ref(db, `meets/${activeMeetId}/events/${event.id}`));
      setMsg('Event deleted successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete event');
    }
  };

  const toggleSelectEvent = (eventId: string) => {
    setSelectedEventIds((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
  };

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      const filteredIds = new Set(filteredEvents.map((event) => event.id));
      setSelectedEventIds((prev) => prev.filter((id) => !filteredIds.has(id)));
    } else {
      setSelectedEventIds((prev) => {
        const merged = new Set(prev);
        filteredEvents.forEach((event) => merged.add(event.id));
        return Array.from(merged);
      });
    }
  };

  const handleBulkActivate = async () => {
    if (!selectedEventIds.length) {
      setMsg('Please select at least one event');
      return;
    }

    try {
      await Promise.all(
        selectedEventIds.map((eventId) =>
          update(ref(db, `meets/${activeMeetId}/events/${eventId}`), {
            active: true,
          })
        )
      );
      setMsg('Selected events activated');
      setSelectedEventIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to activate selected events');
    }
  };

  const handleBulkInactive = async () => {
    if (!selectedEventIds.length) {
      setMsg('Please select at least one event');
      return;
    }

    try {
      await Promise.all(
        selectedEventIds.map((eventId) =>
          update(ref(db, `meets/${activeMeetId}/events/${eventId}`), {
            active: false,
          })
        )
      );
      setMsg('Selected events marked inactive');
      setSelectedEventIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to update selected events');
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedEventIds.length) {
      setMsg('Please select at least one event');
      return;
    }

    const ok = window.confirm(
      `Delete ${selectedEventIds.length} selected event(s)?`
    );
    if (!ok) return;

    try {
      await Promise.all(
        selectedEventIds.map((eventId) =>
          remove(ref(db, `meets/${activeMeetId}/events/${eventId}`))
        )
      );
      setSelectedEventIds([]);
      setMsg('Selected events deleted successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete selected events');
    }
  };

  const handleDownloadTemplate = () => {
    const sampleRows = [
      [
        'Event Number',
        'Distance',
        'Stroke',
        'Gender',
        'Category',
        'Event Type',
        'Round',
        'Qualifies To Event Number',
        'Qualify Count',
        'Active',
        'Record Time',
        'Record Holder',
        'Record Year',
      ],
      [
        '1',
        '50',
        'Freestyle',
        'Boys',
        'U11',
        'Individual',
        'Heats',
        '8',
        '6',
        'TRUE',
        '00:35.42',
        'Aarav Singh',
        '2025',
      ],
      [
        '2',
        '50',
        'Backstroke',
        'Girls',
        'U11',
        'Individual',
        'Timed Final',
        '',
        '0',
        'TRUE',
        '00:39.18',
        'Anaya Kapoor',
        '2024',
      ],
      [
        '8',
        '50',
        'Freestyle',
        'Boys',
        'U11',
        'Individual',
        'Final',
        '',
        '0',
        'TRUE',
        '00:35.42',
        'Aarav Singh',
        '2025',
      ],
      [''],
      ['Allowed Stroke Values', strokeOptions.join(' | ')],
      ['Allowed Gender Values', genderOptions.join(' | ')],
      ['Allowed Event Type Values', eventTypeOptions.join(' | ')],
      ['Allowed Round Values', roundOptions.join(' | ')],
      ['Rule', 'Record Time format example: 00:35.42 or 35.42'],
      [
        'Rule',
        'If Round = Heats, fill Qualifies To Event Number with the matching Final Event Number',
      ],
      [
        'Rule',
        `If Round = Heats, Qualify Count is usually lane count (${
          meetLaneCount || 'set meet lane count'
        })`,
      ],
    ];

    const csv = sampleRows
      .map((row) => row.map(toCsvValue).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'events_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);

    setMsg('Event import template downloaded');
  };

  const handleClickImport = () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    setImporting(true);
    setMsg('Reading CSV...');

    try {
      const text = await file.text();
      const lines = text
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        setMsg('CSV is empty or missing data rows');
        setImporting(false);
        return;
      }

      const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const expectedHeaders = [
        'event number',
        'distance',
        'stroke',
        'gender',
        'category',
        'event type',
        'round',
        'qualifies to event number',
        'qualify count',
        'active',
        'record time',
        'record holder',
        'record year',
      ];

      const headerMap: Record<string, number> = {};
      header.forEach((h, index) => {
        headerMap[h] = index;
      });

      const missingHeaders = expectedHeaders.filter(
        (h) => headerMap[h] === undefined
      );
      if (missingHeaders.length) {
        setMsg(`Missing CSV header(s): ${missingHeaders.join(', ')}`);
        setImporting(false);
        return;
      }

      const csvRows: CsvImportRow[] = lines.slice(1).map((line) => {
        const parts = parseCsvLine(line);
        return {
          eventNumber: parts[headerMap['event number']] || '',
          distance: parts[headerMap['distance']] || '',
          stroke: parts[headerMap['stroke']] || '',
          gender: parts[headerMap['gender']] || '',
          ageGroup: parts[headerMap['category']] || '',
          eventType: parts[headerMap['event type']] || '',
          round: parts[headerMap['round']] || '',
          qualifiesToEventNumber:
            parts[headerMap['qualifies to event number']] || '',
          qualifyCount: parts[headerMap['qualify count']] || '',
          active: parts[headerMap['active']] || '',
          recordTime: parts[headerMap['record time']] || '',
          recordHolder: parts[headerMap['record holder']] || '',
          recordYear: parts[headerMap['record year']] || '',
        };
      });

      const errors: string[] = [];
      const existingEventNumbers = new Set(
        events.map((e) => String(e.eventNumber || '').trim())
      );
      const incomingEventNumbers = new Set<string>();

      csvRows.forEach((row, index) => {
        const rowNo = index + 2;
        const eventNumberText = String(row.eventNumber || '').trim();
        const distanceText = String(row.distance || '').trim();
        const strokeText = String(row.stroke || '').trim();
        const genderText = String(row.gender || '').trim();
        const ageGroupText = String(row.ageGroup || '').trim();
        const eventTypeText = String(row.eventType || '').trim();
        const roundText = String(row.round || '').trim();
        const qualifiesToText = String(row.qualifiesToEventNumber || '').trim();
        const qualifyCountText = String(row.qualifyCount || '').trim();

        if (!eventNumberText) {
          errors.push(`Row ${rowNo}: Event Number is required`);
        } else {
          if (existingEventNumbers.has(eventNumberText)) {
            errors.push(
              `Row ${rowNo}: Event Number ${eventNumberText} already exists`
            );
          }
          if (incomingEventNumbers.has(eventNumberText)) {
            errors.push(
              `Row ${rowNo}: Duplicate Event Number ${eventNumberText} in CSV`
            );
          }
          incomingEventNumbers.add(eventNumberText);
        }

        if (!distanceText) errors.push(`Row ${rowNo}: Distance is required`);
        if (!strokeOptions.includes(strokeText)) {
          errors.push(`Row ${rowNo}: Invalid Stroke "${strokeText}"`);
        }
        if (!genderOptions.includes(genderText)) {
          errors.push(`Row ${rowNo}: Invalid Gender "${genderText}"`);
        }
        if (!meetCategories.includes(ageGroupText)) {
          errors.push(
            `Row ${rowNo}: Category "${ageGroupText}" is not in active meet settings`
          );
        }
        if (!eventTypeOptions.includes(eventTypeText)) {
          errors.push(`Row ${rowNo}: Invalid Event Type "${eventTypeText}"`);
        }
        if (!roundOptions.includes(roundText as EventRound)) {
          errors.push(`Row ${rowNo}: Invalid Round "${roundText}"`);
        }

        if (roundText === 'Heats') {
          if (!qualifiesToText) {
            errors.push(
              `Row ${rowNo}: Qualifies To Event Number is required for Heats`
            );
          }
          const parsedCount = Number(qualifyCountText);
          if (
            !qualifyCountText ||
            !Number.isFinite(parsedCount) ||
            parsedCount <= 0
          ) {
            errors.push(
              `Row ${rowNo}: Qualify Count must be greater than 0 for Heats`
            );
          }
        }
      });

      if (errors.length) {
        setMsg(errors.slice(0, 8).join(' | '));
        setImporting(false);
        return;
      }

      setMsg('Importing events...');

      const user = auth.currentUser;
      if (!user) {
        setMsg('You are not logged in');
        setImporting(false);
        return;
      }

      const eventsRootRef = ref(db, `meets/${activeMeetId}/events`);
      const snapshot = await get(eventsRootRef);
      const currentEventsNode = snapshot.val() || {};
      const currentEventNumberToId = new Map<string, string>();

      Object.entries(currentEventsNode).forEach(([id, item]: any) => {
        currentEventNumberToId.set(String(item?.eventNumber || '').trim(), id);
      });

      const createdEventNumberToId = new Map<string, string>();

      for (const row of csvRows) {
        const eventNumberValue = Number(String(row.eventNumber).trim());
        const distanceValue = String(row.distance).trim();
        const strokeValue = String(row.stroke).trim();
        const genderValue = String(row.gender).trim();
        const ageGroupValue = String(row.ageGroup).trim();
        const eventTypeValue = String(row.eventType).trim();
        const roundValue = String(row.round).trim() as EventRound;
        const qualifyCountValue =
          roundValue === 'Heats' ? Number(String(row.qualifyCount).trim()) : 0;
        const activeValue = ['true', '1', 'yes', 'y'].includes(
          String(row.active).trim().toLowerCase()
        );

        const name = buildEventName(
          distanceValue,
          strokeValue,
          genderValue,
          ageGroupValue,
          eventTypeValue,
          roundValue
        );

        const newEventRef = push(eventsRootRef);

        await set(newEventRef, {
          eventNumber: eventNumberValue,
          distance: distanceValue,
          stroke: strokeValue,
          gender: genderValue,
          ageGroup: ageGroupValue,
          eventType: eventTypeValue,
          round: roundValue,
          qualifiesToEventId: '',
          qualifyCount: qualifyCountValue,
          relay: eventTypeValue === 'Relay',
          name,
          active: activeValue,
          recordTime: normalizeRecordTimeInput(row.recordTime),
          recordHolder: String(row.recordHolder || '').trim(),
          recordYear: String(row.recordYear || '').trim(),
          createdAt: Date.now(),
          createdBy: user.uid,
        });

        createdEventNumberToId.set(
          String(eventNumberValue),
          newEventRef.key as string
        );
      }

      for (const row of csvRows) {
        if (String(row.round).trim() !== 'Heats') continue;

        const sourceEventId = createdEventNumberToId.get(
          String(row.eventNumber).trim()
        );
        const targetEventNumber = String(row.qualifiesToEventNumber).trim();
        const targetEventId =
          createdEventNumberToId.get(targetEventNumber) ||
          currentEventNumberToId.get(targetEventNumber) ||
          '';

        if (!sourceEventId || !targetEventId) continue;

        await update(ref(db, `meets/${activeMeetId}/events/${sourceEventId}`), {
          qualifiesToEventId: targetEventId,
        });
      }

      setMsg(`Imported ${csvRows.length} event(s) successfully`);
    } catch (error: any) {
      setMsg(error.message || 'Failed to import events CSV');
    } finally {
      setImporting(false);
    }
  };

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'} • ${activeMeet.laneCount || '—'} lanes`;
  }, [activeMeet]);

  return (
    <AppShell>
      <div style={{ display: 'grid', gap: 20 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />

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

          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#9fb3c8', marginBottom: 8, fontSize: 13 }}>
              Categories for this meet
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {meetCategories.length > 0 ? (
                meetCategories.map((cat) => (
                  <span key={cat} style={pillStyle}>
                    {cat}
                  </span>
                ))
              ) : (
                <span style={pillStyle}>No categories found</span>
              )}
            </div>
          </div>
        </div>

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
              <h1 style={{ marginTop: 0, marginBottom: 8 }}>Create Event</h1>
              <p style={{ color: '#9fb3c8', marginTop: 0 }}>
                Create swim events for the currently active meet.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={handleDownloadTemplate}
                style={secondaryBtnStyle}
              >
                Download Event Import Template
              </button>

              <button
                onClick={handleClickImport}
                disabled={importing || !activeMeetId}
                style={primaryBtnStyle}
              >
                {importing ? 'Importing...' : 'Import Events CSV'}
              </button>
            </div>
          </div>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Event Number</label>
              <input
                value={eventNumber}
                onChange={(e) => setEventNumber(e.target.value)}
                placeholder="1"
                type="number"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Distance (m)</label>
              <input
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="50"
                type="number"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Stroke</label>
              <select
                value={stroke}
                onChange={(e) => setStroke(e.target.value)}
                style={inputStyle}
              >
                {strokeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                style={inputStyle}
              >
                {genderOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Category / Age Group</label>
              <select
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                style={inputStyle}
              >
                {meetCategories.length === 0 ? (
                  <option value="">No categories found</option>
                ) : (
                  meetCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Event Type</label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                style={inputStyle}
              >
                {eventTypeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Round</label>
              <select
                value={round}
                onChange={(e) => setRound(e.target.value as EventRound)}
                style={inputStyle}
              >
                {roundOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            {round === 'Heats' ? (
              <>
                <div>
                  <label style={labelStyle}>Qualifies To Final Event</label>
                  <select
                    value={qualifiesToEventId}
                    onChange={(e) => setQualifiesToEventId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Select Final event</option>
                    {finalEventOptions.map((event) => (
                      <option key={event.id} value={event.id}>
                        {getEventDisplayLabel(event)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Qualify Count</label>
                  <input
                    value={qualifyCount}
                    onChange={(e) => setQualifyCount(e.target.value)}
                    type="number"
                    min={1}
                    style={inputStyle}
                  />
                  <div style={{ color: '#9fb3c8', fontSize: 12, marginTop: 6 }}>
                    Defaulted from meet lane count: {meetLaneCount || '—'}
                  </div>
                </div>
              </>
            ) : null}

            <div>
              <label style={labelStyle}>Record Time</label>
              <input
                value={recordTime}
                onChange={(e) =>
                  setRecordTimeDigits(
                    e.target.value.replace(/\D/g, '').slice(-6)
                  )
                }
                placeholder="00:35.42"
                inputMode="numeric"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Record Holder</label>
              <input
                value={recordHolder}
                onChange={(e) => setRecordHolder(e.target.value)}
                placeholder="Optional"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Record Year</label>
              <input
                value={recordYear}
                onChange={(e) => setRecordYear(e.target.value)}
                placeholder="Optional"
                style={inputStyle}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ color: '#9fb3c8', fontSize: 13, marginBottom: 6 }}>
              Event Name Preview
            </div>
            <div style={{ fontWeight: 700, color: '#fff' }}>
              {distance && ageGroup
                ? buildEventName(
                    distance,
                    stroke,
                    gender,
                    ageGroup,
                    eventType,
                    round
                  )
                : 'Complete the form to preview event name'}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              marginTop: 18,
            }}
          >
            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span>Event active</span>
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 20,
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={handleSaveEvent}
              disabled={saving || meetCategories.length === 0}
              style={primaryBtnStyle}
            >
              {saving ? 'Saving...' : 'Save Event'}
            </button>

            <button onClick={resetForm} style={secondaryBtnStyle}>
              Reset
            </button>
          </div>

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        <div style={panelStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 style={{ margin: 0 }}>Saved Events</h2>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={handleToggleSelectAll} style={secondaryBtnStyle}>
                {allVisibleSelected ? 'Clear All' : 'Select All'}
              </button>

              <button
                onClick={handleBulkActivate}
                disabled={!selectedEventIds.length}
                style={secondaryBtnStyle}
              >
                Activate Selected
              </button>

              <button
                onClick={handleBulkInactive}
                disabled={!selectedEventIds.length}
                style={secondaryBtnStyle}
              >
                Mark Inactive
              </button>

              <button
                onClick={handleBulkDelete}
                disabled={!selectedEventIds.length}
                style={dangerBtnStyle}
              >
                Delete Selected
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={labelStyle}>Distance (m)</label>
              <select
                value={filterDistance}
                onChange={(e) => setFilterDistance(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Distances</option>
                {distanceOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}m
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Stroke</label>
              <select
                value={filterStroke}
                onChange={(e) => setFilterStroke(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Strokes</option>
                {strokeFilterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Gender</label>
              <select
                value={filterGender}
                onChange={(e) => setFilterGender(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Genders</option>
                {genderFilterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Category / Age Group</label>
              <select
                value={filterAgeGroup}
                onChange={(e) => setFilterAgeGroup(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Categories</option>
                {ageGroupFilterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!activeMeetId ? (
            <p style={{ color: '#ffd6d3' }}>
              Please select an active meet first from the Meets page.
            </p>
          ) : filteredEvents.length === 0 ? (
            <p style={{ color: '#9fb3c8' }}>
              No events match the selected filters.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {filteredEvents.map((event) => {
                const isEditing = editingEventId === event.id;
                const linkedFinal = event.qualifiesToEventId
                  ? events.find((e) => e.id === event.qualifiesToEventId)
                  : null;
                const isSelected = selectedEventIds.includes(event.id);

                return (
                  <div
                    key={event.id}
                    style={{
                      border: isSelected
                        ? '1px solid rgba(212,175,55,0.45)'
                        : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: 16,
                      background: isSelected
                        ? 'rgba(212,175,55,0.08)'
                        : 'rgba(255,255,255,0.04)',
                      opacity: event.active === false ? 0.65 : 1,
                    }}
                  >
                    {!isEditing ? (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                            alignItems: 'flex-start',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              gap: 12,
                              alignItems: 'flex-start',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectEvent(event.id)}
                              style={{ marginTop: 4, transform: 'scale(1.2)' }}
                            />

                            <div>
                              <div style={{ fontSize: 18, fontWeight: 700 }}>
                                Event {event.eventNumber || '—'} •{' '}
                                {event.name || 'Unnamed Event'}
                              </div>
                              <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                                {event.eventType || '—'} •{' '}
                                {event.distance || '—'}m • {event.stroke || '—'}
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              padding: '8px 12px',
                              borderRadius: 999,
                              background:
                                event.active === false
                                  ? 'rgba(217,83,79,0.16)'
                                  : 'rgba(46,175,109,0.16)',
                              border:
                                event.active === false
                                  ? '1px solid rgba(217,83,79,0.35)'
                                  : '1px solid rgba(46,175,109,0.35)',
                              color:
                                event.active === false ? '#ffd6d3' : '#d7ffe8',
                              fontSize: 13,
                              height: 'fit-content',
                            }}
                          >
                            {event.active === false ? 'Inactive' : 'Active'}
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
                            Gender: {event.gender || '—'}
                          </span>
                          <span style={pillStyle}>
                            Category: {event.ageGroup || '—'}
                          </span>
                          <span style={pillStyle}>
                            Type: {event.eventType || '—'}
                          </span>
                          <span style={pillStyle}>
                            Round: {event.round || '—'}
                          </span>
                          {event.round === 'Heats' ? (
                            <span style={pillStyle}>
                              Qualify Count:{' '}
                              {event.qualifyCount || meetLaneCount || '—'}
                            </span>
                          ) : null}
                          <span style={pillStyle}>
                            Record: {event.recordTime || '—'}
                          </span>
                          {event.recordHolder ? (
                            <span style={pillStyle}>
                              Holder: {event.recordHolder}
                            </span>
                          ) : null}
                          {event.recordYear ? (
                            <span style={pillStyle}>
                              Year: {event.recordYear}
                            </span>
                          ) : null}
                        </div>

                        {event.round === 'Heats' ? (
                          <div
                            style={{
                              marginTop: 12,
                              color: '#9fb3c8',
                              fontSize: 13,
                            }}
                          >
                            Qualifies To:{' '}
                            <strong style={{ color: '#fff' }}>
                              {linkedFinal
                                ? getEventDisplayLabel(linkedFinal)
                                : 'Not linked'}
                            </strong>
                          </div>
                        ) : null}

                        <div
                          style={{
                            display: 'flex',
                            gap: 10,
                            flexWrap: 'wrap',
                            marginTop: 14,
                          }}
                        >
                          <button
                            onClick={() => handleStartEdit(event)}
                            style={secondaryBtnStyle}
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => handleToggleEventActive(event)}
                            style={secondaryBtnStyle}
                          >
                            {event.active === false
                              ? 'Activate'
                              : 'Mark Inactive'}
                          </button>

                          <button
                            onClick={() => handleDeleteEvent(event)}
                            style={dangerBtnStyle}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <h3 style={{ marginTop: 0 }}>Edit Event</h3>

                        <div style={gridStyle}>
                          <div>
                            <label style={labelStyle}>Event Number</label>
                            <input
                              value={editEventNumber}
                              onChange={(e) =>
                                setEditEventNumber(e.target.value)
                              }
                              type="number"
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Distance (m)</label>
                            <input
                              value={editDistance}
                              onChange={(e) => setEditDistance(e.target.value)}
                              type="number"
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Stroke</label>
                            <select
                              value={editStroke}
                              onChange={(e) => setEditStroke(e.target.value)}
                              style={inputStyle}
                            >
                              {strokeOptions.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>Gender</label>
                            <select
                              value={editGender}
                              onChange={(e) => setEditGender(e.target.value)}
                              style={inputStyle}
                            >
                              {genderOptions.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>
                              Category / Age Group
                            </label>
                            <select
                              value={editAgeGroup}
                              onChange={(e) => setEditAgeGroup(e.target.value)}
                              style={inputStyle}
                            >
                              {meetCategories.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>Event Type</label>
                            <select
                              value={editEventType}
                              onChange={(e) => setEditEventType(e.target.value)}
                              style={inputStyle}
                            >
                              {eventTypeOptions.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>Round</label>
                            <select
                              value={editRound}
                              onChange={(e) =>
                                setEditRound(e.target.value as EventRound)
                              }
                              style={inputStyle}
                            >
                              {roundOptions.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>

                          {editRound === 'Heats' ? (
                            <>
                              <div>
                                <label style={labelStyle}>
                                  Qualifies To Final Event
                                </label>
                                <select
                                  value={editQualifiesToEventId}
                                  onChange={(e) =>
                                    setEditQualifiesToEventId(e.target.value)
                                  }
                                  style={inputStyle}
                                >
                                  <option value="">Select Final event</option>
                                  {finalEventOptions
                                    .filter((e) => e.id !== event.id)
                                    .map((eventRow) => (
                                      <option
                                        key={eventRow.id}
                                        value={eventRow.id}
                                      >
                                        {getEventDisplayLabel(eventRow)}
                                      </option>
                                    ))}
                                </select>
                              </div>

                              <div>
                                <label style={labelStyle}>Qualify Count</label>
                                <input
                                  value={editQualifyCount}
                                  onChange={(e) =>
                                    setEditQualifyCount(e.target.value)
                                  }
                                  type="number"
                                  min={1}
                                  style={inputStyle}
                                />
                                <div
                                  style={{
                                    color: '#9fb3c8',
                                    fontSize: 12,
                                    marginTop: 6,
                                  }}
                                >
                                  Default from meet lane count:{' '}
                                  {meetLaneCount || '—'}
                                </div>
                              </div>
                            </>
                          ) : null}

                          <div>
                            <label style={labelStyle}>Record Time</label>
                            <input
                              value={editRecordTime}
                              onChange={(e) =>
                                setEditRecordTimeDigits(
                                  e.target.value.replace(/\D/g, '').slice(-6)
                                )
                              }
                              placeholder="00:35.42"
                              inputMode="numeric"
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Record Holder</label>
                            <input
                              value={editRecordHolder}
                              onChange={(e) =>
                                setEditRecordHolder(e.target.value)
                              }
                              placeholder="Optional"
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Record Year</label>
                            <input
                              value={editRecordYear}
                              onChange={(e) =>
                                setEditRecordYear(e.target.value)
                              }
                              placeholder="Optional"
                              style={inputStyle}
                            />
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 16,
                            padding: 14,
                            borderRadius: 14,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          <div
                            style={{
                              color: '#9fb3c8',
                              fontSize: 13,
                              marginBottom: 6,
                            }}
                          >
                            Event Name Preview
                          </div>
                          <div style={{ fontWeight: 700, color: '#fff' }}>
                            {editDistance && editAgeGroup
                              ? buildEventName(
                                  editDistance,
                                  editStroke,
                                  editGender,
                                  editAgeGroup,
                                  editEventType,
                                  editRound
                                )
                              : 'Complete the form to preview event name'}
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            gap: 18,
                            flexWrap: 'wrap',
                            marginTop: 18,
                          }}
                        >
                          <label style={checkRowStyle}>
                            <input
                              type="checkbox"
                              checked={editActive}
                              onChange={(e) => setEditActive(e.target.checked)}
                            />
                            <span>Event active</span>
                          </label>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            gap: 10,
                            flexWrap: 'wrap',
                            marginTop: 14,
                          }}
                        >
                          <button
                            onClick={() => handleUpdateEvent(event.id)}
                            disabled={updatingEventId === event.id}
                            style={primaryBtnStyle}
                          >
                            {updatingEventId === event.id
                              ? 'Updating...'
                              : 'Save Changes'}
                          </button>

                          <button
                            onClick={handleCancelEdit}
                            style={secondaryBtnStyle}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
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
  boxSizing: 'border-box',
};

const checkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: 'white',
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

const pillStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontSize: 13,
};
