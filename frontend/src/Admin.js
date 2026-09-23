import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  orderBy,
} from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// ====================================================================
// サーバー設定
// ====================================================================
const API_BASE_URL = 'https://hinodefes.onrender.com';

// ====================================================================
// Firebase 設定
// ====================================================================
const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG
  ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG)
  : {};

const initialAuthToken = null;
const initialAppId = firebaseConfig.appId || 'default-app-id';

// 管理者トークン
const ADMIN_CUSTOM_AUTH_TOKEN = 'your-admin-custom-token-here';

// ====================================================================
// Firestore 設定
//
// Reception.js / TVDisplay.js も同じ設定を参照してください。
// ====================================================================
const SETTINGS_COLLECTION = 'settings';
const ATTRACTION_SETTINGS_DOC = 'attraction';

const DEFAULT_SETTINGS = {
  startTime: '10:00',
  endTime: '18:00',
  sessionDurationMinutes: 30,
  maxPeoplePerSession: 10,
  notifyBeforeMinutes: 10,
};

// ====================================================================
// スタイル
// ====================================================================
const styles = {
  screenContainer: {
    minHeight: '100vh',
    backgroundColor: '#f3f4f6',
    padding: '24px',
  },
  maxContainer: {
    maxWidth: '1280px',
    margin: '0 auto',
  },
  header: {
    fontSize: '32px',
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: '24px',
    borderBottom: '4px solid #f59e0b',
    paddingBottom: '8px',
  },
  panel: {
    backgroundColor: 'white',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#1f2937',
    margin: '0 0 16px',
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '10px',
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  settingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#374151',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '16px',
    backgroundColor: 'white',
  },
  disabledInput: {
    backgroundColor: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
  button: {
    padding: '10px 18px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    color: 'white',
  },
  greenButton: {
    backgroundColor: '#059669',
    color: 'white',
  },
  grayButton: {
    backgroundColor: '#6b7280',
    color: 'white',
  },
  slotGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  slot: {
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    textAlign: 'left',
  },
  slotSelected: {
    border: '2px solid #2563eb',
    backgroundColor: '#eff6ff',
  },
  slotFull: {
    backgroundColor: '#e5e7eb',
    borderColor: '#d1d5db',
    color: '#9ca3af',
    cursor: 'default',
  },
  statusTag: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '700',
    border: '1px solid',
  },
  reservationCard: {
    padding: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    backgroundColor: '#f9fafb',
    marginBottom: '10px',
  },
  errorContainer: {
    minHeight: '100vh',
    backgroundColor: '#fef2f2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  errorBox: {
    padding: '32px',
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '4px solid #ef4444',
    maxWidth: '640px',
  },
};

const STATUS_MAP = {
  reserved: {
    label: '予約済み',
    color: '#f59e0b',
    bgColor: '#fffbeb',
    textColor: '#92400e',
  },
  entryGuidance: {
    label: '入場案内中',
    color: '#ef4444',
    bgColor: '#fef2f2',
    textColor: '#991b1b',
  },
  used: {
    label: '利用済み',
    color: '#10b981',
    bgColor: '#ecfdf5',
    textColor: '#065f46',
  },
};

// 旧データが残っていても管理画面で読み取れるようにする
const normalizeStatus = (status) => {
  if (status === 'waiting') return 'reserved';
  if (status === 'called') return 'entryGuidance';
  if (status === 'completed' || status === 'seatEnter') return 'used';
  return STATUS_MAP[status] ? status : 'reserved';
};

const pad2 = (n) => String(n).padStart(2, '0');

const timeToMinutes = (time) => {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

const minutesToTime = (minutes) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
};

const getTodayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

const toDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatCreatedAt = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '-';
};

const getReservationDate = (reservation) => {
  if (reservation.reservationDate) return reservation.reservationDate;

  const date = toDate(reservation.reservationAt || reservation.slotStartAt);
  if (date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  return null;
};

const getSlotStart = (reservation) => {
  if (reservation.slotStart) return reservation.slotStart;
  if (reservation.startTime) return reservation.startTime;

  const date = toDate(reservation.reservationAt || reservation.slotStartAt);
  return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : null;
};

const getSlotEnd = (reservation) => {
  if (reservation.slotEnd) return reservation.slotEnd;
  if (reservation.endTime) return reservation.endTime;

  const date = toDate(reservation.slotEndAt);
  return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : null;
};

const makeSlots = (startTime, endTime, durationMinutes) => {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const duration = Number(durationMinutes);

  if (start === null || end === null || !Number.isInteger(duration) || duration <= 0) {
    return [];
  }

  if (end <= start) return [];

  const slots = [];
  for (let cursor = start; cursor + duration <= end; cursor += duration) {
    slots.push({
      start: minutesToTime(cursor),
      end: minutesToTime(cursor + duration),
    });
  }

  return slots;
};

const getRemainingCapacity = (slot, reservations, maxPeople, today) => {
  const reservedPeople = reservations
    .filter((r) => {
      const date = getReservationDate(r);
      const start = getSlotStart(r);
      const status = normalizeStatus(r.status);
      return (
        date === today &&
        start === slot.start &&
        status !== 'used'
      );
    })
    .reduce((sum, r) => sum + Math.max(0, Number(r.people) || 0), 0);

  return Math.max(0, Number(maxPeople) - reservedPeople);
};

const StatCard = ({ title, value, detail }) => (
  <div
    style={{
      ...styles.panel,
      marginBottom: 0,
      padding: '18px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}
  >
    <div style={{ fontSize: '13px', fontWeight: '700', color: '#6b7280' }}>{title}</div>
    <div style={{ fontSize: '28px', fontWeight: '800', color: '#111827', marginTop: '4px' }}>
      {value}
    </div>
    {detail && (
      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{detail}</div>
    )}
  </div>
);

export default function Admin() {
  const [dbInstance, setDbInstance] = useState(null);
  const [userId, setUserId] = useState(null);

  const [reservations, setReservations] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [selectedSlot, setSelectedSlot] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const today = useMemo(() => getTodayString(), []);

  // ----------------------------------------------------------------
  // Firebase 初期化・認証
  // ----------------------------------------------------------------
  useEffect(() => {
    if (Object.keys(firebaseConfig).length === 0) {
      setError('Firebase設定が見つかりません。');
      setLoading(false);
      return;
    }

    try {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      const firestoreInstance = getFirestore(app);

      setLogLevel('error');
      setDbInstance(firestoreInstance);

      const authenticateAdmin = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(authInstance, initialAuthToken);
          } else if (
            ADMIN_CUSTOM_AUTH_TOKEN &&
            ADMIN_CUSTOM_AUTH_TOKEN !== 'your-admin-custom-token-here'
          ) {
            await signInWithCustomToken(authInstance, ADMIN_CUSTOM_AUTH_TOKEN);
          } else {
            await signInAnonymously(authInstance);
          }
        } catch (authError) {
          console.error('Admin Auth Failed:', authError);
          setError(`管理者認証エラー: ${authError.message}`);
          setLoading(false);
        }
      };

      const unsubscribeAuth = authInstance.onAuthStateChanged((user) => {
        if (user) {
          setUserId(user.uid);
          setLoading(false);
        } else {
          authenticateAdmin();
        }
      });

      return () => unsubscribeAuth();
    } catch (e) {
      console.error('Firebase Initialization Error:', e);
      setError(`Firebase初期化エラー: ${e.message}`);
      setLoading(false);
    }
  }, []);

  // ----------------------------------------------------------------
  // Firestore リアルタイム購読
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!dbInstance || !userId) return;

    const reservationsQuery = query(
      collection(dbInstance, 'reservations'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeReservations = onSnapshot(
      reservationsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));

        setReservations(list);
      },
      (err) => {
        console.error('Reservations Listen Failed:', err);
        setError(`予約データ取得エラー: ${err.message}`);
      }
    );

    const settingsRef = doc(
      dbInstance,
      SETTINGS_COLLECTION,
      ATTRACTION_SETTINGS_DOC
    );

    const unsubscribeSettings = onSnapshot(
      settingsRef,
      (snapshotDoc) => {
        const data = snapshotDoc.exists()
          ? { ...DEFAULT_SETTINGS, ...snapshotDoc.data() }
          : DEFAULT_SETTINGS;

        setSettings(data);
        setDraftSettings(data);
      },
      (err) => {
        console.error('Settings Listen Failed:', err);
        setError(`設定データ取得エラー: ${err.message}`);
      }
    );

    return () => {
      unsubscribeReservations();
      unsubscribeSettings();
    };
  }, [dbInstance, userId]);

  // ----------------------------------------------------------------
  // 時間割
  // ----------------------------------------------------------------
  const slots = useMemo(
    () =>
      makeSlots(
        settings.startTime,
        settings.endTime,
        Number(settings.sessionDurationMinutes)
      ),
    [settings.startTime, settings.endTime, settings.sessionDurationMinutes]
  );

  const slotSummaries = useMemo(
    () =>
      slots.map((slot) => {
        const remaining = getRemainingCapacity(
          slot,
          reservations,
          Number(settings.maxPeoplePerSession),
          today
        );

        const slotReservations = reservations.filter(
          (r) =>
            getReservationDate(r) === today &&
            getSlotStart(r) === slot.start
        );

        const totalPeople = slotReservations.reduce(
          (sum, r) => sum + (Number(r.people) || 0),
          0
        );

        return {
          ...slot,
          remaining,
          totalPeople,
          reservationCount: slotReservations.length,
          full: remaining <= 0,
        };
      }),
    [slots, reservations, settings.maxPeoplePerSession, today]
  );

  // ----------------------------------------------------------------
  // 設定保存
  // ----------------------------------------------------------------
  const handleSettingChange = (key, value) => {
    setDraftSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
    setMessage(null);
  };

  const hasReservations = reservations.length > 0;

  const handleSaveSettings = useCallback(async () => {
    if (!dbInstance || !userId) return;

    setMessage(null);

    const start = timeToMinutes(draftSettings.startTime);
    const end = timeToMinutes(draftSettings.endTime);
    const duration = Number(draftSettings.sessionDurationMinutes);
    const maxPeople = Number(draftSettings.maxPeoplePerSession);
    const notifyBefore = Number(draftSettings.notifyBeforeMinutes);

    if (start === null || end === null || end <= start) {
      setMessage({
        type: 'error',
        text: '開始時刻・終了時刻を正しく設定してください。',
      });
      return;
    }

    if (!Number.isInteger(duration) || duration <= 0) {
      setMessage({
        type: 'error',
        text: '一回の利用時間は1分以上の整数で設定してください。',
      });
      return;
    }

    if (!Number.isInteger(maxPeople) || maxPeople <= 0) {
      setMessage({
        type: 'error',
        text: '1回あたりの最大人数は1人以上で設定してください。',
      });
      return;
    }

    if (!Number.isInteger(notifyBefore) || notifyBefore < 0) {
      setMessage({
        type: 'error',
        text: '通知何分前は0分以上の整数で設定してください。',
      });
      return;
    }

    if (hasReservations && duration !== Number(settings.sessionDurationMinutes)) {
      setMessage({
        type: 'error',
        text: '既存の予約が入っているため、「一回の利用時間」は変更できません。',
      });
      return;
    }

    if (duration > end - start) {
      setMessage({
        type: 'error',
        text: '一回の利用時間が営業時間より長くなっています。',
      });
      return;
    }

    setSettingsSaving(true);

    try {
      const normalizedSettings = {
        startTime: draftSettings.startTime,
        endTime: draftSettings.endTime,
        sessionDurationMinutes: duration,
        maxPeoplePerSession: maxPeople,
        notifyBeforeMinutes: notifyBefore,
        updatedAt: new Date(),
      };

      await setDoc(
        doc(dbInstance, SETTINGS_COLLECTION, ATTRACTION_SETTINGS_DOC),
        normalizedSettings,
        { merge: true }
      );

      setMessage({
        type: 'success',
        text: '設定を保存しました。',
      });
    } catch (e) {
      console.error('Settings Save Failed:', e);
      setMessage({
        type: 'error',
        text: `設定の保存に失敗しました: ${e.message}`,
      });
    } finally {
      setSettingsSaving(false);
    }
  }, [dbInstance, userId, draftSettings, hasReservations, settings.sessionDurationMinutes]);

  // ----------------------------------------------------------------
  // ステータス変更
  // ----------------------------------------------------------------
  const handleStatusChange = useCallback(
    async (reservation, newStatus) => {
      if (!dbInstance || !userId) return;

      const currentStatus = normalizeStatus(reservation.status);

      const allowed =
        (currentStatus === 'reserved' && newStatus === 'entryGuidance') ||
        (currentStatus === 'entryGuidance' && newStatus === 'used');

      if (!allowed) return;

      const statusLabel = STATUS_MAP[newStatus]?.label || newStatus;

      if (!window.confirm(`「${statusLabel}」に変更しますか？`)) {
        return;
      }

      try {
        // 入場案内時だけ既存のAPIも試す。
        // API側でLINE通知を実装している場合はここで通知されます。
        if (newStatus === 'entryGuidance') {
          try {
            const response = await fetch(
              `${API_BASE_URL}/api/reservations/${reservation.id}/status/entryGuidance`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  apiSecret:
                    process.env.REACT_APP_API_SECRET || 'YOUR_API_SECRET',
                  userId,
                  reservationId: reservation.id,
                  status: 'entryGuidance',
                }),
              }
            );

            // APIが未対応でもFirestore更新は行う。
            if (!response.ok) {
              console.warn(
                'entryGuidance API returned:',
                response.status
              );
            }
          } catch (apiError) {
            console.warn('entryGuidance API failed:', apiError);
          }
        }

        await updateDoc(
          doc(dbInstance, 'reservations', reservation.id),
          {
            status: newStatus,
            updatedAt: new Date(),
            ...(newStatus === 'entryGuidance'
              ? { entryGuidanceAt: new Date() }
              : {}),
            ...(newStatus === 'used' ? { usedAt: new Date() } : {}),
          }
        );

        setMessage({
          type: 'success',
          text: `ステータスを「${statusLabel}」に変更しました。`,
        });
      } catch (e) {
        console.error('Status update failed:', e);
        setMessage({
          type: 'error',
          text: `ステータス変更に失敗しました: ${e.message}`,
        });
      }
    },
    [dbInstance, userId]
  );

  // ----------------------------------------------------------------
  // 選択時間帯の予約
  // ----------------------------------------------------------------
  const selectedSlotReservations = useMemo(() => {
    if (!selectedSlot) return [];

    return reservations
      .filter(
        (r) =>
          getReservationDate(r) === today &&
          getSlotStart(r) === selectedSlot.start
      )
      .filter((r) => {
        const keyword = searchTerm.trim().toLowerCase();
        if (!keyword) return true;

        return (r.name || '').toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        const aTime = toDate(a.createdAt)?.getTime() || 0;
        const bTime = toDate(b.createdAt)?.getTime() || 0;
        return aTime - bTime;
      });
  }, [selectedSlot, reservations, today, searchTerm]);

  const selectedSlotTotalPeople = useMemo(
    () =>
      selectedSlotReservations.reduce(
        (sum, r) => sum + (Number(r.people) || 0),
        0
      ),
    [selectedSlotReservations]
  );

  // ----------------------------------------------------------------
  // サマリー
  // ----------------------------------------------------------------
  const summary = useMemo(() => {
    const todayReservations = reservations.filter(
      (r) => getReservationDate(r) === today
    );

    const totalPeople = todayReservations.reduce(
      (sum, r) => sum + (Number(r.people) || 0),
      0
    );

    const reserved = todayReservations.filter(
      (r) => normalizeStatus(r.status) === 'reserved'
    ).length;

    const entryGuidance = todayReservations.filter(
      (r) => normalizeStatus(r.status) === 'entryGuidance'
    ).length;

    const used = todayReservations.filter(
      (r) => normalizeStatus(r.status) === 'used'
    ).length;

    return {
      reservationCount: todayReservations.length,
      totalPeople,
      reserved,
      entryGuidance,
      used,
    };
  }, [reservations, today]);

  // ----------------------------------------------------------------
  // 表示
  // ----------------------------------------------------------------
  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
        }}
      >
        <p style={{ fontSize: '20px', color: '#4b5563' }}>
          管理画面をロード中...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorBox}>
          <h1 style={{ color: '#dc2626', marginTop: 0 }}>エラー</h1>
          <p style={{ color: '#374151' }}>{error}</p>
          <p style={{ fontSize: '12px', color: '#6b7280' }}>
            App ID: {initialAppId}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.screenContainer}>
      <div style={styles.maxContainer}>
        <h1 style={styles.header}>🎢 アトラクション予約管理</h1>

        <div
          style={{
            fontSize: '14px',
            color: '#6b7280',
            marginBottom: '16px',
          }}
        >
          本日: <strong>{today}</strong>
        </div>

        {message && (
          <div
            style={{
              ...styles.panel,
              padding: '14px 18px',
              marginBottom: '16px',
              backgroundColor:
                message.type === 'error' ? '#fef2f2' : '#ecfdf5',
              border:
                message.type === 'error'
                  ? '1px solid #fecaca'
                  : '1px solid #a7f3d0',
              color:
                message.type === 'error' ? '#991b1b' : '#065f46',
            }}
          >
            {message.text}
          </div>
        )}

        {/* ============================================================
            設定
        ============================================================ */}
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>⚙️ アトラクション設定</h2>

          <div style={styles.settingGrid}>
            <div style={styles.field}>
              <label style={styles.label}>時間割の開始時刻</label>
              <input
                type="time"
                value={draftSettings.startTime}
                onChange={(e) =>
                  handleSettingChange('startTime', e.target.value)
                }
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>時間割の終了時刻</label>
              <input
                type="time"
                value={draftSettings.endTime}
                onChange={(e) =>
                  handleSettingChange('endTime', e.target.value)
                }
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>
                1回の利用時間（分）
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={draftSettings.sessionDurationMinutes}
                disabled={hasReservations}
                onChange={(e) =>
                  handleSettingChange(
                    'sessionDurationMinutes',
                    e.target.value
                  )
                }
                style={{
                  ...styles.input,
                  ...(hasReservations ? styles.disabledInput : {}),
                }}
              />
              {hasReservations && (
                <span style={{ fontSize: '12px', color: '#dc2626' }}>
                  既存予約があるため変更できません
                </span>
              )}
            </div>

            <div style={styles.field}>
              <label style={styles.label}>
                1回あたりの最大人数
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={draftSettings.maxPeoplePerSession}
                onChange={(e) =>
                  handleSettingChange(
                    'maxPeoplePerSession',
                    e.target.value
                  )
                }
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>
                LINE通知：何分前
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={draftSettings.notifyBeforeMinutes}
                onChange={(e) =>
                  handleSettingChange(
                    'notifyBeforeMinutes',
                    e.target.value
                  )
                }
                style={styles.input}
              />
              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                例：10 → 10分前にLINE通知
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: '18px',
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: '#f9fafb',
              color: '#4b5563',
              fontSize: '13px',
            }}
          >
            時間割は「開始時刻 → 終了時刻」を「1回の利用時間」で自動分割します。
            例：10:00〜18:00、30分なら「10:00〜10:30」「10:30〜11:00」…となります。
          </div>

          <div style={{ marginTop: '16px' }}>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              style={{
                ...styles.button,
                ...styles.primaryButton,
                opacity: settingsSaving ? 0.6 : 1,
              }}
            >
              {settingsSaving ? '保存中...' : '設定を保存'}
            </button>
          </div>
        </section>

        {/* ============================================================
            本日のサマリー
        ============================================================ */}
        <div style={styles.cardGrid}>
          <StatCard
            title="本日の予約"
            value={`${summary.reservationCount}件`}
            detail={`${summary.totalPeople}名`}
          />
          <StatCard
            title="予約済み"
            value={`${summary.reserved}件`}
          />
          <StatCard
            title="入場案内中"
            value={`${summary.entryGuidance}件`}
          />
          <StatCard
            title="利用済み"
            value={`${summary.used}件`}
          />
        </div>

        {/* ============================================================
            時間割
        ============================================================ */}
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>
            🕐 本日の時間割
          </h2>

          <p
            style={{
              fontSize: '13px',
              color: '#6b7280',
              marginTop: 0,
              marginBottom: '16px',
            }}
          >
            時間帯をクリックすると、その時間帯の予約者を確認できます。
          </p>

          {slotSummaries.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                color: '#6b7280',
              }}
            >
              時間割を生成できません。開始・終了時刻と利用時間を確認してください。
            </div>
          ) : (
            <div style={styles.slotGrid}>
              {slotSummaries.map((slot) => {
                const isSelected =
                  selectedSlot?.start === slot.start;
                const isFull = slot.full;

                return (
                  <button
                    type="button"
                    key={`${slot.start}-${slot.end}`}
                    onClick={() => setSelectedSlot(slot)}
                    style={{
                      ...styles.slot,
                      ...(isSelected ? styles.slotSelected : {}),
                      ...(isFull ? styles.slotFull : {}),
                    }}
                  >
                    <div
                      style={{
                        fontSize: '20px',
                        fontWeight: '800',
                        marginBottom: '8px',
                        color: isFull ? '#9ca3af' : '#111827',
                      }}
                    >
                      {slot.start}〜{slot.end}
                    </div>

                    <div
                      style={{
                        fontSize: '15px',
                        fontWeight: '700',
                        color: isFull ? '#9ca3af' : '#374151',
                      }}
                    >
                      残り {slot.remaining}人
                    </div>

                    <div
                      style={{
                        fontSize: '12px',
                        color: isFull ? '#9ca3af' : '#6b7280',
                        marginTop: '5px',
                      }}
                    >
                      予約 {slot.reservationCount}件 / {slot.totalPeople}名
                    </div>

                    {isFull && (
                      <div
                        style={{
                          marginTop: '8px',
                          fontSize: '12px',
                          fontWeight: '800',
                          color: '#6b7280',
                        }}
                      >
                        定員
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ============================================================
            選択時間帯の予約
        ============================================================ */}
        {selectedSlot && (
          <section style={styles.panel}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <h2 style={{ ...styles.sectionTitle, marginBottom: '6px' }}>
                  👥 {selectedSlot.start}〜{selectedSlot.end} の予約
                </h2>
                <div style={{ color: '#6b7280', fontSize: '13px' }}>
                  合計 {selectedSlotTotalPeople}名 /
                  定員 {settings.maxPeoplePerSession}名
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                style={{
                  ...styles.button,
                  ...styles.grayButton,
                }}
              >
                閉じる
              </button>
            </div>

            <div style={{ margin: '16px 0' }}>
              <input
                type="text"
                placeholder="名前で検索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={styles.input}
              />
            </div>

            {selectedSlotReservations.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  color: '#6b7280',
                }}
              >
                この時間帯の予約はありません。
              </div>
            ) : (
              <div>
                {selectedSlotReservations.map((reservation) => {
                  const status = normalizeStatus(reservation.status);
                  const statusInfo = STATUS_MAP[status];

                  return (
                    <div
                      key={reservation.id}
                      style={styles.reservationCard}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '20px',
                              fontWeight: '800',
                              color: '#111827',
                            }}
                          >
                            {reservation.name || '名前未登録'}
                          </div>

                          <div
                            style={{
                              marginTop: '6px',
                              color: '#374151',
                              fontSize: '15px',
                            }}
                          >
                            {Number(reservation.people) || 0}名
                          </div>

                          <div
                            style={{
                              marginTop: '5px',
                              color: '#6b7280',
                              fontSize: '12px',
                            }}
                          >
                            予約受付: {formatCreatedAt(reservation.createdAt)}
                            {reservation.wantsLine && (
                              <span
                                style={{
                                  marginLeft: '10px',
                                  color: '#059669',
                                  fontWeight: '700',
                                }}
                              >
                                LINE希望
                              </span>
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: '8px',
                          }}
                        >
                          <span
                            style={{
                              ...styles.statusTag,
                              backgroundColor: statusInfo.bgColor,
                              color: statusInfo.textColor,
                              borderColor: statusInfo.color,
                            }}
                          >
                            {statusInfo.label}
                          </span>

                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              flexWrap: 'wrap',
                              justifyContent: 'flex-end',
                            }}
                          >
                            {status === 'reserved' && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(
                                    reservation,
                                    'entryGuidance'
                                  )
                                }
                                style={{
                                  ...styles.button,
                                  backgroundColor: '#ef4444',
                                  color: 'white',
                                }}
                              >
                                📢 入場案内
                              </button>
                            )}

                            {status === 'entryGuidance' && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(
                                    reservation,
                                    'used'
                                  )
                                }
                                style={{
                                  ...styles.button,
                                  ...styles.greenButton,
                                }}
                              >
                                ✅ 利用済み
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ============================================================
            予約一覧
        ============================================================ */}
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>
            📋 本日の予約一覧
          </h2>

          <input
            type="text"
            placeholder="名前で検索..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...styles.input, marginBottom: '16px' }}
          />

          <div
            style={{
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                minWidth: '760px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  {['時間帯', '名前', '人数', 'LINE', 'ステータス', '受付時刻', '操作'].map(
                    (heading) => (
                      <th
                        key={heading}
                        style={{
                          textAlign: 'left',
                          padding: '12px 10px',
                          borderBottom: '1px solid #e5e7eb',
                          fontSize: '13px',
                          color: '#6b7280',
                        }}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>

              <tbody>
                {reservations
                  .filter((r) => getReservationDate(r) === today)
                  .filter((r) => {
                    const keyword = searchTerm.trim().toLowerCase();
                    return (
                      !keyword ||
                      (r.name || '').toLowerCase().includes(keyword)
                    );
                  })
                  .sort((a, b) => {
                    const aStart = getSlotStart(a) || '99:99';
                    const bStart = getSlotStart(b) || '99:99';
                    return aStart.localeCompare(bStart);
                  })
                  .map((reservation) => {
                    const status = normalizeStatus(reservation.status);
                    const statusInfo = STATUS_MAP[status];

                    return (
                      <tr key={reservation.id}>
                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                            fontWeight: '700',
                          }}
                        >
                          {getSlotStart(reservation) || '-'}
                          {getSlotEnd(reservation)
                            ? `〜${getSlotEnd(reservation)}`
                            : ''}
                        </td>

                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          {reservation.name || '-'}
                        </td>

                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          {Number(reservation.people) || 0}名
                        </td>

                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          {reservation.wantsLine ? '希望' : 'なし'}
                        </td>

                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          <span
                            style={{
                              ...styles.statusTag,
                              backgroundColor: statusInfo.bgColor,
                              color: statusInfo.textColor,
                              borderColor: statusInfo.color,
                            }}
                          >
                            {statusInfo.label}
                          </span>
                        </td>

                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                            color: '#6b7280',
                          }}
                        >
                          {formatCreatedAt(reservation.createdAt)}
                        </td>

                        <td
                          style={{
                            padding: '12px 10px',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          {status === 'reserved' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleStatusChange(
                                  reservation,
                                  'entryGuidance'
                                )
                              }
                              style={{
                                ...styles.button,
                                backgroundColor: '#ef4444',
                                color: 'white',
                                padding: '7px 10px',
                                fontSize: '13px',
                              }}
                            >
                              入場案内
                            </button>
                          )}

                          {status === 'entryGuidance' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleStatusChange(
                                  reservation,
                                  'used'
                                )
                              }
                              style={{
                                ...styles.button,
                                ...styles.greenButton,
                                padding: '7px 10px',
                                fontSize: '13px',
                              }}
                            >
                              利用済み
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}