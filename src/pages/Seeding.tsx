import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { onValue, ref, set, remove } from 'firebase/database';
import { auth } from '../firebase/auth.js';
import { db } from '../firebase/db.js';
import AppShell from '../components/AppShell';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  laneCount?: number;
};

type SwimmerLite = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  gender?: string;
  ageGroup?: string;
  teamId?: string;
  teamName?: string;
  active?: boolean;
};

function swimmerDisplayName(swimmer?: SwimmerLite | null) {
  if (!swimmer) return '';
  return (
    String(swimmer.fullName || '').trim() ||
    `${swimmer.firstName || ''} ${swimmer.lastName || ''}`.trim()
  );
}

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

type SeededLaneRow = {
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
  lanes: SeededLaneRow[];
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

type SeedingApproach = 'TEAM_BALANCED' | 'SEED_TIME';

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
    seedingApproach?: SeedingApproach | string;
  };
};

type SeedingTab = 'bulk' | 'preview' | 'saved';

type DragState = {
  mode: 'saved';
  heatNumber: number;
  entryId: string;
} | null;

const SEEDING_APPROACH_LABELS: Record<SeedingApproach, string> = {
  TEAM_BALANCED: 'Team Balanced Approach',
  SEED_TIME: 'Seed Time Approach',
};

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

function laneOrderForCount(laneCount: number) {
  if (laneCount === 8) return [4, 5, 3, 6, 2, 7, 1, 8];
  if (laneCount === 6) return [3, 4, 2, 5, 1, 6];
  if (laneCount === 10) return [5, 6, 4, 7, 3, 8, 2, 9, 1, 10];
  if (laneCount === 4) return [2, 3, 1, 4];
  if (laneCount === 2) return [1, 2];
  if (laneCount === 1) return [1];

  const lanes = Array.from({ length: laneCount }, (_, i) => i + 1);
  const centerLeft = Math.floor((laneCount + 1) / 2);
  const centerRight = centerLeft + 1;

  const used = new Set<number>();
  const order: number[] = [];

  if (lanes.includes(centerLeft)) {
    order.push(centerLeft);
    used.add(centerLeft);
  }

  if (lanes.includes(centerRight) && !used.has(centerRight)) {
    order.push(centerRight);
    used.add(centerRight);
  }

  let offset = 1;
  while (order.length < laneCount) {
    const left = centerLeft - offset;
    const right = centerRight + offset - 1;

    if (left >= 1 && !used.has(left)) {
      order.push(left);
      used.add(left);
    }

    if (right <= laneCount && !used.has(right)) {
      order.push(right);
      used.add(right);
    }

    offset += 1;
  }

  return order.slice(0, laneCount);
}

function getTeamKey(entry: EntryRow) {
  return (
    String(entry.teamId || '').trim() ||
    `team_${String(entry.teamName || '')
      .trim()
      .toLowerCase()}` ||
    'no_team'
  );
}

function teamBalancedOrder(entries: EntryRow[]) {
  const teamMap = new Map<string, EntryRow[]>();

  entries.forEach((entry) => {
    const teamKey = getTeamKey(entry);
    const current = teamMap.get(teamKey) || [];
    current.push(entry);
    teamMap.set(teamKey, current);
  });

  const teams = Array.from(teamMap.entries())
    .map(([teamKey, rows]) => ({
      teamKey,
      rows: [...rows].sort((a, b) =>
        String(a.swimmerName || '').localeCompare(String(b.swimmerName || ''))
      ),
    }))
    .sort((a, b) => {
      const aName = String(a.rows[0]?.teamName || '').toLowerCase();
      const bName = String(b.rows[0]?.teamName || '').toLowerCase();
      return aName.localeCompare(bName);
    });

  const out: EntryRow[] = [];
  let added = true;

  while (added) {
    added = false;
    for (const team of teams) {
      if (team.rows.length > 0) {
        out.push(team.rows.shift() as EntryRow);
        added = true;
      }
    }
  }

  return out;
}

function buildRankedEntryList(entries: EntryRow[]) {
  const seeded: Array<EntryRow & { seedValue: number }> = [];
  const unseeded: EntryRow[] = [];

  entries.forEach((entry) => {
    const seedValue = parseSwimTimeToHundredths(entry.laneSeedTime);
    if (seedValue === null) {
      unseeded.push(entry);
    } else {
      seeded.push({ ...entry, seedValue });
    }
  });

  seeded.sort((a, b) => {
    if (a.seedValue !== b.seedValue) return a.seedValue - b.seedValue;
    return String(a.swimmerName || '').localeCompare(
      String(b.swimmerName || '')
    );
  });

  const unseededBalanced = teamBalancedOrder(unseeded);

  return {
    ranked: [...seeded, ...unseededBalanced],
    seededCount: seeded.length,
    unseededCount: unseededBalanced.length,
  };
}

function countSeedStatus(entries: EntryRow[]) {
  let seededCount = 0;
  let unseededCount = 0;

  entries.forEach((entry) => {
    if (parseSwimTimeToHundredths(entry.laneSeedTime) === null) {
      unseededCount += 1;
    } else {
      seededCount += 1;
    }
  });

  return { seededCount, unseededCount };
}

function splitIntoHeatsFastestLast(
  rankedEntries: EntryRow[],
  laneCount: number
) {
  const total = rankedEntries.length;
  const heatCount = Math.ceil(total / laneCount);

  const heats: EntryRow[][] = [];
  let cursor = total;

  for (let heatIndex = heatCount; heatIndex >= 1; heatIndex -= 1) {
    const start = Math.max(0, cursor - laneCount);
    const slice = rankedEntries.slice(start, cursor);
    heats.unshift(slice);
    cursor = start;
  }

  return heats;
}

function assignLanesToHeat(
  entries: EntryRow[],
  heatNumber: number,
  laneCount: number
) {
  const laneOrder = laneOrderForCount(laneCount);
  const lanes: SeededLaneRow[] = [];

  entries.forEach((entry, index) => {
    const laneNumber = laneOrder[index] || index + 1;

    lanes.push({
      laneNumber,
      entryId: String(entry.id || ''),
      swimmerId: String(entry.swimmerId || ''),
      swimmerName: String(entry.swimmerName || ''),
      teamId: String(entry.teamId || ''),
      teamName: String(entry.teamName || ''),
      seedTime: String(entry.laneSeedTime || ''),
      heatNumber,
    });
  });

  return lanes.sort((a, b) => a.laneNumber - b.laneNumber);
}

function buildBalancedHeatsNoSeedTimes(entries: EntryRow[], laneCount: number) {
  const total = entries.length;
  const heatCount = Math.ceil(total / laneCount);

  if (heatCount <= 0) return [] as EntryRow[][];

  const heats: EntryRow[][] = Array.from({ length: heatCount }, () => []);
  const teamMap = new Map<string, EntryRow[]>();

  entries.forEach((entry) => {
    const teamKey = getTeamKey(entry);
    const current = teamMap.get(teamKey) || [];
    current.push(entry);
    teamMap.set(teamKey, current);
  });

  const teams = Array.from(teamMap.entries())
    .map(([teamKey, rows]) => ({
      teamKey,
      rows: [...rows].sort((a, b) =>
        String(a.swimmerName || '').localeCompare(String(b.swimmerName || ''))
      ),
      displayName: String(rows[0]?.teamName || '').toLowerCase(),
    }))
    .sort((a, b) => {
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      return a.displayName.localeCompare(b.displayName);
    });

  let startHeatIndex = 0;

  while (teams.some((team) => team.rows.length > 0)) {
    for (const team of teams) {
      if (team.rows.length === 0) continue;

      let chosenHeatIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let offset = 0; offset < heatCount; offset += 1) {
        const heatIndex = (startHeatIndex + offset) % heatCount;
        const heat = heats[heatIndex];

        if (heat.length >= laneCount) continue;

        const sameTeamCount = heat.filter(
          (item) => getTeamKey(item) === team.teamKey
        ).length;

        const score = sameTeamCount * 1000 + heat.length * 10 + offset;

        if (score < bestScore) {
          bestScore = score;
          chosenHeatIndex = heatIndex;
        }
      }

      if (chosenHeatIndex === -1) continue;

      heats[chosenHeatIndex].push(team.rows.shift() as EntryRow);
      startHeatIndex = (chosenHeatIndex + 1) % heatCount;
    }
  }

  return heats;
}

function buildHeats(
  entries: EntryRow[],
  laneCount: number,
  approach: SeedingApproach = 'SEED_TIME'
) {
  const { seededCount, unseededCount } = countSeedStatus(entries);

  const grouped =
    approach === 'TEAM_BALANCED'
      ? buildBalancedHeatsNoSeedTimes(entries, laneCount)
      : splitIntoHeatsFastestLast(
          buildRankedEntryList(entries).ranked,
          laneCount
        );

  const heats: HeatRow[] = grouped.map((heatEntries, index) => ({
    heatNumber: index + 1,
    lanes: assignLanesToHeat(heatEntries, index + 1, laneCount),
  }));

  return {
    heats,
    seededCount,
    unseededCount,
  };
}

function flattenSavedHeats(
  node?: SavedSeedingNode | null,
  validEntriesById?: Record<string, EntryRow>
) {
  if (!node?.heats) return [] as HeatRow[];

  const heats: HeatRow[] = Object.entries(node.heats)
    .map(([_, heatNode]) => {
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
        .filter((lane): lane is SeededLaneRow => !!lane && lane.laneNumber > 0)
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

function cloneHeats(heats: HeatRow[]) {
  return heats.map((heat) => ({
    ...heat,
    lanes: heat.lanes.map((lane) => ({ ...lane })),
  }));
}

function validateHeats(heats: HeatRow[], laneCount: number) {
  for (const heat of heats) {
    const used = new Set<number>();

    for (const lane of heat.lanes) {
      if (!Number.isInteger(lane.laneNumber)) {
        return `Heat ${heat.heatNumber}: lane must be a whole number`;
      }

      if (lane.laneNumber < 1 || lane.laneNumber > laneCount) {
        return `Heat ${heat.heatNumber}: lane ${lane.laneNumber} is outside 1-${laneCount}`;
      }

      if (used.has(lane.laneNumber)) {
        return `Heat ${heat.heatNumber}: duplicate lane ${lane.laneNumber}`;
      }

      used.add(lane.laneNumber);
    }
  }

  return '';
}

function sortHeatLanes(heats: HeatRow[]) {
  return heats
    .map((heat) => ({
      ...heat,
      lanes: [...heat.lanes].sort((a, b) => a.laneNumber - b.laneNumber),
    }))
    .sort((a, b) => a.heatNumber - b.heatNumber);
}

function RearrangeIcon() {
  return (
    <div
      style={{
        width: 22,
        minWidth: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.92,
      }}
      title="Drag to rearrange lanes"
    >
      <svg
        width="18"
        height="26"
        viewBox="0 0 18 26"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M9 1L13.5 5.5H4.5L9 1Z" fill="#D4AF37" />
        <rect x="2" y="7" width="14" height="2.8" rx="1.4" fill="#D4AF37" />
        <rect x="2" y="11.6" width="14" height="2.8" rx="1.4" fill="#D4AF37" />
        <rect x="2" y="16.2" width="14" height="2.8" rx="1.4" fill="#D4AF37" />
        <path d="M9 25L4.5 20.5L13.5 20.5L9 25Z" fill="#D4AF37" />
      </svg>
    </div>
  );
}

export default function Seeding() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [teams, setTeams] = useState<TeamRow[]>([]);

  const [swimmers, setSwimmers] = useState<SwimmerLite[]>([]);

  const [swimmersLoaded, setSwimmersLoaded] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [savedSeeding, setSavedSeeding] = useState<SavedSeedingNode | null>(
    null
  );
  const [allSeeding, setAllSeeding] = useState<
    Record<string, SavedSeedingNode>
  >({});

  const [previewHeats, setPreviewHeats] = useState<HeatRow[]>([]);
  const [savedEditableHeats, setSavedEditableHeats] = useState<HeatRow[]>([]);
  const [previewSeededCount, setPreviewSeededCount] = useState(0);
  const [previewUnseededCount, setPreviewUnseededCount] = useState(0);
  const [seedingApproach, setSeedingApproach] =
    useState<SeedingApproach>('TEAM_BALANCED');

  const [selectedBulkEventIds, setSelectedBulkEventIds] = useState<string[]>(
    []
  );
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const [activeTab, setActiveTab] = useState<SeedingTab>('bulk');
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropTargetKey, setDropTargetKey] = useState('');

  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingSavedLanes, setUpdatingSavedLanes] = useState(false);

  const laneCount = Number(activeMeet?.laneCount || 8);

  const teamsById = useMemo(() => {
    const map: Record<string, TeamRow> = {};
    teams.forEach((team) => {
      map[team.id] = team;
    });
    return map;
  }, [teams]);

  const resolveTeamName = (item: { teamId?: string; teamName?: string }) => {
    const currentTeam = item.teamId ? teamsById[item.teamId] : null;
    return currentTeam?.name || item.teamName || 'No team';
  };

  const swimmersById = useMemo(() => {
    const map: Record<string, SwimmerLite> = {};
    swimmers.forEach((swimmer) => {
      map[swimmer.id] = swimmer;
    });
    return map;
  }, [swimmers]);

  // Entries keep a copy of the swimmer's name/team from when they were
  // entered. Always prefer the live swimmer record so edits show up, and
  // drop entries whose swimmer was deleted or marked inactive.
  const syncedEntries = useMemo(() => {
    return entries
      .filter((entry) => {
        if (!swimmersLoaded) return true;
        const swimmerId = String(entry.swimmerId || '');
        if (!swimmerId) return true;
        const swimmer = swimmersById[swimmerId];
        return !!swimmer && swimmer.active !== false;
      })
      .map((entry) => {
        const swimmer = entry.swimmerId
          ? swimmersById[String(entry.swimmerId)]
          : undefined;
        const merged: EntryRow = {
          ...entry,
          swimmerName: swimmerDisplayName(swimmer) || entry.swimmerName,
          teamId: swimmer?.teamId || entry.teamId,
          teamName: swimmer?.teamName || entry.teamName,
        };
        return {
          ...merged,
          teamName: resolveTeamName(merged),
        };
      });
  }, [entries, teamsById, swimmersById, swimmersLoaded]);

  const activeEvents = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false)
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const selectedEvent = useMemo(() => {
    return activeEvents.find((event) => event.id === selectedEventId) || null;
  }, [activeEvents, selectedEventId]);

  const eventEntries = useMemo(() => {
    if (!selectedEventId) return [];

    return syncedEntries
      .filter(
        (entry) =>
          entry.eventId === selectedEventId &&
          entry.active !== false &&
          String(entry.status || 'Entered').toLowerCase() !== 'scratch'
      )
      .sort((a, b) =>
        String(a.swimmerName || '').localeCompare(String(b.swimmerName || ''))
      );
  }, [syncedEntries, selectedEventId]);

  const eventEntriesById = useMemo(() => {
    const map: Record<string, EntryRow> = {};
    eventEntries.forEach((entry) => {
      if (entry.id) map[entry.id] = entry;
    });
    return map;
  }, [eventEntries]);

  const bulkEventRows = useMemo(() => {
    return activeEvents.map((event) => {
      const entryCount = syncedEntries.filter(
        (entry) =>
          entry.eventId === event.id &&
          entry.active !== false &&
          String(entry.status || 'Entered').toLowerCase() !== 'scratch'
      ).length;

      return {
        event,
        entryCount,
        hasSavedSeeding: !!allSeeding[event.id],
        readyToSeed: entryCount > 0,
      };
    });
  }, [activeEvents, syncedEntries, allSeeding]);

  const savedHeatList = useMemo(() => {
    const flattened = flattenSavedHeats(savedSeeding, eventEntriesById);
    return flattened.map((heat) => ({
      ...heat,
      lanes: heat.lanes
        .map((lane) => ({
          ...lane,
          teamName: resolveTeamName(lane),
        }))
        .sort((a, b) => a.laneNumber - b.laneNumber),
    }));
  }, [savedSeeding, eventEntriesById, teamsById]);

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'} • ${laneCount} lanes`;
  }, [activeMeet, laneCount]);

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
      setSwimmers([]);
      setSwimmersLoaded(false);
      setEvents([]);
      setEntries([]);
      setSelectedEventId('');
      setSavedSeeding(null);
      setAllSeeding({});
      setSelectedBulkEventIds([]);
      setPreviewHeats([]);
      setSavedEditableHeats([]);
      return;
    }

    const teamsRef = ref(db, `meets/${activeMeetId}/teams`);
    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const entriesRef = ref(db, `meets/${activeMeetId}/entries`);
    const seedingRef = ref(db, `meets/${activeMeetId}/seeding`);
    const swimmersRef = ref(db, `meets/${activeMeetId}/swimmers`);

    setSwimmersLoaded(false);
    const unsubSwimmers = onValue(swimmersRef, (snap) => {
      const val = snap.val() || {};
      const rows: SwimmerLite[] = Object.entries(val).map(
        ([id, item]: any) => ({ id, ...item })
      );
      setSwimmers(rows);
      setSwimmersLoaded(true);
    });

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

    return () => {
      unsubTeams();
      unsubEvents();
      unsubEntries();
      unsubSeeding();
      unsubSwimmers();
    };
  }, [activeMeetId]);

  useEffect(() => {
    if (!activeMeetId || !selectedEventId) {
      setSavedSeeding(null);
      return;
    }

    const seedingRef = ref(
      db,
      `meets/${activeMeetId}/seeding/${selectedEventId}`
    );

    const unsub = onValue(seedingRef, (snap) => {
      setSavedSeeding((snap.val() as SavedSeedingNode) || null);
    });

    return () => unsub();
  }, [activeMeetId, selectedEventId]);

  useEffect(() => {
    if (!selectedEventId || eventEntries.length === 0) {
      setPreviewHeats([]);
      setPreviewSeededCount(0);
      setPreviewUnseededCount(0);
      return;
    }

    const ranked = countSeedStatus(eventEntries);
    const flattenedSaved = flattenSavedHeats(savedSeeding, eventEntriesById);

    if (flattenedSaved.length > 0) {
      setPreviewHeats(
        flattenedSaved.map((heat) => ({
          ...heat,
          lanes: heat.lanes
            .map((lane) => ({
              ...lane,
              teamName: resolveTeamName(lane),
            }))
            .sort((a, b) => a.laneNumber - b.laneNumber),
        }))
      );
      setPreviewSeededCount(ranked.seededCount);
      setPreviewUnseededCount(ranked.unseededCount);
      return;
    }

    const built = buildHeats(eventEntries, laneCount, seedingApproach);
    setPreviewHeats(
      built.heats.map((heat) => ({
        ...heat,
        lanes: heat.lanes
          .map((lane) => ({
            ...lane,
            teamName: resolveTeamName(lane),
          }))
          .sort((a, b) => a.laneNumber - b.laneNumber),
      }))
    );
    setPreviewSeededCount(built.seededCount);
    setPreviewUnseededCount(built.unseededCount);
  }, [
    selectedEventId,
    eventEntries,
    eventEntriesById,
    savedSeeding,
    laneCount,
    teamsById,
    seedingApproach,
  ]);

  useEffect(() => {
    setSavedEditableHeats(cloneHeats(savedHeatList));
  }, [savedHeatList]);

  useEffect(() => {
    setSelectedBulkEventIds((prev) =>
      prev.filter((id) => activeEvents.some((event) => event.id === id))
    );
  }, [activeEvents]);

  const toggleBulkEventSelection = (eventId: string) => {
    setSelectedBulkEventIds((prev) => {
      if (prev.includes(eventId)) {
        return prev.filter((id) => id !== eventId);
      }
      return [...prev, eventId];
    });
  };

  const handleSelectAllEvents = () => {
    setSelectedBulkEventIds(bulkEventRows.map((row) => row.event.id));
  };

  const handleSelectReadyToSeed = () => {
    const ids = bulkEventRows
      .filter((row) => row.readyToSeed)
      .map((row) => row.event.id);

    setSelectedBulkEventIds(ids);
    setMsg(
      ids.length
        ? `${ids.length} ready-to-seed event(s) selected. Choose a seeding approach, then click Regenerate Selected.`
        : 'No events are currently ready to seed'
    );
  };

  const handleClearBulkSelection = () => {
    setSelectedBulkEventIds([]);
  };

  const findLanePosition = (
    heats: HeatRow[],
    heatNumber: number,
    entryId: string
  ) => {
    const heatIndex = heats.findIndex((heat) => heat.heatNumber === heatNumber);
    if (heatIndex === -1) return null;

    const laneIndex = heats[heatIndex].lanes.findIndex(
      (lane) => lane.entryId === entryId
    );
    if (laneIndex === -1) return null;

    return {
      heatIndex,
      laneIndex,
      lane: heats[heatIndex].lanes[laneIndex],
    };
  };

  const swapAcrossHeats = (
    heats: HeatRow[],
    sourceHeatNumber: number,
    sourceEntryId: string,
    targetHeatNumber: number,
    targetEntryId: string
  ) => {
    const next = cloneHeats(heats);
    const source = findLanePosition(next, sourceHeatNumber, sourceEntryId);
    const target = findLanePosition(next, targetHeatNumber, targetEntryId);

    if (!source || !target) return heats;

    const sourceLaneNumber = source.lane.laneNumber;
    const targetLaneNumber = target.lane.laneNumber;

    next[source.heatIndex].lanes[source.laneIndex] = {
      ...target.lane,
      laneNumber: sourceLaneNumber,
      heatNumber: sourceHeatNumber,
    };

    next[target.heatIndex].lanes[target.laneIndex] = {
      ...source.lane,
      laneNumber: targetLaneNumber,
      heatNumber: targetHeatNumber,
    };

    return sortHeatLanes(next);
  };

  const getFirstFreeLaneNumber = (heat: HeatRow, meetLaneCount: number) => {
    const used = new Set(heat.lanes.map((lane) => lane.laneNumber));
    for (let lane = 1; lane <= meetLaneCount; lane += 1) {
      if (!used.has(lane)) return lane;
    }
    return null;
  };

  const moveToHeatIfFree = (
    heats: HeatRow[],
    sourceHeatNumber: number,
    sourceEntryId: string,
    targetHeatNumber: number,
    meetLaneCount: number
  ) => {
    if (sourceHeatNumber === targetHeatNumber) return heats;

    const next = cloneHeats(heats);
    const source = findLanePosition(next, sourceHeatNumber, sourceEntryId);
    const targetHeatIndex = next.findIndex(
      (heat) => heat.heatNumber === targetHeatNumber
    );

    if (!source || targetHeatIndex === -1) return heats;

    const freeLane = getFirstFreeLaneNumber(
      next[targetHeatIndex],
      meetLaneCount
    );
    if (!freeLane) return heats;

    const movedLane = {
      ...source.lane,
      laneNumber: freeLane,
      heatNumber: targetHeatNumber,
    };

    next[source.heatIndex].lanes.splice(source.laneIndex, 1);
    next[targetHeatIndex].lanes.push(movedLane);

    return sortHeatLanes(next);
  };

  const handleDragStart = (heatNumber: number, entryId: string) => {
    setDragState({ mode: 'saved', heatNumber, entryId });
  };

  const handleDropSwap = (heatNumber: number, targetEntryId: string) => {
    if (!dragState) return;

    if (
      dragState.heatNumber === heatNumber &&
      dragState.entryId === targetEntryId
    ) {
      setDropTargetKey('');
      setDragState(null);
      return;
    }

    setSavedEditableHeats((prev) =>
      swapAcrossHeats(
        prev,
        dragState.heatNumber,
        dragState.entryId,
        heatNumber,
        targetEntryId
      )
    );

    setDropTargetKey('');
    setDragState(null);
  };

  const handleDropMoveToHeat = (targetHeatNumber: number) => {
    if (!dragState) return;

    setSavedEditableHeats((prev) =>
      moveToHeatIfFree(
        prev,
        dragState.heatNumber,
        dragState.entryId,
        targetHeatNumber,
        laneCount
      )
    );

    setDropTargetKey('');
    setDragState(null);
  };

  const buildSeedingPayloadFromHeats = (
    event: EventRow,
    heats: HeatRow[],
    meetLaneCount: number,
    uid: string,
    seededCount: number,
    unseededCount: number,
    approach: SeedingApproach
  ) => {
    const heatsNode: Record<string, any> = {};

    sortHeatLanes(heats).forEach((heat) => {
      const lanesNode: Record<string, any> = {};

      heat.lanes.forEach((lane) => {
        lanesNode[`lane${lane.laneNumber}`] = {
          laneNumber: lane.laneNumber,
          entryId: lane.entryId,
          swimmerId: lane.swimmerId,
          swimmerName: lane.swimmerName,
          teamId: lane.teamId,
          teamName: resolveTeamName(lane),
          seedTime: lane.seedTime,
          heatNumber: lane.heatNumber,
        };
      });

      heatsNode[`heat${heat.heatNumber}`] = {
        heatNumber: heat.heatNumber,
        lanes: lanesNode,
      };
    });

    return {
      generatedAt: Date.now(),
      generatedBy: uid,
      laneCount: meetLaneCount,
      eventId: event.id,
      eventNumber: event.eventNumber || 0,
      eventName: event.name || '',
      heats: heatsNode,
      meta: {
        seededCount,
        unseededCount,
        seedingApproach: approach,
      },
    };
  };

  const buildSeedingPayload = (
    event: EventRow,
    eventEntriesForSave: EntryRow[],
    meetLaneCount: number,
    uid: string,
    approach: SeedingApproach
  ) => {
    const syncedEventEntries = eventEntriesForSave.map((entry) => ({
      ...entry,
      teamName: resolveTeamName(entry),
    }));

    const built = buildHeats(syncedEventEntries, meetLaneCount, approach);

    return buildSeedingPayloadFromHeats(
      event,
      built.heats,
      meetLaneCount,
      uid,
      built.seededCount,
      built.unseededCount,
      approach
    );
  };

  const handleGeneratePreview = () => {
    if (!selectedEvent) {
      setMsg('Please select an event');
      return;
    }

    if (eventEntries.length === 0) {
      setMsg('No entries found for the selected event');
      setPreviewHeats([]);
      return;
    }

    const built = buildHeats(eventEntries, laneCount, seedingApproach);
    setPreviewHeats(
      built.heats.map((heat) => ({
        ...heat,
        lanes: heat.lanes
          .map((lane) => ({
            ...lane,
            teamName: resolveTeamName(lane),
          }))
          .sort((a, b) => a.laneNumber - b.laneNumber),
      }))
    );
    setPreviewSeededCount(built.seededCount);
    setPreviewUnseededCount(built.unseededCount);

    setMsg(
      `Preview generated using ${SEEDING_APPROACH_LABELS[seedingApproach]}: ${built.heats.length} heat(s), ${built.seededCount} seeded, ${built.unseededCount} unseeded`
    );
    setActiveTab('preview');
  };

  const handleSaveSeeding = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!selectedEvent) {
      setMsg('Please select an event');
      return;
    }

    if (previewHeats.length === 0) {
      setMsg('Please generate seeding preview first');
      return;
    }

    const validationError = validateHeats(previewHeats, laneCount);
    if (validationError) {
      setMsg(validationError);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setSaving(true);
    setMsg('Saving seeding...');

    try {
      const payload = buildSeedingPayloadFromHeats(
        selectedEvent,
        previewHeats,
        laneCount,
        user.uid,
        previewSeededCount,
        previewUnseededCount,
        seedingApproach
      );

      await set(
        ref(db, `meets/${activeMeetId}/seeding/${selectedEventId}`),
        payload
      );

      setMsg(
        `Seeding saved successfully using ${SEEDING_APPROACH_LABELS[seedingApproach]}`
      );
      setActiveTab('saved');
    } catch (error: any) {
      setMsg(error.message || 'Failed to save seeding');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSavedLanes = async () => {
    if (!activeMeetId || !selectedEvent || !selectedEventId) {
      setMsg('Please select an event');
      return;
    }

    if (savedEditableHeats.length === 0) {
      setMsg('No saved seeding found to update');
      return;
    }

    const validationError = validateHeats(savedEditableHeats, laneCount);
    if (validationError) {
      setMsg(validationError);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setUpdatingSavedLanes(true);
    setMsg('Updating saved lane arrangement...');

    try {
      const savedApproach =
        savedSeeding?.meta?.seedingApproach === 'SEED_TIME'
          ? 'SEED_TIME'
          : 'TEAM_BALANCED';

      const payload = buildSeedingPayloadFromHeats(
        selectedEvent,
        savedEditableHeats,
        laneCount,
        user.uid,
        Number(savedSeeding?.meta?.seededCount || 0),
        Number(savedSeeding?.meta?.unseededCount || 0),
        savedApproach
      );

      await set(
        ref(db, `meets/${activeMeetId}/seeding/${selectedEventId}`),
        payload
      );

      const rebuilt = buildHeats(eventEntries, laneCount, savedApproach);
      setPreviewHeats(
        sortHeatLanes(savedEditableHeats).map((heat) => ({
          ...heat,
          lanes: heat.lanes.map((lane) => ({
            ...lane,
            teamName: resolveTeamName(lane),
          })),
        }))
      );
      setPreviewSeededCount(
        Number(savedSeeding?.meta?.seededCount ?? rebuilt.seededCount)
      );
      setPreviewUnseededCount(
        Number(savedSeeding?.meta?.unseededCount ?? rebuilt.unseededCount)
      );

      setMsg('Saved seeding lanes updated successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to update saved lanes');
    } finally {
      setUpdatingSavedLanes(false);
    }
  };

  const handleDeleteSeeding = async () => {
    if (!activeMeetId || !selectedEventId) {
      setMsg('Please select an event');
      return;
    }

    const ok = window.confirm('Delete saved seeding for this event?');
    if (!ok) return;

    try {
      await remove(ref(db, `meets/${activeMeetId}/seeding/${selectedEventId}`));
      setMsg('Saved seeding deleted successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete seeding');
    }
  };

  const handleBulkRegenerateSelected = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (selectedBulkEventIds.length === 0) {
      setMsg('Please select at least one event');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const ok = window.confirm(
      `Generate seeding for ${selectedBulkEventIds.length} selected event(s) using ${SEEDING_APPROACH_LABELS[seedingApproach]}? This will overwrite saved seeding for those events.`
    );
    if (!ok) return;

    setBulkProcessing(true);
    setMsg(
      `Generating seeding for ${selectedBulkEventIds.length} selected event(s) using ${SEEDING_APPROACH_LABELS[seedingApproach]}...`
    );

    try {
      let regenerated = 0;
      let skipped = 0;

      for (const eventId of selectedBulkEventIds) {
        const event = activeEvents.find((row) => row.id === eventId);
        if (!event) {
          skipped += 1;
          continue;
        }

        const eventEntriesForSave = syncedEntries.filter(
          (entry) =>
            entry.eventId === eventId &&
            entry.active !== false &&
            String(entry.status || 'Entered').toLowerCase() !== 'scratch'
        );

        if (eventEntriesForSave.length === 0) {
          skipped += 1;
          continue;
        }

        const payload = buildSeedingPayload(
          event,
          eventEntriesForSave,
          laneCount,
          user.uid,
          seedingApproach
        );
        await set(ref(db, `meets/${activeMeetId}/seeding/${eventId}`), payload);
        regenerated += 1;
      }

      setMsg(
        `Bulk seeding complete using ${SEEDING_APPROACH_LABELS[seedingApproach]}: ${regenerated} event(s) generated, ${skipped} skipped`
      );
      setSelectedBulkEventIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to regenerate selected seeding');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkDeleteSelectedSeeding = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (selectedBulkEventIds.length === 0) {
      setMsg('Please select at least one event');
      return;
    }

    const selectedWithSavedSeeding = selectedBulkEventIds.filter(
      (id) => !!allSeeding[id]
    );

    if (selectedWithSavedSeeding.length === 0) {
      setMsg('None of the selected events have saved seeding');
      return;
    }

    const ok = window.confirm(
      `Delete saved seeding for ${selectedWithSavedSeeding.length} selected event(s)?`
    );
    if (!ok) return;

    setBulkProcessing(true);
    setMsg(
      `Deleting saved seeding for ${selectedWithSavedSeeding.length} selected event(s)...`
    );

    try {
      for (const eventId of selectedWithSavedSeeding) {
        await remove(ref(db, `meets/${activeMeetId}/seeding/${eventId}`));
      }

      setMsg(
        `Deleted saved seeding for ${selectedWithSavedSeeding.length} event(s) successfully`
      );
      setSelectedBulkEventIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete selected seeding');
    } finally {
      setBulkProcessing(false);
    }
  };

  const renderPreviewTable = (heats: HeatRow[]) => {
    if (heats.length === 0) {
      return (
        <p style={{ color: '#9fb3c8' }}>
          No preview generated yet. Click Generate Preview.
        </p>
      );
    }

    return (
      <div
        style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              minWidth: 860,
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
                {['Heat', 'Lane', 'Swimmer', 'Team', 'Seed Time'].map(
                  (head) => (
                    <th key={head} style={thStyle}>
                      {head}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {heats.map((heat) =>
                [...heat.lanes]
                  .sort((a, b) => a.laneNumber - b.laneNumber)
                  .map((lane, idx) => (
                    <tr
                      key={`preview-${heat.heatNumber}-${lane.entryId}`}
                      style={{
                        background:
                          idx % 2 === 0
                            ? 'rgba(255,255,255,0.02)'
                            : 'rgba(255,255,255,0.06)',
                      }}
                    >
                      <td style={tdStyle}>
                        {idx === 0 ? `Heat ${heat.heatNumber}` : ''}
                      </td>
                      <td style={{ ...tdStyle, width: 110, fontWeight: 700 }}>
                        Lane {lane.laneNumber}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {lane.swimmerName || '—'}
                      </td>
                      <td style={tdStyle}>{resolveTeamName(lane)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {lane.seedTime || 'Unseeded'}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderSavedTable = (heats: HeatRow[]) => {
    if (heats.length === 0) {
      return (
        <p style={{ color: '#9fb3c8' }}>
          No saved seeding found for this event.
        </p>
      );
    }

    return (
      <div
        style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <div style={{ maxHeight: 560, overflow: 'auto' }}>
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
                  '',
                  'Heat',
                  'Lane',
                  'Swimmer',
                  'Team',
                  'Seed Time',
                  'Move',
                ].map((head) => (
                  <th key={head} style={thStyle}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {heats.map((heat) => {
                const freeLane = getFirstFreeLaneNumber(heat, laneCount);
                const moveZoneKey = `heat-zone-${heat.heatNumber}`;
                const isMoveZoneActive = dropTargetKey === moveZoneKey;

                return (
                  <Fragment key={`saved-heat-${heat.heatNumber}`}>
                    {heat.lanes
                      .sort((a, b) => a.laneNumber - b.laneNumber)
                      .map((lane, idx) => {
                        const rowKey = `saved-${heat.heatNumber}-${lane.entryId}`;
                        const isDragging =
                          dragState?.heatNumber === heat.heatNumber &&
                          dragState?.entryId === lane.entryId;
                        const isDropTarget = dropTargetKey === rowKey;
                        const isEvenRow = idx % 2 === 0;

                        return (
                          <tr
                            key={rowKey}
                            draggable
                            onDragStart={() =>
                              handleDragStart(heat.heatNumber, lane.entryId)
                            }
                            onDragEnd={() => {
                              setDropTargetKey('');
                              setDragState(null);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (
                                dragState &&
                                !(
                                  dragState.heatNumber === heat.heatNumber &&
                                  dragState.entryId === lane.entryId
                                )
                              ) {
                                setDropTargetKey(rowKey);
                              }
                            }}
                            onDragLeave={() => {
                              if (dropTargetKey === rowKey) {
                                setDropTargetKey('');
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleDropSwap(heat.heatNumber, lane.entryId);
                            }}
                            style={{
                              cursor: 'grab',
                              background: isDragging
                                ? 'rgba(212,175,55,0.22)'
                                : isDropTarget
                                ? 'rgba(46,175,109,0.20)'
                                : isEvenRow
                                ? 'rgba(255,255,255,0.02)'
                                : 'rgba(255,255,255,0.06)',
                              transition: 'background 0.18s ease',
                            }}
                          >
                            <td style={{ ...tdStyle, width: 44 }}>
                              <RearrangeIcon />
                            </td>
                            <td style={tdStyle}>
                              {idx === 0 ? `Heat ${heat.heatNumber}` : ''}
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                width: 110,
                                fontWeight: 700,
                              }}
                            >
                              Lane {lane.laneNumber}
                            </td>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>
                              {lane.swimmerName || '—'}
                            </td>
                            <td style={tdStyle}>{resolveTeamName(lane)}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                              {lane.seedTime || 'Unseeded'}
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                whiteSpace: 'nowrap',
                                color: '#9fb3c8',
                                fontSize: 12,
                              }}
                            >
                              Drop on another swimmer to swap
                            </td>
                          </tr>
                        );
                      })}

                    <tr
                      key={moveZoneKey}
                      onDragOver={(e) => {
                        if (!dragState || freeLane === null) return;
                        e.preventDefault();
                        setDropTargetKey(moveZoneKey);
                      }}
                      onDragLeave={() => {
                        if (dropTargetKey === moveZoneKey) setDropTargetKey('');
                      }}
                      onDrop={(e) => {
                        if (!dragState || freeLane === null) return;
                        e.preventDefault();
                        handleDropMoveToHeat(heat.heatNumber);
                      }}
                      style={{
                        background: isMoveZoneActive
                          ? 'rgba(46,175,109,0.18)'
                          : 'rgba(255,255,255,0.03)',
                      }}
                    >
                      <td
                        colSpan={7}
                        style={{
                          padding: '12px 14px',
                          borderBottom: '1px solid rgba(255,255,255,0.10)',
                          color: freeLane === null ? '#ffd6d3' : '#d7ffe8',
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        {freeLane === null
                          ? `Heat ${heat.heatNumber} is full — no free lane for move`
                          : `Move zone: drop here to move swimmer into Heat ${heat.heatNumber} on Lane ${freeLane}`}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const getTabStyle = (tab: SeedingTab): CSSProperties => {
    const isActive = activeTab === tab;

    if (tab === 'bulk') return isActive ? tabBulkActiveStyle : tabBulkStyle;
    if (tab === 'preview')
      return isActive ? tabPreviewActiveStyle : tabPreviewStyle;
    return isActive ? tabSavedActiveStyle : tabSavedStyle;
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
          <h1 style={{ marginTop: 0 }}>Seeding</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            Create heats and lane allocation for the selected event.
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
              <label style={labelStyle}>Lane Count</label>
              <input
                value={String(laneCount)}
                disabled
                readOnly
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Entries Available</label>
              <input
                value={String(eventEntries.length)}
                disabled
                readOnly
                style={inputStyle}
              />
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
                  Approach: {SEEDING_APPROACH_LABELS[seedingApproach]}
                </span>
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 18,
            }}
          >
            <button onClick={handleGeneratePreview} style={secondaryBtnStyle}>
              Generate Preview
            </button>

            <button
              onClick={handleSaveSeeding}
              disabled={saving || previewHeats.length === 0}
              style={
                previewHeats.length === 0 ? disabledBtnStyle : primaryBtnStyle
              }
            >
              {saving ? 'Saving...' : 'Save Seeding'}
            </button>

            <button
              onClick={handleDeleteSeeding}
              disabled={!savedSeeding}
              style={!savedSeeding ? disabledBtnStyle : dangerBtnStyle}
            >
              Delete Saved Seeding
            </button>
          </div>

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        <div style={panelStyle}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            <button
              onClick={() => setActiveTab('bulk')}
              style={getTabStyle('bulk')}
            >
              Bulk Seeding Actions
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              style={getTabStyle('preview')}
            >
              Preview Heats
            </button>
            <button
              onClick={() => setActiveTab('saved')}
              style={getTabStyle('saved')}
            >
              Saved Seeding
            </button>
          </div>

          {activeTab === 'bulk' ? (
            <div style={{ marginTop: 18 }}>
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
                    Bulk Seeding Actions
                  </h2>
                  <div style={{ color: '#9fb3c8' }}>
                    Select ready events, choose the seeding approach, then
                    generate saved seeding.
                  </div>
                </div>

                <div style={approachPanelStyle}>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>
                    Seeding Approach
                  </label>
                  <select
                    value={seedingApproach}
                    onChange={(e) =>
                      setSeedingApproach(e.target.value as SeedingApproach)
                    }
                    style={{ ...inputStyle, minWidth: 260 }}
                  >
                    <option value="TEAM_BALANCED">
                      Team Balanced Approach
                    </option>
                    <option value="SEED_TIME">Seed Time Approach</option>
                  </select>
                  <div style={{ color: '#9fb3c8', fontSize: 12, marginTop: 6 }}>
                    {seedingApproach === 'TEAM_BALANCED'
                      ? 'Balances teams across heats first, then assigns center lanes.'
                      : 'Ranks by seed time first; fastest swimmers are placed in later heats.'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={handleSelectAllEvents}
                    disabled={bulkEventRows.length === 0}
                    style={
                      bulkEventRows.length === 0
                        ? disabledBtnStyle
                        : secondaryBtnStyle
                    }
                  >
                    Select All Events
                  </button>

                  <button
                    onClick={handleSelectReadyToSeed}
                    disabled={
                      bulkEventRows.filter((row) => row.readyToSeed).length ===
                      0
                    }
                    style={
                      bulkEventRows.filter((row) => row.readyToSeed).length ===
                      0
                        ? disabledBtnStyle
                        : secondaryBtnStyle
                    }
                  >
                    Ready to Seed
                  </button>

                  <button
                    onClick={handleClearBulkSelection}
                    disabled={selectedBulkEventIds.length === 0}
                    style={
                      selectedBulkEventIds.length === 0
                        ? disabledBtnStyle
                        : secondaryBtnStyle
                    }
                  >
                    Clear Selection
                  </button>

                  <button
                    onClick={handleBulkRegenerateSelected}
                    disabled={
                      selectedBulkEventIds.length === 0 || bulkProcessing
                    }
                    style={
                      selectedBulkEventIds.length === 0 || bulkProcessing
                        ? disabledBtnStyle
                        : primaryBtnStyle
                    }
                  >
                    {bulkProcessing
                      ? 'Processing...'
                      : `Generate Selected (${selectedBulkEventIds.length})`}
                  </button>

                  <button
                    onClick={handleBulkDeleteSelectedSeeding}
                    disabled={
                      selectedBulkEventIds.length === 0 || bulkProcessing
                    }
                    style={
                      selectedBulkEventIds.length === 0 || bulkProcessing
                        ? disabledBtnStyle
                        : dangerBtnStyle
                    }
                  >
                    Delete Selected Seeding ({selectedBulkEventIds.length})
                  </button>
                </div>
              </div>

              {bulkEventRows.length === 0 ? (
                <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                  No active events found for this meet.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {bulkEventRows.map((row) => {
                    const isSelected = selectedBulkEventIds.includes(
                      row.event.id
                    );
                    const savedApproach =
                      allSeeding[row.event.id]?.meta?.seedingApproach;

                    return (
                      <div
                        key={row.event.id}
                        style={{
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 16,
                          padding: 16,
                          background: isSelected
                            ? 'rgba(212,175,55,0.10)'
                            : 'rgba(255,255,255,0.04)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
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
                              onChange={() =>
                                toggleBulkEventSelection(row.event.id)
                              }
                              style={{ marginTop: 4, transform: 'scale(1.2)' }}
                            />

                            <div>
                              <div style={{ fontSize: 18, fontWeight: 700 }}>
                                Event {row.event.eventNumber || '—'} •{' '}
                                {row.event.name || 'Unnamed Event'}
                              </div>
                              <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                                {row.event.gender || '—'} •{' '}
                                {row.event.ageGroup || '—'} • Entries:{' '}
                                {row.entryCount}
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                ...pillStyle,
                                background: row.readyToSeed
                                  ? 'rgba(46,175,109,0.16)'
                                  : 'rgba(255,255,255,0.06)',
                                border: row.readyToSeed
                                  ? '1px solid rgba(46,175,109,0.28)'
                                  : '1px solid rgba(255,255,255,0.08)',
                                color: row.readyToSeed ? '#d7ffe8' : '#fff',
                              }}
                            >
                              {row.readyToSeed ? 'Ready to Seed' : 'No Entries'}
                            </span>

                            <span
                              style={{
                                ...pillStyle,
                                background: row.hasSavedSeeding
                                  ? 'rgba(212,175,55,0.18)'
                                  : 'rgba(255,255,255,0.06)',
                                border: row.hasSavedSeeding
                                  ? '1px solid rgba(212,175,55,0.35)'
                                  : '1px solid rgba(255,255,255,0.08)',
                                color: row.hasSavedSeeding ? '#f3d97b' : '#fff',
                              }}
                            >
                              {row.hasSavedSeeding
                                ? 'Saved Seeding'
                                : 'Not Seeded'}
                            </span>

                            {row.hasSavedSeeding ? (
                              <span style={pillStyle}>
                                {savedApproach === 'SEED_TIME'
                                  ? 'Seed Time Approach'
                                  : 'Team Balanced Approach'}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {activeTab === 'preview' ? (
            <div style={{ marginTop: 18 }}>
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
                    Preview Heats
                  </h2>
                  <div style={{ color: '#9fb3c8' }}>
                    Read-only preview. Current approach:{' '}
                    {SEEDING_APPROACH_LABELS[seedingApproach]}. Rearrangement is
                    allowed only in Saved Seeding.
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                {renderPreviewTable(previewHeats)}
              </div>
            </div>
          ) : null}

          {activeTab === 'saved' ? (
            <div style={{ marginTop: 18 }}>
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
                    Saved Seeding
                  </h2>
                  <div style={{ color: '#9fb3c8' }}>
                    Drag onto another swimmer row to swap across or within
                    heats. Drag onto a heat move zone to move a swimmer into
                    that heat if a lane is free, then save the updated
                    arrangement.
                  </div>
                </div>

                <button
                  onClick={handleUpdateSavedLanes}
                  disabled={
                    savedEditableHeats.length === 0 || updatingSavedLanes
                  }
                  style={
                    savedEditableHeats.length === 0 || updatingSavedLanes
                      ? disabledBtnStyle
                      : primaryBtnStyle
                  }
                >
                  {updatingSavedLanes ? 'Updating...' : 'Save Updated Lanes'}
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
                {renderSavedTable(savedEditableHeats)}
              </div>
            </div>
          ) : null}
        </div>

        <div style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Seeding Logic Used</h2>

          <div style={{ display: 'grid', gap: 10, color: '#d6deea' }}>
            <div>
              • Team Balanced Approach spreads swimmers across heats by team
              first so each heat stays as even as possible across teams.
            </div>
            <div>
              • Seed Time Approach ranks swimmers by seed time, with faster
              swimmers placed in later heats.
            </div>
            <div>
              • Unseeded swimmers are still balanced by team when Seed Time
              Approach is used.
            </div>
            <div>
              • Within each heat, center lanes are given first priority.
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
              Approach: {SEEDING_APPROACH_LABELS[seedingApproach]}
            </span>
            <span style={pillStyle}>Seeded: {previewSeededCount}</span>
            <span style={pillStyle}>Unseeded: {previewUnseededCount}</span>
            <span style={pillStyle}>Preview Heats: {previewHeats.length}</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 13,
  color: '#f1d67a',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  whiteSpace: 'nowrap',
};

const panelStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 18,
  padding: 20,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
  marginTop: 18,
};

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 8,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: 'white',
  outline: 'none',
};

const approachPanelStyle: CSSProperties = {
  minWidth: 290,
  padding: 12,
  borderRadius: 14,
  border: '1px solid rgba(212,175,55,0.28)',
  background: 'rgba(212,175,55,0.08)',
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
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'white',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: 'none',
  background: 'rgba(255,255,255,0.10)',
  color: 'rgba(255,255,255,0.55)',
  fontWeight: 700,
  cursor: 'not-allowed',
};

const dangerBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(217,83,79,0.35)',
  background: 'rgba(217,83,79,0.16)',
  color: '#ffd6d3',
  fontWeight: 700,
  cursor: 'pointer',
};

const tabBulkStyle: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid rgba(53, 162, 235, 0.30)',
  background: 'rgba(53, 162, 235, 0.08)',
  color: '#cfe9ff',
  fontWeight: 700,
  cursor: 'pointer',
  width: '100%',
  outline: 'none',
};

const tabBulkActiveStyle: CSSProperties = {
  ...tabBulkStyle,
  border: '1px solid rgba(53, 162, 235, 0.55)',
  background: 'rgba(53, 162, 235, 0.22)',
  color: '#ffffff',
  boxShadow: '0 0 0 2px rgba(53, 162, 235, 0.16)',
};

const tabPreviewStyle: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid rgba(75, 192, 192, 0.30)',
  background: 'rgba(75, 192, 192, 0.08)',
  color: '#d7fffb',
  fontWeight: 700,
  cursor: 'pointer',
  width: '100%',
  outline: 'none',
};

const tabPreviewActiveStyle: CSSProperties = {
  ...tabPreviewStyle,
  border: '1px solid rgba(75, 192, 192, 0.55)',
  background: 'rgba(75, 192, 192, 0.22)',
  color: '#ffffff',
  boxShadow: '0 0 0 2px rgba(75, 192, 192, 0.16)',
};

const tabSavedStyle: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid rgba(212, 175, 55, 0.30)',
  background: 'rgba(212, 175, 55, 0.08)',
  color: '#f7e7a8',
  fontWeight: 700,
  cursor: 'pointer',
  width: '100%',
  outline: 'none',
};

const tabSavedActiveStyle: CSSProperties = {
  ...tabSavedStyle,
  border: '1px solid rgba(212, 175, 55, 0.55)',
  background: 'rgba(212, 175, 55, 0.22)',
  color: '#ffffff',
  boxShadow: '0 0 0 2px rgba(212, 175, 55, 0.16)',
};

const pillStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontSize: 13,
};
