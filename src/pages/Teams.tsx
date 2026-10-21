import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { push, ref, set, onValue, update, remove } from 'firebase/database';
import { auth } from '../firebase/auth';
import { db } from '../firebase/db';
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

type TeamPinRow = {
  pin?: string;
  active?: boolean;
  submitted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
  lastSubmittedAt?: number;
};

function generateFourDigitPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function formatDateTime(value?: number) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

export default function Teams() {
  const [activeMeetId, setActiveMeetId] = useState('');
  const [activeMeet, setActiveMeet] = useState<MeetRow | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [seedClub, setSeedClub] = useState('');
  const [active, setActive] = useState(true);

  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamPins, setTeamPins] = useState<Record<string, TeamPinRow>>({});

  const [editingTeamId, setEditingTeamId] = useState('');
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editSeedClub, setEditSeedClub] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [updatingTeamId, setUpdatingTeamId] = useState('');

  const [processingPinTeamId, setProcessingPinTeamId] = useState('');

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      const aActive = a.active === false ? 0 : 1;
      const bActive = b.active === false ? 0 : 1;
      if (aActive !== bActive) return bActive - aActive;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [teams]);

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
      setTeamPins({});
      return;
    }

    const teamsRef = ref(db, `meets/${activeMeetId}/teams`);
    const teamPinsRef = ref(db, `meets/${activeMeetId}/teamPins`);

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

    const unsubPins = onValue(teamPinsRef, (snap) => {
      setTeamPins((snap.val() as Record<string, TeamPinRow>) || {});
    });

    return () => {
      unsubTeams();
      unsubPins();
    };
  }, [activeMeetId]);

  const resetForm = () => {
    setName('');
    setCode('');
    setSeedClub('');
    setActive(true);
  };

  const handleSaveTeam = async () => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!name.trim()) {
      setMsg('Please enter team / house / club name');
      return;
    }

    const duplicateName = teams.find(
      (team) =>
        String(team.name || '')
          .trim()
          .toLowerCase() === name.trim().toLowerCase()
    );

    if (duplicateName) {
      setMsg('A team with this name already exists in the active meet');
      return;
    }

    const duplicateCode =
      code.trim() &&
      teams.find(
        (team) =>
          String(team.code || '')
            .trim()
            .toLowerCase() === code.trim().toLowerCase()
      );

    if (duplicateCode) {
      setMsg('A team with this code already exists in the active meet');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setSaving(true);
    setMsg('Saving team...');

    try {
      const newTeamRef = push(ref(db, `meets/${activeMeetId}/teams`));

      await set(newTeamRef, {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        seedClub: seedClub.trim(),
        active,
        createdAt: Date.now(),
        createdBy: user.uid,
      });

      setMsg('Team saved successfully');
      resetForm();
    } catch (error: any) {
      setMsg(error.message || 'Failed to save team');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (team: TeamRow) => {
    setEditingTeamId(team.id);
    setEditName(team.name || '');
    setEditCode(team.code || '');
    setEditSeedClub(team.seedClub || '');
    setEditActive(team.active !== false);
    setMsg('');
  };

  const handleCancelEdit = () => {
    setEditingTeamId('');
    setEditName('');
    setEditCode('');
    setEditSeedClub('');
    setEditActive(true);
    setMsg('');
  };

  const handleUpdateTeam = async (teamId: string) => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first from the Meets page');
      return;
    }

    if (!editName.trim()) {
      setMsg('Please enter team / house / club name');
      return;
    }

    const duplicateName = teams.find(
      (team) =>
        team.id !== teamId &&
        String(team.name || '')
          .trim()
          .toLowerCase() === editName.trim().toLowerCase()
    );

    if (duplicateName) {
      setMsg('Another team with this name already exists in the active meet');
      return;
    }

    const duplicateCode =
      editCode.trim() &&
      teams.find(
        (team) =>
          team.id !== teamId &&
          String(team.code || '')
            .trim()
            .toLowerCase() === editCode.trim().toLowerCase()
      );

    if (duplicateCode) {
      setMsg('Another team with this code already exists in the active meet');
      return;
    }

    setUpdatingTeamId(teamId);
    setMsg('Updating team...');

    try {
      await update(ref(db, `meets/${activeMeetId}/teams/${teamId}`), {
        name: editName.trim(),
        code: editCode.trim().toUpperCase(),
        seedClub: editSeedClub.trim(),
        active: editActive,
      });

      setMsg('Team updated successfully');
      handleCancelEdit();
    } catch (error: any) {
      setMsg(error.message || 'Failed to update team');
    } finally {
      setUpdatingTeamId('');
    }
  };

  const handleToggleTeamActive = async (team: TeamRow) => {
    try {
      const nextValue = !team.active;
      await update(ref(db, `meets/${activeMeetId}/teams/${team.id}`), {
        active: nextValue,
      });
      setMsg(nextValue ? 'Team activated' : 'Team marked inactive');
    } catch (error: any) {
      setMsg(error.message || 'Failed to update team status');
    }
  };

  const handleDeleteTeam = async (team: TeamRow) => {
    const ok = window.confirm(`Delete team "${team.name || 'Unnamed Team'}"?`);
    if (!ok) return;

    try {
      await remove(ref(db, `meets/${activeMeetId}/teams/${team.id}`));
      await remove(ref(db, `meets/${activeMeetId}/teamPins/${team.id}`));
      setMsg('Team deleted successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete team');
    }
  };

  const getTeamEntryLink = (teamId: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/team-entries?meetId=${encodeURIComponent(
      activeMeetId
    )}&teamId=${encodeURIComponent(teamId)}`;
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(successMessage);
    } catch {
      setMsg('Failed to copy to clipboard');
    }
  };

  const handleOpenTeamManager = (teamId: string) => {
    const url = getTeamEntryLink(teamId);
    window.open(url, '_blank', 'noopener,noreferrer');
    setMsg('Team manager opened in a new window');
  };

  const handleGeneratePin = async (team: TeamRow) => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const pin = generateFourDigitPin();

    setProcessingPinTeamId(team.id);
    setMsg(`Generating PIN for ${team.name || 'team'}...`);

    try {
      await set(ref(db, `meets/${activeMeetId}/teamPins/${team.id}`), {
        pin,
        active: true,
        submitted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: user.uid,
        updatedBy: user.uid,
      });

      setMsg(`PIN generated for ${team.name || 'team'}`);
    } catch (error: any) {
      setMsg(error.message || 'Failed to generate PIN');
    } finally {
      setProcessingPinTeamId('');
    }
  };

  const handleResetPin = async (team: TeamRow) => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const pin = generateFourDigitPin();

    setProcessingPinTeamId(team.id);
    setMsg(`Resetting PIN for ${team.name || 'team'}...`);

    try {
      await update(ref(db, `meets/${activeMeetId}/teamPins/${team.id}`), {
        pin,
        active: true,
        submitted: false,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      });

      setMsg(`PIN reset for ${team.name || 'team'}`);
    } catch (error: any) {
      setMsg(error.message || 'Failed to reset PIN');
    } finally {
      setProcessingPinTeamId('');
    }
  };

  const handleTogglePinActive = async (team: TeamRow) => {
    if (!activeMeetId) {
      setMsg('Please select an active meet first');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    const currentPin = teamPins[team.id];
    if (!currentPin?.pin) {
      setMsg('Generate a PIN first for this team');
      return;
    }

    const nextValue = !(currentPin.active !== false);

    setProcessingPinTeamId(team.id);
    setMsg(
      `${nextValue ? 'Activating' : 'Deactivating'} PIN for ${
        team.name || 'team'
      }...`
    );

    try {
      await update(ref(db, `meets/${activeMeetId}/teamPins/${team.id}`), {
        active: nextValue,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      });

      setMsg(
        nextValue
          ? `PIN activated for ${team.name || 'team'}`
          : `PIN deactivated for ${team.name || 'team'}`
      );
    } catch (error: any) {
      setMsg(error.message || 'Failed to update PIN status');
    } finally {
      setProcessingPinTeamId('');
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
          <h1 style={{ marginTop: 0 }}>Create Team / House / Club</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            Create teams for the currently active meet.
          </p>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Team / House / Club Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Panthers Blue"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="PB"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Seed Club / School</label>
              <input
                value={seedClub}
                onChange={(e) => setSeedClub(e.target.value)}
                placeholder="TBS Panthers"
                style={inputStyle}
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
              <span>Team active</span>
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
              onClick={handleSaveTeam}
              disabled={saving}
              style={primaryBtnStyle}
            >
              {saving ? 'Saving...' : 'Save Team'}
            </button>

            <button onClick={resetForm} style={secondaryBtnStyle}>
              Reset
            </button>
          </div>

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        <div style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Saved Teams</h2>

          {!activeMeetId ? (
            <p style={{ color: '#ffd6d3' }}>
              Please select an active meet first from the Meets page.
            </p>
          ) : sortedTeams.length === 0 ? (
            <p style={{ color: '#9fb3c8' }}>
              No teams added for this meet yet.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {sortedTeams.map((team) => {
                const isEditing = editingTeamId === team.id;
                const pinRow = teamPins[team.id];
                const teamLink = getTeamEntryLink(team.id);
                const isPinActive = pinRow?.active !== false && !!pinRow?.pin;
                const isProcessing = processingPinTeamId === team.id;

                return (
                  <div
                    key={team.id}
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: 16,
                      background: 'rgba(255,255,255,0.04)',
                      opacity: team.active === false ? 0.65 : 1,
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
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700 }}>
                              {team.name || 'Unnamed Team'}
                            </div>
                            <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                              Code: {team.code || '—'}
                            </div>
                            <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                              Seed Club / School: {team.seedClub || '—'}
                            </div>
                          </div>

                          <div
                            style={{
                              padding: '8px 12px',
                              borderRadius: 999,
                              background:
                                team.active === false
                                  ? 'rgba(217,83,79,0.16)'
                                  : 'rgba(46,175,109,0.16)',
                              border:
                                team.active === false
                                  ? '1px solid rgba(217,83,79,0.35)'
                                  : '1px solid rgba(46,175,109,0.35)',
                              color:
                                team.active === false ? '#ffd6d3' : '#d7ffe8',
                              fontSize: 13,
                              height: 'fit-content',
                            }}
                          >
                            {team.active === false ? 'Inactive' : 'Active'}
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 14,
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 14,
                            overflowX: 'auto',
                          }}
                        >
                          <table
                            style={{
                              width: '100%',
                              borderCollapse: 'collapse',
                              minWidth: 760,
                            }}
                          >
                            <thead>
                              <tr
                                style={{ background: 'rgba(255,255,255,0.06)' }}
                              >
                                <th style={thStyle}>Manager PIN</th>
                                <th style={thStyle}>PIN Status</th>
                                <th style={thStyle}>Submitted</th>
                                <th style={thStyle}>Last Submitted</th>
                                <th style={thStyle}>Team Manager</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td style={tdStyle}>
                                  {pinRow?.pin ? (
                                    <span
                                      style={{
                                        fontWeight: 800,
                                        letterSpacing: 2,
                                        color: '#f1d67a',
                                      }}
                                    >
                                      {pinRow.pin}
                                    </span>
                                  ) : (
                                    'Not generated'
                                  )}
                                </td>

                                <td style={tdStyle}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '6px 10px',
                                      borderRadius: 999,
                                      background: isPinActive
                                        ? 'rgba(46,175,109,0.16)'
                                        : 'rgba(217,83,79,0.16)',
                                      border: isPinActive
                                        ? '1px solid rgba(46,175,109,0.35)'
                                        : '1px solid rgba(217,83,79,0.35)',
                                      color: isPinActive
                                        ? '#d7ffe8'
                                        : '#ffd6d3',
                                      fontSize: 12,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {isPinActive ? 'Active' : 'Inactive'}
                                  </span>
                                </td>

                                <td style={tdStyle}>
                                  {pinRow?.submitted ? 'Yes' : 'No'}
                                </td>

                                <td style={tdStyle}>
                                  {formatDateTime(pinRow?.lastSubmittedAt)}
                                </td>

                                <td style={tdStyle}>
                                  {pinRow?.pin ? (
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: 8,
                                        flexWrap: 'wrap',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <button
                                        onClick={() =>
                                          copyText(
                                            teamLink,
                                            'Team manager link copied'
                                          )
                                        }
                                        style={secondaryBtnStyle}
                                      >
                                        Copy Link
                                      </button>

                                      <button
                                        onClick={() =>
                                          handleOpenTeamManager(team.id)
                                        }
                                        style={secondaryBtnStyle}
                                      >
                                        Open Team Manager
                                      </button>

                                      <button
                                        onClick={() =>
                                          copyText(
                                            `${team.name || 'Team'} PIN: ${
                                              pinRow.pin
                                            }\n${teamLink}`,
                                            'PIN and team manager link copied'
                                          )
                                        }
                                        style={secondaryBtnStyle}
                                      >
                                        Copy PIN + Link
                                      </button>
                                    </div>
                                  ) : (
                                    'Generate PIN first'
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
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
                            onClick={() => handleStartEdit(team)}
                            style={secondaryBtnStyle}
                          >
                            Edit Team
                          </button>

                          <button
                            onClick={() => handleToggleTeamActive(team)}
                            style={secondaryBtnStyle}
                          >
                            {team.active === false
                              ? 'Activate Team'
                              : 'Mark Team Inactive'}
                          </button>

                          {!pinRow?.pin ? (
                            <button
                              onClick={() => handleGeneratePin(team)}
                              disabled={isProcessing}
                              style={primaryBtnStyle}
                            >
                              {isProcessing ? 'Generating...' : 'Generate PIN'}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleResetPin(team)}
                                disabled={isProcessing}
                                style={primaryBtnStyle}
                              >
                                {isProcessing ? 'Resetting...' : 'Reset PIN'}
                              </button>

                              <button
                                onClick={() => handleTogglePinActive(team)}
                                disabled={isProcessing}
                                style={secondaryBtnStyle}
                              >
                                {isPinActive
                                  ? 'Deactivate PIN'
                                  : 'Activate PIN'}
                              </button>
                            </>
                          )}

                          <button
                            onClick={() => handleDeleteTeam(team)}
                            style={dangerBtnStyle}
                          >
                            Delete Team
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <h3 style={{ marginTop: 0 }}>Edit Team</h3>

                        <div style={gridStyle}>
                          <div>
                            <label style={labelStyle}>
                              Team / House / Club Name
                            </label>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Code</label>
                            <input
                              value={editCode}
                              onChange={(e) => setEditCode(e.target.value)}
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Seed Club / School</label>
                            <input
                              value={editSeedClub}
                              onChange={(e) => setEditSeedClub(e.target.value)}
                              placeholder="TBS Panthers"
                              style={inputStyle}
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
                              onChange={(e) => setEditActive(e.target.checked)}
                            />
                            <span>Team active</span>
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
                            onClick={() => handleUpdateTeam(team.id)}
                            disabled={updatingTeamId === team.id}
                            style={primaryBtnStyle}
                          >
                            {updatingTeamId === team.id
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
  boxSizing: 'border-box',
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

const dangerBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(217,83,79,0.35)',
  background: 'rgba(217,83,79,0.16)',
  color: '#ffd6d3',
  fontWeight: 700,
  cursor: 'pointer',
};

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
  verticalAlign: 'top',
};
