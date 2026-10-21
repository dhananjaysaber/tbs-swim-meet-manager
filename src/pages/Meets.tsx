import { useEffect, useState, type CSSProperties } from 'react';
import { push, ref, set, onValue, update, remove } from 'firebase/database';
import { auth } from '../firebase/auth';
import { db } from '../firebase/db';
import AppShell from '../components/AppShell';

type MeetRow = {
  id: string;
  name?: string;
  venue?: string;
  date?: string;
  type?: string;
  laneCount?: number;
  poolLength?: number;
  pointsEnabled?: boolean;
  relayEnabled?: boolean;
  fanVisible?: boolean;
  status?: string;
  active?: boolean;
  createdBy?: string;
  createdAt?: number;
  settings?: {
    categories?: Record<string, string>;
  };
};

export default function Meets() {
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState('time_trial');
  const [laneCount, setLaneCount] = useState('8');
  const [poolLength, setPoolLength] = useState('25');
  const [pointsEnabled, setPointsEnabled] = useState(true);
  const [relayEnabled, setRelayEnabled] = useState(true);
  const [fanVisible, setFanVisible] = useState(true);
  const [categoriesText, setCategoriesText] = useState(
    'U8, U10, U12, U14, U16, Open'
  );

  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [meets, setMeets] = useState<MeetRow[]>([]);
  const [activeMeetId, setActiveMeetId] = useState('');

  const [editingMeetId, setEditingMeetId] = useState('');
  const [editName, setEditName] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editType, setEditType] = useState('time_trial');
  const [editLaneCount, setEditLaneCount] = useState('8');
  const [editPoolLength, setEditPoolLength] = useState('25');
  const [editPointsEnabled, setEditPointsEnabled] = useState(true);
  const [editRelayEnabled, setEditRelayEnabled] = useState(true);
  const [editFanVisible, setEditFanVisible] = useState(true);
  const [editCategoriesText, setEditCategoriesText] = useState('');
  const [updatingMeetId, setUpdatingMeetId] = useState('');

  useEffect(() => {
    const meetsRef = ref(db, 'meets');

    const unsub = onValue(
      meetsRef,
      (snap) => {
        console.log('RTDB meets snapshot exists:', snap.exists());
        console.log('RTDB meets snapshot value:', snap.val());

        const val = snap.val();

        if (!val) {
          console.log('No data returned from /meets');
          setMeets([]);
          return;
        }

        const rows: MeetRow[] = Object.entries(val).map(([id, item]: any) => ({
          id,
          ...item,
        }));

        console.log('Mapped meets rows:', rows);

        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setMeets(rows);
      },
      (error) => {
        console.error('Failed to read /meets:', error);
        setMsg(error.message || 'Failed to load meets');
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const activeRef = ref(db, 'appState/activeMeetId');

    const unsub = onValue(activeRef, (snap) => {
      setActiveMeetId(snap.val() || '');
    });

    return () => unsub();
  }, []);

  const resetForm = () => {
    setName('');
    setVenue('');
    setDate('');
    setType('time_trial');
    setLaneCount('8');
    setPoolLength('25');
    setPointsEnabled(true);
    setRelayEnabled(true);
    setFanVisible(true);
    setCategoriesText('U8, U10, U12, U14, U16, Open');
  };

  const buildCategoriesObject = (rawText: string) => {
    const parts = rawText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const uniqueParts = Array.from(new Set(parts));

    if (uniqueParts.length === 0) return null;

    const result: Record<string, string> = {};
    uniqueParts.forEach((item, index) => {
      result[`cat${index + 1}`] = item;
    });

    return result;
  };

  const categoriesToText = (meet: MeetRow) => {
    return Object.values(meet.settings?.categories || {}).join(', ');
  };

  const handleCreateMeet = async () => {
    if (!name.trim()) {
      setMsg('Please enter the meet name');
      return;
    }

    if (!venue.trim()) {
      setMsg('Please enter the venue');
      return;
    }

    if (!date) {
      setMsg('Please select the meet date');
      return;
    }

    const categories = buildCategoriesObject(categoriesText);
    if (!categories) {
      setMsg('Please enter at least one category');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setMsg('You are not logged in');
      return;
    }

    setSaving(true);
    setMsg('Saving meet...');

    try {
      const newMeetRef = push(ref(db, 'meets'));

      await set(newMeetRef, {
        name: name.trim(),
        venue: venue.trim(),
        date,
        type,
        laneCount: Number(laneCount),
        poolLength: Number(poolLength),
        pointsEnabled,
        relayEnabled,
        fanVisible,
        status: 'setup',
        active: true,
        createdBy: user.uid,
        createdAt: Date.now(),
        settings: {
          categories,
        },
      });

      setMsg('Meet created successfully');
      resetForm();
    } catch (error: any) {
      setMsg(error.message || 'Failed to create meet');
    } finally {
      setSaving(false);
    }
  };

  const handleSetActiveMeet = async (meetId: string) => {
    try {
      const meet = meets.find((m) => m.id === meetId);

      if (!meet) {
        setMsg('Meet not found');
        return;
      }

      if (meet.active === false) {
        setMsg('Cannot select an inactive meet');
        return;
      }

      await set(ref(db, 'appState/activeMeetId'), meetId);
      setMsg('Active meet selected');
    } catch (error: any) {
      setMsg(error.message || 'Failed to set active meet');
    }
  };

  const handleStartEdit = (meet: MeetRow) => {
    setEditingMeetId(meet.id);
    setEditName(meet.name || '');
    setEditVenue(meet.venue || '');
    setEditDate(meet.date || '');
    setEditType(meet.type || 'time_trial');
    setEditLaneCount(String(meet.laneCount || 8));
    setEditPoolLength(String(meet.poolLength || 25));
    setEditPointsEnabled(Boolean(meet.pointsEnabled));
    setEditRelayEnabled(Boolean(meet.relayEnabled));
    setEditFanVisible(meet.fanVisible !== false);
    setEditCategoriesText(categoriesToText(meet));
  };

  const handleCancelEdit = () => {
    setEditingMeetId('');
    setEditName('');
    setEditVenue('');
    setEditDate('');
    setEditType('time_trial');
    setEditLaneCount('8');
    setEditPoolLength('25');
    setEditPointsEnabled(true);
    setEditRelayEnabled(true);
    setEditFanVisible(true);
    setEditCategoriesText('');
  };

  const handleUpdateMeet = async (meetId: string) => {
    if (!editName.trim()) {
      setMsg('Please enter the meet name');
      return;
    }

    if (!editVenue.trim()) {
      setMsg('Please enter the venue');
      return;
    }

    if (!editDate) {
      setMsg('Please select the meet date');
      return;
    }

    const categories = buildCategoriesObject(editCategoriesText);
    if (!categories) {
      setMsg('Please enter at least one category');
      return;
    }

    setUpdatingMeetId(meetId);
    setMsg('Updating meet...');

    try {
      await update(ref(db, `meets/${meetId}`), {
        name: editName.trim(),
        venue: editVenue.trim(),
        date: editDate,
        type: editType,
        laneCount: Number(editLaneCount),
        poolLength: Number(editPoolLength),
        pointsEnabled: editPointsEnabled,
        relayEnabled: editRelayEnabled,
        fanVisible: editFanVisible,
        settings: { categories },
      });

      setMsg('Meet updated successfully');
      handleCancelEdit();
    } catch (error: any) {
      setMsg(error.message || 'Failed to update meet');
    } finally {
      setUpdatingMeetId('');
    }
  };

  const handleToggleMeetActive = async (meet: MeetRow) => {
    try {
      const nextValue = meet.active === false;

      await update(ref(db, `meets/${meet.id}`), {
        active: nextValue,
      });

      if (!nextValue && activeMeetId === meet.id) {
        await set(ref(db, 'appState/activeMeetId'), '');
      }

      setMsg(nextValue ? 'Meet activated' : 'Meet marked inactive');
    } catch (error: any) {
      setMsg(error.message || 'Failed to update meet status');
    }
  };

  const handleToggleFanVisible = async (meet: MeetRow) => {
    try {
      const nextValue = meet.fanVisible === false;

      if (nextValue) {
        if (meet.active === false) {
          setMsg('Please activate the meet before enabling it for the Fan App');
          return;
        }

        await update(ref(db), {
          [`meets/${meet.id}/fanVisible`]: true,
          'appState/activeMeetId': meet.id,
        });

        setMsg('Meet enabled for Fan App and set as active meet');
      } else {
        const updates: Record<string, any> = {
          [`meets/${meet.id}/fanVisible`]: false,
        };

        if (activeMeetId === meet.id) {
          updates['appState/activeMeetId'] = '';
        }

        await update(ref(db), updates);

        setMsg('Meet disabled for Fan App');
      }
    } catch (error: any) {
      setMsg(error.message || 'Failed to update Fan App visibility');
    }
  };

  const handleDeleteMeet = async (meet: MeetRow) => {
    const ok = window.confirm(
      `Delete meet "${
        meet.name || 'Unnamed Meet'
      }"? This will remove ALL data (teams, swimmers, events, entries, results, etc.).`
    );
    if (!ok) return;

    try {
      await remove(ref(db, `meets/${meet.id}`));

      if (activeMeetId === meet.id) {
        await set(ref(db, 'appState/activeMeetId'), '');
      }

      setMsg('Meet deleted successfully');
    } catch (error: any) {
      setMsg(error.message || 'Failed to delete meet');
    }
  };

  const getCategoryList = (meet: MeetRow) => {
    const categoriesObj = meet.settings?.categories || {};
    return Object.values(categoriesObj).filter(Boolean);
  };

  return (
    <AppShell>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={panelStyle}>
          <h1 style={{ marginTop: 0 }}>Create Meet</h1>
          <p style={{ color: '#9fb3c8', marginTop: 0 }}>
            Set up a swim meet and save it to Firebase.
          </p>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Meet Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Panthers Invitational 2026"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Venue</label>
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="TBS Pool"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Meet Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Meet Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={inputStyle}
              >
                <option value="time_trial">Time Trial Meet</option>
                <option value="heat_finals">Heat + Finals Meet</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Lane Count</label>
              <select
                value={laneCount}
                onChange={(e) => setLaneCount(e.target.value)}
                style={inputStyle}
              >
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="8">8</option>
                <option value="10">10</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Pool Length (m)</label>
              <select
                value={poolLength}
                onChange={(e) => setPoolLength(e.target.value)}
                style={inputStyle}
              >
                <option value="25">25m</option>
                <option value="50">50m</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <label style={labelStyle}>Categories / Age Groups</label>
            <textarea
              value={categoriesText}
              onChange={(e) => setCategoriesText(e.target.value)}
              placeholder="U8, U10, U12, U14, U16, Open"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
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
                checked={pointsEnabled}
                onChange={(e) => setPointsEnabled(e.target.checked)}
              />
              <span>Enable Team Points</span>
            </label>

            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={relayEnabled}
                onChange={(e) => setRelayEnabled(e.target.checked)}
              />
              <span>Enable Relays</span>
            </label>

            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={fanVisible}
                onChange={(e) => setFanVisible(e.target.checked)}
              />
              <span>Enable for Fan App</span>
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
              onClick={handleCreateMeet}
              disabled={saving}
              style={primaryBtnStyle}
            >
              {saving ? 'Saving...' : 'Create Meet'}
            </button>

            <button onClick={resetForm} style={secondaryBtnStyle}>
              Reset
            </button>
          </div>

          <p style={{ marginTop: 16, color: '#f1d67a' }}>{msg}</p>
        </div>

        <div style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Saved Meets</h2>

          {meets.length === 0 ? (
            <p style={{ color: '#9fb3c8' }}>No meets created yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {meets.map((meet) => {
                const isActiveMeet = activeMeetId === meet.id;
                const isEditing = editingMeetId === meet.id;
                const isMeetInactive = meet.active === false;
                const isFanVisible = meet.fanVisible !== false;
                const categories = getCategoryList(meet);

                return (
                  <div
                    key={meet.id}
                    style={{
                      border: isActiveMeet
                        ? '1px solid rgba(212,175,55,0.45)'
                        : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: 16,
                      background: isActiveMeet
                        ? 'rgba(212,175,55,0.08)'
                        : 'rgba(255,255,255,0.04)',
                      opacity: isMeetInactive ? 0.65 : 1,
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
                              {meet.name}{' '}
                              {isActiveMeet ? (
                                <span
                                  style={{ color: '#f1d67a', fontSize: 14 }}
                                >
                                  • Active Meet
                                </span>
                              ) : null}
                            </div>
                            <div style={{ color: '#9fb3c8', marginTop: 4 }}>
                              {meet.venue} • {meet.date}
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gap: 8,
                              justifyItems: 'end',
                            }}
                          >
                            <div
                              style={{
                                padding: '8px 12px',
                                borderRadius: 999,
                                background: isMeetInactive
                                  ? 'rgba(217,83,79,0.16)'
                                  : 'rgba(212,175,55,0.16)',
                                border: isMeetInactive
                                  ? '1px solid rgba(217,83,79,0.35)'
                                  : '1px solid rgba(212,175,55,0.35)',
                                color: isMeetInactive ? '#ffd6d3' : '#f1d67a',
                                fontSize: 13,
                                height: 'fit-content',
                              }}
                            >
                              {isMeetInactive ? 'Inactive' : 'Active'}
                            </div>

                            <div
                              style={{
                                padding: '8px 12px',
                                borderRadius: 999,
                                background: isFanVisible
                                  ? 'rgba(46,175,109,0.16)'
                                  : 'rgba(217,83,79,0.16)',
                                border: isFanVisible
                                  ? '1px solid rgba(46,175,109,0.35)'
                                  : '1px solid rgba(217,83,79,0.35)',
                                color: isFanVisible ? '#d7ffe8' : '#ffd6d3',
                                fontSize: 13,
                                height: 'fit-content',
                              }}
                            >
                              {isFanVisible
                                ? 'Fan App Enabled'
                                : 'Fan App Disabled'}
                            </div>
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
                            Lanes: {meet.laneCount || '—'}
                          </span>
                          <span style={pillStyle}>
                            Pool: {meet.poolLength || '—'}m
                          </span>
                          <span style={pillStyle}>
                            Points: {meet.pointsEnabled ? 'On' : 'Off'}
                          </span>
                          <span style={pillStyle}>
                            Relays: {meet.relayEnabled ? 'On' : 'Off'}
                          </span>
                          <span style={pillStyle}>
                            Status: {meet.status || 'setup'}
                          </span>
                        </div>

                        <div style={{ marginTop: 12 }}>
                          <div
                            style={{
                              color: '#9fb3c8',
                              marginBottom: 8,
                              fontSize: 13,
                            }}
                          >
                            Categories
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            {categories.length > 0 ? (
                              categories.map((cat) => (
                                <span key={cat} style={pillStyle}>
                                  {cat}
                                </span>
                              ))
                            ) : (
                              <span style={pillStyle}>No categories</span>
                            )}
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
                          <button
                            onClick={() => handleSetActiveMeet(meet.id)}
                            disabled={isMeetInactive}
                            style={
                              isActiveMeet
                                ? activeBtnStyle
                                : isMeetInactive
                                ? disabledBtnStyle
                                : secondaryBtnStyle
                            }
                          >
                            {isActiveMeet
                              ? 'Selected as Active Meet'
                              : 'Set as Active Meet'}
                          </button>

                          <button
                            onClick={() => handleStartEdit(meet)}
                            style={secondaryBtnStyle}
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => handleToggleMeetActive(meet)}
                            style={secondaryBtnStyle}
                          >
                            {isMeetInactive ? 'Activate' : 'Mark Inactive'}
                          </button>

                          <button
                            onClick={() => handleToggleFanVisible(meet)}
                            style={
                              isFanVisible
                                ? redToggleBtnStyle
                                : greenToggleBtnStyle
                            }
                          >
                            {isFanVisible
                              ? 'Disable Fan App'
                              : 'Enable Fan App'}
                          </button>

                          <button
                            onClick={() => handleDeleteMeet(meet)}
                            style={dangerBtnStyle}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <h3 style={{ marginTop: 0 }}>Edit Meet</h3>

                        <div style={gridStyle}>
                          <div>
                            <label style={labelStyle}>Meet Name</label>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Venue</label>
                            <input
                              value={editVenue}
                              onChange={(e) => setEditVenue(e.target.value)}
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Meet Date</label>
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <label style={labelStyle}>Meet Type</label>
                            <select
                              value={editType}
                              onChange={(e) => setEditType(e.target.value)}
                              style={inputStyle}
                            >
                              <option value="time_trial">
                                Time Trial Meet
                              </option>
                              <option value="heat_finals">
                                Heat + Finals Meet
                              </option>
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>Lane Count</label>
                            <select
                              value={editLaneCount}
                              onChange={(e) => setEditLaneCount(e.target.value)}
                              style={inputStyle}
                            >
                              <option value="4">4</option>
                              <option value="6">6</option>
                              <option value="8">8</option>
                              <option value="10">10</option>
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>Pool Length (m)</label>
                            <select
                              value={editPoolLength}
                              onChange={(e) =>
                                setEditPoolLength(e.target.value)
                              }
                              style={inputStyle}
                            >
                              <option value="25">25m</option>
                              <option value="50">50m</option>
                            </select>
                          </div>
                        </div>

                        <div style={{ marginTop: 18 }}>
                          <label style={labelStyle}>
                            Categories / Age Groups
                          </label>
                          <textarea
                            value={editCategoriesText}
                            onChange={(e) =>
                              setEditCategoriesText(e.target.value)
                            }
                            rows={3}
                            style={{ ...inputStyle, resize: 'vertical' }}
                          />
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
                              checked={editPointsEnabled}
                              onChange={(e) =>
                                setEditPointsEnabled(e.target.checked)
                              }
                            />
                            <span>Enable Team Points</span>
                          </label>

                          <label style={checkRowStyle}>
                            <input
                              type="checkbox"
                              checked={editRelayEnabled}
                              onChange={(e) =>
                                setEditRelayEnabled(e.target.checked)
                              }
                            />
                            <span>Enable Relays</span>
                          </label>

                          <label style={checkRowStyle}>
                            <input
                              type="checkbox"
                              checked={editFanVisible}
                              onChange={(e) =>
                                setEditFanVisible(e.target.checked)
                              }
                            />
                            <span>Enable for Fan App</span>
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
                            onClick={() => handleUpdateMeet(meet.id)}
                            disabled={updatingMeetId === meet.id}
                            style={primaryBtnStyle}
                          >
                            {updatingMeetId === meet.id
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

const activeBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(212,175,55,0.45)',
  background: 'rgba(212,175,55,0.18)',
  color: '#f1d67a',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.45)',
  fontWeight: 700,
  cursor: 'not-allowed',
};

const redToggleBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(217,83,79,0.5)',
  background: 'rgba(217,83,79,0.2)',
  color: '#ffd6d3',
  fontWeight: 700,
  cursor: 'pointer',
};

const greenToggleBtnStyle: CSSProperties = {
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(46,175,109,0.5)',
  background: 'rgba(46,175,109,0.2)',
  color: '#d7ffe8',
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

const pillStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontSize: 13,
};
