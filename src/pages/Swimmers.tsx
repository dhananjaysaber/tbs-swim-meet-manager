import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from 'react';
import { push, ref, set, onValue, update, remove, get } from 'firebase/database';
import { auth } from '../firebase/auth';
import { db } from '../firebase/db';
import AppShell from '../components/AppShell';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  settings?: {
    categories?: Record<string, string>;
  };
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
  createdAt?: number;
  createdBy?: string;
};

type CsvSwimmerRow = {
  firstName: string;
  lastName: string;
  fullName: string;
  gender: string;
  ageGroup: string;
  team: string;
  teamId: string;
  teamName: string;
  dob: string;
  regNo: string;
  seedClub: string;
  active: boolean;
};

export default function Swimmers() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);
  const [meetCategories, setMeetCategories] = useState<string[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('Boys');
  const [ageGroup, setAgeGroup] = useState('');
  const [teamId, setTeamId] = useState('');
  const [dob, setDob] = useState('');
  const [seedClub, setSeedClub] = useState('');
  const [active, setActive] = useState(true);

  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [swimmers, setSwimmers] = useState<SwimmerRow[]>([]);

  const [csvRows, setCsvRows] = useState<CsvSwimmerRow[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [importing, setImporting] = useState(false);

  const [editingSwimmerId, setEditingSwimmerId] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editGender, setEditGender] = useState('Boys');
  const [editAgeGroup, setEditAgeGroup] = useState('');
  const [editTeamId, setEditTeamId] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editRegNo, setEditRegNo] = useState('');
  const [editSeedClub, setEditSeedClub] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [updatingSwimmerId, setUpdatingSwimmerId] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTeamId, setFilterTeamId] = useState('');
  const [selectedSwimmerIds, setSelectedSwimmerIds] = useState<string[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkTeamId, setBulkTeamId] = useState('');

  const activeTeams = useMemo(() => {
    return teams
      .filter((t) => t.active !== false)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [teams]);

  const teamsById = useMemo(() => {
    const map: Record<string, TeamRow> = {};
    teams.forEach((team) => {
      map[team.id] = team;
    });
    return map;
  }, [teams]);

  const selectedTeam = useMemo(() => {
    return activeTeams.find((t) => t.id === teamId) || null;
  }, [activeTeams, teamId]);

  const selectedEditTeam = useMemo(() => {
    return teams.find((t) => t.id === editTeamId) || null;
  }, [teams, editTeamId]);

  const selectedBulkTeam = useMemo(() => {
    return teams.find((t) => t.id === bulkTeamId) || null;
  }, [teams, bulkTeamId]);

  const getResolvedTeamName = (swimmer: SwimmerRow) => {
    const teamFromId = swimmer.teamId ? teamsById[swimmer.teamId] : null;
    return teamFromId?.name || swimmer.teamName || swimmer.team || 'No team';
  };

  const nextGeneratedRegNo = useMemo(() => {
    let maxNum = 0;

    swimmers.forEach((swimmer) => {
      const raw = String(swimmer.regNo || '').trim();
      const match = raw.match(/(\d+)(?!.*\d)/);
      if (!match) return;

      const n = Number(match[1]);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    });

    return `P${String(maxNum + 1).padStart(3, '0')}`;
  }, [swimmers]);

  const filteredSwimmers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    const rows = [...swimmers]
      .sort((a, b) => {
        const nameA = String(a.fullName || '').toLowerCase();
        const nameB = String(b.fullName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      })
      .filter((swimmer) => {
        if (!filterTeamId) return true;
        return swimmer.teamId === filterTeamId;
      });

    if (!q) return rows;

    return rows.filter((swimmer) => {
      const haystack = [
        swimmer.fullName || '',
        swimmer.firstName || '',
        swimmer.lastName || '',
        swimmer.regNo || '',
        getResolvedTeamName(swimmer),
        swimmer.gender || '',
        swimmer.ageGroup || '',
        swimmer.seedClub || '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [swimmers, searchTerm, filterTeamId, teamsById]);

  const selectedCount = selectedSwimmerIds.length;

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
      setMeetCategories([]);
      setAgeGroup('');
      setTeams([]);
      setTeamId('');
      setBulkTeamId('');
      return;
    }

    const meetRef = ref(db, `meets/${activeMeetId}`);
    const teamsRef = ref(db, `meets/${activeMeetId}/teams`);

    const unsubMeet = onValue(meetRef, (snap) => {
      if (!snap.exists()) {
        setActiveMeet(null);
        setMeetCategories([]);
        setAgeGroup('');
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

    const unsubTeams = onValue(teamsRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setTeams([]);
        setTeamId('');
        setBulkTeamId('');
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

      setTeamId((prev) => {
        if (prev && rows.some((t) => t.id === prev && t.active !== false)) {
          return prev;
        }
        const firstActive = rows.find((t) => t.active !== false);
        return firstActive?.id || '';
      });

      setEditTeamId((prev) => {
        if (prev && rows.some((t) => t.id === prev)) return prev;
        return prev;
      });

      setBulkTeamId((prev) => {
        if (prev && rows.some((t) => t.id === prev)) return prev;
        return '';
      });

      setFilterTeamId((prev) => {
        if (prev && rows.some((t) => t.id === prev)) return prev;
        return '';
      });
    });

    return () => {
      unsubMeet();
      unsubTeams();
    };
  }, [activeMeetId]);

  useEffect(() => {
    if (!selectedTeam) {
      setSeedClub('');
      return;
    }
    setSeedClub(selectedTeam.seedClub || '');
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedEditTeam) return;
    setEditSeedClub(selectedEditTeam.seedClub || '');
  }, [selectedEditTeam]);

  useEffect(() => {
    if (!activeMeetId) {
      setSwimmers([]);
      return;
    }

    const swimmersRef = ref(db, `meets/${activeMeetId}/swimmers`);

    const unsub = onValue(swimmersRef, (snap) => {
      const val = snap.val();

      if (!val) {
        setSwimmers([]);
        return;
      }

      const rows: SwimmerRow[] = Object.entries(val).map(([id, item]: any) => ({
        id,
        ...item,
      }));

      rows.sort((a, b) => {
        const nameA = (a.fullName || '').toLowerCase();
        const nameB = (b.fullName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setSwimmers(rows);
    });

    return () => unsub();
  }, [activeMeetId]);

  useEffect(() => {
    setSelectedSwimmerIds((prev) =>
      prev.filter((id) => filteredSwimmers.some((swimmer) => swimmer.id === id))
    );
  }, [filteredSwimmers]);

  const resetForm = () => {
    const defaultTeamId = activeTeams[0]?.id || '';
    const defaultTeam = activeTeams.find((t) => t.id === defaultTeamId) || null;

    setFirstName('');
    setLastName('');
    setGender('Boys');
    setAgeGroup(meetCategories[0] || '');
    setTeamId(defaultTeamId);
    setDob('');
    setSeedClub(defaultTeam?.seedClub || '');
    setActive(true);
  };

  const handleSaveSwimmer = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!firstName.trim()) {
      setMsg('Please enter first name');
      return;
    }

    if (!lastName.trim()) {
      setMsg('Please enter last name');
      return;
    }

    if (!teamId.trim()) {
      setMsg('Please select team / house / club');
      return;
    }

    if (!selectedTeam) {
      setMsg('Selected team / house / club is not valid');
      return;
    }

    if (!ageGroup) {
      setMsg('Please select a category / age group');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const generatedRegNo = nextGeneratedRegNo;

    setSaving(true);
    setMsg('Saving swimmer...');

    try {
      const newSwimmerRef = push(ref(db, `meets/${activeMeetId}/swimmers`));

      await set(newSwimmerRef, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fullName,
        gender,
        ageGroup,
        teamId: selectedTeam.id,
        teamName: selectedTeam.name || '',
        team: selectedTeam.name || '',
        dob,
        regNo: generatedRegNo,
        seedClub: selectedTeam.seedClub || '',
        active,
        createdAt: Date.now(),
        createdBy: user.uid,
      });

      setMsg(
        `Swimmer saved successfully with Registration No. ${generatedRegNo}`
      );
      resetForm();
    } catch (error: any) {
      setMsg(error.message || 'Failed to save swimmer');
    } finally {
      setSaving(false);
    }
  };

  const parseBoolean = (value: string) => {
    const text = String(value || '')
      .trim()
      .toLowerCase();
    return text === 'true' || text === 'yes' || text === '1';
  };

  const parseCsvText = (text: string): CsvSwimmerRow[] => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new Error('CSV must include headers and at least one data row');
    }

    const headers = lines[0].split(',').map((h) => h.trim());

    const requiredHeaders = [
      'First Name',
      'Last Name',
      'Gender',
      'Age Group',
      'Team',
      'DOB',
      'Registration No',
      'Seed Club',
      'Active',
    ];

    const missingHeaders = requiredHeaders.filter(
      (header) => !headers.includes(header)
    );

    if (missingHeaders.length > 0) {
      throw new Error(`Missing header(s): ${missingHeaders.join(', ')}`);
    }

    const getIndex = (header: string) => headers.indexOf(header);

    const rows: CsvSwimmerRow[] = lines.slice(1).map((line, rowIndex) => {
      const cols = line.split(',').map((c) => c.trim());

      const firstName = cols[getIndex('First Name')] || '';
      const lastName = cols[getIndex('Last Name')] || '';
      const gender = cols[getIndex('Gender')] || 'Boys';
      const ageGroup = cols[getIndex('Age Group')] || '';
      const teamNameRaw = cols[getIndex('Team')] || '';
      const dob = cols[getIndex('DOB')] || '';
      const regNo = cols[getIndex('Registration No')] || '';
      const seedClubFromCsv = cols[getIndex('Seed Club')] || '';
      const active = parseBoolean(cols[getIndex('Active')] || 'true');
      const fullName = `${firstName} ${lastName}`.trim();

      if (!firstName || !lastName || !teamNameRaw) {
        throw new Error(
          `Row ${rowIndex + 2}: First Name, Last Name and Team are required`
        );
      }

      if (!ageGroup) {
        throw new Error(`Row ${rowIndex + 2}: Age Group is required`);
      }

      const matchedTeam = activeTeams.find(
        (t) =>
          String(t.name || '')
            .trim()
            .toLowerCase() === String(teamNameRaw).trim().toLowerCase()
      );

      if (!matchedTeam) {
        throw new Error(
          `Row ${
            rowIndex + 2
          }: Team "${teamNameRaw}" not found in active meet teams`
        );
      }

      return {
        firstName,
        lastName,
        fullName,
        gender,
        ageGroup,
        team: matchedTeam.name || '',
        teamId: matchedTeam.id,
        teamName: matchedTeam.name || '',
        dob,
        regNo,
        seedClub: matchedTeam.seedClub || seedClubFromCsv || '',
        active,
      };
    });

    return rows;
  };

  const handleCsvFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMsg('');
    setCsvRows([]);
    setCsvFileName(file.name);

    try {
      const text = await file.text();
      const parsedRows = parseCsvText(text);
      setCsvRows(parsedRows);
      setMsg(
        `CSV loaded successfully: ${parsedRows.length} swimmer(s) ready to import`
      );
    } catch (error: any) {
      setCsvRows([]);
      setCsvFileName('');
      setMsg(error.message || 'Failed to read CSV');
    }

    event.target.value = '';
  };

  const handleImportCsv = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (csvRows.length === 0) {
      setMsg('Please choose a valid CSV file first');
      return;
    }

    if (meetCategories.length === 0) {
      setMsg('No categories found in the active meet');
      return;
    }

    if (activeTeams.length === 0) {
      setMsg('Please create teams first in the Teams page');
      return;
    }

    const invalidRows = csvRows.filter(
      (row) => !meetCategories.includes(row.ageGroup)
    );

    if (invalidRows.length > 0) {
      setMsg(
        `These CSV age groups do not match the active meet categories: ${Array.from(
          new Set(invalidRows.map((r) => r.ageGroup))
        ).join(', ')}`
      );
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setImporting(true);
    setMsg('Importing swimmers from CSV...');

    try {
      for (const row of csvRows) {
        const newSwimmerRef = push(ref(db, `meets/${activeMeetId}/swimmers`));

        await set(newSwimmerRef, {
          firstName: row.firstName,
          lastName: row.lastName,
          fullName: row.fullName,
          gender: row.gender,
          ageGroup: row.ageGroup,
          teamId: row.teamId,
          teamName: row.teamName,
          team: row.teamName,
          dob: row.dob,
          regNo: row.regNo,
          seedClub: row.seedClub,
          active: row.active,
          createdAt: Date.now(),
          createdBy: user.uid,
          importedFromCsv: true,
        });
      }

      setMsg(`CSV import completed: ${csvRows.length} swimmer(s) added`);
      setCsvRows([]);
      setCsvFileName('');
    } catch (error: any) {
      setMsg(error.message || 'Failed to import CSV swimmers');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const categoriesForTemplate =
      meetCategories.length > 0 ? meetCategories : ['U10', 'U12', 'U14'];

    const teamNamesForTemplate =
      activeTeams.length > 0
        ? activeTeams.map((t) => t.name || '')
        : ['Panthers Blue', 'Panthers Gold', 'Panthers White'];

    const sampleCategory1 = categoriesForTemplate[0] || 'U10';
    const sampleCategory2 =
      categoriesForTemplate[1] || categoriesForTemplate[0] || 'U12';
    const sampleCategory3 =
      categoriesForTemplate[2] || categoriesForTemplate[0] || 'U14';

    const sampleTeam1 = teamNamesForTemplate[0] || 'Panthers Blue';
    const sampleTeam2 =
      teamNamesForTemplate[1] || teamNamesForTemplate[0] || 'Panthers Gold';
    const sampleTeam3 =
      teamNamesForTemplate[2] || teamNamesForTemplate[0] || 'Panthers White';

    const blob = new Blob(
      [
        [
          [
            'First Name',
            'Last Name',
            'Gender',
            'Age Group',
            'Team',
            'DOB',
            'Registration No',
            'Seed Club',
            'Active',
          ].join(','),
          [
            'Aryan',
            'Singh',
            'Boys',
            sampleCategory1,
            sampleTeam1,
            '2012-05-12',
            'P001',
            'Leave blank or use team seed club',
            'true',
          ].join(','),
          [
            'Riya',
            'Sharma',
            'Girls',
            sampleCategory2,
            sampleTeam2,
            '2014-03-18',
            'P002',
            'Leave blank or use team seed club',
            'true',
          ].join(','),
          [
            'Kabir',
            'Mehta',
            'Boys',
            sampleCategory3,
            sampleTeam3,
            '2015-09-01',
            'P003',
            'Leave blank or use team seed club',
            'true',
          ].join(','),
        ].join('\n'),
      ],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.setAttribute('download', 'swimmers-import-template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const handleStartEdit = (swimmer: SwimmerRow) => {
    setEditingSwimmerId(swimmer.id);
    setEditFirstName(swimmer.firstName || '');
    setEditLastName(swimmer.lastName || '');
    setEditGender(swimmer.gender || 'Boys');
    setEditAgeGroup(swimmer.ageGroup || meetCategories[0] || '');

    const matchedTeam =
      teams.find((t) => t.id === swimmer.teamId) ||
      teams.find(
        (t) =>
          String(t.name || '')
            .trim()
            .toLowerCase() ===
          String(swimmer.teamName || swimmer.team || '')
            .trim()
            .toLowerCase()
      );

    setEditTeamId(matchedTeam?.id || '');
    setEditDob(swimmer.dob || '');
    setEditRegNo(swimmer.regNo || '');
    setEditSeedClub(matchedTeam?.seedClub || swimmer.seedClub || '');
    setEditActive(swimmer.active !== false);
  };

  const handleCancelEdit = () => {
    setEditingSwimmerId('');
    setEditFirstName('');
    setEditLastName('');
    setEditGender('Boys');
    setEditAgeGroup('');
    setEditTeamId('');
    setEditDob('');
    setEditRegNo('');
    setEditSeedClub('');
    setEditActive(true);
  };

  /**
   * Keep event entries and saved seeding in step with the swimmer record.
   * Entries / seeding lanes store a copy of the swimmer's name and team,
   * so without this an edit or delete leaves stale rows behind.
   */
  type SwimmerCascade =
    | { remove: true }
    | {
        remove?: false;
        swimmerName?: string;
        gender?: string;
        ageGroup?: string;
        teamId?: string;
        teamName?: string;
      };

  const cascadeSwimmerChanges = async (
    changes: Record<string, SwimmerCascade>
  ) => {
    if (!activeMeetId || Object.keys(changes).length === 0) return 0;

    const [entriesSnap, seedingSnap] = await Promise.all([
      get(ref(db, `meets/${activeMeetId}/entries`)),
      get(ref(db, `meets/${activeMeetId}/seeding`)),
    ]);

    const updates: Record<string, unknown> = {};

    const applyPatch = (
      basePath: string,
      change: SwimmerCascade,
      fields: Array<'swimmerName' | 'gender' | 'ageGroup' | 'teamId' | 'teamName'>
    ) => {
      if (change.remove) {
        updates[basePath] = null;
        return;
      }
      fields.forEach((field) => {
        const value = change[field];
        if (value !== undefined) updates[`${basePath}/${field}`] = value;
      });
    };

    const entriesVal = (entriesSnap.val() || {}) as Record<string, any>;
    Object.entries(entriesVal).forEach(([entryId, entry]) => {
      const change = changes[String(entry?.swimmerId || '')];
      if (!change) return;
      applyPatch(`entries/${entryId}`, change, [
        'swimmerName',
        'gender',
        'ageGroup',
        'teamId',
        'teamName',
      ]);
    });

    const seedingVal = (seedingSnap.val() || {}) as Record<string, any>;
    Object.entries(seedingVal).forEach(([eventId, eventNode]) => {
      Object.entries(eventNode?.heats || {}).forEach(
        ([heatKey, heatNode]: [string, any]) => {
          Object.entries(heatNode?.lanes || {}).forEach(
            ([laneKey, lane]: [string, any]) => {
              const change = changes[String(lane?.swimmerId || '')];
              if (!change) return;
              applyPatch(
                `seeding/${eventId}/heats/${heatKey}/lanes/${laneKey}`,
                change,
                ['swimmerName', 'teamId', 'teamName']
              );
            }
          );
        }
      );
    });

    if (Object.keys(updates).length === 0) return 0;
    await update(ref(db, `meets/${activeMeetId}`), updates);
    return Object.keys(updates).length;
  };

  const handleUpdateSwimmer = async (swimmerId: string) => {
    if (!editFirstName.trim()) {
      setMsg('Please enter first name');
      return;
    }

    if (!editLastName.trim()) {
      setMsg('Please enter last name');
      return;
    }

    if (!editTeamId.trim()) {
      setMsg('Please select team / house / club');
      return;
    }

    if (!selectedEditTeam) {
      setMsg('Selected team / house / club is not valid');
      return;
    }

    if (!editAgeGroup) {
      setMsg('Please select a category / age group');
      return;
    }

    setUpdatingSwimmerId(swimmerId);
    setMsg('Updating swimmer...');

    try {
      await update(ref(db, `meets/${activeMeetId}/swimmers/${swimmerId}`), {
        firstName: editFirstName.trim(),
        lastName: editLastName.trim(),
        fullName: `${editFirstName.trim()} ${editLastName.trim()}`.trim(),
        gender: editGender,
        ageGroup: editAgeGroup,
        teamId: selectedEditTeam.id,
        teamName: selectedEditTeam.name || '',
        team: selectedEditTeam.name || '',
        dob: editDob,
        regNo: editRegNo.trim(),
        seedClub: selectedEditTeam.seedClub || '',
        active: editActive,
      });

      await cascadeSwimmerChanges({
        [swimmerId]: {
          swimmerName: `${editFirstName.trim()} ${editLastName.trim()}`.trim(),
          gender: editGender,
          ageGroup: editAgeGroup,
          teamId: selectedEditTeam.id,
          teamName: selectedEditTeam.name || '',
        },
      });

      setMsg('Swimmer updated successfully');
      handleCancelEdit();
    } catch (error: any) {
      setMsg(error.message || 'Failed to update swimmer');
    } finally {
      setUpdatingSwimmerId('');
    }
  };

  const handleToggleSwimmerActive = async (swimmer: SwimmerRow) => {
    try {
      const nextValue = !swimmer.active;
      await update(ref(db, `meets/${activeMeetId}/swimmers/${swimmer.id}`), {
        active: nextValue,
      });
      setMsg(nextValue ? 'Swimmer activated' : 'Swimmer marked inactive');
    } catch (error: any) {
      setMsg(error.message || 'Failed to update swimmer status');
    }
  };

  const handleDeleteSwimmer = async (swimmer: SwimmerRow) => {
    const ok = window.confirm(
      `Delete swimmer "${swimmer.fullName || 'Unnamed Swimmer'}"?`
    );
    if (!ok) return;

    try {
      await remove(ref(db, `meets/${activeMeetId}/swimmers/${swimmer.id}`));
      await cascadeSwimmerChanges({ [swimmer.id]: { remove: true } });
      setMsg('Swimmer deleted (entries and seeding lanes removed)');
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete swimmer');
    }
  };

  const handleChooseCsv = () => {
    fileInputRef.current?.click();
  };

  const toggleSwimmerSelection = (swimmerId: string) => {
    setSelectedSwimmerIds((prev) => {
      if (prev.includes(swimmerId)) {
        return prev.filter((id) => id !== swimmerId);
      }
      return [...prev, swimmerId];
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedSwimmerIds(filteredSwimmers.map((swimmer) => swimmer.id));
  };

  const handleClearSelection = () => {
    setSelectedSwimmerIds([]);
  };

  const handleBulkSetActive = async (nextActive: boolean) => {
    if (selectedSwimmerIds.length === 0) {
      setMsg('Please select at least one swimmer');
      return;
    }

    setBulkProcessing(true);
    setMsg(
      nextActive ? 'Marking swimmers active...' : 'Marking swimmers inactive...'
    );

    try {
      for (const swimmerId of selectedSwimmerIds) {
        await update(ref(db, `meets/${activeMeetId}/swimmers/${swimmerId}`), {
          active: nextActive,
        });
      }

      setMsg(
        nextActive
          ? `${selectedSwimmerIds.length} swimmer(s) marked active`
          : `${selectedSwimmerIds.length} swimmer(s) marked inactive`
      );
      setSelectedSwimmerIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to update selected swimmers');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkAssignTeam = async () => {
    if (selectedSwimmerIds.length === 0) {
      setMsg('Please select at least one swimmer');
      return;
    }

    if (!bulkTeamId) {
      setMsg('Please select a team first for bulk update');
      return;
    }

    if (!selectedBulkTeam) {
      setMsg('Selected bulk team is not valid');
      return;
    }

    setBulkProcessing(true);
    setMsg('Updating selected swimmers team...');

    try {
      for (const swimmerId of selectedSwimmerIds) {
        await update(ref(db, `meets/${activeMeetId}/swimmers/${swimmerId}`), {
          teamId: selectedBulkTeam.id,
          teamName: selectedBulkTeam.name || '',
          team: selectedBulkTeam.name || '',
          seedClub: selectedBulkTeam.seedClub || '',
        });
      }

      await cascadeSwimmerChanges(
        Object.fromEntries(
          selectedSwimmerIds.map((id) => [
            id,
            {
              teamId: selectedBulkTeam.id,
              teamName: selectedBulkTeam.name || '',
            },
          ])
        )
      );

      setMsg(
        `${selectedSwimmerIds.length} swimmer(s) updated to ${
          selectedBulkTeam.name || 'selected team'
        }`
      );
      setSelectedSwimmerIds([]);
      setBulkTeamId('');
    } catch (error: any) {
      setMsg(error.message || 'Failed to update selected swimmers team');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSwimmerIds.length === 0) {
      setMsg('Please select at least one swimmer');
      return;
    }

    const ok = window.confirm(
      `Delete ${selectedSwimmerIds.length} selected swimmer(s)?`
    );
    if (!ok) return;

    setBulkProcessing(true);
    setMsg('Deleting selected swimmers...');

    try {
      for (const swimmerId of selectedSwimmerIds) {
        await remove(ref(db, `meets/${activeMeetId}/swimmers/${swimmerId}`));
      }

      await cascadeSwimmerChanges(
        Object.fromEntries(
          selectedSwimmerIds.map((id) => [id, { remove: true as const }])
        )
      );

      setMsg(`${selectedSwimmerIds.length} swimmer(s) deleted successfully`);
      setSelectedSwimmerIds([]);
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete selected swimmers');
    } finally {
      setBulkProcessing(false);
    }
  };

  const activeMeetLabel = useMemo(() => {
    if (!activeMeet) return 'No active meet selected';
    return `${activeMeet.name || 'Unnamed Meet'} • ${
      activeMeet.venue || 'No venue'
    } • ${activeMeet.date || 'No date'}`;
  }, [activeMeet]);

  return (
    <AppShell>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleCsvFileChange}
        style={{ display: 'none' }}
      />

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

          <div style={{ marginTop: 14 }}>
            <div style={{ color: '#9fb3c8', marginBottom: 8, fontSize: 13 }}>
              Teams / Houses / Clubs for this meet
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {activeTeams.length > 0 ? (
                activeTeams.map((team) => (
                  <span key={team.id} style={pillStyle}>
                    {team.name} {team.seedClub ? `• ${team.seedClub}` : ''}
                  </span>
                ))
              ) : (
                <span style={pillStyle}>No active teams found</span>
              )}
            </div>
          </div>
        </div>

        <div style={panelStyle}>
          <h1 style={{ marginTop: 0 }}>Upload Swimmers CSV</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            Upload swimmers in bulk for the active meet.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              marginTop: 12,
            }}
          >
            <button onClick={handleDownloadTemplate} style={secondaryBtnStyle}>
              Download Import Template
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: 16,
            }}
          >
            <button onClick={handleChooseCsv} style={secondaryBtnStyle}>
              Choose CSV File
            </button>

            <button
              onClick={handleImportCsv}
              disabled={importing || csvRows.length === 0}
              style={primaryBtnStyle}
            >
              {importing ? 'Importing...' : 'Import CSV'}
            </button>
          </div>

          <div style={{ marginTop: 16, color: '#9fb3c8' }}>
            <strong>Expected headers:</strong> First Name, Last Name, Gender,
            Age Group, Team, DOB, Registration No, Seed Club, Active
          </div>

          <div style={{ marginTop: 8, color: '#9fb3c8' }}>
            <strong>Allowed categories for this meet:</strong>{' '}
            {meetCategories.length > 0
              ? meetCategories.join(', ')
              : 'No categories found'}
          </div>

          <div style={{ marginTop: 8, color: '#9fb3c8' }}>
            <strong>Allowed teams for this meet:</strong>{' '}
            {activeTeams.length > 0
              ? activeTeams
                  .map(
                    (t) => `${t.name}${t.seedClub ? ` (${t.seedClub})` : ''}`
                  )
                  .join(', ')
              : 'No active teams found'}
          </div>

          {csvFileName ? (
            <div style={{ marginTop: 12, color: '#f1d67a' }}>
              Loaded file: {csvFileName}
            </div>
          ) : null}

          {csvRows.length > 0 ? (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ marginTop: 0 }}>CSV Preview</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {csvRows.slice(0, 5).map((row, idx) => (
                  <div
                    key={`${row.fullName}-${idx}`}
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12,
                      padding: 12,
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{row.fullName}</div>
                    <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                      {row.teamName} • {row.gender} • {row.ageGroup}
                    </div>
                    <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                      Seed Club / School: {row.seedClub || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        <div style={panelStyle}>
          <h1 style={{ marginTop: 0 }}>Add Swimmer Manually</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            Add swimmers one by one to the currently active meet.
          </p>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>First Name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Aryan"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Last Name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Singh"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                style={inputStyle}
              >
                <option value="Boys">Boys</option>
                <option value="Girls">Girls</option>
                <option value="Mixed">Mixed</option>
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
              <label style={labelStyle}>Team / House / Club</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                style={inputStyle}
              >
                {activeTeams.length === 0 ? (
                  <option value="">No teams found</option>
                ) : (
                  <>
                    <option value="">Select Team</option>
                    {activeTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Date of Birth</label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Registration No.</label>
              <input
                value={nextGeneratedRegNo}
                readOnly
                style={{
                  ...inputStyle,
                  background: 'rgba(255,255,255,0.03)',
                  color: '#f1d67a',
                  cursor: 'not-allowed',
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>Seed Club / School</label>
              <input
                value={seedClub}
                readOnly
                style={{
                  ...inputStyle,
                  background: 'rgba(255,255,255,0.03)',
                  color: '#f1d67a',
                  cursor: 'not-allowed',
                }}
              />
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
              <span>Swimmer active</span>
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
              onClick={handleSaveSwimmer}
              disabled={
                saving ||
                meetCategories.length === 0 ||
                activeTeams.length === 0
              }
              style={primaryBtnStyle}
            >
              {saving ? 'Saving...' : 'Save Swimmer'}
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
            }}
          >
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Saved Swimmers</h2>
              <div style={{ color: '#9fb3c8' }}>
                Search swimmers, filter by team and use bulk actions where
                needed.
              </div>
            </div>

            <div style={{ color: '#9fb3c8', fontSize: 13 }}>
              Total: {filteredSwimmers.length}
            </div>
          </div>

          {!activeMeetId ? (
            <p style={{ color: '#ffd6d3', marginTop: 16 }}>
              Please select an active meet first from the Meets page.
            </p>
          ) : swimmers.length === 0 ? (
            <p style={{ color: '#9fb3c8', marginTop: 16 }}>
              No swimmers added for this meet yet.
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
                  <label style={labelStyle}>Search Student</label>
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by name, reg no, team, gender, category..."
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Filter by Team</label>
                  <select
                    value={filterTeamId}
                    onChange={(e) => setFilterTeamId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">All Teams</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(220px, 320px) auto',
                  gap: 12,
                  alignItems: 'end',
                  marginTop: 16,
                }}
              >
                <div>
                  <label style={labelStyle}>Bulk Team Update</label>
                  <select
                    value={bulkTeamId}
                    onChange={(e) => setBulkTeamId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Select team to apply</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <button
                    onClick={handleBulkAssignTeam}
                    disabled={
                      selectedCount === 0 || bulkProcessing || !bulkTeamId
                    }
                    style={
                      selectedCount === 0 || bulkProcessing || !bulkTeamId
                        ? disabledBtnStyle
                        : secondaryBtnStyle
                    }
                  >
                    Apply Team to Selected ({selectedCount})
                  </button>
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
                <button
                  onClick={handleSelectAllFiltered}
                  disabled={filteredSwimmers.length === 0}
                  style={
                    filteredSwimmers.length === 0
                      ? disabledBtnStyle
                      : secondaryBtnStyle
                  }
                >
                  Select All Filtered
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
                  onClick={() => handleBulkSetActive(true)}
                  disabled={selectedCount === 0 || bulkProcessing}
                  style={
                    selectedCount === 0 || bulkProcessing
                      ? disabledBtnStyle
                      : secondaryBtnStyle
                  }
                >
                  Mark Active ({selectedCount})
                </button>

                <button
                  onClick={() => handleBulkSetActive(false)}
                  disabled={selectedCount === 0 || bulkProcessing}
                  style={
                    selectedCount === 0 || bulkProcessing
                      ? disabledBtnStyle
                      : secondaryBtnStyle
                  }
                >
                  Mark Inactive ({selectedCount})
                </button>

                <button
                  onClick={handleBulkDelete}
                  disabled={selectedCount === 0 || bulkProcessing}
                  style={
                    selectedCount === 0 || bulkProcessing
                      ? disabledBtnStyle
                      : dangerBtnStyle
                  }
                >
                  Delete Selected ({selectedCount})
                </button>
              </div>

              {filteredSwimmers.length === 0 ? (
                <p style={{ color: '#9fb3c8', marginTop: 16 }}>
                  No swimmers found for your search.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {filteredSwimmers.map((swimmer) => {
                    const isEditing = editingSwimmerId === swimmer.id;
                    const isSelected = selectedSwimmerIds.includes(swimmer.id);
                    const resolvedTeamName = getResolvedTeamName(swimmer);

                    return (
                      <div
                        key={swimmer.id}
                        style={{
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 16,
                          padding: 16,
                          background: 'rgba(255,255,255,0.04)',
                          opacity: swimmer.active === false ? 0.65 : 1,
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
                                    toggleSwimmerSelection(swimmer.id)
                                  }
                                  style={{
                                    marginTop: 4,
                                    transform: 'scale(1.2)',
                                  }}
                                />

                                <div>
                                  <div
                                    style={{ fontSize: 18, fontWeight: 700 }}
                                  >
                                    {swimmer.fullName || 'Unnamed Swimmer'}
                                  </div>
                                  <div
                                    style={{ color: '#9fb3c8', marginTop: 4 }}
                                  >
                                    {resolvedTeamName} • {swimmer.gender || '—'}{' '}
                                    • {swimmer.ageGroup || '—'}
                                  </div>
                                </div>
                              </div>

                              <div
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 999,
                                  background:
                                    swimmer.active === false
                                      ? 'rgba(217,83,79,0.16)'
                                      : 'rgba(46,175,109,0.16)',
                                  border:
                                    swimmer.active === false
                                      ? '1px solid rgba(217,83,79,0.35)'
                                      : '1px solid rgba(46,175,109,0.35)',
                                  color:
                                    swimmer.active === false
                                      ? '#ffd6d3'
                                      : '#d7ffe8',
                                  fontSize: 13,
                                  height: 'fit-content',
                                }}
                              >
                                {swimmer.active === false
                                  ? 'Inactive'
                                  : 'Active'}
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
                                Reg No: {swimmer.regNo || '—'}
                              </span>
                              <span style={pillStyle}>
                                DOB: {swimmer.dob || '—'}
                              </span>
                              <span style={pillStyle}>
                                Seed Club: {swimmer.seedClub || '—'}
                              </span>
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
                                onClick={() => handleStartEdit(swimmer)}
                                style={secondaryBtnStyle}
                              >
                                Edit
                              </button>

                              <button
                                onClick={() =>
                                  handleToggleSwimmerActive(swimmer)
                                }
                                style={secondaryBtnStyle}
                              >
                                {swimmer.active === false
                                  ? 'Activate'
                                  : 'Mark Inactive'}
                              </button>

                              <button
                                onClick={() => handleDeleteSwimmer(swimmer)}
                                style={dangerBtnStyle}
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <h3 style={{ marginTop: 0 }}>Edit Swimmer</h3>

                            <div style={gridStyle}>
                              <div>
                                <label style={labelStyle}>First Name</label>
                                <input
                                  value={editFirstName}
                                  onChange={(e) =>
                                    setEditFirstName(e.target.value)
                                  }
                                  style={inputStyle}
                                />
                              </div>

                              <div>
                                <label style={labelStyle}>Last Name</label>
                                <input
                                  value={editLastName}
                                  onChange={(e) =>
                                    setEditLastName(e.target.value)
                                  }
                                  style={inputStyle}
                                />
                              </div>

                              <div>
                                <label style={labelStyle}>Gender</label>
                                <select
                                  value={editGender}
                                  onChange={(e) =>
                                    setEditGender(e.target.value)
                                  }
                                  style={inputStyle}
                                >
                                  <option value="Boys">Boys</option>
                                  <option value="Girls">Girls</option>
                                  <option value="Mixed">Mixed</option>
                                </select>
                              </div>

                              <div>
                                <label style={labelStyle}>
                                  Category / Age Group
                                </label>
                                <select
                                  value={editAgeGroup}
                                  onChange={(e) =>
                                    setEditAgeGroup(e.target.value)
                                  }
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
                                <label style={labelStyle}>
                                  Team / House / Club
                                </label>
                                <select
                                  value={editTeamId}
                                  onChange={(e) =>
                                    setEditTeamId(e.target.value)
                                  }
                                  style={inputStyle}
                                >
                                  <option value="">Select Team</option>
                                  {teams.map((team) => (
                                    <option key={team.id} value={team.id}>
                                      {team.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label style={labelStyle}>Date of Birth</label>
                                <input
                                  type="date"
                                  value={editDob}
                                  onChange={(e) => setEditDob(e.target.value)}
                                  style={inputStyle}
                                />
                              </div>

                              <div>
                                <label style={labelStyle}>
                                  Registration No.
                                </label>
                                <input
                                  value={editRegNo}
                                  readOnly
                                  style={{
                                    ...inputStyle,
                                    background: 'rgba(255,255,255,0.03)',
                                    color: '#f1d67a',
                                    cursor: 'not-allowed',
                                  }}
                                />
                              </div>

                              <div>
                                <label style={labelStyle}>
                                  Seed Club / School
                                </label>
                                <input
                                  value={editSeedClub}
                                  readOnly
                                  style={{
                                    ...inputStyle,
                                    background: 'rgba(255,255,255,0.03)',
                                    color: '#f1d67a',
                                    cursor: 'not-allowed',
                                  }}
                                />
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
                                  onChange={(e) =>
                                    setEditActive(e.target.checked)
                                  }
                                />
                                <span>Swimmer active</span>
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
                                onClick={() => handleUpdateSwimmer(swimmer.id)}
                                disabled={updatingSwimmerId === swimmer.id}
                                style={primaryBtnStyle}
                              >
                                {updatingSwimmerId === swimmer.id
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
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

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

const checkRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: 'white',
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

const pillStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontSize: 13,
};
