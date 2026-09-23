import React, { useEffect, useState, useMemo } from 'react';

// ====================================================================
// Firebase/API インポート
// ====================================================================
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
} from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// ====================================================================
// Firebase 設定
//
// Admin.js / Reception.js と同じ Firestore 構造を参照しています。
//   - settings/attraction ドキュメント（時間割の設定）
//   - reservations コレクション（当日の予約一覧）
// ====================================================================
const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG
  ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG)
  : {};

const DEFAULT_SETTINGS = {
  startTime: '10:00',
  endTime: '18:00',
  sessionDurationMinutes: 30,
  maxPeoplePerSession: 10,
  notifyBeforeMinutes: 10,
};

// ====================================================================
// 共通ユーティリティ（Admin.js / Reception.js と同じロジック）
// ====================================================================
const pad2 = (n) => String(n).padStart(2, '0');

const getTodayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

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

const makeSlots = (startTime, endTime, durationMinutes) => {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const duration = Number(durationMinutes);

  if (
    start === null ||
    end === null ||
    end <= start ||
    !Number.isInteger(duration) ||
    duration <= 0
  ) {
    return [];
  }

  const result = [];
  for (let cursor = start; cursor + duration <= end; cursor += duration) {
    result.push({
      start: minutesToTime(cursor),
      end: minutesToTime(cursor + duration),
    });
  }
  return result;
};

const toDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getReservationDate = (reservation) => {
  if (reservation.reservationDate) return reservation.reservationDate;
  const date = toDate(reservation.createdAt);
  if (!date) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const getSlotStart = (reservation) =>
  reservation.slotStart || reservation.startTime || null;

// 旧データ（waiting/called/completed等）が残っていても表示できるようにする
const normalizeStatus = (status) => {
  if (status === 'waiting') return 'reserved';
  if (status === 'called') return 'entryGuidance';
  if (status === 'completed' || status === 'seatEnter') return 'used';
  return status || 'reserved';
};

// ====================================================================
// 混雑度に応じた色を決定する
// 0〜4割: 空きあり（緑） / 5〜7割: やや混雑（黄） / 8〜9割: 混雑（赤） / 10割: 満席（灰）
// ====================================================================
const getCongestionLevel = (reservedPeople, maxPeople) => {
  const capacity = Number(maxPeople) > 0 ? Number(maxPeople) : 0;
  if (capacity <= 0) return 'full';

  const ratio = reservedPeople / capacity;

  if (ratio >= 1) return 'full'; // 10割
  if (ratio >= 0.8) return 'busy'; // 8〜9割
  if (ratio >= 0.5) return 'moderate'; // 5〜7割
  return 'available'; // 0〜4割
};

const CONGESTION_STYLE = {
  available: {
    label: '空きあり',
    background: '#2ecc71',
    text: '#003d1a',
  },
  moderate: {
    label: 'やや混雑',
    background: '#f1c40f',
    text: '#4d3b00',
  },
  busy: {
    label: '混雑',
    background: '#e74c3c',
    text: '#ffffff',
  },
  full: {
    label: '満席',
    background: '#7f8c8d',
    text: '#ffffff',
  },
};

export default function TVDisplay() {
  const [db, setDb] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const today = useMemo(() => getTodayString(), []);

  // 1. Firebaseの初期化と認証
  useEffect(() => {
    if (!Object.keys(firebaseConfig).length) {
      setError('Firebase設定が見つかりません。');
      setLoading(false);
      return undefined;
    }

    try {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);
      setLogLevel('error');
      setDb(firestore);

      if (!authentication.currentUser) {
        signInAnonymously(authentication).catch((authError) => {
          console.error('Firebase認証エラー:', authError);
          setError('認証に失敗しました。');
          setLoading(false);
        });
      }
    } catch (e) {
      console.error('Firebase初期化エラー:', e);
      setError('Firebaseの初期化に失敗しました。');
      setLoading(false);
    }

    return undefined;
  }, []);

  // 2. 設定（時間割の基本情報）をリアルタイム取得
  useEffect(() => {
    if (!db) return undefined;

    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'attraction'),
      (snapshot) => {
        setSettings(
          snapshot.exists()
            ? { ...DEFAULT_SETTINGS, ...snapshot.data() }
            : DEFAULT_SETTINGS
        );
      },
      (err) => {
        console.error('設定取得エラー:', err);
        setError('アトラクション設定の取得に失敗しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [db]);

  // 3. 当日の予約をリアルタイム取得
  useEffect(() => {
    if (!db) return undefined;

    const reservationsQuery = query(
      collection(db, 'reservations'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      reservationsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        setReservations(list);
        setLoading(false);
      },
      (err) => {
        console.error('Firestoreリスニングエラー:', err);
        setError('データ取得に失敗しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [db]);

  // ----------------------------------------------------------------
  // 時間割の自動生成と各時間帯の集計
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

  const slotSummaries = useMemo(() => {
    const maxPeople = Number(settings.maxPeoplePerSession);

    return slots.map((slot) => {
      const todaySlotReservations = reservations.filter((r) => {
        return (
          getReservationDate(r) === today && getSlotStart(r) === slot.start
        );
      });

      // 「利用済み」は定員計算から除外（Reception.js/Admin.jsと同じ扱い）
      const activeReservations = todaySlotReservations.filter(
        (r) => normalizeStatus(r.status) !== 'used'
      );

      const reservedPeople = activeReservations.reduce(
        (sum, r) => sum + Math.max(0, Number(r.people) || 0),
        0
      );

      const isCalled = todaySlotReservations.some(
        (r) => normalizeStatus(r.status) === 'entryGuidance'
      );

      return {
        ...slot,
        reservedPeople,
        remaining: Math.max(0, maxPeople - reservedPeople),
        level: getCongestionLevel(reservedPeople, maxPeople),
        isCalled,
      };
    });
  }, [slots, reservations, today, settings.maxPeoplePerSession]);

  const calledSlots = useMemo(
    () => slotSummaries.filter((slot) => slot.isCalled),
    [slotSummaries]
  );

  const calledSlotsText = useMemo(
    () => calledSlots.map((slot) => `${slot.start}〜${slot.end}`).join(' / '),
    [calledSlots]
  );

  const totalWaitingGroups = useMemo(() => {
    return reservations.filter(
      (r) =>
        getReservationDate(r) === today &&
        normalizeStatus(r.status) === 'reserved'
    ).length;
  }, [reservations, today]);

  if (loading || !db) {
    return <div style={styles.messageScreen}>⚡️ リアルタイムデータを読み込み中...</div>;
  }
  if (error) {
    return <div style={{ ...styles.messageScreen, color: 'red' }}>エラー: {error}</div>;
  }

  return (
    <div style={styles.container}>
      {/* グローバルスタイル */}
      <style>{`
        body { margin: 0; font-family: 'Hiragino Sans', 'ヒラギノ角ゴシック', 'メイリオ', Meiryo, 'MS Pゴシック', sans-serif; }
        * { box-sizing: border-box; }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* 現在ご案内中（呼び出し中）の時間帯 */}
      <div style={styles.calledSection}>
        <h1 style={styles.calledTitle}>ただいまご案内中の時間帯</h1>
        <div
          style={{
            ...styles.calledNumberWrapper,
            animation: calledSlots.length > 0 ? 'pulse 1.5s infinite' : 'none',
          }}
        >
          {calledSlots.length > 0 ? (
            <span style={styles.calledNumberText}>{calledSlotsText}</span>
          ) : (
            <span style={{ ...styles.calledNumberText, fontSize: '7vh' }}>
              {totalWaitingGroups > 0
                ? `現在 ${totalWaitingGroups} 組予約待ち`
                : '受付終了'}
            </span>
          )}
        </div>
        <p style={styles.subText}>
          お呼び出し後は、受付までお越しください。
        </p>
      </div>

      {/* 時間割エリア */}
      <div style={styles.scheduleSection}>
        <div style={styles.scheduleHeader}>
          <h2 style={styles.scheduleTitle}>本日の時間割・混雑状況</h2>
          <div style={styles.legend}>
            {Object.entries(CONGESTION_STYLE).map(([key, style]) => (
              <div key={key} style={styles.legendItem}>
                <span
                  style={{
                    ...styles.legendSwatch,
                    backgroundColor: style.background,
                  }}
                />
                <span>{style.label}</span>
              </div>
            ))}
          </div>
        </div>

        {slotSummaries.length === 0 ? (
          <div style={styles.emptySchedule}>本日の時間割はありません。</div>
        ) : (
          <div style={styles.slotGrid}>
            {slotSummaries.map((slot) => {
              const style = CONGESTION_STYLE[slot.level];
              return (
                <div
                  key={`${slot.start}-${slot.end}`}
                  style={{
                    ...styles.slotCard,
                    backgroundColor: style.background,
                    color: style.text,
                    ...(slot.isCalled ? styles.slotCardCalled : {}),
                  }}
                >
                  <div style={styles.slotTime}>
                    {slot.start}
                    <br />〜{slot.end}
                  </div>
                  <div style={styles.slotRemaining}>
                    {slot.level === 'full' ? '満席' : `残り ${slot.remaining}人`}
                  </div>
                  {slot.isCalled && (
                    <div style={styles.slotCalledBadge}>ご案内中</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// レスポンシブなスタイル定義
const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#001f3f', // ネイビー
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
  },
  messageScreen: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '5vh',
    color: '#666',
    backgroundColor: '#f0f0f0',
  },
  calledSection: {
    flex: 3, // 画面の約半分〜3/5を占める
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '2vh 2vw',
    borderBottom: '0.5vh solid #0074D9',
    textAlign: 'center',
  },
  calledTitle: {
    fontSize: '6vh',
    color: '#FF4136', // 赤
    margin: '0 0 2vh 0',
    fontWeight: '900',
  },
  calledNumberWrapper: {
    backgroundColor: '#fff',
    color: '#FF4136',
    borderRadius: '2vh',
    padding: '2vh 5vw',
    margin: '1vh 0',
    width: '90%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '20vh',
  },
  calledNumberText: {
    fontSize: '10vh',
    fontWeight: '900',
    lineHeight: 1.2,
    wordBreak: 'break-word',
    textAlign: 'center',
  },
  subText: {
    fontSize: '3vh',
    opacity: 0.9,
    marginTop: '1vh',
  },
  scheduleSection: {
    flex: 4, // 画面の約半分〜3/5を占める
    backgroundColor: '#001a33',
    padding: '2vh 2vw',
    width: '100%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  scheduleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1vh',
    marginBottom: '1.5vh',
  },
  scheduleTitle: {
    fontSize: '3.5vh',
    margin: 0,
    color: '#7FDBFF',
  },
  legend: {
    display: 'flex',
    gap: '1.5vw',
    fontSize: '1.8vh',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5vw',
  },
  legendSwatch: {
    display: 'inline-block',
    width: '1.8vh',
    height: '1.8vh',
    borderRadius: '0.4vh',
  },
  emptySchedule: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '3vh',
    color: '#7FDBFF',
  },
  slotGrid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(11vw, 1fr))',
    gridAutoRows: 'minmax(10vh, 1fr)',
    gap: '1vh',
    overflowY: 'auto',
  },
  slotCard: {
    borderRadius: '1.2vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1vh',
    textAlign: 'center',
    position: 'relative',
  },
  slotCardCalled: {
    outline: '0.5vh solid #ffffff',
    outlineOffset: '-0.5vh',
  },
  slotTime: {
    fontSize: '2vh',
    fontWeight: '800',
    lineHeight: 1.2,
  },
  slotRemaining: {
    fontSize: '1.7vh',
    fontWeight: '700',
    marginTop: '0.6vh',
  },
  slotCalledBadge: {
    marginTop: '0.6vh',
    fontSize: '1.4vh',
    fontWeight: '900',
    backgroundColor: 'rgba(0,0,0,0.25)',
    padding: '0.2vh 0.8vh',
    borderRadius: '999px',
  },
};