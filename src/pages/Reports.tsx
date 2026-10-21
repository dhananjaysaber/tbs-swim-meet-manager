import { useEffect, useMemo, useState } from 'react';
import { onValue, ref, get, remove } from 'firebase/database';
import { db } from '../firebase/db.js';

type ReportTab =
  | 'EVENT_RESULTS'
  | 'MEDALS'
  | 'TEAM_POINTS'
  | 'TEAM_ENTRIES'
  | 'SWIMMER_PROFILES'
  | 'EXCEPTIONS'
  | 'ANALYTICS';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  laneCount?: number;
  poolLength?: string | number;
  pointsEnabled?: boolean;
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
  teamId?: string;
  teamName?: string;
  dob?: string;
  regNo?: string;
  active?: boolean;
};

type TeamRow = {
  id: string;
  name?: string;
  code?: string;
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

type JoinedResultRow = {
  resultId: string;
  entryId: string;
  swimmerId: string;
  swimmerName: string;
  gender: string;
  ageGroup: string;
  teamId: string;
  teamName: string;
  eventId: string;
  eventNumber: number;
  eventName: string;
  stroke: string;
  eventType: string;
  relay: boolean;
  heatNumber: number;
  laneNumber: number;
  seedTime: string;
  heatFinalTime: string;
  status: string;
  place: number | null;
};

type TeamEntryGroup = {
  teamId: string;
  teamName: string;
  swimmers: Array<{
    swimmerId: string;
    swimmerName: string;
    gender: string;
    ageGroup: string;
    regNo: string;
    events: Array<{
      entryId: string;
      eventId: string;
      eventNumber: number;
      eventName: string;
      stroke: string;
      seedTime: string;
      status: string;
    }>;
  }>;
};

const POINTS_BY_PLACE: Record<number, number> = {
  1: 5,
  2: 3,
  3: 1,
};

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

function statusSortScore(status: string) {
  if (status === 'OK') return 0;
  if (status === 'NS') return 1;
  if (status === 'DQ') return 2;
  if (status === 'SCR') return 3;
  return 9;
}

function sortRowsForRanking(rows: JoinedResultRow[]) {
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

function computePlaces(rows: JoinedResultRow[]) {
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

function buildEventDisplayName(event?: EventRow | null, fallback?: string) {
  const directName = String(event?.name || fallback || '').trim();
  if (directName) return directName;

  const parts = [
    event?.distance ? `${event.distance}m` : '',
    event?.stroke || '',
    event?.gender || '',
    event?.ageGroup || '',
    event?.eventType || '',
  ].filter(Boolean);

  return parts.join(' - ');
}

function isEntryScratched(entry?: EntryRow | null) {
  const s = String(entry?.status || '')
    .trim()
    .toLowerCase();
  return s === 'scratch' || s === 'scratched' || s === 'scr';
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function Reports() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [swimmers, setSwimmers] = useState<SwimmerRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [results, setResults] = useState<Record<string, ResultRow>>({});

  const [tab, setTab] = useState<ReportTab>('EVENT_RESULTS');

  const [eventFilter, setEventFilter] = useState('');
  const [selectedMedalEventIds, setSelectedMedalEventIds] = useState<string[]>(
    []
  );
  const [genderFilter, setGenderFilter] = useState('');
  const [ageGroupFilter, setAgeGroupFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [msg, setMsg] = useState('');
  const handleCleanDeletedEvent = async () => {
    if (!activeMeetId) {
      setMsg('No active meet selected.');
      return;
    }

    const targetEventId = '-Ooi7b5P9tJ4U9Q1KXHB';
    const targetNameIncludes = '25m Freestyle - Girls - U9';
    const paths = ['entries', 'results', 'seeding'];

    try {
      let deletedCount = 0;

      for (const path of paths) {
        const snapshot = await get(ref(db, `meets/${activeMeetId}/${path}`));
        if (!snapshot.exists()) continue;

        const promises: Promise<void>[] = [];

        snapshot.forEach((child) => {
          const data = child.val();

          const matchesEventId =
            data && String(data.eventId || '') === targetEventId;

          const matchesEventName =
            data &&
            String(data.eventName || '')
              .toLowerCase()
              .includes(targetNameIncludes.toLowerCase());

          const matchesSeedingKey = child.key === targetEventId;

          if (matchesEventId || matchesEventName || matchesSeedingKey) {
            deletedCount += 1;
            promises.push(remove(child.ref));
          }
        });

        await Promise.all(promises);
      }

      setMsg(
        `✅ U9 ghost event cleaned successfully (${deletedCount} records deleted)`
      );
    } catch (err) {
      console.error(err);
      setMsg('❌ Cleanup failed');
    }
  };

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  const eventMap = useMemo(() => {
    const map = new Map<string, EventRow>();
    events.forEach((row) => map.set(row.id, row));
    return map;
  }, [events]);

  const swimmerMap = useMemo(() => {
    const map = new Map<string, SwimmerRow>();
    swimmers.forEach((row) => map.set(row.id, row));
    return map;
  }, [swimmers]);

  const teamMap = useMemo(() => {
    const map = new Map<string, TeamRow>();
    teams.forEach((row) => map.set(row.id, row));
    return map;
  }, [teams]);

  const joinedResults = useMemo(() => {
    const rows: JoinedResultRow[] = [];
    const usedResultIds = new Set<string>();
    const resultsByEntryId = new Map<
      string,
      { resultId: string; result: ResultRow }
    >();

    Object.entries(results).forEach(([resultId, rawResult]) => {
      const result = rawResult as ResultRow;
      const entryId = String(result.entryId || resultId || '');
      if (entryId) {
        resultsByEntryId.set(entryId, { resultId, result });
      }
    });

    const buildJoinedRow = (
      resultId: string,
      result: ResultRow | null,
      entry: EntryRow | null
    ): JoinedResultRow => {
      const swimmer = swimmerMap.get(
        String(result?.swimmerId || entry?.swimmerId || '')
      );
      const event = eventMap.get(
        String(result?.eventId || entry?.eventId || '')
      );
      const team =
        teamMap.get(
          String(result?.teamId || entry?.teamId || swimmer?.teamId || '')
        ) || null;

      const eventName = buildEventDisplayName(
        event,
        String(result?.eventName || entry?.eventName || '')
      );

      return {
        resultId,
        entryId: String(result?.entryId || entry?.id || ''),
        swimmerId: String(
          result?.swimmerId || entry?.swimmerId || swimmer?.id || ''
        ),
        swimmerName: String(
          result?.swimmerName ||
            entry?.swimmerName ||
            swimmer?.fullName ||
            `${swimmer?.firstName || ''} ${swimmer?.lastName || ''}`.trim() ||
            ''
        ),
        gender: String(swimmer?.gender || entry?.gender || event?.gender || ''),
        ageGroup: String(
          swimmer?.ageGroup || entry?.ageGroup || event?.ageGroup || ''
        ),
        teamId: String(
          result?.teamId || entry?.teamId || swimmer?.teamId || team?.id || ''
        ),
        teamName: String(
          result?.teamName ||
            entry?.teamName ||
            swimmer?.teamName ||
            team?.name ||
            ''
        ),
        eventId: String(result?.eventId || entry?.eventId || event?.id || ''),
        eventNumber: Number(
          result?.eventNumber || entry?.eventNumber || event?.eventNumber || 0
        ),
        eventName,
        stroke: String(event?.stroke || ''),
        eventType: String(event?.eventType || ''),
        relay: !!event?.relay,
        heatNumber: Number(result?.heatNumber || 0),
        laneNumber: Number(result?.laneNumber || 0),
        seedTime: String(result?.seedTime || entry?.laneSeedTime || ''),
        heatFinalTime: String(result?.heatFinalTime || ''),
        status: normalizeStatus(
          result?.status || (isEntryScratched(entry) ? 'SCR' : 'OK')
        ),
        place: typeof result?.place === 'number' ? result.place : null,
      };
    };

    entries
      .filter((entry) => {
        if (entry.active === false) return false;
        if (!eventMap.has(String(entry.eventId || ''))) return false; // 🔥 prevents ghost events
        return true;
      })
      .forEach((entry) => {
        const match = resultsByEntryId.get(entry.id);
        if (match) {
          usedResultIds.add(match.resultId);
          rows.push(buildJoinedRow(match.resultId, match.result, entry));
          return;
        }

        rows.push(buildJoinedRow(`entry-${entry.id}`, null, entry));
      });

    Object.entries(results).forEach(([resultId, rawResult]) => {
      const result = rawResult as ResultRow;
      if (usedResultIds.has(resultId)) return;

      const entry = entries.find(
        (e) => e.id === String(result.entryId || resultId || '')
      );

      rows.push(buildJoinedRow(resultId, result, entry || null));
    });

    return rows.sort((a, b) => {
      if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
      const eventNameDiff = a.eventName.localeCompare(b.eventName);
      if (eventNameDiff !== 0) return eventNameDiff;
      if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
      if (a.laneNumber !== b.laneNumber) return a.laneNumber - b.laneNumber;
      return a.swimmerName.localeCompare(b.swimmerName);
    });
  }, [results, entries, swimmerMap, eventMap, teamMap]);

  const filteredResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return joinedResults.filter((row) => {
      if (eventFilter && row.eventId !== eventFilter) return false;
      if (genderFilter && row.gender !== genderFilter) return false;
      if (ageGroupFilter && row.ageGroup !== ageGroupFilter) return false;
      if (teamFilter && row.teamId !== teamFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;

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
    joinedResults,
    eventFilter,
    genderFilter,
    ageGroupFilter,
    teamFilter,
    statusFilter,
    searchTerm,
  ]);

  const rankedFilteredResults = useMemo(() => {
    if (!filteredResults.length) return [];

    const grouped = new Map<string, JoinedResultRow[]>();

    filteredResults.forEach((row) => {
      const key = row.eventId || `event-${row.eventNumber}`;
      const current = grouped.get(key) || [];
      current.push(row);
      grouped.set(key, current);
    });

    const output: JoinedResultRow[] = [];

    grouped.forEach((groupRows) => {
      const placeMap = computePlaces(groupRows);
      const sorted = sortRowsForRanking(groupRows).map((row) => ({
        ...row,
        place: placeMap[row.resultId] ?? null,
      }));
      output.push(...sorted);
    });

    return output.sort((a, b) => {
      if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
      if ((a.place ?? 9999) !== (b.place ?? 9999))
        return (a.place ?? 9999) - (b.place ?? 9999);
      if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
      if (a.laneNumber !== b.laneNumber) return a.laneNumber - b.laneNumber;
      return a.swimmerName.localeCompare(b.swimmerName);
    });
  }, [filteredResults]);

  const medalEventIdSet = useMemo(() => {
    return new Set(selectedMedalEventIds);
  }, [selectedMedalEventIds]);

  const medalRows = useMemo(() => {
    const grouped = new Map<string, JoinedResultRow[]>();

    rankedFilteredResults.forEach((row) => {
      if (
        selectedMedalEventIds.length > 0 &&
        !medalEventIdSet.has(row.eventId)
      ) {
        return;
      }
      const current = grouped.get(row.eventId) || [];
      current.push(row);
      grouped.set(row.eventId, current);
    });

    return Array.from(grouped.values())
      .map((groupRows) => {
        const podium = groupRows.filter((r) => (r.place ?? 9999) <= 3);
        return {
          eventId: groupRows[0]?.eventId || '',
          eventNumber: groupRows[0]?.eventNumber || 0,
          eventName: groupRows[0]?.eventName || '',
          gender: groupRows[0]?.gender || '',
          ageGroup: groupRows[0]?.ageGroup || '',
          stroke: groupRows[0]?.stroke || '',
          podium,
        };
      })
      .sort((a, b) => a.eventNumber - b.eventNumber);
  }, [rankedFilteredResults, selectedMedalEventIds, medalEventIdSet]);

  const teamPointsRows = useMemo(() => {
    const map = new Map<
      string,
      {
        teamId: string;
        teamName: string;
        gold: number;
        silver: number;
        bronze: number;
        totalPoints: number;
      }
    >();

    rankedFilteredResults.forEach((row) => {
      if (!row.teamId || !row.teamName) return;
      const place = row.place ?? 9999;
      if (!POINTS_BY_PLACE[place]) return;

      const current = map.get(row.teamId) || {
        teamId: row.teamId,
        teamName: row.teamName,
        gold: 0,
        silver: 0,
        bronze: 0,
        totalPoints: 0,
      };

      if (place === 1) current.gold += 1;
      if (place === 2) current.silver += 1;
      if (place === 3) current.bronze += 1;

      current.totalPoints += POINTS_BY_PLACE[place];
      map.set(row.teamId, current);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.gold !== a.gold) return b.gold - a.gold;
      if (b.silver !== a.silver) return b.silver - a.silver;
      return a.teamName.localeCompare(b.teamName);
    });
  }, [rankedFilteredResults]);

  const teamEntriesGroups = useMemo(() => {
    const filteredEntries = entries.filter((entry) => {
      if (entry.active === false) return false;

      const swimmer = swimmerMap.get(String(entry.swimmerId || ''));
      const event = eventMap.get(String(entry.eventId || ''));
      const teamId = String(entry.teamId || swimmer?.teamId || '');
      const teamName = String(
        entry.teamName || swimmer?.teamName || teamMap.get(teamId)?.name || ''
      );

      if (eventFilter && String(entry.eventId || '') !== eventFilter)
        return false;
      if (
        genderFilter &&
        String(swimmer?.gender || entry.gender || event?.gender || '') !==
          genderFilter
      )
        return false;
      if (
        ageGroupFilter &&
        String(swimmer?.ageGroup || entry.ageGroup || event?.ageGroup || '') !==
          ageGroupFilter
      )
        return false;
      if (teamFilter && teamId !== teamFilter) return false;

      const q = searchTerm.trim().toLowerCase();
      if (q) {
        const haystack = [
          swimmer?.fullName || '',
          entry.swimmerName || '',
          teamName,
          event?.name || entry.eventName || '',
          swimmer?.regNo || '',
          swimmer?.ageGroup || entry.ageGroup || '',
        ]
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    const teamMapGroup = new Map<string, TeamEntryGroup>();

    filteredEntries.forEach((entry) => {
      const swimmer = swimmerMap.get(String(entry.swimmerId || ''));
      const event = eventMap.get(String(entry.eventId || ''));
      const teamId = String(entry.teamId || swimmer?.teamId || '');
      const teamName = String(
        entry.teamName ||
          swimmer?.teamName ||
          teamMap.get(teamId)?.name ||
          'No Team'
      );

      if (!teamMapGroup.has(teamId || 'NO_TEAM')) {
        teamMapGroup.set(teamId || 'NO_TEAM', {
          teamId: teamId || 'NO_TEAM',
          teamName,
          swimmers: [],
        });
      }

      const teamGroup = teamMapGroup.get(teamId || 'NO_TEAM') as TeamEntryGroup;
      const swimmerId = String(
        entry.swimmerId || swimmer?.id || `entry-${entry.id}`
      );
      const swimmerName = String(
        entry.swimmerName ||
          swimmer?.fullName ||
          `${swimmer?.firstName || ''} ${swimmer?.lastName || ''}`.trim() ||
          'Unnamed Swimmer'
      );

      let swimmerGroup = teamGroup.swimmers.find(
        (s) => s.swimmerId === swimmerId
      );
      if (!swimmerGroup) {
        swimmerGroup = {
          swimmerId,
          swimmerName,
          gender: String(
            swimmer?.gender || entry.gender || event?.gender || ''
          ),
          ageGroup: String(
            swimmer?.ageGroup || entry.ageGroup || event?.ageGroup || ''
          ),
          regNo: String(swimmer?.regNo || ''),
          events: [],
        };
        teamGroup.swimmers.push(swimmerGroup);
      }

      swimmerGroup.events.push({
        entryId: entry.id,
        eventId: String(entry.eventId || event?.id || ''),
        eventNumber: Number(entry.eventNumber || event?.eventNumber || 0),
        eventName: String(entry.eventName || event?.name || ''),
        stroke: String(event?.stroke || ''),
        seedTime: String(entry.laneSeedTime || ''),
        status: String(entry.status || 'Entered'),
      });
    });

    return Array.from(teamMapGroup.values())
      .map((teamGroup) => ({
        ...teamGroup,
        swimmers: teamGroup.swimmers
          .map((swimmerGroup) => ({
            ...swimmerGroup,
            events: [...swimmerGroup.events].sort(
              (a, b) => a.eventNumber - b.eventNumber
            ),
          }))
          .sort((a, b) => a.swimmerName.localeCompare(b.swimmerName)),
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [
    entries,
    swimmerMap,
    eventMap,
    teamMap,
    eventFilter,
    genderFilter,
    ageGroupFilter,
    teamFilter,
    searchTerm,
  ]);

  const swimmerProfiles = useMemo(() => {
    const grouped = new Map<
      string,
      {
        swimmerId: string;
        swimmerName: string;
        gender: string;
        ageGroup: string;
        teamName: string;
        rows: JoinedResultRow[];
      }
    >();

    rankedFilteredResults.forEach((row) => {
      const current = grouped.get(row.swimmerId) || {
        swimmerId: row.swimmerId,
        swimmerName: row.swimmerName,
        gender: row.gender,
        ageGroup: row.ageGroup,
        teamName: row.teamName,
        rows: [],
      };
      current.rows.push(row);
      grouped.set(row.swimmerId, current);
    });

    return Array.from(grouped.values()).sort((a, b) =>
      a.swimmerName.localeCompare(b.swimmerName)
    );
  }, [rankedFilteredResults]);

  const exceptionRows = useMemo(() => {
    const rows: Array<{
      type: string;
      swimmerName: string;
      teamName: string;
      eventName: string;
      eventNumber: number;
      heatNumber: number;
      status: string;
      detail: string;
    }> = [];

    rankedFilteredResults.forEach((row) => {
      if (row.status !== 'OK') {
        rows.push({
          type: 'Result Status',
          swimmerName: row.swimmerName,
          teamName: row.teamName,
          eventName: row.eventName,
          eventNumber: row.eventNumber,
          heatNumber: row.heatNumber,
          status: row.status,
          detail: row.status,
        });
      } else if (!row.heatFinalTime) {
        rows.push({
          type: 'Missing Time',
          swimmerName: row.swimmerName,
          teamName: row.teamName,
          eventName: row.eventName,
          eventNumber: row.eventNumber,
          heatNumber: row.heatNumber,
          status: row.status,
          detail: 'No H/F time saved',
        });
      }
    });

    return rows.sort((a, b) => {
      if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
      if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
      return a.swimmerName.localeCompare(b.swimmerName);
    });
  }, [rankedFilteredResults]);

  const analyticsSummary = useMemo(() => {
    const participationByCategory = new Map<string, number>();
    const participationByTeam = new Map<string, number>();
    const fastestByStroke = new Map<
      string,
      {
        swimmerName: string;
        teamName: string;
        eventName: string;
        time: string;
        hundredths: number;
      }
    >();

    rankedFilteredResults.forEach((row) => {
      participationByCategory.set(
        row.ageGroup || 'Unspecified',
        (participationByCategory.get(row.ageGroup || 'Unspecified') || 0) + 1
      );

      participationByTeam.set(
        row.teamName || 'No Team',
        (participationByTeam.get(row.teamName || 'No Team') || 0) + 1
      );

      if (row.status === 'OK' && row.heatFinalTime && row.stroke) {
        const hundredths = parseSwimTimeToHundredths(row.heatFinalTime);
        if (hundredths !== null) {
          const current = fastestByStroke.get(row.stroke);
          if (!current || hundredths < current.hundredths) {
            fastestByStroke.set(row.stroke, {
              swimmerName: row.swimmerName,
              teamName: row.teamName,
              eventName: row.eventName,
              time: row.heatFinalTime,
              hundredths,
            });
          }
        }
      }
    });

    return {
      totalResults: rankedFilteredResults.length,
      totalEventsWithResults: new Set(
        rankedFilteredResults.map((r) => r.eventId)
      ).size,
      totalTeams: new Set(
        rankedFilteredResults.map((r) => r.teamId).filter(Boolean)
      ).size,
      participationByCategory: Array.from(
        participationByCategory.entries()
      ).sort((a, b) => a[0].localeCompare(b[0])),
      participationByTeam: Array.from(participationByTeam.entries()).sort(
        (a, b) => b[1] - a[1]
      ),
      fastestByStroke: Array.from(fastestByStroke.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      ),
    };
  }, [rankedFilteredResults]);

  const eventOptions = useMemo(() => {
    return [...events]
      .filter((event) => event.active !== false)
      .sort((a, b) => Number(a.eventNumber || 0) - Number(b.eventNumber || 0));
  }, [events]);

  const genderOptions = useMemo(() => {
    return Array.from(
      new Set(joinedResults.map((row) => row.gender).filter(Boolean))
    ).sort();
  }, [joinedResults]);

  const ageGroupOptions = useMemo(() => {
    return Array.from(
      new Set(joinedResults.map((row) => row.ageGroup).filter(Boolean))
    ).sort();
  }, [joinedResults]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    joinedResults.forEach((row) => {
      if (row.teamId && row.teamName) map.set(row.teamId, row.teamName);
    });

    teams.forEach((row) => {
      if (row.id && row.name) map.set(row.id, row.name);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [joinedResults, teams]);

  const medalSelectableEvents = useMemo(() => {
    const eventIdsWithPodiumData = new Set<string>();

    rankedFilteredResults.forEach((row) => {
      if ((row.place ?? 9999) <= 3) {
        eventIdsWithPodiumData.add(row.eventId);
      }
    });

    return eventOptions.filter((event) => eventIdsWithPodiumData.has(event.id));
  }, [eventOptions, rankedFilteredResults]);

  const selectedMedalEventLabel = useMemo(() => {
    if (selectedMedalEventIds.length === 0) return 'All podium events';
    if (selectedMedalEventIds.length === 1) {
      const event = eventOptions.find(
        (item) => item.id === selectedMedalEventIds[0]
      );
      return event
        ? `Event ${event.eventNumber || '—'} • ${event.name || 'Unnamed Event'}`
        : '1 selected event';
    }
    return `${selectedMedalEventIds.length} selected events`;
  }, [eventOptions, selectedMedalEventIds]);

  const toggleMedalEventSelection = (eventId: string) => {
    setSelectedMedalEventIds((current) => {
      if (current.includes(eventId)) {
        return current.filter((id) => id !== eventId);
      }
      return [...current, eventId];
    });
  };

  const selectAllMedalEvents = () => {
    setSelectedMedalEventIds(medalSelectableEvents.map((event) => event.id));
  };

  const clearMedalEventSelection = () => {
    setSelectedMedalEventIds([]);
  };

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
      setSwimmers([]);
      setTeams([]);
      setEntries([]);
      setResults({});
      return;
    }

    const eventsRef = ref(db, `meets/${activeMeetId}/events`);
    const swimmersRef = ref(db, `meets/${activeMeetId}/swimmers`);
    const teamsRef = ref(db, `meets/${activeMeetId}/teams`);
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
      setSwimmers(rows);
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
      setTeams(rows);
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
      unsubSwimmers();
      unsubTeams();
      unsubEntries();
      unsubResults();
    };
  }, [activeMeetId]);

  const buildPrintHtml = () => {
    const titleBase = activeMeet?.name || 'Swim Meet Reports';
    const subtitle = `${activeMeet?.venue || '—'} • ${activeMeet?.date || '—'}`;
    const filterLine = [
      tab === 'MEDALS'
        ? `Event: ${selectedMedalEventLabel}`
        : eventFilter
        ? `Event: ${
            eventOptions.find((e) => e.id === eventFilter)?.eventNumber || '—'
          }`
        : 'Event: All',
      genderFilter ? `Gender: ${genderFilter}` : 'Gender: All',
      ageGroupFilter ? `Category: ${ageGroupFilter}` : 'Category: All',
      teamFilter
        ? `Team: ${teamOptions.find((t) => t.id === teamFilter)?.name || '—'}`
        : 'Team: All',
      statusFilter ? `Status: ${statusFilter}` : 'Status: All',
    ].join(' • ');

    const wrap = (body: string, title: string) => `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body {
              font-family: Arial, Helvetica, sans-serif;
              color: #111;
              margin: 0;
              background: #fff;
            }
            .page-title {
              font-size: 22px;
              font-weight: 800;
              text-align: center;
            }
            .sub-title {
              font-size: 12px;
              text-align: center;
              margin-top: 4px;
              color: #444;
            }
            .filters {
              font-size: 11px;
              margin: 10px 0 14px;
              text-align: center;
              color: #555;
            }
            .section {
              margin-bottom: 16px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .section-title {
              font-size: 14px;
              font-weight: 700;
              padding-bottom: 4px;
              border-bottom: 2px solid #333;
              margin-bottom: 8px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            th, td {
              border: 1px solid #cfcfcf;
              padding: 4px 6px;
              font-size: 11px;
              vertical-align: top;
            }
            th {
              background: #f2f2f2;
              text-align: left;
            }
            .center { text-align: center; }
            .small { font-size: 10px; color: #555; }
            .team-card, .swimmer-card {
              border: 1px solid #d8d8d8;
              padding: 8px;
              margin-bottom: 10px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .team-head, .swimmer-head {
              font-size: 13px;
              font-weight: 700;
              margin-bottom: 6px;
            }
            .entry-list {
              margin: 0;
              padding-left: 18px;
              font-size: 11px;
            }
            .stats-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 10px;
            }
          </style>
        </head>
        <body>
          <div class="page-title">${escapeHtml(titleBase)}</div>
          <div class="sub-title">${escapeHtml(title)} • ${escapeHtml(
      subtitle
    )}</div>
          <div class="filters">${escapeHtml(filterLine)}</div>
          ${body}
          <script>
            window.onload = function () {
              window.print();
              window.onafterprint = function () { window.close(); };
            };
          </script>
        </body>
      </html>
    `;

    if (tab === 'EVENT_RESULTS') {
      const grouped = new Map<string, JoinedResultRow[]>();

      rankedFilteredResults.forEach((row) => {
        const key = row.eventId || `event-${row.eventNumber}`;
        const current = grouped.get(key) || [];
        current.push(row);
        grouped.set(key, current);
      });

      const sectionHtml = Array.from(grouped.values())
        .sort((a, b) => (a[0]?.eventNumber || 0) - (b[0]?.eventNumber || 0))
        .map((groupRows) => {
          const first = groupRows[0];
          const eventHeading = `Event ${first?.eventNumber || '—'} - ${
            first?.eventName || 'Unnamed Event'
          }`;

          const rows = groupRows
            .map(
              (row) => `
                <tr>
                  <td class="center">${row.place ?? '—'}</td>
                  <td class="center">${row.heatNumber || '—'}</td>
                  <td class="center">${row.laneNumber || '—'}</td>
                  <td>${escapeHtml(row.swimmerName || '—')}</td>
                  <td class="center">${escapeHtml(row.seedTime || '—')}</td>
                  <td class="center">${escapeHtml(
                    row.heatFinalTime || '—'
                  )}</td>
                  <td class="center">${escapeHtml(row.status || '—')}</td>
                </tr>
              `
            )
            .join('');

          return `
            <div class="section">
              <div class="section-title">${escapeHtml(eventHeading)}</div>
              <table>
                <thead>
                  <tr>
                    <th class="center" style="width:52px;">Place</th>
                    <th class="center" style="width:52px;">Heat</th>
                    <th class="center" style="width:52px;">Lane</th>
                    <th>Swimmer</th>
                    <th class="center" style="width:80px;">Seed</th>
                    <th class="center" style="width:84px;">H/F Time</th>
                    <th class="center" style="width:58px;">Status</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
        })
        .join('');

      return wrap(
        sectionHtml ||
          `
          <div class="section">
            <div class="section-title">Event Results Report</div>
            <div class="small">No results found.</div>
          </div>
        `,
        eventFilter
          ? eventOptions.find((e) => e.id === eventFilter)?.name
            ? `Event ${
                eventOptions.find((e) => e.id === eventFilter)?.eventNumber ||
                '—'
              } - ${eventOptions.find((e) => e.id === eventFilter)?.name || ''}`
            : 'Event Results Report'
          : 'Event Results Report'
      );
    }

    if (tab === 'MEDALS') {
      const body = medalRows
        .map(
          (row) => `
            <div class="section">
              <div class="section-title">${escapeHtml(
                `Event ${row.eventNumber} • ${row.eventName}`
              )}</div>
              <div class="small">${escapeHtml(
                `${row.gender} • ${row.ageGroup} • ${row.stroke}`
              )}</div>
              <table style="margin-top:6px;">
                <thead>
                  <tr>
                    <th style="width:60px;">Medal</th>
                    <th>Swimmer</th>
                    <th style="width:140px;">Team</th>
                    <th class="center" style="width:90px;">Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${row.podium
                    .map(
                      (p) => `
                    <tr>
                      <td>${
                        p.place === 1
                          ? 'Gold'
                          : p.place === 2
                          ? 'Silver'
                          : 'Bronze'
                      }</td>
                      <td>${escapeHtml(p.swimmerName)}</td>
                      <td>${escapeHtml(p.teamName)}</td>
                      <td class="center">${escapeHtml(
                        p.heatFinalTime || '—'
                      )}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `
        )
        .join('');

      return wrap(
        body ||
          `<div class="section"><div class="section-title">No medal data</div></div>`,
        selectedMedalEventIds.length > 0
          ? `Podium Finish Report • ${
              selectedMedalEventIds.length
            } Selected Event${selectedMedalEventIds.length === 1 ? '' : 's'}`
          : 'Podium Finish Report'
      );
    }

    if (tab === 'TEAM_POINTS') {
      const rows = teamPointsRows
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.teamName)}</td>
            <td class="center">${row.gold}</td>
            <td class="center">${row.silver}</td>
            <td class="center">${row.bronze}</td>
            <td class="center">${row.totalPoints}</td>
          </tr>
        `
        )
        .join('');

      return wrap(
        `
        <div class="section">
          <div class="section-title">Team Points</div>
          <div class="small">Points used: Gold = 5, Silver = 3, Bronze = 1</div>
          <table style="margin-top:6px;">
            <thead>
              <tr>
                <th>Team</th>
                <th class="center" style="width:80px;">Gold</th>
                <th class="center" style="width:80px;">Silver</th>
                <th class="center" style="width:80px;">Bronze</th>
                <th class="center" style="width:100px;">Total Points</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `,
        'Team Points Report'
      );
    }

    if (tab === 'TEAM_ENTRIES') {
      const body = teamEntriesGroups
        .map(
          (team) => `
          <div class="team-card">
            <div class="team-head">${escapeHtml(team.teamName)}</div>
            ${team.swimmers
              .map(
                (swimmer) => `
                <div class="swimmer-card">
                  <div class="swimmer-head">${escapeHtml(
                    swimmer.swimmerName
                  )} <span class="small">(${escapeHtml(
                  swimmer.gender
                )} • ${escapeHtml(swimmer.ageGroup)}${
                  swimmer.regNo ? ` • ${escapeHtml(swimmer.regNo)}` : ''
                })</span></div>
                  <ul class="entry-list">
                    ${swimmer.events
                      .map(
                        (ev) => `
                      <li>
                        ${escapeHtml(
                          `Event ${ev.eventNumber} • ${ev.eventName}`
                        )}
                        ${
                          ev.stroke
                            ? `<span class="small"> • ${escapeHtml(
                                ev.stroke
                              )}</span>`
                            : ''
                        }
                        ${
                          ev.seedTime
                            ? `<span class="small"> • Seed: ${escapeHtml(
                                ev.seedTime
                              )}</span>`
                            : ''
                        }
                      </li>
                    `
                      )
                      .join('')}
                  </ul>
                </div>
              `
              )
              .join('')}
          </div>
        `
        )
        .join('');

      return wrap(
        body ||
          `<div class="section"><div class="section-title">No team entries found</div></div>`,
        'Team-wise Entries Report'
      );
    }

    if (tab === 'SWIMMER_PROFILES') {
      const body = swimmerProfiles
        .map(
          (swimmer) => `
          <div class="swimmer-card">
            <div class="swimmer-head">${escapeHtml(
              swimmer.swimmerName
            )} <span class="small">(${escapeHtml(
            swimmer.teamName
          )} • ${escapeHtml(swimmer.gender)} • ${escapeHtml(
            swimmer.ageGroup
          )})</span></div>
            <table>
              <thead>
                <tr>
                  <th style="width:110px;">Event</th>
                  <th>Details</th>
                  <th class="center" style="width:80px;">Time</th>
                  <th class="center" style="width:60px;">Place</th>
                  <th class="center" style="width:70px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${swimmer.rows
                  .map(
                    (row) => `
                  <tr>
                    <td>${escapeHtml(`Event ${row.eventNumber}`)}</td>
                    <td>${escapeHtml(row.eventName)}</td>
                    <td class="center">${escapeHtml(
                      row.heatFinalTime || '—'
                    )}</td>
                    <td class="center">${row.place ?? '—'}</td>
                    <td class="center">${escapeHtml(row.status)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        )
        .join('');

      return wrap(
        body ||
          `<div class="section"><div class="section-title">No swimmer profiles found</div></div>`,
        'Swimmer Profiles Report'
      );
    }

    if (tab === 'EXCEPTIONS') {
      const rows = exceptionRows
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.type)}</td>
            <td>${escapeHtml(
              `Event ${row.eventNumber} • ${row.eventName}`
            )}</td>
            <td class="center">${row.heatNumber || '—'}</td>
            <td>${escapeHtml(row.swimmerName)}</td>
            <td>${escapeHtml(row.teamName)}</td>
            <td class="center">${escapeHtml(row.status)}</td>
            <td>${escapeHtml(row.detail)}</td>
          </tr>
        `
        )
        .join('');

      return wrap(
        `
        <div class="section">
          <div class="section-title">Exceptions Report</div>
          <table>
            <thead>
              <tr>
                <th style="width:110px;">Type</th>
                <th>Event</th>
                <th class="center" style="width:60px;">Heat</th>
                <th>Swimmer</th>
                <th style="width:140px;">Team</th>
                <th class="center" style="width:70px;">Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `,
        'Exceptions Report'
      );
    }

    const fastestRows = analyticsSummary.fastestByStroke
      .map(
        ([stroke, row]) => `
        <tr>
          <td>${escapeHtml(stroke)}</td>
          <td>${escapeHtml(row.swimmerName)}</td>
          <td>${escapeHtml(row.teamName)}</td>
          <td>${escapeHtml(row.eventName)}</td>
          <td class="center">${escapeHtml(row.time)}</td>
        </tr>
      `
      )
      .join('');

    const categoryRows = analyticsSummary.participationByCategory
      .map(
        ([label, count]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td class="center">${count}</td>
        </tr>
      `
      )
      .join('');

    const teamRows = analyticsSummary.participationByTeam
      .map(
        ([label, count]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td class="center">${count}</td>
        </tr>
      `
      )
      .join('');

    return wrap(
      `
      <div class="section">
        <div class="section-title">Analytics Summary</div>
        <div class="stats-grid">
          <div class="team-card">
            <div class="team-head">Overview</div>
            <div class="small">Results: ${analyticsSummary.totalResults}</div>
            <div class="small">Events with Results: ${analyticsSummary.totalEventsWithResults}</div>
            <div class="small">Teams: ${analyticsSummary.totalTeams}</div>
          </div>

          <div class="team-card">
            <div class="team-head">Participation by Category</div>
            <table>
              <thead>
                <tr><th>Category</th><th class="center" style="width:70px;">Count</th></tr>
              </thead>
              <tbody>${categoryRows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Fastest by Stroke</div>
        <table>
          <thead>
            <tr>
              <th style="width:120px;">Stroke</th>
              <th>Swimmer</th>
              <th style="width:140px;">Team</th>
              <th>Event</th>
              <th class="center" style="width:90px;">Time</th>
            </tr>
          </thead>
          <tbody>${fastestRows}</tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Participation by Team</div>
        <table>
          <thead>
            <tr><th>Team</th><th class="center" style="width:70px;">Count</th></tr>
          </thead>
          <tbody>${teamRows}</tbody>
        </table>
      </div>
    `,
      'Analytics Report'
    );
  };

  const handlePrint = () => {
    const html = buildPrintHtml();
    const printWindow = window.open('', '_blank', 'width=1100,height=900');
    if (!printWindow) {
      setMsg('Popup blocked. Please allow popups and try again.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <>
      <style>{`
        :root {
          --rp-bg: #eef3f8;
          --rp-panel: #ffffff;
          --rp-panel-2: #f7f9fc;
          --rp-line: #d4dbe5;
          --rp-text: #1d2b3a;
          --rp-sub: #60758a;
          --rp-blue: #4f89ff;
          --rp-yellow: #f4c542;
          --rp-green: #43a047;
          --rp-red: #d9534f;
          --rp-navy: #1f4f82;
          --rp-gold: #d4af37;
        }

        body {
          background: var(--rp-bg);
        }

        .reports-page {
          min-height: 100vh;
          background: var(--rp-bg);
          color: var(--rp-text);
          padding: 10px 10px 84px;
          font-family: Arial, Helvetica, sans-serif;
        }

        .reports-shell {
          display: grid;
          gap: 10px;
        }

        .reports-strip,
        .reports-tabs-wrap,
        .reports-filter-wrap,
        .reports-panel,
        .reports-footer {
          background: var(--rp-panel);
          border: 1px solid var(--rp-line);
        }

        .reports-strip {
          padding: 8px 12px;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          background: linear-gradient(90deg, #0f2d52 0%, #1f4f82 55%, #d4af37 100%);
          color: #fff;
        }

        .reports-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 800;
          letter-spacing: 0.2px;
          font-size: 26px;
        }

        .reports-brand img {
          width: 34px;
          height: 34px;
          object-fit: contain;
          background: rgba(255,255,255,0.92);
          padding: 3px;
          border-radius: 8px;
        }

        .reports-brand-sub {
          font-size: 12px;
          opacity: 0.92;
          font-weight: 600;
        }

        .reports-tabs-wrap {
          padding: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .reports-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .reports-tab {
          min-height: 40px;
          padding: 8px 12px;
          border: 1px solid #bfc9d6;
          background: #fff;
          color: var(--rp-text);
          font-weight: 700;
          cursor: pointer;
          font-size: 13px;
        }

        .reports-tab.active {
          background: #e8f0ff;
          color: #143e74;
          border-color: #8fb3e6;
        }

        .reports-btn,
        .reports-input,
        .reports-select {
          border: 1px solid #bfc9d6;
          background: #fff;
          color: var(--rp-text);
          min-height: 38px;
          padding: 8px 10px;
          font-size: 13px;
        }

        .reports-btn {
          cursor: pointer;
          font-weight: 700;
        }

        .reports-btn.primary {
          background: #e8f0ff;
          color: #143e74;
        }

        .reports-filter-wrap {
          padding: 10px;
          display: grid;
          gap: 10px;
        }

        .reports-filter-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 10px;
        }
        
        /* Tablet */
        @media (max-width: 1200px) {
          .reports-filter-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        
        /* Mobile */
        @media (max-width: 768px) {
          .reports-filter-grid {
            grid-template-columns: 1fr;
          }
        }
        .reports-select,
.reports-input {
  width: 100%;
  box-sizing: border-box;
  max-width: 100%;
}
.reports-filter-wrap > * {
  min-width: 0;
}

        .reports-label {
          display: block;
          margin-bottom: 6px;
          font-size: 12px;
          color: var(--rp-sub);
          font-weight: 700;
        }

        .reports-pills {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .reports-pill {
          border: 1px solid var(--rp-line);
          background: var(--rp-panel-2);
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--rp-text);
        }

        .reports-msg {
          color: #7b5a00;
          font-weight: 700;
          font-size: 13px;
        }

        .reports-panel {
          padding: 10px;
        }

        .reports-panel-title {
          font-size: 20px;
          font-weight: 800;
          color: var(--rp-navy);
          margin-bottom: 10px;
        }

        .reports-table-wrap {
          overflow: auto;
        }

        .reports-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          min-width: 1100px;
        }

        .reports-table th,
        .reports-table td {
          border: 1px solid var(--rp-line);
          padding: 6px 8px;
          font-size: 13px;
          vertical-align: top;
          background: #fff;
        }

        .reports-table th {
          background: #edf2f7;
          color: #19334d;
          font-weight: 700;
          text-align: left;
        }

        .reports-center {
          text-align: center;
        }

        .reports-muted {
          color: var(--rp-sub);
          font-size: 12px;
        }

        .reports-status {
          display: inline-block;
          padding: 4px 8px;
          border: 1px solid var(--rp-line);
          background: var(--rp-panel-2);
          font-size: 12px;
          font-weight: 700;
        }

        .reports-cards {
          display: grid;
          gap: 10px;
        }

        .reports-card {
          border: 1px solid var(--rp-line);
          background: #fff;
          padding: 10px;
        }

        .reports-card-title {
          font-size: 14px;
          font-weight: 800;
          color: var(--rp-navy);
          margin-bottom: 8px;
        }

        .reports-list {
          margin: 0;
          padding-left: 18px;
        }

        .reports-medal-select-panel {
          border: 1px solid var(--rp-line);
          background: #f8fbff;
          padding: 10px;
          margin-bottom: 10px;
        }

        .reports-medal-select-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }

        .reports-medal-select-title {
          font-size: 15px;
          font-weight: 800;
          color: var(--rp-navy);
        }

        .reports-medal-select-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .reports-medal-event-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 8px;
        }

        .reports-medal-event-card {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          border: 1px solid #d5deea;
          background: #fff;
          padding: 9px;
          cursor: pointer;
          user-select: none;
        }

        .reports-medal-event-card input {
          margin-top: 2px;
        }

        .reports-medal-event-card.active {
          border-color: #8fb3e6;
          background: #eaf2ff;
        }

        .reports-medal-event-main {
          font-size: 13px;
          font-weight: 800;
          color: #163c70;
        }

        .reports-medal-event-sub {
          font-size: 12px;
          color: var(--rp-sub);
          margin-top: 2px;
        }

        .reports-footer {
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

        @media (max-width: 900px) {
          .reports-tabs-wrap {
            align-items: flex-start;
          }

          .reports-brand {
            font-size: 20px;
          }
        }
      `}</style>

      <div className="reports-page">
        <div className="reports-shell">
          <div className="reports-strip">
            <div className="reports-brand">
              <img
                src="https://tbspanthers.british-school.org/wp-content/uploads/2024/12/TBS.png"
                alt="Panthers"
              />
              <div>
                <div>Panthers Swim Meet Manager</div>
                <div className="reports-brand-sub">Reports Console</div>
              </div>
            </div>

            <div style={{ fontWeight: 700 }}>{activeMeetLabel}</div>
          </div>

          <div className="reports-tabs-wrap">
            <div className="reports-tabs">
              {[
                ['EVENT_RESULTS', 'Event Results'],
                ['MEDALS', 'Medal Report'],
                ['TEAM_POINTS', 'Team Points'],
                ['TEAM_ENTRIES', 'Team Entries'],
                ['SWIMMER_PROFILES', 'Swimmer Profiles'],
                ['EXCEPTIONS', 'Exceptions'],
                ['ANALYTICS', 'Analytics'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`reports-tab ${tab === value ? 'active' : ''}`}
                  onClick={() => setTab(value as ReportTab)}
                >
                  {label}
                </button>
              ))}
            </div>

            <button className="reports-btn primary" onClick={handlePrint}>
              Print Current Report
            </button>
          </div>

          <div className="reports-filter-wrap">
            <div className="reports-filter-grid">
              <div>
                <label className="reports-label">Event</label>
                <select
                  className="reports-select"
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
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
                <label className="reports-label">Gender</label>
                <select
                  className="reports-select"
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value)}
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
                <label className="reports-label">Category</label>
                <select
                  className="reports-select"
                  value={ageGroupFilter}
                  onChange={(e) => setAgeGroupFilter(e.target.value)}
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
                <label className="reports-label">Team</label>
                <select
                  className="reports-select"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
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
                <label className="reports-label">Status</label>
                <select
                  className="reports-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All Status</option>
                  <option value="OK">OK</option>
                  <option value="DQ">DQ</option>
                  <option value="NS">NS</option>
                  <option value="SCR">SCR</option>
                </select>
              </div>

              <div>
                <label className="reports-label">Search</label>
                <input
                  className="reports-input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search swimmer, team, event..."
                />
              </div>
            </div>

            <div className="reports-pills">
              <span className="reports-pill">
                Results: {rankedFilteredResults.length}
              </span>
              <span className="reports-pill">Entries: {entries.length}</span>
              <span className="reports-pill">Teams: {teams.length}</span>
              <span className="reports-pill">Swimmers: {swimmers.length}</span>
              <span className="reports-pill">
                Points: Gold 5 • Silver 3 • Bronze 1
              </span>

              {/* 🔥 CLEANUP BUTTON */}
              {false && (
                <button
                  className="reports-btn"
                  style={{
                    background: '#ffe5e5',
                    borderColor: '#ffb3b3',
                    fontWeight: 800,
                  }}
                  onClick={handleCleanDeletedEvent}
                >
                  🧹 Clean Deleted Event (U9)
                </button>
              )}

              {msg ? (
                <span className="reports-pill reports-msg">{msg}</span>
              ) : null}
            </div>
          </div>

          <div className="reports-panel">
            {tab === 'EVENT_RESULTS' && (
              <>
                <div className="reports-panel-title">Event Results Report</div>
                <div className="reports-table-wrap">
                  <table className="reports-table">
                    <thead>
                      <tr>
                        <th className="reports-center" style={{ width: 56 }}>
                          Place
                        </th>
                        <th style={{ width: 150 }}>Event</th>
                        <th className="reports-center" style={{ width: 56 }}>
                          Heat
                        </th>
                        <th className="reports-center" style={{ width: 56 }}>
                          Lane
                        </th>
                        <th>Swimmer</th>
                        <th style={{ width: 150 }}>Team</th>
                        <th style={{ width: 90 }}>Category</th>
                        <th className="reports-center" style={{ width: 82 }}>
                          Seed
                        </th>
                        <th className="reports-center" style={{ width: 90 }}>
                          H/F Time
                        </th>
                        <th className="reports-center" style={{ width: 70 }}>
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedFilteredResults.length === 0 ? (
                        <tr>
                          <td
                            colSpan={10}
                            className="reports-center"
                            style={{ padding: 20 }}
                          >
                            No results found.
                          </td>
                        </tr>
                      ) : (
                        rankedFilteredResults.map((row) => (
                          <tr key={row.resultId}>
                            <td className="reports-center">
                              {row.place ?? '—'}
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                Event {row.eventNumber || '—'}
                              </div>
                              <div className="reports-muted">
                                {row.eventName || '—'}
                              </div>
                            </td>
                            <td className="reports-center">
                              {row.heatNumber || '—'}
                            </td>
                            <td className="reports-center">
                              {row.laneNumber || '—'}
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                {row.swimmerName || '—'}
                              </div>
                              <div className="reports-muted">
                                {row.gender || '—'} • {row.stroke || '—'}
                              </div>
                            </td>
                            <td>{row.teamName || '—'}</td>
                            <td>{row.ageGroup || '—'}</td>
                            <td className="reports-center">
                              {row.seedTime || '—'}
                            </td>
                            <td className="reports-center">
                              {row.heatFinalTime || '—'}
                            </td>
                            <td className="reports-center">
                              <span className="reports-status">
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'MEDALS' && (
              <>
                <div className="reports-panel-title">Medal / Podium Report</div>

                <div className="reports-medal-select-panel">
                  <div className="reports-medal-select-head">
                    <div>
                      <div className="reports-medal-select-title">
                        Select events for podium print
                      </div>
                      <div className="reports-muted">
                        {selectedMedalEventIds.length === 0
                          ? 'No event selected. Print will include all podium events shown below.'
                          : `${selectedMedalEventIds.length} event${
                              selectedMedalEventIds.length === 1 ? '' : 's'
                            } selected for podium/result print.`}
                      </div>
                    </div>

                    <div className="reports-medal-select-actions">
                      <button
                        type="button"
                        className="reports-btn"
                        onClick={selectAllMedalEvents}
                      >
                        Select All Podium Events
                      </button>
                      <button
                        type="button"
                        className="reports-btn"
                        onClick={clearMedalEventSelection}
                      >
                        Clear Selection
                      </button>
                      <button
                        type="button"
                        className="reports-btn primary"
                        onClick={handlePrint}
                      >
                        Print Selected Podium Results
                      </button>
                    </div>
                  </div>

                  {medalSelectableEvents.length === 0 ? (
                    <div className="reports-muted">
                      No events with podium data are available for the current
                      filters.
                    </div>
                  ) : (
                    <div className="reports-medal-event-grid">
                      {medalSelectableEvents.map((event) => {
                        const checked = selectedMedalEventIds.includes(
                          event.id
                        );

                        return (
                          <label
                            key={event.id}
                            className={`reports-medal-event-card ${
                              checked ? 'active' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleMedalEventSelection(event.id)
                              }
                            />
                            <span>
                              <span className="reports-medal-event-main">
                                Event {event.eventNumber || '—'} •{' '}
                                {event.name || 'Unnamed Event'}
                              </span>
                              <span className="reports-medal-event-sub">
                                {[event.gender, event.ageGroup, event.stroke]
                                  .filter(Boolean)
                                  .join(' • ') || 'Podium event'}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="reports-cards">
                  {medalRows.length === 0 ? (
                    <div className="reports-card">No podium data found.</div>
                  ) : (
                    medalRows.map((row) => (
                      <div key={row.eventId} className="reports-card">
                        <div className="reports-card-title">
                          Event {row.eventNumber} • {row.eventName}
                        </div>
                        <div
                          className="reports-muted"
                          style={{ marginBottom: 8 }}
                        >
                          {row.gender} • {row.ageGroup} • {row.stroke}
                        </div>

                        <div className="reports-table-wrap">
                          <table
                            className="reports-table"
                            style={{ minWidth: 720 }}
                          >
                            <thead>
                              <tr>
                                <th style={{ width: 80 }}>Medal</th>
                                <th>Swimmer</th>
                                <th style={{ width: 160 }}>Team</th>
                                <th
                                  className="reports-center"
                                  style={{ width: 90 }}
                                >
                                  Time
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.podium.map((p) => (
                                <tr key={p.resultId}>
                                  <td>
                                    {p.place === 1
                                      ? 'Gold'
                                      : p.place === 2
                                      ? 'Silver'
                                      : 'Bronze'}
                                  </td>
                                  <td>{p.swimmerName}</td>
                                  <td>{p.teamName}</td>
                                  <td className="reports-center">
                                    {p.heatFinalTime || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'TEAM_POINTS' && (
              <>
                <div className="reports-panel-title">Team Points Report</div>
                <div className="reports-table-wrap">
                  <table className="reports-table" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th className="reports-center" style={{ width: 80 }}>
                          Gold
                        </th>
                        <th className="reports-center" style={{ width: 80 }}>
                          Silver
                        </th>
                        <th className="reports-center" style={{ width: 80 }}>
                          Bronze
                        </th>
                        <th className="reports-center" style={{ width: 100 }}>
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamPointsRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="reports-center"
                            style={{ padding: 20 }}
                          >
                            No team points found.
                          </td>
                        </tr>
                      ) : (
                        teamPointsRows.map((row) => (
                          <tr key={row.teamId}>
                            <td style={{ fontWeight: 700 }}>{row.teamName}</td>
                            <td className="reports-center">{row.gold}</td>
                            <td className="reports-center">{row.silver}</td>
                            <td className="reports-center">{row.bronze}</td>
                            <td
                              className="reports-center"
                              style={{ fontWeight: 800 }}
                            >
                              {row.totalPoints}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'TEAM_ENTRIES' && (
              <>
                <div className="reports-panel-title">
                  Team-wise Entries Report
                </div>
                <div className="reports-cards">
                  {teamEntriesGroups.length === 0 ? (
                    <div className="reports-card">
                      No team-wise entries found.
                    </div>
                  ) : (
                    teamEntriesGroups.map((team) => (
                      <div key={team.teamId} className="reports-card">
                        <div className="reports-card-title">
                          {team.teamName}
                        </div>
                        <div className="reports-cards">
                          {team.swimmers.map((swimmer) => (
                            <div
                              key={swimmer.swimmerId}
                              className="reports-card"
                            >
                              <div style={{ fontWeight: 800 }}>
                                {swimmer.swimmerName}
                              </div>
                              <div
                                className="reports-muted"
                                style={{ marginBottom: 8 }}
                              >
                                {swimmer.gender || '—'} •{' '}
                                {swimmer.ageGroup || '—'}
                                {swimmer.regNo ? ` • ${swimmer.regNo}` : ''}
                              </div>

                              <ul className="reports-list">
                                {swimmer.events.map((event) => (
                                  <li
                                    key={event.entryId}
                                    style={{ marginBottom: 4 }}
                                  >
                                    <strong>Event {event.eventNumber}</strong> •{' '}
                                    {event.eventName}
                                    {event.stroke ? ` • ${event.stroke}` : ''}
                                    {event.seedTime
                                      ? ` • Seed: ${event.seedTime}`
                                      : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'SWIMMER_PROFILES' && (
              <>
                <div className="reports-panel-title">
                  Swimmer Profile Report
                </div>
                <div className="reports-cards">
                  {swimmerProfiles.length === 0 ? (
                    <div className="reports-card">
                      No swimmer profiles found.
                    </div>
                  ) : (
                    swimmerProfiles.map((swimmer) => (
                      <div key={swimmer.swimmerId} className="reports-card">
                        <div className="reports-card-title">
                          {swimmer.swimmerName}
                        </div>
                        <div
                          className="reports-muted"
                          style={{ marginBottom: 8 }}
                        >
                          {swimmer.teamName} • {swimmer.gender} •{' '}
                          {swimmer.ageGroup}
                        </div>

                        <div className="reports-table-wrap">
                          <table
                            className="reports-table"
                            style={{ minWidth: 760 }}
                          >
                            <thead>
                              <tr>
                                <th style={{ width: 110 }}>Event</th>
                                <th>Details</th>
                                <th
                                  className="reports-center"
                                  style={{ width: 62 }}
                                >
                                  Heat
                                </th>
                                <th
                                  className="reports-center"
                                  style={{ width: 62 }}
                                >
                                  Lane
                                </th>
                                <th
                                  className="reports-center"
                                  style={{ width: 90 }}
                                >
                                  Seed
                                </th>
                                <th
                                  className="reports-center"
                                  style={{ width: 90 }}
                                >
                                  H/F Time
                                </th>
                                <th
                                  className="reports-center"
                                  style={{ width: 60 }}
                                >
                                  Place
                                </th>
                                <th
                                  className="reports-center"
                                  style={{ width: 70 }}
                                >
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {swimmer.rows.map((row) => (
                                <tr key={row.resultId}>
                                  <td>Event {row.eventNumber || '—'}</td>
                                  <td>{row.eventName || '—'}</td>
                                  <td className="reports-center">
                                    {row.heatNumber || '—'}
                                  </td>
                                  <td className="reports-center">
                                    {row.laneNumber || '—'}
                                  </td>
                                  <td className="reports-center">
                                    {row.seedTime || '—'}
                                  </td>
                                  <td className="reports-center">
                                    {row.heatFinalTime || '—'}
                                  </td>
                                  <td className="reports-center">
                                    {row.place ?? '—'}
                                  </td>
                                  <td className="reports-center">
                                    {row.status}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'EXCEPTIONS' && (
              <>
                <div className="reports-panel-title">Exceptions Report</div>
                <div className="reports-table-wrap">
                  <table className="reports-table" style={{ minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 110 }}>Type</th>
                        <th>Event</th>
                        <th className="reports-center" style={{ width: 60 }}>
                          Heat
                        </th>
                        <th>Swimmer</th>
                        <th style={{ width: 140 }}>Team</th>
                        <th className="reports-center" style={{ width: 70 }}>
                          Status
                        </th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exceptionRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="reports-center"
                            style={{ padding: 20 }}
                          >
                            No exceptions found.
                          </td>
                        </tr>
                      ) : (
                        exceptionRows.map((row, index) => (
                          <tr key={`${row.type}-${row.swimmerName}-${index}`}>
                            <td>{row.type}</td>
                            <td>{`Event ${row.eventNumber} • ${row.eventName}`}</td>
                            <td className="reports-center">
                              {row.heatNumber || '—'}
                            </td>
                            <td>{row.swimmerName}</td>
                            <td>{row.teamName}</td>
                            <td className="reports-center">{row.status}</td>
                            <td>{row.detail}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'ANALYTICS' && (
              <>
                <div className="reports-panel-title">Analytics Report</div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div className="reports-card">
                    <div className="reports-card-title">Overview</div>
                    <div className="reports-muted">
                      Results: {analyticsSummary.totalResults}
                    </div>
                    <div className="reports-muted">
                      Events with Results:{' '}
                      {analyticsSummary.totalEventsWithResults}
                    </div>
                    <div className="reports-muted">
                      Teams: {analyticsSummary.totalTeams}
                    </div>
                  </div>

                  <div className="reports-card">
                    <div className="reports-card-title">
                      Participation by Category
                    </div>
                    <div className="reports-table-wrap">
                      <table
                        className="reports-table"
                        style={{ minWidth: 320 }}
                      >
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th
                              className="reports-center"
                              style={{ width: 70 }}
                            >
                              Count
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsSummary.participationByCategory.map(
                            ([label, count]) => (
                              <tr key={label}>
                                <td>{label}</td>
                                <td className="reports-center">{count}</td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="reports-card" style={{ marginBottom: 10 }}>
                  <div className="reports-card-title">Fastest by Stroke</div>
                  <div className="reports-table-wrap">
                    <table className="reports-table" style={{ minWidth: 820 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 120 }}>Stroke</th>
                          <th>Swimmer</th>
                          <th style={{ width: 150 }}>Team</th>
                          <th>Event</th>
                          <th className="reports-center" style={{ width: 90 }}>
                            Time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyticsSummary.fastestByStroke.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="reports-center"
                              style={{ padding: 20 }}
                            >
                              No fastest-swimmer data found.
                            </td>
                          </tr>
                        ) : (
                          analyticsSummary.fastestByStroke.map(
                            ([stroke, row]) => (
                              <tr key={stroke}>
                                <td>{stroke}</td>
                                <td>{row.swimmerName}</td>
                                <td>{row.teamName}</td>
                                <td>{row.eventName}</td>
                                <td className="reports-center">{row.time}</td>
                              </tr>
                            )
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="reports-card">
                  <div className="reports-card-title">
                    Participation by Team
                  </div>
                  <div className="reports-table-wrap">
                    <table className="reports-table" style={{ minWidth: 420 }}>
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th className="reports-center" style={{ width: 80 }}>
                            Count
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyticsSummary.participationByTeam.map(
                          ([label, count]) => (
                            <tr key={label}>
                              <td>{label}</td>
                              <td className="reports-center">{count}</td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="reports-footer">
            <div className="reports-pills">
              <span className="reports-pill">
                Current Report: {tab.replaceAll('_', ' ')}
              </span>
              <span className="reports-pill">
                Meet: {activeMeet?.name || '—'}
              </span>
            </div>

            <div className="reports-pills">
              <span className="reports-pill">
                Filtered Results: {rankedFilteredResults.length}
              </span>
              <span className="reports-pill">
                Printable: {tab === 'MEDALS' ? selectedMedalEventLabel : 'Yes'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
