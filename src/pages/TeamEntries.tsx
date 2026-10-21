import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { onValue, push, ref, remove, set, update } from 'firebase/database';
import { db } from '../firebase/db';

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
};

type TeamPinRow = {
  pin?: string;
  active?: boolean;
  submitted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
  lastSubmittedAt?: number | null;
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

type TeamReviewRow = {
  submitted?: boolean;
  submittedAt?: number | null;
  submittedByTeamId?: string;
  teamName?: string;
  totalSwimmers?: number;
  totalEntries?: number;
  eventSummary?: Record<
    string,
    {
      eventId?: string;
      eventName?: string;
      eventNumber?: number;
      swimmerCount?: number;
    }
  >;
};

type ManageMode = 'BY_NAME' | 'BY_EVENT';

type SeedStatus = 'idle' | 'edited' | 'saved';

type GuideStep = {
  id: 'workflow' | 'mode' | 'seed' | 'summary' | 'print' | 'submit';
  title: string;
  text: string;
};

const PANTHERS_LOGO =
  'https://tbspanthers.british-school.org/wp-content/uploads/2025/10/TBSPanthers-Logo-512px.png';

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'workflow',
    title: 'Workflow Menu',
    text: 'Use the left menu to move between Enter by Name, Enter by Event, and Submit & Print Entries. This is the main workflow for managers.',
  },
  {
    id: 'mode',
    title: 'Choose Entry Method',
    text: 'Enter by Name is best when working swimmer by swimmer. Enter by Event is best when filling one event at a time.',
  },
  {
    id: 'seed',
    title: 'Add Entries and Seed Time',
    text: 'Tick the checkbox to add or remove an entry. Enter the seed time using digits only, then click Save for that row.',
  },
  {
    id: 'summary',
    title: 'Review Summary',
    text: 'Open Submit & Print Entries to review all reports, then print or submit from one place.',
  },
  {
    id: 'print',
    title: 'Print Entries',
    text: 'Open Print Entries to review the team event summary, swimmer summary, and swimmer-wise entry report before printing.',
  },
  {
    id: 'submit',
    title: 'Final Confirmation',
    text: 'Submit only after checking all entries. If you make changes later, the submission status will reset to No until you submit again.',
  },
];

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

function displayGenderLabel(value?: string) {
  const v = normalizeGender(value);
  if (v === 'boys') return 'Boys';
  if (v === 'girls') return 'Girls';
  if (v === 'mixed') return 'Mixed';
  return value || '—';
}

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    meetId: params.get('meetId') || '',
    teamId: params.get('teamId') || '',
  };
}

function isFinalEvent(event: EventRow) {
  const roundText = String(event.round || '')
    .trim()
    .toLowerCase();
  if (roundText === 'timed final') return false;
  if (roundText === 'final') return true;
  if (roundText === 'heats') return false;

  const text = `${event.name || ''} ${event.eventType || ''}`.toLowerCase();

  if (text.includes('timed final')) return false;
  if (text.includes('final')) return true;

  return false;
}

function cleanEventName(name?: string) {
  let text = String(name || '').trim();
  if (!text) return 'Unnamed Event';

  text = text.replace(/\s*-\s*final\b.*$/i, '');
  text = text.replace(/\s*-\s*heat\b.*$/i, '');
  text = text.replace(/\bfinal\b/gi, '').trim();
  text = text.replace(/\bheat\b/gi, '').trim();
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\s*-\s*$/g, '').trim();

  return text || 'Unnamed Event';
}

function eventShortName(event?: EventRow | null, fallbackName?: string) {
  const distance = String(event?.distance || '').trim();
  const stroke = String(event?.stroke || '').trim();
  if (distance && stroke) return `${distance} ${stroke}`;
  return cleanEventName(fallbackName || event?.name);
}

function eventDisplayLabel(event: EventRow) {
  const base =
    event.distance && event.stroke
      ? `${String(event.distance).trim()} ${String(event.stroke).trim()}`
      : cleanEventName(event.name);

  return `${base} - ${displayGenderLabel(event.gender)} - ${
    event.ageGroup || '—'
  }`;
}

function swimmerDisplayLabel(swimmer: SwimmerRow) {
  const name =
    swimmer.fullName ||
    `${swimmer.firstName || ''} ${swimmer.lastName || ''}`.trim() ||
    'Unnamed Swimmer';

  return `${name} - ${swimmer.ageGroup || '—'} - ${displayGenderLabel(
    swimmer.gender
  )}`;
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

export default function TeamEntries() {
  const [{ meetId, teamId }, setQueryState] = useState(() => getQueryParams());

  const [meet, setMeet] = useState<MeetRow | null>(null);
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [teamPin, setTeamPin] = useState<TeamPinRow | null>(null);
  const [teamReview, setTeamReview] = useState<TeamReviewRow | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [swimmers, setSwimmers] = useState<SwimmerRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);

  const [enteredPin, setEnteredPin] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [step, setStep] = useState<'pin' | 'manage' | 'print'>('pin');

  const [pageLoading, setPageLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(
    'Loading team manager...'
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('Team Manager');
  const [modalMessage, setModalMessage] = useState('');

  const [manageMode, setManageMode] = useState<ManageMode>('BY_NAME');

  const [swimmerSearch, setSwimmerSearch] = useState('');
  const [selectedSwimmerId, setSelectedSwimmerId] = useState('');

  const [eventSearch, setEventSearch] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');

  const [printSearch, setPrintSearch] = useState('');
  const [printCategory, setPrintCategory] = useState('ALL');
  const [printGender, setPrintGender] = useState('ALL');
  const [printDistance, setPrintDistance] = useState('ALL');
  const [printStroke, setPrintStroke] = useState('ALL');
  const [inlineMessage, setInlineMessage] = useState('');

  const [seedDigitsByKey, setSeedDigitsByKey] = useState<
    Record<string, string>
  >({});
  const [seedStatusByKey, setSeedStatusByKey] = useState<
    Record<string, SeedStatus>
  >({});

  const inlineMessageTimerRef = useRef<number | null>(null);
  const [busySeedKey, setBusySeedKey] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [reportTab, setReportTab] = useState<'events' | 'swimmers' | 'details'>(
    'events'
  );

  const [themeMode, setThemeMode] = useState<'auto' | 'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'auto';
    const saved = window.localStorage.getItem('panthers-team-manager-theme');
    return saved === 'dark' || saved === 'light' || saved === 'auto'
      ? saved
      : 'auto';
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const resolvedTheme =
    themeMode === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : themeMode;
  const isDarkTheme = resolvedTheme === 'dark';
  const nextThemeMode: 'auto' | 'dark' | 'light' =
    themeMode === 'auto' ? 'dark' : themeMode === 'dark' ? 'light' : 'auto';
  const themeButtonLabel =
    themeMode === 'auto'
      ? `Theme: Auto (${isDarkTheme ? 'Dark' : 'Light'})`
      : themeMode === 'dark'
      ? 'Theme: Dark'
      : 'Theme: Light';

  const guideStorageKey = `panthers-team-guide:${meetId}:${teamId}`;

  const openModal = (title: string, message: string) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const showInlineMessage = (message: string) => {
    setInlineMessage(message);
    if (inlineMessageTimerRef.current) {
      window.clearTimeout(inlineMessageTimerRef.current);
    }
    inlineMessageTimerRef.current = window.setTimeout(() => {
      setInlineMessage('');
    }, 1800);
  };

  const openGuide = () => {
    setGuideIndex(0);
    setGuideOpen(true);
  };

  const closeGuide = () => {
    setGuideOpen(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(guideStorageKey, 'seen');
    }
  };

  const nextGuide = () => {
    if (guideIndex >= GUIDE_STEPS.length - 1) {
      closeGuide();
      return;
    }
    setGuideIndex((prev) => prev + 1);
  };

  const prevGuide = () => {
    setGuideIndex((prev) => Math.max(0, prev - 1));
  };

  const currentGuideStep = GUIDE_STEPS[guideIndex];

  const isGuideHighlight = (id: GuideStep['id']) =>
    guideOpen && currentGuideStep?.id === id;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('panthers-team-manager-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setSystemPrefersDark('matches' in event ? event.matches : media.matches);
    };

    handleChange(media);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = isDarkTheme ? 'dark' : 'light';
  }, [isDarkTheme]);

  useEffect(() => {
    return () => {
      if (inlineMessageTimerRef.current) {
        window.clearTimeout(inlineMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const syncQuery = () => setQueryState(getQueryParams());

    window.addEventListener('popstate', syncQuery);
    syncQuery();

    return () => {
      window.removeEventListener('popstate', syncQuery);
    };
  }, []);

  useEffect(() => {
    if (!meetId) {
      setMeet(null);
      return;
    }

    const meetRef = ref(db, `meets/${meetId}`);

    const unsub = onValue(meetRef, (snap) => {
      if (!snap.exists()) {
        setMeet(null);
        return;
      }

      setMeet({
        id: meetId,
        ...snap.val(),
      });
    });

    return () => unsub();
  }, [meetId]);

  useEffect(() => {
    if (!meetId || !teamId) {
      setTeam(null);
      setTeamPin(null);
      setTeamReview(null);
      setSwimmers([]);
      setEvents([]);
      setEntries([]);
      setPageLoading(false);
      return;
    }

    setPageLoading(true);
    setLoadingMessage('Loading team manager...');

    const teamRef = ref(db, `meets/${meetId}/teams/${teamId}`);
    const pinRef = ref(db, `meets/${meetId}/teamPins/${teamId}`);
    const reviewRef = ref(db, `meets/${meetId}/teamEntryReviews/${teamId}`);
    const swimmersRef = ref(db, `meets/${meetId}/swimmers`);
    const eventsRef = ref(db, `meets/${meetId}/events`);
    const entriesRef = ref(db, `meets/${meetId}/entries`);

    let gotTeam = false;
    let gotPin = false;
    let gotReview = false;
    let gotSwimmers = false;
    let gotEvents = false;
    let gotEntries = false;

    const maybeFinishLoading = () => {
      if (
        gotTeam &&
        gotPin &&
        gotReview &&
        gotSwimmers &&
        gotEvents &&
        gotEntries
      ) {
        setPageLoading(false);
      }
    };

    const unsubTeam = onValue(teamRef, (snap) => {
      if (!snap.exists()) {
        setTeam(null);
      } else {
        setTeam({
          id: teamId,
          ...snap.val(),
        });
      }
      gotTeam = true;
      maybeFinishLoading();
    });

    const unsubPin = onValue(pinRef, (snap) => {
      setTeamPin((snap.val() as TeamPinRow) || null);
      gotPin = true;
      maybeFinishLoading();
    });

    const unsubReview = onValue(reviewRef, (snap) => {
      setTeamReview((snap.val() as TeamReviewRow) || null);
      gotReview = true;
      maybeFinishLoading();
    });

    const unsubSwimmers = onValue(swimmersRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setSwimmers([]);
      } else {
        const rows: SwimmerRow[] = Object.entries(val).map(
          ([id, item]: any) => ({
            id,
            ...item,
          })
        );
        setSwimmers(rows);
      }

      gotSwimmers = true;
      maybeFinishLoading();
    });

    const unsubEvents = onValue(eventsRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setEvents([]);
      } else {
        const rows: EventRow[] = Object.entries(val).map(([id, item]: any) => ({
          id,
          ...item,
        }));

        rows.sort(
          (a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0)
        );

        setEvents(rows);
      }

      gotEvents = true;
      maybeFinishLoading();
    });

    const unsubEntries = onValue(entriesRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setEntries([]);
      } else {
        const rows: EntryRow[] = Object.entries(val).map(([id, item]: any) => ({
          id,
          ...item,
        }));
        setEntries(rows);
      }

      gotEntries = true;
      maybeFinishLoading();
    });

    return () => {
      unsubTeam();
      unsubPin();
      unsubReview();
      unsubSwimmers();
      unsubEvents();
      unsubEntries();
    };
  }, [meetId, teamId]);

  const isPinActive = !!teamPin?.pin && teamPin?.active !== false;
  const isEditable = pinVerified && isPinActive;
  const isEditLocked = !isEditable;

  const teamSwimmers = useMemo(() => {
    return swimmers
      .filter(
        (swimmer) =>
          swimmer.active !== false && String(swimmer.teamId || '') === teamId
      )
      .sort((a, b) =>
        String(
          a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim()
        ).localeCompare(
          String(
            b.fullName || `${b.firstName || ''} ${b.lastName || ''}`.trim()
          )
        )
      );
  }, [swimmers, teamId]);

  const activeEvents = useMemo(() => {
    return events
      .filter((event) => event.active !== false)
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const teamSwimmerIds = useMemo(() => {
    return new Set(teamSwimmers.map((swimmer) => swimmer.id));
  }, [teamSwimmers]);

  const activeEventIds = useMemo(() => {
    return new Set(activeEvents.map((event) => event.id));
  }, [activeEvents]);

  const teamEntries = useMemo(() => {
    return entries.filter((entry) => {
      const swimmerId = String(entry.swimmerId || '');
      const eventId = String(entry.eventId || '');
      const status = String(entry.status || '').toLowerCase();

      return (
        String(entry.teamId || '') === teamId &&
        entry.active !== false &&
        status !== 'scratch' &&
        !!swimmerId &&
        !!eventId &&
        teamSwimmerIds.has(swimmerId) &&
        activeEventIds.has(eventId)
      );
    });
  }, [entries, teamId, teamSwimmerIds, activeEventIds]);

  const eventMetaById = useMemo(() => {
    const map: Record<string, EventRow> = {};
    activeEvents.forEach((event) => {
      map[event.id] = event;
    });
    return map;
  }, [activeEvents]);

  const swimmerMetaById = useMemo(() => {
    const map: Record<string, SwimmerRow> = {};
    teamSwimmers.forEach((swimmer) => {
      map[swimmer.id] = swimmer;
    });
    return map;
  }, [teamSwimmers]);

  const teamEventSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        eventId: string;
        eventNumber: number;
        eventName: string;
        typeLabel: string;
        category: string;
        gender: string;
        distance: string;
        stroke: string;
        swimmerNames: string[];
      }
    >();

    teamEntries.forEach((entry) => {
      const eventIdKey = String(entry.eventId || '');
      if (!eventIdKey) return;

      const eventMeta = eventMetaById[eventIdKey];
      const swimmerMeta = swimmerMetaById[String(entry.swimmerId || '')];
      const swimmerName =
        swimmerMeta?.fullName || entry.swimmerName || 'Unnamed Swimmer';

      const current = map.get(eventIdKey) || {
        eventId: eventIdKey,
        eventNumber: Number(entry.eventNumber || eventMeta?.eventNumber || 0),
        eventName: eventShortName(
          eventMeta,
          entry.eventName || eventMeta?.name
        ),
        typeLabel: eventMeta?.relay ? 'Relay' : 'Individual',
        category:
          swimmerMeta?.ageGroup ||
          entry.ageGroup ||
          eventMeta?.ageGroup ||
          'Unspecified',
        gender: displayGenderLabel(
          swimmerMeta?.gender ||
            entry.gender ||
            eventMeta?.gender ||
            'Unspecified'
        ),
        distance: String(eventMeta?.distance || '').trim(),
        stroke: String(eventMeta?.stroke || '').trim(),
        swimmerNames: [],
      };

      if (!current.swimmerNames.includes(swimmerName)) {
        current.swimmerNames.push(swimmerName);
      }

      map.set(eventIdKey, current);
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        swimmerNames: [...row.swimmerNames].sort((a, b) => a.localeCompare(b)),
        swimmerCount: row.swimmerNames.length,
      }))
      .sort((a, b) => a.eventNumber - b.eventNumber);
  }, [teamEntries, eventMetaById, swimmerMetaById]);

  const swimmerSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        swimmerId: string;
        swimmerName: string;
        category: string;
        gender: string;
        individualCount: number;
        relayCount: number;
      }
    >();

    teamEntries.forEach((entry) => {
      const swimmerIdKey = String(entry.swimmerId || '');
      if (!swimmerIdKey) return;

      const swimmerMeta = swimmerMetaById[swimmerIdKey];
      const eventMeta = eventMetaById[String(entry.eventId || '')];
      const relay = !!eventMeta?.relay;

      const current = map.get(swimmerIdKey) || {
        swimmerId: swimmerIdKey,
        swimmerName:
          swimmerMeta?.fullName || entry.swimmerName || 'Unnamed Swimmer',
        category: swimmerMeta?.ageGroup || entry.ageGroup || 'Unspecified',
        gender: displayGenderLabel(
          swimmerMeta?.gender || entry.gender || 'Unspecified'
        ),
        individualCount: 0,
        relayCount: 0,
      };

      if (relay) {
        current.relayCount += 1;
      } else {
        current.individualCount += 1;
      }

      map.set(swimmerIdKey, current);
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        totalCount: row.individualCount + row.relayCount,
      }))
      .sort((a, b) => {
        const cat = String(a.category || '').localeCompare(
          String(b.category || '')
        );
        if (cat !== 0) return cat;
        const gen = normalizeGender(a.gender).localeCompare(
          normalizeGender(b.gender)
        );
        if (gen !== 0) return gen;
        return a.swimmerName.localeCompare(b.swimmerName);
      });
  }, [teamEntries, swimmerMetaById, eventMetaById]);

  const swimmerDetailGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        category: string;
        gender: string;
        swimmerId: string;
        swimmerName: string;
        individualCount: number;
        relayCount: number;
        events: Array<{
          eventId: string;
          eventNumber: number;
          eventName: string;
          typeLabel: string;
          distance: string;
          stroke: string;
        }>;
      }
    >();

    teamEntries.forEach((entry) => {
      const swimmerIdKey = String(entry.swimmerId || '');
      const eventIdKey = String(entry.eventId || '');
      if (!swimmerIdKey || !eventIdKey) return;

      const swimmerMeta = swimmerMetaById[swimmerIdKey];
      const eventMeta = eventMetaById[eventIdKey];
      const relay = !!eventMeta?.relay;
      const key = `${
        swimmerMeta?.ageGroup || entry.ageGroup || 'Unspecified'
      }__${displayGenderLabel(
        swimmerMeta?.gender || entry.gender || 'Unspecified'
      )}__${swimmerIdKey}`;

      const current = map.get(key) || {
        category: swimmerMeta?.ageGroup || entry.ageGroup || 'Unspecified',
        gender: displayGenderLabel(
          swimmerMeta?.gender || entry.gender || 'Unspecified'
        ),
        swimmerId: swimmerIdKey,
        swimmerName:
          swimmerMeta?.fullName || entry.swimmerName || 'Unnamed Swimmer',
        individualCount: 0,
        relayCount: 0,
        events: [],
      };

      if (relay) current.relayCount += 1;
      else current.individualCount += 1;

      if (!current.events.some((item) => item.eventId === eventIdKey)) {
        current.events.push({
          eventId: eventIdKey,
          eventNumber: Number(entry.eventNumber || eventMeta?.eventNumber || 0),
          eventName: eventShortName(
            eventMeta,
            entry.eventName || eventMeta?.name
          ),
          typeLabel: relay ? 'Relay' : 'Individual',
          distance: String(eventMeta?.distance || '').trim(),
          stroke: String(eventMeta?.stroke || '').trim(),
        });
      }

      map.set(key, current);
    });

    const rows = Array.from(map.values())
      .map((row) => ({
        ...row,
        totalCount: row.individualCount + row.relayCount,
        events: [...row.events].sort((a, b) => a.eventNumber - b.eventNumber),
      }))
      .sort((a, b) => {
        const cat = String(a.category || '').localeCompare(
          String(b.category || '')
        );
        if (cat !== 0) return cat;
        const gen = normalizeGender(a.gender).localeCompare(
          normalizeGender(b.gender)
        );
        if (gen !== 0) return gen;
        return a.swimmerName.localeCompare(b.swimmerName);
      });

    const grouped = new Map<
      string,
      {
        category: string;
        genders: Array<{
          gender: string;
          swimmers: typeof rows;
        }>;
      }
    >();

    rows.forEach((row) => {
      const categoryKey = row.category;
      if (!grouped.has(categoryKey)) {
        grouped.set(categoryKey, {
          category: row.category,
          genders: [],
        });
      }

      const categoryGroup = grouped.get(categoryKey)!;
      let genderGroup = categoryGroup.genders.find(
        (item) => item.gender === row.gender
      );
      if (!genderGroup) {
        genderGroup = { gender: row.gender, swimmers: [] as typeof rows };
        categoryGroup.genders.push(genderGroup);
      }
      genderGroup.swimmers.push(row);
    });

    return Array.from(grouped.values()).map((categoryGroup) => ({
      ...categoryGroup,
      genders: categoryGroup.genders.sort((a, b) =>
        normalizeGender(a.gender).localeCompare(normalizeGender(b.gender))
      ),
    }));
  }, [teamEntries, swimmerMetaById, eventMetaById]);

  const totalRelayEntries = useMemo(() => {
    return teamEntries.filter(
      (entry) => !!eventMetaById[String(entry.eventId || '')]?.relay
    ).length;
  }, [teamEntries, eventMetaById]);

  const totalIndividualEntries = useMemo(() => {
    return teamEntries.filter(
      (entry) => !eventMetaById[String(entry.eventId || '')]?.relay
    ).length;
  }, [teamEntries, eventMetaById]);

  const printCategoryOptions = useMemo(() => {
    return (
      Array.from(
        new Set(teamEventSummaryRows.map((row) => row.category).filter(Boolean))
      ) as string[]
    ).sort((a, b) => a.localeCompare(b));
  }, [teamEventSummaryRows]);

  const printGenderOptions = useMemo(() => {
    return (
      Array.from(
        new Set(teamEventSummaryRows.map((row) => row.gender).filter(Boolean))
      ) as string[]
    ).sort((a, b) => normalizeGender(a).localeCompare(normalizeGender(b)));
  }, [teamEventSummaryRows]);

  const printDistanceOptions = useMemo(() => {
    return (
      Array.from(
        new Set(teamEventSummaryRows.map((row) => row.distance).filter(Boolean))
      ) as string[]
    ).sort((a, b) => a.localeCompare(b));
  }, [teamEventSummaryRows]);

  const printStrokeOptions = useMemo(() => {
    return (
      Array.from(
        new Set(teamEventSummaryRows.map((row) => row.stroke).filter(Boolean))
      ) as string[]
    ).sort((a, b) => a.localeCompare(b));
  }, [teamEventSummaryRows]);

  const filteredTeamEventSummaryRows = useMemo(() => {
    const q = printSearch.trim().toLowerCase();
    return teamEventSummaryRows.filter((row) => {
      const matchesSearch =
        !q ||
        [
          row.eventName,
          row.swimmerNames.join(' '),
          row.category,
          row.gender,
          row.distance,
          row.stroke,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q);
      const matchesCategory =
        printCategory === 'ALL' || row.category === printCategory;
      const matchesGender = printGender === 'ALL' || row.gender === printGender;
      const matchesDistance =
        printDistance === 'ALL' || row.distance === printDistance;
      const matchesStroke = printStroke === 'ALL' || row.stroke === printStroke;
      return (
        matchesSearch &&
        matchesCategory &&
        matchesGender &&
        matchesDistance &&
        matchesStroke
      );
    });
  }, [
    teamEventSummaryRows,
    printSearch,
    printCategory,
    printGender,
    printDistance,
    printStroke,
  ]);

  const filteredSwimmerSummaryRows = useMemo(() => {
    const q = printSearch.trim().toLowerCase();
    return swimmerSummaryRows.filter((row) => {
      const matchesSearch =
        !q ||
        [row.swimmerName, row.category, row.gender]
          .join(' ')
          .toLowerCase()
          .includes(q);
      const matchesCategory =
        printCategory === 'ALL' || row.category === printCategory;
      const matchesGender = printGender === 'ALL' || row.gender === printGender;
      return matchesSearch && matchesCategory && matchesGender;
    });
  }, [swimmerSummaryRows, printSearch, printCategory, printGender]);

  const filteredSwimmerDetailGroups = useMemo(() => {
    const q = printSearch.trim().toLowerCase();

    return swimmerDetailGroups
      .map((categoryGroup) => ({
        ...categoryGroup,
        genders: categoryGroup.genders
          .map((genderGroup) => ({
            ...genderGroup,
            swimmers: genderGroup.swimmers.filter((swimmer) => {
              const matchesSearch =
                !q ||
                [
                  swimmer.swimmerName,
                  swimmer.category,
                  swimmer.gender,
                  swimmer.events.map((event) => event.eventName).join(' '),
                  swimmer.events.map((event) => event.distance).join(' '),
                  swimmer.events.map((event) => event.stroke).join(' '),
                ]
                  .join(' ')
                  .toLowerCase()
                  .includes(q);
              const matchesCategory =
                printCategory === 'ALL' || swimmer.category === printCategory;
              const matchesGender =
                printGender === 'ALL' || swimmer.gender === printGender;
              const matchesDistance =
                printDistance === 'ALL' ||
                swimmer.events.some(
                  (event) => event.distance === printDistance
                );
              const matchesStroke =
                printStroke === 'ALL' ||
                swimmer.events.some((event) => event.stroke === printStroke);

              return (
                matchesSearch &&
                matchesCategory &&
                matchesGender &&
                matchesDistance &&
                matchesStroke
              );
            }),
          }))
          .filter((genderGroup) => genderGroup.swimmers.length > 0),
      }))
      .filter((categoryGroup) => categoryGroup.genders.length > 0);
  }, [
    swimmerDetailGroups,
    printSearch,
    printCategory,
    printGender,
    printDistance,
    printStroke,
  ]);

  const resetPrintFilters = () => {
    setPrintSearch('');
    setPrintCategory('ALL');
    setPrintGender('ALL');
    setPrintDistance('ALL');
    setPrintStroke('ALL');
  };

  const entryBySwimmerEvent = useMemo(() => {
    const map: Record<string, EntryRow> = {};

    teamEntries.forEach((entry) => {
      const key = `${entry.swimmerId || ''}__${entry.eventId || ''}`;
      map[key] = entry;
    });

    return map;
  }, [teamEntries]);

  const eligibleEventsBySwimmer = useMemo(() => {
    const map: Record<string, EventRow[]> = {};

    teamSwimmers.forEach((swimmer) => {
      const swimmerGender = normalizeGender(swimmer.gender);
      const swimmerAgeGroup = normalizeAgeGroup(swimmer.ageGroup);

      map[swimmer.id] = activeEvents.filter((event) => {
        const eventGender = normalizeGender(event.gender);
        const eventAgeGroup = normalizeAgeGroup(event.ageGroup);

        const genderMatch =
          eventGender === 'mixed' ? true : swimmerGender === eventGender;
        const ageGroupMatch = swimmerAgeGroup === eventAgeGroup;

        return genderMatch && ageGroupMatch;
      });
    });

    return map;
  }, [teamSwimmers, activeEvents]);

  const eligibleSwimmersByEvent = useMemo(() => {
    const map: Record<string, SwimmerRow[]> = {};

    activeEvents.forEach((event) => {
      const eventGender = normalizeGender(event.gender);
      const eventAgeGroup = normalizeAgeGroup(event.ageGroup);

      map[event.id] = teamSwimmers.filter((swimmer) => {
        const swimmerGender = normalizeGender(swimmer.gender);
        const swimmerAgeGroup = normalizeAgeGroup(swimmer.ageGroup);

        const genderMatch =
          eventGender === 'mixed' ? true : swimmerGender === eventGender;
        const ageGroupMatch = swimmerAgeGroup === eventAgeGroup;

        return genderMatch && ageGroupMatch;
      });
    });

    return map;
  }, [activeEvents, teamSwimmers]);

  const filteredSwimmers = useMemo(() => {
    const q = swimmerSearch.trim().toLowerCase();
    if (!q) return teamSwimmers;

    return teamSwimmers.filter((swimmer) => {
      const text = [
        swimmer.fullName || '',
        swimmer.firstName || '',
        swimmer.lastName || '',
        swimmer.gender || '',
        swimmer.ageGroup || '',
      ]
        .join(' ')
        .toLowerCase();

      return text.includes(q);
    });
  }, [teamSwimmers, swimmerSearch]);

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();

    const nonFinalEvents = activeEvents.filter((event) => !isFinalEvent(event));

    if (!q) return nonFinalEvents;

    return nonFinalEvents.filter((event) => {
      const text = [eventDisplayLabel(event), String(event.eventNumber || '')]
        .join(' ')
        .toLowerCase();

      return text.includes(q);
    });
  }, [activeEvents, eventSearch]);

  useEffect(() => {
    setSelectedSwimmerId((prev) => {
      if (prev && filteredSwimmers.some((s) => s.id === prev)) return prev;
      return filteredSwimmers[0]?.id || '';
    });
  }, [filteredSwimmers]);

  useEffect(() => {
    setSelectedEventId((prev) => {
      if (prev && filteredEvents.some((e) => e.id === prev)) return prev;
      return filteredEvents[0]?.id || '';
    });
  }, [filteredEvents]);

  const selectedSwimmer = useMemo(() => {
    return teamSwimmers.find((s) => s.id === selectedSwimmerId) || null;
  }, [teamSwimmers, selectedSwimmerId]);

  const selectedEvent = useMemo(() => {
    return activeEvents.find((e) => e.id === selectedEventId) || null;
  }, [activeEvents, selectedEventId]);

  const selectedSwimmerEvents = useMemo(() => {
    if (!selectedSwimmerId) return [];
    return (eligibleEventsBySwimmer[selectedSwimmerId] || []).filter(
      (event) => !isFinalEvent(event)
    );
  }, [eligibleEventsBySwimmer, selectedSwimmerId]);

  const selectedEventSwimmers = useMemo(() => {
    if (!selectedEventId) return [];
    return eligibleSwimmersByEvent[selectedEventId] || [];
  }, [eligibleSwimmersByEvent, selectedEventId]);

  const summaryRows = useMemo(() => {
    const eventSummaryMap = new Map<
      string,
      {
        eventId: string;
        eventName: string;
        eventNumber: number;
        swimmerCount: number;
      }
    >();

    teamEntries.forEach((entry) => {
      const eventIdKey = String(entry.eventId || '');
      if (!eventIdKey) return;

      const current = eventSummaryMap.get(eventIdKey) || {
        eventId: eventIdKey,
        eventName: entry.eventName || 'Unnamed Event',
        eventNumber: Number(entry.eventNumber || 0),
        swimmerCount: 0,
      };

      current.swimmerCount += 1;
      eventSummaryMap.set(eventIdKey, current);
    });

    return Array.from(eventSummaryMap.values()).sort(
      (a, b) => a.eventNumber - b.eventNumber
    );
  }, [teamEntries]);

  const totalEntries = teamEntries.length;
  const totalSwimmers = useMemo(() => {
    const swimmerIds = new Set(
      teamEntries.map((entry) => String(entry.swimmerId || '')).filter(Boolean)
    );
    return swimmerIds.size;
  }, [teamEntries]);

  const currentEventSummaryCount = useMemo(() => {
    return summaryRows.reduce(
      (acc, row) => acc + Number(row.swimmerCount || 0),
      0
    );
  }, [summaryRows]);

  const currentReviewIsFresh = useMemo(() => {
    if (!teamReview?.submitted) return false;

    const reviewSummaryCount = Object.values(
      teamReview.eventSummary || {}
    ).reduce<number>(
      (acc, item) =>
        acc +
        Number(
          (item as { swimmerCount?: number } | undefined)?.swimmerCount || 0
        ),
      0
    );

    return (
      Number(teamReview.totalEntries || 0) === totalEntries &&
      Number(teamReview.totalSwimmers || 0) === totalSwimmers &&
      reviewSummaryCount === currentEventSummaryCount &&
      totalEntries > 0
    );
  }, [teamReview, totalEntries, totalSwimmers, currentEventSummaryCount]);

  const submittedDisplay = currentReviewIsFresh ? 'Yes' : 'No';

  const getSeedKey = (swimmerId: string, eventId: string) =>
    `${swimmerId}__${eventId}`;

  const getExistingEntry = (swimmerId: string, eventId: string) =>
    entryBySwimmerEvent[`${swimmerId}__${eventId}`];

  const getExistingSeedDigits = (swimmerId: string, eventId: string) =>
    digitsOnly(getExistingEntry(swimmerId, eventId)?.laneSeedTime || '');

  useEffect(() => {
    const nextDigits: Record<string, string> = {};
    const nextStatus: Record<string, SeedStatus> = {};

    teamEntries.forEach((entry) => {
      const swimmerId = String(entry.swimmerId || '');
      const eventId = String(entry.eventId || '');
      const key = getSeedKey(swimmerId, eventId);
      nextDigits[key] = digitsOnly(entry.laneSeedTime || '');
      nextStatus[key] = 'saved';
    });

    setSeedDigitsByKey((prev) => ({ ...prev, ...nextDigits }));
    setSeedStatusByKey((prev) => ({ ...prev, ...nextStatus }));
  }, [teamEntries]);

  const getSeedDigits = (swimmerId: string, eventId: string) => {
    const key = getSeedKey(swimmerId, eventId);
    return seedDigitsByKey[key] || '';
  };

  const getSeedDisplay = (swimmerId: string, eventId: string) => {
    return formatSwimTimeFromDigits(getSeedDigits(swimmerId, eventId));
  };

  const getSeedStatus = (swimmerId: string, eventId: string): SeedStatus => {
    const key = getSeedKey(swimmerId, eventId);
    return seedStatusByKey[key] || 'idle';
  };

  const setSeedDigits = (
    swimmerId: string,
    eventId: string,
    digits: string
  ) => {
    const key = getSeedKey(swimmerId, eventId);
    const cleanDigits = digitsOnly(digits);
    const existingDigits = getExistingSeedDigits(swimmerId, eventId);
    const nextStatus: SeedStatus =
      cleanDigits === existingDigits
        ? existingDigits
          ? 'saved'
          : 'idle'
        : 'edited';

    setSeedDigitsByKey((prev) => ({
      ...prev,
      [key]: cleanDigits,
    }));

    setSeedStatusByKey((prev) => ({
      ...prev,
      [key]: nextStatus,
    }));
  };

  const handleSeedKeyDown = (
    swimmerId: string,
    eventId: string,
    e: ReactKeyboardEvent<HTMLInputElement>
  ) => {
    const key = e.key;
    const current = getSeedDigits(swimmerId, eventId);

    if (/^\d$/.test(key)) {
      e.preventDefault();
      setSeedDigits(swimmerId, eventId, appendDigit(current, key));
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      setSeedDigits(swimmerId, eventId, removeLastDigit(current));
      return;
    }

    if (key === 'Delete') {
      e.preventDefault();
      setSeedDigits(swimmerId, eventId, '');
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

  const markReviewDirty = async () => {
    if (!meetId || !teamId) return;

    await Promise.all([
      update(ref(db, `meets/${meetId}/teamPins/${teamId}`), {
        submitted: false,
        lastSubmittedAt: null,
        updatedAt: Date.now(),
        updatedBy: `team-pin:${teamId}`,
      }),
      update(ref(db, `meets/${meetId}/teamEntryReviews/${teamId}`), {
        submitted: false,
        submittedAt: null,
        totalSwimmers: 0,
        totalEntries: 0,
        eventSummary: {},
      }),
    ]);
  };

  const handleVerifyPin = () => {
    if (!teamPin?.pin) {
      openModal(
        'No PIN',
        'This team does not have a PIN yet. Please contact the admin.'
      );
      return;
    }

    if (teamPin.active === false) {
      openModal(
        'PIN Inactive',
        'This team PIN is inactive. Please contact the admin.'
      );
      return;
    }

    if (enteredPin.trim() !== String(teamPin.pin || '').trim()) {
      openModal(
        'Invalid PIN',
        'The PIN you entered is not correct. Please try again.'
      );
      return;
    }

    setPinVerified(true);
    setStep('manage');

    if (typeof window !== 'undefined') {
      const seen = localStorage.getItem(guideStorageKey);
      if (!seen) {
        setGuideIndex(0);
        setGuideOpen(true);
      }
    }

    openModal('Access Granted', 'Team manager loaded successfully.');
  };

  const saveSeedOnlyIfExists = async (
    swimmerId: string,
    eventId: string,
    entryId?: string
  ) => {
    if (!meetId || !entryId) return;

    const seedTime = formatSwimTimeFromDigits(
      getSeedDigits(swimmerId, eventId)
    );

    await update(ref(db, `meets/${meetId}/entries/${entryId}`), {
      laneSeedTime: seedTime,
    });

    const key = getSeedKey(swimmerId, eventId);
    setSeedStatusByKey((prev) => ({
      ...prev,
      [key]: 'saved',
    }));
  };

  const toggleEntry = async (swimmer: SwimmerRow, event: EventRow) => {
    if (!isEditable) {
      openModal(
        'Editing Disabled',
        'PIN is inactive or not verified. Editing is disabled.'
      );
      return;
    }

    if (!meetId || !teamId) return;

    const existing = entryBySwimmerEvent[`${swimmer.id}__${event.id}`];

    try {
      if (existing) {
        await remove(ref(db, `meets/${meetId}/entries/${existing.id}`));

        const key = getSeedKey(swimmer.id, event.id);
        setSeedStatusByKey((prev) => ({
          ...prev,
          [key]: getSeedDigits(swimmer.id, event.id) ? 'edited' : 'idle',
        }));
      } else {
        const newEntryRef = push(ref(db, `meets/${meetId}/entries`));
        const seedTime = formatSwimTimeFromDigits(
          getSeedDigits(swimmer.id, event.id)
        );

        await set(newEntryRef, {
          swimmerId: swimmer.id,
          swimmerName:
            swimmer.fullName ||
            `${swimmer.firstName || ''} ${swimmer.lastName || ''}`.trim(),
          gender: swimmer.gender || '',
          ageGroup: swimmer.ageGroup || '',
          teamId: swimmer.teamId || teamId,
          teamName: team?.name || swimmer.teamName || swimmer.team || '',
          eventId: event.id,
          eventNumber: event.eventNumber || 0,
          eventName: event.name || '',
          laneSeedTime: seedTime,
          status: 'Entered',
          active: true,
          createdAt: Date.now(),
          createdBy: `team-pin:${teamId}`,
        });

        const key = getSeedKey(swimmer.id, event.id);
        setSeedStatusByKey((prev) => ({
          ...prev,
          [key]: 'saved',
        }));
      }

      await markReviewDirty();

      const swimmerName =
        swimmer.fullName ||
        `${swimmer.firstName || ''} ${swimmer.lastName || ''}`.trim();

      const eventLabel = eventDisplayLabel(event);

      showInlineMessage(
        existing
          ? `${swimmerName} removed from ${eventLabel}`
          : `${swimmerName} added to ${eventLabel}`
      );
    } catch (error: any) {
      openModal('Update Failed', error?.message || 'Failed to update entry.');
    }
  };

  const handleSaveSeedTime = async (swimmer: SwimmerRow, event: EventRow) => {
    if (!isEditable) {
      openModal(
        'Editing Disabled',
        'PIN is inactive or not verified. Editing is disabled.'
      );
      return;
    }

    if (!meetId || !teamId) {
      openModal('Missing Meet', 'Meet or team details are missing.');
      return;
    }

    const seedTime = formatSwimTimeFromDigits(
      getSeedDigits(swimmer.id, event.id)
    );
    if (!seedTime) {
      openModal(
        'Seed Time Required',
        'Please enter a seed time before saving.'
      );
      return;
    }

    const existing = entryBySwimmerEvent[`${swimmer.id}__${event.id}`];
    const busyKey = getSeedKey(swimmer.id, event.id);
    setBusySeedKey(busyKey);

    try {
      if (existing?.id) {
        await saveSeedOnlyIfExists(swimmer.id, event.id, existing.id);
      } else {
        const newEntryRef = push(ref(db, `meets/${meetId}/entries`));

        await set(newEntryRef, {
          swimmerId: swimmer.id,
          swimmerName:
            swimmer.fullName ||
            `${swimmer.firstName || ''} ${swimmer.lastName || ''}`.trim(),
          gender: swimmer.gender || '',
          ageGroup: swimmer.ageGroup || '',
          teamId: swimmer.teamId || teamId,
          teamName: team?.name || swimmer.teamName || swimmer.team || '',
          eventId: event.id,
          eventNumber: event.eventNumber || 0,
          eventName: event.name || '',
          laneSeedTime: seedTime,
          status: 'Entered',
          active: true,
          createdAt: Date.now(),
          createdBy: `team-pin:${teamId}`,
        });

        const key = getSeedKey(swimmer.id, event.id);
        setSeedStatusByKey((prev) => ({
          ...prev,
          [key]: 'saved',
        }));
      }

      await markReviewDirty();

      const swimmerName =
        swimmer.fullName ||
        `${swimmer.firstName || ''} ${swimmer.lastName || ''}`.trim();

      const eventLabel = eventDisplayLabel(event);

      showInlineMessage(`${swimmerName} seed time saved for ${eventLabel}`);
    } catch (error: any) {
      openModal(
        'Update Failed',
        error?.message || 'Failed to update seed time.'
      );
    } finally {
      setBusySeedKey('');
    }
  };

  const switchToByName = () => {
    setStep('manage');
    setManageMode('BY_NAME');
  };

  const switchToByEvent = () => {
    setStep('manage');
    setManageMode('BY_EVENT');
  };

  const switchToPrint = () => {
    setStep('print');
  };

  const renderPrintFilters = (
    mode: 'event' | 'swimmer' | 'detail' | 'all' = 'all'
  ) => {
    const showDistanceStroke =
      mode === 'event' || mode === 'detail' || mode === 'all';

    return (
      <div style={printFiltersGridStyle}>
        <div>
          <label style={labelStyle}>Search</label>
          <input
            value={printSearch}
            onChange={(e) => setPrintSearch(e.target.value)}
            placeholder="Search swimmer or event..."
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Category</label>
          <select
            value={printCategory}
            onChange={(e) => setPrintCategory(e.target.value)}
            style={inputStyle}
          >
            <option value="ALL">All Categories</option>
            {printCategoryOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Gender</label>
          <select
            value={printGender}
            onChange={(e) => setPrintGender(e.target.value)}
            style={inputStyle}
          >
            <option value="ALL">All Genders</option>
            {printGenderOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {showDistanceStroke ? (
          <>
            <div>
              <label style={labelStyle}>Distance</label>
              <select
                value={printDistance}
                onChange={(e) => setPrintDistance(e.target.value)}
                style={inputStyle}
              >
                <option value="ALL">All Distances</option>
                {printDistanceOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Stroke</label>
              <select
                value={printStroke}
                onChange={(e) => setPrintStroke(e.target.value)}
                style={inputStyle}
              >
                <option value="ALL">All Strokes</option>
                {printStrokeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button onClick={resetPrintFilters} style={secondaryBtnStyle}>
            Clear Filters
          </button>
        </div>
      </div>
    );
  };

  const escapePrintHtml = (value?: string | number | null) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const buildPrintShell = (title: string, bodyHtml: string) => `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${escapePrintHtml(title)}</title>
          <style>
            :root { --navy:#0b1f3a; --gold:#d4af37; --text:#14253d; --muted:#5b6b7d; --line:#d9dee5; --soft:#f6f8fb; }
            * { box-sizing:border-box; }
            body { margin:0; padding:24px; font-family:Arial, Helvetica, sans-serif; color:var(--text); background:#fff; }
            .header { display:flex; align-items:center; gap:16px; border-bottom:3px solid var(--gold); padding-bottom:16px; margin-bottom:20px; }
            .logo { width:64px; height:64px; object-fit:contain; }
            .title { font-size:26px; font-weight:800; color:var(--navy); }
            .sub { margin-top:4px; color:var(--muted); font-size:14px; }
            .section { margin-bottom:24px; page-break-inside:avoid; }
            .section-heading { font-size:20px; font-weight:800; color:var(--navy); margin:0 0 12px; }
            .stats { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; }
            .stat { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:#fff; }
            .stat-value { font-size:22px; font-weight:800; color:#b89018; }
            .stat-label { color:var(--muted); margin-top:4px; font-size:12px; text-transform:uppercase; letter-spacing:0.3px; }
            table { width:100%; border-collapse:collapse; background:#fff; }
            th, td { border-bottom:1px solid #e4e8ee; padding:10px 12px; text-align:left; font-size:13px; vertical-align:top; }
            th { color:#b89018; font-weight:800; background:#fbfcfe; }
            .category-block { margin-bottom:26px; page-break-inside:avoid; }
            .category-title { background:var(--navy); color:#fff; padding:10px 14px; border-radius:10px; font-weight:800; margin-bottom:12px; }
            .gender-block { border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:14px; page-break-inside:avoid; }
            .gender-title { font-size:18px; font-weight:800; color:var(--navy); margin-bottom:10px; }
            .swimmer-block { border:1px solid #edf1f5; border-radius:12px; padding:12px; margin-bottom:12px; page-break-inside:avoid; background:var(--soft); }
            .swimmer-name { font-size:16px; font-weight:800; color:var(--navy); }
            .swimmer-counts { margin-top:4px; color:var(--muted); font-size:13px; }
            .empty { color:var(--muted); font-style:italic; }
            @media print { body { padding:14px; } .section,.category-block,.gender-block,.swimmer-block,.stat { break-inside:avoid; } }
            @media (max-width:900px) { .stats { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
          </style>
        </head>
        <body>
          <div class="header">
            <img class="logo" src="${PANTHERS_LOGO}" alt="Panthers logo" />
            <div>
              <div class="title">${escapePrintHtml(title)}</div>
              <div class="sub">${escapePrintHtml(
                meet?.name || 'Meet'
              )} • ${escapePrintHtml(team?.name || 'Team')} • ${escapePrintHtml(
    team?.seedClub || 'Seed Club'
  )}</div>
            </div>
          </div>
          ${bodyHtml}
        </body>
      </html>
  `;

  const printHtmlDocument = (title: string, bodyHtml: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      openModal('Print Failed', 'Unable to prepare the print report.');
      return;
    }

    let didPrint = false;
    const doPrint = () => {
      if (didPrint) return;
      didPrint = true;
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          setTimeout(() => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          }, 1200);
        }
      }, 350);
    };

    iframe.onload = doPrint;
    doc.open();
    doc.write(buildPrintShell(title, bodyHtml));
    doc.close();
    window.setTimeout(doPrint, 800);
  };

  const buildTeamEventSummaryHtml = (rows = filteredTeamEventSummaryRows) => `
    <section class="section">
      <h2 class="section-heading">Team Event Summary</h2>
      ${
        rows.length === 0
          ? `<div class="empty">No entries available for this team.</div>`
          : `
            <table>
              <thead>
                <tr>
                  <th>Event No.</th>
                  <th>Event Name</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Gender</th>
                  <th>No. of Swimmers</th>
                  <th>Swimmers Entered</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (row) => `
                  <tr>
                    <td>${escapePrintHtml(row.eventNumber || '—')}</td>
                    <td>${escapePrintHtml(row.eventName)}</td>
                    <td>${escapePrintHtml(row.typeLabel)}</td>
                    <td>${escapePrintHtml(row.category)}</td>
                    <td>${escapePrintHtml(row.gender)}</td>
                    <td>${escapePrintHtml(row.swimmerCount)}</td>
                    <td>${escapePrintHtml(row.swimmerNames.join(', '))}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </section>
  `;

  const buildSwimmerSummaryHtml = (rows = filteredSwimmerSummaryRows) => `
    <section class="section">
      <h2 class="section-heading">Swimmer Summary</h2>
      ${
        rows.length === 0
          ? `<div class="empty">No swimmers available for summary.</div>`
          : `
            <table>
              <thead>
                <tr>
                  <th>Swimmer</th>
                  <th>Category</th>
                  <th>Gender</th>
                  <th>Individual</th>
                  <th>Relay</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (row) => `
                  <tr>
                    <td>${escapePrintHtml(row.swimmerName)}</td>
                    <td>${escapePrintHtml(row.category)}</td>
                    <td>${escapePrintHtml(row.gender)}</td>
                    <td>${escapePrintHtml(row.individualCount)}</td>
                    <td>${escapePrintHtml(row.relayCount)}</td>
                    <td>${escapePrintHtml(row.totalCount)}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </section>
  `;

  const buildSwimmerWiseHtml = (groups = filteredSwimmerDetailGroups) => `
    <section class="section">
      <h2 class="section-heading">Swimmer-wise Entries</h2>
      ${
        groups.length === 0
          ? `<div class="empty">No swimmer-wise entries available.</div>`
          : groups
              .map(
                (categoryGroup) => `
            <section class="category-block">
              <div class="category-title">${escapePrintHtml(
                categoryGroup.category
              )}</div>
              ${categoryGroup.genders
                .map(
                  (genderGroup) => `
                <div class="gender-block">
                  <div class="gender-title">${escapePrintHtml(
                    genderGroup.gender
                  )}</div>
                  ${
                    genderGroup.swimmers.length === 0
                      ? `<div class="empty">No swimmers in this section.</div>`
                      : genderGroup.swimmers
                          .map(
                            (swimmer) => `
                        <div class="swimmer-block">
                          <div class="swimmer-name">${escapePrintHtml(
                            swimmer.swimmerName
                          )}</div>
                          <div class="swimmer-counts">Individual: ${escapePrintHtml(
                            swimmer.individualCount
                          )} | Relay: ${escapePrintHtml(
                              swimmer.relayCount
                            )} | Total: ${escapePrintHtml(
                              swimmer.totalCount
                            )}</div>
                          <table>
                            <thead>
                              <tr>
                                <th>Event No.</th>
                                <th>Event Name</th>
                                <th>Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${swimmer.events
                                .map(
                                  (event) => `
                                <tr>
                                  <td>${escapePrintHtml(
                                    event.eventNumber || '—'
                                  )}</td>
                                  <td>${escapePrintHtml(event.eventName)}</td>
                                  <td>${escapePrintHtml(event.typeLabel)}</td>
                                </tr>`
                                )
                                .join('')}
                            </tbody>
                          </table>
                        </div>`
                          )
                          .join('')
                  }
                </div>`
                )
                .join('')}
            </section>`
              )
              .join('')
      }
    </section>
  `;

  const downloadTextFile = (
    filename: string,
    content: string,
    mimeType = 'text/plain;charset=utf-8;'
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const csvCell = (value: unknown) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };

  const rowsToCsv = (rows: Array<Array<unknown>>) =>
    rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

  const slugifyFilePart = (value: string) =>
    String(value || 'report')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';

  const xmlCell = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const xmlWorksheet = (name: string, rows: Array<Array<unknown>>) => {
    const safeName = String(name || 'Sheet').slice(0, 31);
    return `
      <Worksheet ss:Name="${xmlCell(safeName)}">
        <Table>
          ${rows
            .map(
              (row, rowIndex) => `
                <Row>
                  ${row
                    .map(
                      (cell) => `
                        <Cell ss:StyleID="${
                          rowIndex === 0 ? 'hdr' : 'cell'
                        }"><Data ss:Type="String">${xmlCell(cell)}</Data></Cell>
                      `
                    )
                    .join('')}
                </Row>
              `
            )
            .join('')}
        </Table>
      </Worksheet>
    `;
  };

  const exportTeamEventSummaryCsv = () => {
    const rows: Array<Array<unknown>> = [
      [
        'Event No.',
        'Event Name',
        'Type',
        'Category',
        'Gender',
        'No. of Swimmers',
        'Swimmers Entered',
      ],
      ...filteredTeamEventSummaryRows.map((row) => [
        row.eventNumber || '—',
        row.eventName,
        row.typeLabel,
        row.category,
        row.gender,
        row.swimmerCount,
        row.swimmerNames.join(', '),
      ]),
    ];

    downloadTextFile(
      `${slugifyFilePart(team?.name || 'team')}-team-event-summary.csv`,
      rowsToCsv(rows),
      'text/csv;charset=utf-8;'
    );
  };

  const exportSwimmerSummaryCsv = () => {
    const rows: Array<Array<unknown>> = [
      ['Swimmer', 'Category', 'Gender', 'Individual', 'Relay', 'Total'],
      ...filteredSwimmerSummaryRows.map((row) => [
        row.swimmerName,
        row.category,
        row.gender,
        row.individualCount,
        row.relayCount,
        row.totalCount,
      ]),
    ];

    downloadTextFile(
      `${slugifyFilePart(team?.name || 'team')}-swimmer-summary.csv`,
      rowsToCsv(rows),
      'text/csv;charset=utf-8;'
    );
  };

  const exportSwimmerWiseCsv = () => {
    const detailRows: Array<Array<unknown>> = [
      [
        'Category',
        'Gender',
        'Swimmer',
        'Individual',
        'Relay',
        'Total',
        'Event No.',
        'Event Name',
        'Type',
      ],
    ];

    filteredSwimmerDetailGroups.forEach((categoryGroup) => {
      categoryGroup.genders.forEach((genderGroup) => {
        genderGroup.swimmers.forEach((swimmer) => {
          swimmer.events.forEach((event) => {
            detailRows.push([
              categoryGroup.category,
              genderGroup.gender,
              swimmer.swimmerName,
              swimmer.individualCount,
              swimmer.relayCount,
              swimmer.totalCount,
              event.eventNumber || '—',
              event.eventName,
              event.typeLabel,
            ]);
          });
        });
      });
    });

    downloadTextFile(
      `${slugifyFilePart(team?.name || 'team')}-swimmer-wise-entries.csv`,
      rowsToCsv(detailRows),
      'text/csv;charset=utf-8;'
    );
  };

  const exportFullWorkbook = () => {
    const overviewRows: Array<Array<unknown>> = [
      ['Metric', 'Value'],
      ['Total Swimmers', totalSwimmers],
      ['Total Entries', totalEntries],
      ['Individual Entries', totalIndividualEntries],
      ['Relay Entries', totalRelayEntries],
      ['Events with Entries', filteredTeamEventSummaryRows.length],
      ['Submitted', submittedDisplay],
    ];

    const teamEventRows: Array<Array<unknown>> = [
      [
        'Event No.',
        'Event Name',
        'Type',
        'Category',
        'Gender',
        'No. of Swimmers',
        'Swimmers Entered',
      ],
      ...filteredTeamEventSummaryRows.map((row) => [
        row.eventNumber || '—',
        row.eventName,
        row.typeLabel,
        row.category,
        row.gender,
        row.swimmerCount,
        row.swimmerNames.join(', '),
      ]),
    ];

    const swimmerSummaryRowsData: Array<Array<unknown>> = [
      ['Swimmer', 'Category', 'Gender', 'Individual', 'Relay', 'Total'],
      ...filteredSwimmerSummaryRows.map((row) => [
        row.swimmerName,
        row.category,
        row.gender,
        row.individualCount,
        row.relayCount,
        row.totalCount,
      ]),
    ];

    const swimmerWiseRows: Array<Array<unknown>> = [
      [
        'Category',
        'Gender',
        'Swimmer',
        'Individual',
        'Relay',
        'Total',
        'Event No.',
        'Event Name',
        'Type',
      ],
    ];

    filteredSwimmerDetailGroups.forEach((categoryGroup) => {
      categoryGroup.genders.forEach((genderGroup) => {
        genderGroup.swimmers.forEach((swimmer) => {
          swimmer.events.forEach((event) => {
            swimmerWiseRows.push([
              categoryGroup.category,
              genderGroup.gender,
              swimmer.swimmerName,
              swimmer.individualCount,
              swimmer.relayCount,
              swimmer.totalCount,
              event.eventNumber || '—',
              event.eventName,
              event.typeLabel,
            ]);
          });
        });
      });
    });

    const workbookXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Top"/>
      <Borders/>
      <Font ss:FontName="Arial" ss:Size="10"/>
      <Interior/>
      <NumberFormat/>
      <Protection/>
    </Style>
    <Style ss:ID="hdr">
      <Font ss:FontName="Arial" ss:Bold="1"/>
      <Interior ss:Color="#D9E2F3" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="cell">
      <Alignment ss:Vertical="Top" ss:WrapText="1"/>
    </Style>
  </Styles>
  ${xmlWorksheet('Team Overview', overviewRows)}
  ${xmlWorksheet('Team Event Summary', teamEventRows)}
  ${xmlWorksheet('Swimmer Summary', swimmerSummaryRowsData)}
  ${xmlWorksheet('Swimmer-wise Entries', swimmerWiseRows)}
</Workbook>`;

    downloadTextFile(
      `${slugifyFilePart(team?.name || 'team')}-full-report.xls`,
      workbookXml,
      'application/vnd.ms-excel;charset=utf-8;'
    );
  };

  const handlePrintTeamEventSummary = () => {
    printHtmlDocument(
      'Panthers Team Event Summary',
      buildTeamEventSummaryHtml()
    );
  };

  const handlePrintSwimmerSummary = () => {
    printHtmlDocument('Panthers Swimmer Summary', buildSwimmerSummaryHtml());
  };

  const handlePrintSwimmerWiseEntries = () => {
    printHtmlDocument('Panthers Swimmer-wise Entries', buildSwimmerWiseHtml());
  };

  const renderTeamEventSummaryTable = () => {
    return (
      <div style={cardStyle}>
        <div style={sectionHeaderRowStyle}>
          <div style={{ ...cardTitleStyle, marginBottom: 0 }}>
            Team Event Summary
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={exportTeamEventSummaryCsv}
              style={secondaryBtnStyle}
            >
              ⬇️ Export CSV
            </button>
            <button
              onClick={handlePrintTeamEventSummary}
              style={secondaryBtnStyle}
            >
              🖨️ Print Team Event Summary
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>{renderPrintFilters('event')}</div>

        {filteredTeamEventSummaryRows.length === 0 ? (
          <div style={{ ...noteStyle, marginTop: 14 }}>
            No entries available for this team.
          </div>
        ) : (
          <div
            style={{
              ...tableWrapStyle,
              ...sectionScrollWrapStyle,
              marginTop: 14,
            }}
          >
            <table style={printWideTableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Event No.</th>
                  <th style={thStyle}>Event Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Gender</th>
                  <th style={thStyle}>No. of Swimmers</th>
                  <th style={thStyle}>Swimmers Entered</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeamEventSummaryRows.map((row) => (
                  <tr key={row.eventId}>
                    <td style={tdStyle}>{row.eventNumber || '—'}</td>
                    <td style={tdStyle}>{row.eventName}</td>
                    <td style={tdStyle}>{row.typeLabel}</td>
                    <td style={tdStyle}>{row.category}</td>
                    <td style={tdStyle}>{row.gender}</td>
                    <td style={tdStyle}>{row.swimmerCount}</td>
                    <td style={tdStyle}>{row.swimmerNames.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderSwimmerSummaryTable = () => {
    return (
      <div style={cardStyle}>
        <div style={sectionHeaderRowStyle}>
          <div style={{ ...cardTitleStyle, marginBottom: 0 }}>
            Swimmer Summary
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={exportSwimmerSummaryCsv} style={secondaryBtnStyle}>
              ⬇️ Export CSV
            </button>
            <button
              onClick={handlePrintSwimmerSummary}
              style={secondaryBtnStyle}
            >
              🖨️ Print Swimmer Summary
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>{renderPrintFilters('swimmer')}</div>

        {filteredSwimmerSummaryRows.length === 0 ? (
          <div style={{ ...noteStyle, marginTop: 14 }}>
            No swimmers available for summary.
          </div>
        ) : (
          <div
            style={{
              ...tableWrapStyle,
              ...sectionScrollWrapStyle,
              marginTop: 14,
            }}
          >
            <table style={summaryWideTableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Swimmer</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Gender</th>
                  <th style={thStyle}>Individual</th>
                  <th style={thStyle}>Relay</th>
                  <th style={thStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredSwimmerSummaryRows.map((row) => (
                  <tr
                    key={row.swimmerId}
                    style={{
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        'rgba(212,175,55,0.12)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={tdStyle}>{row.swimmerName}</td>
                    <td style={tdStyle}>{row.category}</td>
                    <td style={tdStyle}>{row.gender}</td>
                    <td style={tdStyle}>{row.individualCount}</td>
                    <td style={tdStyle}>{row.relayCount}</td>
                    <td style={{ ...tdStyle, fontWeight: 800 }}>
                      {row.totalCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderSwimmerWiseReport = () => {
    return (
      <div style={cardStyle}>
        <div style={sectionHeaderRowStyle}>
          <div style={{ ...cardTitleStyle, marginBottom: 0 }}>
            Swimmer-wise Entries
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={exportSwimmerWiseCsv} style={secondaryBtnStyle}>
              ⬇️ Export CSV
            </button>
            <button
              onClick={handlePrintSwimmerWiseEntries}
              style={secondaryBtnStyle}
            >
              🖨️ Print Swimmer-wise Entries
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>{renderPrintFilters('detail')}</div>

        {filteredSwimmerDetailGroups.length === 0 ? (
          <div style={{ ...noteStyle, marginTop: 14 }}>
            No swimmer-wise entries available.
          </div>
        ) : (
          <div
            style={{
              ...sectionScrollWrapStyle,
              marginTop: 14,
              display: 'grid',
              gap: 16,
              paddingRight: 4,
            }}
          >
            {filteredSwimmerDetailGroups.map((categoryGroup) => (
              <div key={categoryGroup.category} style={printCategoryBlockStyle}>
                <div style={printCategoryTitleStyle}>
                  {categoryGroup.category}
                </div>

                {categoryGroup.genders.map((genderGroup) => (
                  <div
                    key={`${categoryGroup.category}-${genderGroup.gender}`}
                    style={printGenderBlockStyle}
                  >
                    <div style={printGenderTitleStyle}>
                      {genderGroup.gender}
                    </div>

                    {genderGroup.swimmers.length === 0 ? (
                      <div style={noteStyle}>No swimmers in this section.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 12 }}>
                        {genderGroup.swimmers.map((swimmer) => (
                          <div
                            key={swimmer.swimmerId}
                            style={printSwimmerCardStyle}
                          >
                            <div style={printSwimmerHeadStyle}>
                              <div style={cardTitleStyle}>
                                {swimmer.swimmerName}
                              </div>
                              <div style={noteStyle}>
                                Individual: {swimmer.individualCount} | Relay:{' '}
                                {swimmer.relayCount} | Total:{' '}
                                {swimmer.totalCount}
                              </div>
                            </div>

                            <div style={tableWrapStyle}>
                              <table style={summaryDetailTableStyle}>
                                <thead>
                                  <tr>
                                    <th style={thStyle}>Event No.</th>
                                    <th style={thStyle}>Event Name</th>
                                    <th style={thStyle}>Type</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {swimmer.events.map((event) => (
                                    <tr
                                      key={`${swimmer.swimmerId}-${event.eventId}`}
                                    >
                                      <td style={tdStyle}>
                                        {event.eventNumber || '—'}
                                      </td>
                                      <td style={tdStyle}>{event.eventName}</td>
                                      <td style={tdStyle}>{event.typeLabel}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const handlePrintSummary = () => {
    const overviewHtml = `
      <section class="section">
        <h2 class="section-heading">Team Overview</h2>
        <div class="stats">
          <div class="stat"><div class="stat-value">${escapePrintHtml(
            totalSwimmers
          )}</div><div class="stat-label">Total Swimmers</div></div>
          <div class="stat"><div class="stat-value">${escapePrintHtml(
            totalEntries
          )}</div><div class="stat-label">Total Entries</div></div>
          <div class="stat"><div class="stat-value">${escapePrintHtml(
            totalIndividualEntries
          )}</div><div class="stat-label">Individual Entries</div></div>
          <div class="stat"><div class="stat-value">${escapePrintHtml(
            totalRelayEntries
          )}</div><div class="stat-label">Relay Entries</div></div>
          <div class="stat"><div class="stat-value">${escapePrintHtml(
            filteredTeamEventSummaryRows.length
          )}</div><div class="stat-label">Events with Entries</div></div>
          <div class="stat"><div class="stat-value">${escapePrintHtml(
            submittedDisplay
          )}</div><div class="stat-label">Submitted</div></div>
        </div>
      </section>
    `;

    printHtmlDocument(
      'Panthers Team Entries Report',
      `${overviewHtml}${buildTeamEventSummaryHtml()}${buildSwimmerSummaryHtml()}${buildSwimmerWiseHtml()}`
    );
  };

  const handleSubmitTeamReview = async () => {
    if (!isEditable) {
      openModal(
        'Submit Disabled',
        'PIN is inactive or not verified. Submit is disabled.'
      );
      return;
    }

    if (!meetId || !teamId) return;

    setSubmitting(true);
    setLoadingMessage('Submitting final team confirmation...');

    try {
      const eventSummaryPayload: Record<
        string,
        {
          eventId?: string;
          eventName?: string;
          eventNumber?: number;
          swimmerCount?: number;
        }
      > = {};

      summaryRows.forEach((row) => {
        eventSummaryPayload[row.eventId] = {
          eventId: row.eventId,
          eventName: row.eventName,
          eventNumber: row.eventNumber,
          swimmerCount: row.swimmerCount,
        };
      });

      await set(ref(db, `meets/${meetId}/teamEntryReviews/${teamId}`), {
        submitted: true,
        submittedAt: Date.now(),
        submittedByTeamId: teamId,
        teamName: team?.name || '',
        totalSwimmers,
        totalEntries,
        eventSummary: eventSummaryPayload,
      });

      await update(ref(db, `meets/${meetId}/teamPins/${teamId}`), {
        submitted: true,
        lastSubmittedAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: `team-pin:${teamId}`,
      });

      openModal('Submitted', 'Team entry confirmation submitted successfully.');
    } catch (error: any) {
      openModal(
        'Submit Failed',
        error?.message || 'Failed to submit team review.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderReportTabs = () => {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
          marginBottom: 18,
        }}
      >
        {/* TEAM EVENT SUMMARY */}
        <button
          type="button"
          onClick={() => setReportTab('events')}
          style={{
            padding: '14px 10px',
            borderRadius: 12,
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',

            background: reportTab === 'events' ? '#d4af37' : '#dc2626',

            color: reportTab === 'events' ? '#1a1a1a' : '#ffffff',

            boxShadow:
              reportTab === 'events'
                ? '0 6px 16px rgba(212,175,55,0.4)'
                : '0 4px 10px rgba(0,0,0,0.2)',
          }}
          onMouseEnter={(e) => {
            if (reportTab !== 'events') {
              e.currentTarget.style.background = '#b91c1c';
            }
          }}
          onMouseLeave={(e) => {
            if (reportTab !== 'events') {
              e.currentTarget.style.background = '#dc2626';
            }
          }}
        >
          Team Event Summary
        </button>

        {/* SWIMMER SUMMARY */}
        <button
          type="button"
          onClick={() => setReportTab('swimmers')}
          style={{
            padding: '14px 10px',
            borderRadius: 12,
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',

            background: reportTab === 'swimmers' ? '#d4af37' : '#2563eb',

            color: reportTab === 'swimmers' ? '#1a1a1a' : '#ffffff',

            boxShadow:
              reportTab === 'swimmers'
                ? '0 6px 16px rgba(212,175,55,0.4)'
                : '0 4px 10px rgba(0,0,0,0.2)',
          }}
          onMouseEnter={(e) => {
            if (reportTab !== 'swimmers') {
              e.currentTarget.style.background = '#1d4ed8';
            }
          }}
          onMouseLeave={(e) => {
            if (reportTab !== 'swimmers') {
              e.currentTarget.style.background = '#2563eb';
            }
          }}
        >
          Swimmer Summary
        </button>

        {/* SWIMMER-WISE */}
        <button
          type="button"
          onClick={() => setReportTab('details')}
          style={{
            padding: '14px 10px',
            borderRadius: 12,
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',

            background: reportTab === 'details' ? '#d4af37' : '#16a34a',

            color: reportTab === 'details' ? '#1a1a1a' : '#ffffff',

            boxShadow:
              reportTab === 'details'
                ? '0 6px 16px rgba(212,175,55,0.4)'
                : '0 4px 10px rgba(0,0,0,0.2)',
          }}
          onMouseEnter={(e) => {
            if (reportTab !== 'details') {
              e.currentTarget.style.background = '#15803d';
            }
          }}
          onMouseLeave={(e) => {
            if (reportTab !== 'details') {
              e.currentTarget.style.background = '#16a34a';
            }
          }}
        >
          Swimmer-wise Entries
        </button>
      </div>
    );
  };

  return (
    <div
      className={`team-entries-root ${
        isDarkTheme ? 'tm-theme-dark' : 'tm-theme-light'
      }`}
      style={pageStyle}
    >
      {(pageLoading || submitting) && (
        <div style={loadingOverlayStyle}>
          <div style={loadingCardStyle}>
            <div style={logoWrapStyle}>
              <img
                src={PANTHERS_LOGO}
                alt="Panthers logo"
                style={logoImageStyle}
              />
              <div>
                <div style={loadingTitleStyle}>Panthers Team Manager</div>
                <div style={loadingSubStyle}>{loadingMessage}</div>
              </div>
            </div>

            <div style={spinnerStyle} />
          </div>
        </div>
      )}

      {modalOpen && (
        <div style={modalBackdropStyle}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <img
                src={PANTHERS_LOGO}
                alt="Panthers logo"
                style={logoMiniImageStyle}
              />
              <div>
                <div style={modalTitleStyle}>{modalTitle}</div>
                <div style={modalSubStyle}>Panthers Team Manager</div>
              </div>
            </div>

            <div style={modalBodyStyle}>{modalMessage}</div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={primaryBtnStyle}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {guideOpen && step !== 'pin' && (
        <div style={guideOverlayStyle}>
          <div style={guideCardStyle}>
            <div style={guideTopRowStyle}>
              <div>
                <div style={guideBadgeStyle}>
                  Step {guideIndex + 1} of {GUIDE_STEPS.length}
                </div>
                <div style={guideTitleStyle}>{currentGuideStep.title}</div>
              </div>
              <button onClick={closeGuide} style={guideSkipBtnStyle}>
                Skip
              </button>
            </div>

            <div style={guideTextStyle}>{currentGuideStep.text}</div>

            <div style={guideActionsStyle}>
              <button
                onClick={prevGuide}
                disabled={guideIndex === 0}
                style={
                  guideIndex === 0 ? guideDisabledBtnStyle : secondaryBtnStyle
                }
              >
                Back
              </button>

              <button onClick={nextGuide} style={primaryBtnStyle}>
                {guideIndex === GUIDE_STEPS.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        :root {
          --tm-transition-fast: 180ms ease;
          --tm-transition-medium: 260ms ease;
        }

        .team-entries-root,
        .team-entries-root *,
        .team-entries-root *::before,
        .team-entries-root *::after {
          transition:
            background-color var(--tm-transition-medium),
            border-color var(--tm-transition-fast),
            color var(--tm-transition-fast),
            box-shadow var(--tm-transition-medium),
            fill var(--tm-transition-fast),
            stroke var(--tm-transition-fast);
        }

        .tm-theme-dark {
          --tm-page-bg: #071426;
          --tm-text-primary: #ffffff;
          --tm-text-secondary: #9fb3c8;
          --tm-panel-bg: rgba(255,255,255,0.06);
          --tm-panel-border: rgba(255,255,255,0.08);
          --tm-card-bg: rgba(255,255,255,0.03);
          --tm-card-bg-soft: rgba(255,255,255,0.02);
          --tm-card-border: rgba(255,255,255,0.08);
          --tm-input-bg: #10233a;
          --tm-input-text: #f5f7fb;
          --tm-input-border: rgba(255,255,255,0.12);
          --tm-pill-bg: rgba(255,255,255,0.06);
          --tm-pill-border: rgba(255,255,255,0.08);
          --tm-btn-secondary-bg: rgba(255,255,255,0.04);
          --tm-btn-secondary-border: rgba(255,255,255,0.12);
          --tm-left-rail-bg: rgba(255,255,255,0.04);
          --tm-left-rail-btn-bg: rgba(255,255,255,0.04);
          --tm-seed-bg: rgba(255,255,255,0.06);
          --tm-table-divider: rgba(255,255,255,0.06);
          --tm-table-head-divider: rgba(255,255,255,0.08);
          --tm-shadow-heavy: 0 20px 60px rgba(0,0,0,0.32);
          --tm-shadow-soft: 0 8px 18px rgba(0,0,0,0.28);
        }

        .tm-theme-light {
          --tm-page-bg: #eef3f9;
          --tm-text-primary: #10233a;
          --tm-text-secondary: #5b6b7d;
          --tm-panel-bg: #ffffff;
          --tm-panel-border: rgba(16,35,58,0.10);
          --tm-card-bg: #ffffff;
          --tm-card-bg-soft: #f7f9fc;
          --tm-card-border: rgba(16,35,58,0.10);
          --tm-input-bg: #ffffff;
          --tm-input-text: #10233a;
          --tm-input-border: rgba(16,35,58,0.14);
          --tm-pill-bg: rgba(16,35,58,0.05);
          --tm-pill-border: rgba(16,35,58,0.10);
          --tm-btn-secondary-bg: #ffffff;
          --tm-btn-secondary-border: rgba(16,35,58,0.14);
          --tm-left-rail-bg: #f7f9fc;
          --tm-left-rail-btn-bg: #ffffff;
          --tm-seed-bg: #ffffff;
          --tm-table-divider: rgba(16,35,58,0.08);
          --tm-table-head-divider: rgba(16,35,58,0.12);
          --tm-shadow-heavy: 0 20px 50px rgba(15,35,58,0.12);
          --tm-shadow-soft: 0 8px 20px rgba(15,35,58,0.10);
        }

        @keyframes panthers-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes tick-pop {
          0% {
            transform: scale(0.5);
            opacity: 0;
          }
          60% {
            transform: scale(1.2);
            opacity: 1;
          }
          100% {
            transform: scale(1);
          }
        }
        .team-manager-shell {
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }

        .team-manager-shell select,
        .team-manager-shell input,
        .team-manager-shell textarea {
          color: var(--tm-input-text);
        }

        .team-manager-shell select {
          background: var(--tm-input-bg) !important;
          color: var(--tm-input-text) !important;
          color-scheme: inherit;
        }

        .team-manager-shell select option {
          background: var(--tm-input-bg) !important;
          color: var(--tm-input-text) !important;
        }

        .team-manager-shell select option:hover,
        .team-manager-shell select option:checked,
        .team-manager-shell select option:focus {
          background: #1a3554 !important;
          color: #ffffff !important;
        }

        .tm-theme-light .team-manager-shell select option:hover,
        .tm-theme-light .team-manager-shell select option:checked,
        .tm-theme-light .team-manager-shell select option:focus {
          background: #e7eef7 !important;
          color: #10233a !important;
        }

        .team-manager-shell select:focus,
        .team-manager-shell input:focus,
        .team-manager-shell textarea:focus {
          border-color: rgba(212,175,55,0.45) !important;
          box-shadow: 0 0 0 3px rgba(212,175,55,0.14);
        }

        .report-tab-btn {
          transform: translateY(0);
        }

        .report-tab-btn:hover {
          background: linear-gradient(180deg, rgba(212,175,55,0.18) 0%, rgba(184,144,24,0.14) 100%) !important;
          border-color: rgba(212,175,55,0.38) !important;
          color: #fff2bf !important;
          box-shadow: 0 12px 26px rgba(0,0,0,0.18);
          transform: translateY(-1px);
        }

        .report-tab-btn.active:hover {
          background: linear-gradient(180deg, rgba(212,175,55,0.30) 0%, rgba(184,144,24,0.24) 100%) !important;
          border-color: rgba(212,175,55,0.5) !important;
          color: #fff2bf !important;
        }

        @media (max-width: 980px) {
          .team-manager-shell {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div style={heroStyle}>
        <div style={heroLeftStyle}>
          <img src={PANTHERS_LOGO} alt="Panthers logo" style={heroLogoStyle} />
          <div>
            <div style={heroTitleStyle}>Panthers Team Manager</div>
            <div style={heroSubStyle}>
              {meet?.name || 'Meet'} • {team?.name || 'Team'} •{' '}
              {team?.seedClub || 'Seed Club'}
            </div>
          </div>
        </div>

        <div style={statusWrapStyle}>
          <button
            onClick={() => setThemeMode(nextThemeMode)}
            style={themeToggleBtnStyle}
            title="Cycle theme mode: Auto, Dark, Light"
          >
            {themeButtonLabel}
          </button>

          {step !== 'pin' ? (
            <button onClick={openGuide} style={helpBtnStyle}>
              Help / Guide
            </button>
          ) : null}

          <span
            style={{
              ...statusPillStyle,
              background: isPinActive
                ? 'rgba(46,175,109,0.18)'
                : 'rgba(217,83,79,0.18)',
              border: isPinActive
                ? '1px solid rgba(46,175,109,0.35)'
                : '1px solid rgba(217,83,79,0.35)',
              color: isPinActive ? '#d7ffe8' : '#ffd6d3',
            }}
          >
            {isPinActive ? 'PIN Active' : 'PIN Inactive'}
          </span>

          <span style={statusPillStyle}>Submitted: {submittedDisplay}</span>
        </div>
      </div>

      <div style={panelStyle}>
        {!meetId || !teamId ? (
          <p style={noteStyle}>
            Invalid team link. Please use the full team link shared by the
            admin.
          </p>
        ) : !team ? (
          <p style={noteStyle}>Team not found.</p>
        ) : step === 'pin' ? (
          <div style={{ display: 'grid', gap: 16, maxWidth: 460 }}>
            <h2 style={{ margin: 0 }}>Manager PIN Access</h2>
            <p style={noteStyle}>
              Enter the team PIN shared by the admin to open the team manager.
            </p>

            <div>
              <label style={labelStyle}>Enter PIN</label>
              <input
                value={enteredPin}
                onChange={(e) =>
                  setEnteredPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="Enter PIN"
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={handleVerifyPin} style={primaryBtnStyle}>
                Verify PIN
              </button>
            </div>
          </div>
        ) : (
          <div className="team-manager-shell">
            <aside
              style={{
                ...leftRailStyle,
                background: 'rgb(22, 58, 114)', // ✅ your required color
                ...(isGuideHighlight('workflow') ? highlightBlockStyle : {}),
              }}
            >
              <div style={leftRailHeaderStyle}>Workflow</div>
              <div style={leftRailSubStyle}>
                Follow the steps in order to complete your team entries.
              </div>

              <div style={leftRailNavStyle}>
                <button
                  onClick={switchToByName}
                  style={
                    step === 'manage' && manageMode === 'BY_NAME'
                      ? leftRailActiveBtnStyle
                      : leftRailBtnStyle
                  }
                  title="Work swimmer by swimmer"
                >
                  Enter by Name
                </button>

                <button
                  onClick={switchToByEvent}
                  style={
                    step === 'manage' && manageMode === 'BY_EVENT'
                      ? leftRailActiveBtnStyle
                      : leftRailBtnStyle
                  }
                  title="Work event by event"
                >
                  Enter by Event
                </button>

                <button
                  onClick={switchToPrint}
                  style={
                    step === 'print' ? leftRailActiveBtnStyle : leftRailBtnStyle
                  }
                  title="Open the print-friendly entries report"
                >
                  Submit & Print Entries
                </button>
              </div>

              <div style={leftRailTipStyle}>
                Tip: changes to entries or seed times will reset Submitted to No
                until the final confirmation is sent again.
              </div>
            </aside>

            <section style={{ minWidth: 0 }}>
              {step === 'manage' ? (
                <div style={{ display: 'grid', gap: 20 }}>
                  <div style={inlineMessageContainerStyle}>
                    <div
                      style={{
                        ...inlineMessageStyle,
                        opacity: inlineMessage ? 1 : 0,
                        transform: inlineMessage
                          ? 'translateY(0)'
                          : 'translateY(-6px)',
                        pointerEvents: 'none',
                      }}
                    >
                      <span style={tickStyle}>✓</span>
                      {inlineMessage}
                    </div>
                  </div>

                  <div style={summaryHeaderStyle}>
                    <div>
                      <h2 style={{ margin: 0 }}>Manage Entries</h2>
                      <div style={noteStyle}>
                        Choose how you want to enter: by swimmer name or by
                        event.
                      </div>
                    </div>
                  </div>

                  {teamSwimmers.length === 0 ? (
                    <p style={noteStyle}>No swimmers found for this team.</p>
                  ) : manageMode === 'BY_NAME' ? (
                    <>
                      <div
                        style={{
                          ...filterGridStyle,
                          ...(isGuideHighlight('mode')
                            ? highlightBlockStyle
                            : {}),
                        }}
                      >
                        <div>
                          <label style={labelStyle}>Search Swimmer</label>
                          <input
                            value={swimmerSearch}
                            onChange={(e) => setSwimmerSearch(e.target.value)}
                            placeholder="Search by swimmer, category, gender..."
                            style={inputStyle}
                          />
                        </div>

                        <div>
                          <label style={labelStyle}>Choose Swimmer</label>
                          <select
                            value={selectedSwimmerId}
                            onChange={(e) =>
                              setSelectedSwimmerId(e.target.value)
                            }
                            style={inputStyle}
                          >
                            {filteredSwimmers.length === 0 ? (
                              <option value="">No swimmers found</option>
                            ) : (
                              filteredSwimmers.map((swimmer) => (
                                <option key={swimmer.id} value={swimmer.id}>
                                  {swimmerDisplayLabel(swimmer)}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>

                      {selectedSwimmer ? (
                        <div
                          style={{
                            ...cardStyle,
                            ...(isGuideHighlight('seed')
                              ? highlightBlockStyle
                              : {}),
                          }}
                        >
                          <div style={cardHeaderStyle}>
                            <div>
                              <div style={cardTitleStyle}>
                                {selectedSwimmer.fullName ||
                                  `${selectedSwimmer.firstName || ''} ${
                                    selectedSwimmer.lastName || ''
                                  }`.trim() ||
                                  'Unnamed Swimmer'}
                              </div>
                              <div style={cardSubStyle}>
                                {selectedSwimmer.ageGroup || '—'} •{' '}
                                {displayGenderLabel(selectedSwimmer.gender)}
                              </div>
                            </div>
                          </div>

                          {selectedSwimmerEvents.length === 0 ? (
                            <p style={noteStyle}>
                              No eligible events for this swimmer.
                            </p>
                          ) : (
                            <div style={tableWrapStyle}>
                              <table style={managerTableStyleWide}>
                                <thead>
                                  <tr>
                                    <th style={thStyle}>Select</th>
                                    <th style={thStyle}>Event No.</th>
                                    <th style={thStyle}>Event</th>
                                    <th style={thStyle}>Gender</th>
                                    <th style={thStyle}>Age Group</th>
                                    <th style={thStyle}>Seed Time</th>
                                    <th style={thStyle}>Status</th>
                                    <th style={thStyle}>Save</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedSwimmerEvents.map((event) => {
                                    const existingEntry = getExistingEntry(
                                      selectedSwimmer.id,
                                      event.id
                                    );
                                    const checked = !!existingEntry;
                                    const seedStatus = getSeedStatus(
                                      selectedSwimmer.id,
                                      event.id
                                    );
                                    const currentBusyKey = getSeedKey(
                                      selectedSwimmer.id,
                                      event.id
                                    );

                                    return (
                                      <tr key={event.id}>
                                        <td style={tdStyle}>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={isEditLocked}
                                            onChange={() =>
                                              toggleEntry(
                                                selectedSwimmer,
                                                event
                                              )
                                            }
                                          />
                                        </td>
                                        <td style={tdStyle}>
                                          {event.eventNumber || '—'}
                                        </td>
                                        <td style={tdStyle}>
                                          {eventDisplayLabel(event)}
                                        </td>
                                        <td style={tdStyle}>
                                          {displayGenderLabel(event.gender)}
                                        </td>
                                        <td style={tdStyle}>
                                          {event.ageGroup || '—'}
                                        </td>
                                        <td style={tdStyle}>
                                          <input
                                            type="text"
                                            value={getSeedDisplay(
                                              selectedSwimmer.id,
                                              event.id
                                            )}
                                            onChange={(e) =>
                                              setSeedDigits(
                                                selectedSwimmer.id,
                                                event.id,
                                                e.target.value
                                              )
                                            }
                                            onKeyDown={(e) =>
                                              handleSeedKeyDown(
                                                selectedSwimmer.id,
                                                event.id,
                                                e
                                              )
                                            }
                                            onPaste={(e) => {
                                              e.preventDefault();
                                              setSeedDigits(
                                                selectedSwimmer.id,
                                                event.id,
                                                e.clipboardData.getData('text')
                                              );
                                            }}
                                            inputMode="numeric"
                                            placeholder="00:00.00"
                                            disabled={isEditLocked}
                                            style={seedInputStyle}
                                          />
                                        </td>
                                        <td style={tdStyle}>
                                          {seedStatus === 'saved' ? (
                                            <span style={savedInlineStyle}>
                                              Saved
                                            </span>
                                          ) : seedStatus === 'edited' ? (
                                            <span style={editedInlineStyle}>
                                              Edited
                                            </span>
                                          ) : (
                                            <span style={idleInlineStyle}>
                                              —
                                            </span>
                                          )}
                                        </td>
                                        <td style={tdStyle}>
                                          <button
                                            onClick={() =>
                                              handleSaveSeedTime(
                                                selectedSwimmer,
                                                event
                                              )
                                            }
                                            disabled={
                                              isEditLocked ||
                                              seedStatus !== 'edited' ||
                                              busySeedKey === currentBusyKey
                                            }
                                            style={
                                              isEditLocked ||
                                              seedStatus !== 'edited' ||
                                              busySeedKey === currentBusyKey
                                                ? disabledMiniBtnStyle
                                                : miniBtnStyle
                                            }
                                          >
                                            {busySeedKey === currentBusyKey
                                              ? 'Saving...'
                                              : 'Save'}
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p style={noteStyle}>Please choose a swimmer.</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          ...filterGridStyle,
                          ...(isGuideHighlight('mode')
                            ? highlightBlockStyle
                            : {}),
                        }}
                      >
                        <div>
                          <label style={labelStyle}>Search Event</label>
                          <input
                            value={eventSearch}
                            onChange={(e) => setEventSearch(e.target.value)}
                            placeholder="Search by event, gender, age group..."
                            style={inputStyle}
                          />
                        </div>

                        <div>
                          <label style={labelStyle}>Choose Event</label>
                          <select
                            value={selectedEventId}
                            onChange={(e) => setSelectedEventId(e.target.value)}
                            style={inputStyle}
                          >
                            {filteredEvents.length === 0 ? (
                              <option value="">No events found</option>
                            ) : (
                              filteredEvents.map((event) => (
                                <option key={event.id} value={event.id}>
                                  {eventDisplayLabel(event)}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>

                      {selectedEvent ? (
                        <div
                          style={{
                            ...cardStyle,
                            ...(isGuideHighlight('seed')
                              ? highlightBlockStyle
                              : {}),
                          }}
                        >
                          <div style={cardHeaderStyle}>
                            <div>
                              <div style={cardTitleStyle}>
                                {eventDisplayLabel(selectedEvent)}
                              </div>
                            </div>
                          </div>

                          {selectedEventSwimmers.length === 0 ? (
                            <p style={noteStyle}>
                              No eligible swimmers for this event.
                            </p>
                          ) : (
                            <div style={tableWrapStyle}>
                              <table style={managerTableStyleWide}>
                                <thead>
                                  <tr>
                                    <th style={thStyle}>Select</th>
                                    <th style={thStyle}>Swimmer</th>
                                    <th style={thStyle}>Gender</th>
                                    <th style={thStyle}>Age Group</th>
                                    <th style={thStyle}>Seed Time</th>
                                    <th style={thStyle}>Status</th>
                                    <th style={thStyle}>Save</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedEventSwimmers.map((swimmer) => {
                                    const existingEntry = getExistingEntry(
                                      swimmer.id,
                                      selectedEvent.id
                                    );
                                    const checked = !!existingEntry;
                                    const seedStatus = getSeedStatus(
                                      swimmer.id,
                                      selectedEvent.id
                                    );
                                    const currentBusyKey = getSeedKey(
                                      swimmer.id,
                                      selectedEvent.id
                                    );

                                    return (
                                      <tr key={swimmer.id}>
                                        <td style={tdStyle}>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={isEditLocked}
                                            onChange={() =>
                                              toggleEntry(
                                                swimmer,
                                                selectedEvent
                                              )
                                            }
                                          />
                                        </td>
                                        <td style={tdStyle}>
                                          {swimmer.fullName ||
                                            `${swimmer.firstName || ''} ${
                                              swimmer.lastName || ''
                                            }`.trim() ||
                                            'Unnamed Swimmer'}
                                        </td>
                                        <td style={tdStyle}>
                                          {displayGenderLabel(swimmer.gender)}
                                        </td>
                                        <td style={tdStyle}>
                                          {swimmer.ageGroup || '—'}
                                        </td>
                                        <td style={tdStyle}>
                                          <input
                                            type="text"
                                            value={getSeedDisplay(
                                              swimmer.id,
                                              selectedEvent.id
                                            )}
                                            onChange={(e) =>
                                              setSeedDigits(
                                                swimmer.id,
                                                selectedEvent.id,
                                                e.target.value
                                              )
                                            }
                                            onKeyDown={(e) =>
                                              handleSeedKeyDown(
                                                swimmer.id,
                                                selectedEvent.id,
                                                e
                                              )
                                            }
                                            onPaste={(e) => {
                                              e.preventDefault();
                                              setSeedDigits(
                                                swimmer.id,
                                                selectedEvent.id,
                                                e.clipboardData.getData('text')
                                              );
                                            }}
                                            inputMode="numeric"
                                            placeholder="00:00.00"
                                            disabled={isEditLocked}
                                            style={seedInputStyle}
                                          />
                                        </td>
                                        <td style={tdStyle}>
                                          {seedStatus === 'saved' ? (
                                            <span style={savedInlineStyle}>
                                              Saved
                                            </span>
                                          ) : seedStatus === 'edited' ? (
                                            <span style={editedInlineStyle}>
                                              Edited
                                            </span>
                                          ) : (
                                            <span style={idleInlineStyle}>
                                              —
                                            </span>
                                          )}
                                        </td>
                                        <td style={tdStyle}>
                                          <button
                                            onClick={() =>
                                              handleSaveSeedTime(
                                                swimmer,
                                                selectedEvent
                                              )
                                            }
                                            disabled={
                                              isEditLocked ||
                                              seedStatus !== 'edited' ||
                                              busySeedKey === currentBusyKey
                                            }
                                            style={
                                              isEditLocked ||
                                              seedStatus !== 'edited' ||
                                              busySeedKey === currentBusyKey
                                                ? disabledMiniBtnStyle
                                                : miniBtnStyle
                                            }
                                          >
                                            {busySeedKey === currentBusyKey
                                              ? 'Saving...'
                                              : 'Save'}
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p style={noteStyle}>Please choose an event.</p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 20 }}>
                  <div
                    style={{
                      ...summaryHeaderStyle,
                      ...(isGuideHighlight('print') ? highlightBlockStyle : {}),
                    }}
                  >
                    <div>
                      <h2 style={{ margin: 0 }}>Submit & Print Entries</h2>
                      <div style={noteStyle}>
                        Review and Submit the team event and swimmers report.
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        onClick={handleSubmitTeamReview}
                        style={{
                          ...primaryBtnStyle,
                          ...(isGuideHighlight('submit')
                            ? highlightButtonStyle
                            : {}),
                        }}
                        disabled={
                          !isEditable || submitting || totalEntries === 0
                        }
                      >
                        {submitting ? 'Submitting...' : '✅ Submit Final Entry'}
                      </button>

                      <button
                        onClick={exportFullWorkbook}
                        style={secondaryBtnStyle}
                      >
                        ⬇️ Export Full Report (.xls)
                      </button>

                      <button
                        onClick={handlePrintSummary}
                        style={secondaryBtnStyle}
                      >
                        🖨️ Print Full Report
                      </button>
                    </div>
                  </div>

                  <div style={statsGridStyle}>
                    <div style={statCardStyle}>
                      <div style={statValueStyle}>{totalSwimmers}</div>
                      <div style={statLabelStyle}>Total Swimmers</div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={statValueStyle}>{totalEntries}</div>
                      <div style={statLabelStyle}>Total Entries</div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={statValueStyle}>{totalIndividualEntries}</div>
                      <div style={statLabelStyle}>Individual Entries</div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={statValueStyle}>{totalRelayEntries}</div>
                      <div style={statLabelStyle}>Relay Entries</div>
                    </div>
                  </div>

                  {renderReportTabs()}

                  <div style={{ maxHeight: 650, overflowY: 'auto' }}>
                    {reportTab === 'events'
                      ? renderTeamEventSummaryTable()
                      : null}
                    {reportTab === 'swimmers'
                      ? renderSwimmerSummaryTable()
                      : null}
                    {reportTab === 'details' ? renderSwimmerWiseReport() : null}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--tm-page-bg)',
  color: 'var(--tm-text-primary)',
  padding: 24,
  boxSizing: 'border-box',
};

const heroStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 20,
};

const heroLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const heroLogoStyle: CSSProperties = {
  width: 64,
  height: 64,
  objectFit: 'contain',
  borderRadius: 14,
  background: 'var(--tm-pill-bg)',
  padding: 6,
  boxShadow: 'var(--tm-shadow-soft)',
};

const logoImageStyle: CSSProperties = {
  width: 52,
  height: 52,
  objectFit: 'contain',
  borderRadius: 12,
  background: 'var(--tm-pill-bg)',
  padding: 4,
};

const logoMiniImageStyle: CSSProperties = {
  width: 42,
  height: 42,
  objectFit: 'contain',
  borderRadius: 10,
  background: 'var(--tm-pill-bg)',
  padding: 4,
};

const heroTitleStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
};

const heroSubStyle: CSSProperties = {
  color: 'var(--tm-text-secondary)',
  marginTop: 4,
};

const helpBtnStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid rgba(212,175,55,0.45)',
  background: 'rgba(212,175,55,0.12)',
  color: '#ffe89a',
  fontWeight: 700,
  cursor: 'pointer',
};

const loadingOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(3, 12, 24, 0.72)',
  WebkitBackdropFilter: 'blur(8px)',
  backdropFilter: 'blur(8px)',
  zIndex: 5000,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
};

const loadingCardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: 'var(--tm-panel-bg)',
  border: '1px solid var(--tm-card-border)',
  borderRadius: 20,
  padding: 24,
  boxShadow: 'var(--tm-shadow-heavy)',
};

const logoWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const loadingTitleStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: 20,
};

const loadingSubStyle: CSSProperties = {
  marginTop: 4,
  color: 'var(--tm-text-secondary)',
};

const spinnerStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: '3px solid rgba(255,255,255,0.22)',
  borderTopColor: '#d4af37',
  marginTop: 18,
  animation: 'panthers-spin 0.8s linear infinite',
};

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(3, 12, 24, 0.72)',
  WebkitBackdropFilter: 'blur(6px)',
  backdropFilter: 'blur(6px)',
  zIndex: 5100,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
};

const modalCardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  background: 'var(--tm-panel-bg)',
  border: '1px solid var(--tm-card-border)',
  borderRadius: 20,
  padding: 22,
  boxShadow: 'var(--tm-shadow-heavy)',
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
};

const modalTitleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
};

const modalSubStyle: CSSProperties = {
  color: 'var(--tm-text-secondary)',
  fontSize: 13,
  marginTop: 2,
};

const modalBodyStyle: CSSProperties = {
  color: 'var(--tm-input-text)',
  lineHeight: 1.5,
  marginBottom: 18,
};

const guideOverlayStyle: CSSProperties = {
  position: 'fixed',
  right: 18,
  bottom: 18,
  zIndex: 5200,
  width: 'min(420px, calc(100vw - 32px))',
};

const guideCardStyle: CSSProperties = {
  background: 'var(--tm-panel-bg)',
  border: '1px solid rgba(212,175,55,0.28)',
  borderRadius: 20,
  padding: 18,
  boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
};

const guideTopRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
};

const guideBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '5px 10px',
  borderRadius: 999,
  background: 'rgba(212,175,55,0.16)',
  border: '1px solid rgba(212,175,55,0.35)',
  color: '#ffe89a',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 8,
};

const guideTitleStyle: CSSProperties = {
  fontSize: 19,
  fontWeight: 800,
};

const guideTextStyle: CSSProperties = {
  marginTop: 10,
  color: '#d6e2ee',
  lineHeight: 1.55,
  fontSize: 14,
};

const guideActionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  marginTop: 16,
};

const guideSkipBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--tm-text-secondary)',
  cursor: 'pointer',
  fontWeight: 700,
};

const guideDisabledBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid var(--tm-panel-border)',
  background: 'var(--tm-card-bg)',
  color: 'rgba(255,255,255,0.35)',
  fontWeight: 700,
  cursor: 'not-allowed',
};

const statusWrapStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const statusPillStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'var(--tm-pill-bg)',
  border: '1px solid var(--tm-panel-border)',
  fontSize: 13,
  fontWeight: 700,
};

const panelStyle: CSSProperties = {
  background: 'var(--tm-pill-bg)',
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 18,
  padding: 20,
};

const leftRailStyle: CSSProperties = {
  background: 'var(--tm-left-rail-bg)',
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 18,
  padding: 16,
  position: 'sticky',
  top: 18,
};

const leftRailHeaderStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
};

const leftRailSubStyle: CSSProperties = {
  marginTop: 6,
  color: 'var(--tm-text-secondary)',
  fontSize: 13,
  lineHeight: 1.5,
};

const leftRailNavStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  marginTop: 16,
};

const leftRailBtnStyle: CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  borderRadius: 14,
  border: '1px solid var(--tm-card-border)',
  background: 'var(--tm-left-rail-btn-bg)',
  color: 'var(--tm-text-primary)',
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'left',
};

const leftRailActiveBtnStyle: CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  borderRadius: 14,
  border: '1px solid rgba(212,175,55,0.45)',
  background:
    'linear-gradient(180deg, rgba(212,175,55,0.24) 0%, rgba(184,144,24,0.18) 100%)',
  color: '#ffe89a',
  fontWeight: 800,
  cursor: 'pointer',
  textAlign: 'left',
  boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
};

const leftRailTipStyle: CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 12,
  background: 'rgba(212,175,55,0.10)',
  border: '1px solid rgba(212,175,55,0.20)',
  color: '#e8d59a',
  fontSize: 12,
  lineHeight: 1.5,
};

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 8,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid var(--tm-input-border)',
  background: 'var(--tm-input-bg)',
  color: 'var(--tm-input-text)',
  outline: 'none',
  boxSizing: 'border-box',
  colorScheme: 'dark',
};

const seedInputStyle: CSSProperties = {
  width: 120,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--tm-input-border)',
  background: 'var(--tm-seed-bg)',
  color: 'var(--tm-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  textAlign: 'center',
  fontWeight: 700,
};

const primaryBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: 'none',
  background: '#d4af37',
  color: '#071426',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid var(--tm-input-border)',
  background: 'var(--tm-left-rail-btn-bg)',
  color: 'var(--tm-text-primary)',
  fontWeight: 700,
  cursor: 'pointer',
};

const miniBtnStyle: CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: 'none',
  background: '#d4af37',
  color: '#071426',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledMiniBtnStyle: CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: 'none',
  background: 'rgba(127,127,127,0.18)',
  color: 'var(--tm-text-secondary)',
  fontWeight: 700,
  cursor: 'not-allowed',
};

const noteStyle: CSSProperties = {
  color: 'var(--tm-text-secondary)',
};

const themeToggleBtnStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid var(--tm-btn-secondary-border)',
  background: 'var(--tm-btn-secondary-bg)',
  color: 'var(--tm-text-primary)',
  fontWeight: 700,
  cursor: 'pointer',
};

const savedInlineStyle: CSSProperties = {
  color: '#6dd19c',
  fontSize: 12,
  fontWeight: 700,
};

const editedInlineStyle: CSSProperties = {
  color: '#f1d67a',
  fontSize: 12,
  fontWeight: 700,
};

const idleInlineStyle: CSSProperties = {
  color: '#8da2b7',
  fontSize: 12,
};

const summaryHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const sectionHeaderRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const printFiltersGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

const sectionScrollWrapStyle: CSSProperties = {
  maxHeight: 650,
  overflowY: 'auto',
};

const filterGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)',
  gap: 14,
};

const cardStyle: CSSProperties = {
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 16,
  padding: 16,
  background: 'var(--tm-card-bg)',
};

const printCategoryBlockStyle: CSSProperties = {
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 16,
  padding: 16,
  background: 'var(--tm-card-bg-soft)',
};

const printCategoryTitleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: '#f1d67a',
  marginBottom: 12,
};

const printGenderBlockStyle: CSSProperties = {
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 14,
  padding: 14,
  background: 'var(--tm-card-bg)',
  marginBottom: 12,
};

const printGenderTitleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: 'var(--tm-text-primary)',
  marginBottom: 10,
};

const printSwimmerCardStyle: CSSProperties = {
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 12,
  padding: 12,
  background: 'var(--tm-left-rail-btn-bg)',
};

const printSwimmerHeadStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginBottom: 10,
};

const highlightBlockStyle: CSSProperties = {
  border: '1px solid rgba(212,175,55,0.45)',
  boxShadow: '0 0 0 3px rgba(212,175,55,0.10)',
};

const highlightButtonStyle: CSSProperties = {
  boxShadow: '0 0 0 3px rgba(212,175,55,0.22)',
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 12,
};

const cardTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
};

const cardSubStyle: CSSProperties = {
  color: 'var(--tm-text-secondary)',
  marginTop: 4,
};

const statsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

const statCardStyle: CSSProperties = {
  border: '1px solid var(--tm-panel-border)',
  borderRadius: 16,
  padding: 16,
  background: 'var(--tm-card-bg)',
};

const statValueStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: '#f1d67a',
};

const statLabelStyle: CSSProperties = {
  color: 'var(--tm-text-secondary)',
  marginTop: 6,
};

const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
};

const managerTableStyleWide: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 980,
};

const printWideTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 1180,
};

const summaryWideTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 760,
};

const summaryDetailTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 520,
};

const inlineMessageContainerStyle: CSSProperties = {
  height: 44,
  display: 'flex',
  alignItems: 'center',
};

const inlineMessageStyle: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  background: 'rgba(46,175,109,0.16)',
  border: '1px solid rgba(46,175,109,0.35)',
  color: '#d7ffe8',
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'all 0.25s ease',
};

const tickStyle: CSSProperties = {
  display: 'inline-block',
  marginRight: 8,
  color: '#6dd19c',
  fontWeight: 900,
  transform: 'scale(0.8)',
  animation: 'tick-pop 0.25s ease forwards',
};

const thStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 13,
  color: '#f1d67a',
  background: '#0f2742', // ✅ solid (no transparency)
  borderBottom: '1px solid rgba(255,255,255,0.12)',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid var(--tm-table-divider)',
  verticalAlign: 'top',
};
