import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
} from 'firebase/firestore';

// ====================================================================
// サーバー / LINE QRコード設定
// ====================================================================
const SERVER_URL = 'https://hinodefes.onrender.com';
const LINE_QR_CODE_URL = 'https://hinodefes-57609.web.app/QQRCODE.png';

// ====================================================================
// Firebase設定
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

const normalizeStatus = (status) => {
  if (status === 'waiting') return 'reserved';
  if (status === 'called') return 'entryGuidance';
  if (status === 'completed' || status === 'seatEnter') return 'used';
  return status || 'reserved';
};

export default function Reception() {
  const [db, setDb] = useState(null);
  const [name, setName] = useState('');
  const [people, setPeople] = useState(1);
  const [wantsLine, setWantsLine] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [reservations, setReservations] = useState([]);

  const [isReserved, setIsReserved] = useState(false);
  const [reservationCode, setReservationCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const today = useMemo(() => getTodayString(), []);

  // ----------------------------------------------------------------
  // Firebase初期化・匿名認証
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!Object.keys(firebaseConfig).length) {
      setError('Firebase設定が見つかりません。');
      setLoading(false);
      return undefined;
    }

    try {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const firestore = getFirestore(app);
      setDb(firestore);

      if (!auth.currentUser) {
        signInAnonymously(auth).catch((authError) => {
          console.error('Firebase匿名認証エラー:', authError);
          setError('データベースへの接続に失敗しました。');
        });
      }
    } catch (e) {
      console.error('Firebase初期化エラー:', e);
      setError(`アプリケーションの初期化に失敗しました: ${e.message}`);
      setLoading(false);
    }

    return undefined;
  }, []);

  // ----------------------------------------------------------------
  // 設定をリアルタイム取得
  // Admin.jsと同じ settings/attraction を使用
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!db) return undefined;

    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'attraction'),
      (snapshot) => {
        if (snapshot.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...snapshot.data() });
        } else {
          setSettings(DEFAULT_SETTINGS);
        }
        setLoading(false);
      },
      (err) => {
        console.error('設定取得エラー:', err);
        setError(`アトラクション設定の取得に失敗しました: ${err.message}`);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [db]);

  // ----------------------------------------------------------------
  // 本日の予約をリアルタイム取得
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!db) return undefined;

    const reservationsQuery = query(
      collection(db, 'reservations'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      reservationsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((reservationDoc) => ({
          id: reservationDoc.id,
          ...reservationDoc.data(),
        }));
        setReservations(list);
      },
      (err) => {
        console.error('予約取得エラー:', err);
        setError(`予約情報の取得に失敗しました: ${err.message}`);
      }
    );

    return () => unsubscribe();
  }, [db]);

  // ----------------------------------------------------------------
  // 時間割を自動生成
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

  // ----------------------------------------------------------------
  // 各時間帯の残り人数
  // 利用済みは定員計算から除外
  // ----------------------------------------------------------------
  const slotSummaries = useMemo(() => {
    return slots.map((slot) => {
      const slotReservations = reservations.filter((reservation) => {
        return (
          getReservationDate(reservation) === today &&
          getSlotStart(reservation) === slot.start &&
          normalizeStatus(reservation.status) !== 'used'
        );
      });

      const reservedPeople = slotReservations.reduce(
        (sum, reservation) => sum + Math.max(0, Number(reservation.people) || 0),
        0
      );

      return {
        ...slot,
        reservedPeople,
        remaining: Math.max(
          0,
          Number(settings.maxPeoplePerSession) - reservedPeople
        ),
      };
    });
  }, [slots, reservations, today, settings.maxPeoplePerSession]);

  // ----------------------------------------------------------------
  // 入力人数に応じて選択可能な時間帯を決定
  // ----------------------------------------------------------------
  const availableSlots = useMemo(() => {
    const requestedPeople = Math.max(1, Number(people) || 1);
    return slotSummaries.filter((slot) => slot.remaining >= requestedPeople);
  }, [slotSummaries, people]);

  // 人数変更で選択中の時間帯に入れなくなった場合は解除
  useEffect(() => {
    if (!selectedSlot) return;
    const stillAvailable = availableSlots.some(
      (slot) => slot.start === selectedSlot.start
    );
    if (!stillAvailable) {
      setSelectedSlot(null);
    }
  }, [availableSlots, selectedSlot]);

  // ----------------------------------------------------------------
  // 新規予約
  // ----------------------------------------------------------------
  const handleNewReservation = () => {
    setIsReserved(false);
    setReservationCode(null);
    setName('');
    setPeople(1);
    setWantsLine(false);
    setSelectedSlot(null);
    setMessage(null);
  };

  // ----------------------------------------------------------------
  // 予約登録
  // ----------------------------------------------------------------
  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage(null);

    const requestedPeople = Number(people);

    if (!name.trim()) {
      setMessage({ type: 'error', text: '氏名を入力してください。' });
      return;
    }

    if (!Number.isInteger(requestedPeople) || requestedPeople < 1) {
      setMessage({ type: 'error', text: '人数は1人以上で入力してください。' });
      return;
    }

    if (requestedPeople > Number(settings.maxPeoplePerSession)) {
      setMessage({
        type: 'error',
        text: `1回あたりの最大人数は${settings.maxPeoplePerSession}人です。`,
      });
      return;
    }

    if (!selectedSlot) {
      setMessage({ type: 'error', text: '利用する時間帯を選択してください。' });
      return;
    }

    const latestSlot = slotSummaries.find(
      (slot) => slot.start === selectedSlot.start
    );

    if (!latestSlot || latestSlot.remaining < requestedPeople) {
      setMessage({
        type: 'error',
        text: '選択した時間帯の定員に達しました。別の時間帯を選択してください。',
      });
      setSelectedSlot(null);
      return;
    }

    if (!db) {
      setMessage({ type: 'error', text: 'データベースに接続できていません。' });
      return;
    }

    setSubmitting(true);

    const reservationData = {
      reservationDate: today,
      slotStart: selectedSlot.start,
      slotEnd: selectedSlot.end,
      name: name.trim(),
      people: requestedPeople,
      wantsLine,
      lineUserId: null,
      status: 'reserved',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      // 新仕様では予約番号を発行せず、FirestoreのドキュメントIDを内部IDとして使用
      const reservationRef = await addDoc(
        collection(db, 'reservations'),
        reservationData
      );

      // LINE希望者については、既存サーバー側の通知処理が利用できるよう
      // 予約IDと時間帯を通知APIへ渡す。API未対応でも予約自体は成功扱いにする。
      if (wantsLine) {
        try {
          const lineResponse = await fetch(`${SERVER_URL}/api/reservations/${reservationRef.id}/line`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reservationId: reservationRef.id,
              reservationDate: today,
              slotStart: selectedSlot.start,
              slotEnd: selectedSlot.end,
              name: name.trim(),
              people: requestedPeople,
              notifyBeforeMinutes: Number(settings.notifyBeforeMinutes),
            }),
          });

          if (lineResponse.ok) {
            const lineData = await lineResponse.json();
            setReservationCode(lineData.reservationCode || null);
          } else {
            console.warn('LINE連携APIがエラーを返しました:', lineResponse.status);
          }
        } catch (lineError) {
          // LINE連携APIがまだ新仕様に対応していない場合でも予約は保持する
          console.warn('LINE連携API呼び出しに失敗しました:', lineError);
        }
      }

      setIsReserved(true);
    } catch (err) {
      console.error('予約登録エラー:', err);
      setMessage({
        type: 'error',
        text: err.message || '予約処理中にエラーが発生しました。',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ----------------------------------------------------------------
  // ローディング / エラー
  // ----------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ ...styles.container, ...styles.centered }}>
        <div style={styles.card}>
          <p style={{ textAlign: 'center', fontSize: '1.2rem' }}>
            予約情報を読み込み中...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...styles.container, ...styles.centered }}>
        <div style={styles.card}>
          <h1 style={{ color: '#dc2626' }}>エラー</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------
  // 予約完了画面
  // ----------------------------------------------------------------
  if (isReserved) {
    return (
      <div style={{ ...styles.container, ...styles.centered }}>
        <div style={{ ...styles.card, maxWidth: '620px' }}>
          <div style={styles.successMark}>✓</div>
          <h1 style={styles.h1}>予約受付完了</h1>

          <div style={styles.confirmBox}>
            <div style={styles.confirmLabel}>ご予約時間</div>
            <div style={styles.confirmTime}>
              {selectedSlot?.start}〜{selectedSlot?.end}
            </div>
            <div style={styles.confirmRow}>
              <span>お名前</span>
              <strong>{name}</strong>
            </div>
            <div style={styles.confirmRow}>
              <span>人数</span>
              <strong>{people}名</strong>
            </div>
          </div>

          {wantsLine ? (
            <div style={styles.lineBox}>
              <h2 style={{ marginTop: 0 }}>LINE通知をご希望のお客様へ</h2>
              <p>
                下のQRコードからLINEを友だち追加のうえ、
                <br />
                トーク画面で下の「予約コード」を送信してください。
              </p>
              <img
                src={LINE_QR_CODE_URL}
                alt="LINE QR Code"
                style={styles.qrCode}
              />
              {reservationCode ? (
                <div style={styles.reservationCodeBox}>
                  <div style={styles.reservationCodeLabel}>予約コード</div>
                  <div style={styles.reservationCodeValue}>{reservationCode}</div>
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#9a3412', marginTop: '0.8rem' }}>
                  予約コードの発行に失敗しました。受付スタッフにお声がけください。
                </p>
              )}
            </div>
          ) : (
            <div style={styles.infoBox}>
              ご予約時間が近づきましたら、館内の案内をご確認ください。
            </div>
          )}

          <button
            type="button"
            onClick={handleNewReservation}
            style={{ ...styles.button, ...styles.newButton }}
          >
            新規予約
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------
  // 受付フォーム
  // ----------------------------------------------------------------
  return (
    <div style={styles.container}>
      <div style={{ ...styles.card, maxWidth: '760px' }}>
        <h1 style={styles.h1}>アトラクション予約</h1>

        <div style={styles.todayBadge}>本日 {today}</div>

        <form onSubmit={handleSubmit}>
          {/* 氏名 */}
          <div style={styles.formGroup}>
            <label style={styles.label} htmlFor="name">
              お名前
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              style={styles.input}
              placeholder="例：日野 太郎"
              autoComplete="name"
            />
          </div>

          {/* 人数 */}
          <div style={styles.formGroup}>
            <label style={styles.label} htmlFor="people">
              ご利用人数
            </label>
            <div style={styles.peopleInputRow}>
              <input
                id="people"
                type="number"
                value={people}
                onChange={(event) => {
                  const value = Math.max(1, parseInt(event.target.value, 10) || 1);
                  setPeople(value);
                }}
                min="1"
                max={settings.maxPeoplePerSession}
                required
                style={{ ...styles.input, marginBottom: 0 }}
              />
              <span style={styles.peopleUnit}>名</span>
            </div>
            <div style={styles.helpText}>
              1回あたり最大 {settings.maxPeoplePerSession}名
            </div>
          </div>

          {/* 時間割 */}
          <div style={styles.scheduleSection}>
            <div style={styles.scheduleHeader}>
              <div>
                <h2 style={styles.h2}>利用時間を選択してください</h2>
                <p style={styles.scheduleDescription}>
                  {people}名で利用できる時間帯を表示しています。
                </p>
              </div>
              <div style={styles.capacityLegend}>
                <span style={styles.legendAvailable}>選択可能</span>
                <span style={styles.legendUnavailable}>満員</span>
              </div>
            </div>

            {slotSummaries.length === 0 ? (
              <div style={styles.infoBox}>
                現在、時間割を表示できません。管理画面の営業時間と利用時間の設定を確認してください。
              </div>
            ) : (
              <div style={styles.slotGrid}>
                {slotSummaries.map((slot) => {
                  const isAvailable = slot.remaining >= Number(people);
                  const isSelected = selectedSlot?.start === slot.start;

                  return (
                    <button
                      key={`${slot.start}-${slot.end}`}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => setSelectedSlot(slot)}
                      style={{
                        ...styles.slotButton,
                        ...(isSelected ? styles.slotButtonSelected : {}),
                        ...(!isAvailable ? styles.slotButtonDisabled : {}),
                      }}
                    >
                      <div style={styles.slotTime}>
                        {slot.start}〜{slot.end}
                      </div>
                      <div
                        style={{
                          ...styles.slotRemaining,
                          color: isAvailable ? '#059669' : '#9ca3af',
                        }}
                      >
                        残り {slot.remaining}人
                      </div>
                      {!isAvailable && (
                        <div style={styles.fullLabel}>満員</div>
                      )}
                      {isSelected && (
                        <div style={styles.selectedLabel}>✓ 選択中</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {slots.length > 0 && availableSlots.length === 0 && (
              <div style={styles.warningBox}>
                {people}名で利用できる時間帯がありません。
                人数を減らすか、空きが出るまでお待ちください。
              </div>
            )}
          </div>

          {/* 選択確認 */}
          {selectedSlot && (
            <div style={styles.selectedSummary}>
              <div style={styles.selectedSummaryLabel}>選択した時間</div>
              <div style={styles.selectedSummaryTime}>
                {selectedSlot.start}〜{selectedSlot.end}
              </div>
              <div style={styles.selectedSummaryCapacity}>
                予約後の残り定員：{Math.max(0, selectedSlot.remaining - Number(people))}人
              </div>
            </div>
          )}

          {/* LINE */}
          <div style={styles.lineCheckbox}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={wantsLine}
                onChange={(event) => setWantsLine(event.target.checked)}
                style={styles.checkbox}
              />
              <span>
                <strong>LINEで通知を受け取る</strong>
                <small>
                  ご予約時間が近づいたらLINEにもお知らせします。
                </small>
              </span>
            </label>
          </div>

          {message && (
            <div
              style={{
                ...styles.message,
                ...(message.type === 'error'
                  ? styles.errorMessage
                  : styles.successMessage),
              }}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedSlot}
            style={{
              ...styles.button,
              ...styles.submitButton,
              opacity: submitting || !selectedSlot ? 0.55 : 1,
              cursor: submitting || !selectedSlot ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? '予約中...' : 'この内容で予約する'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ====================================================================
// スタイル
// ====================================================================
const styles = {
  container: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    backgroundColor: '#f0f2f5',
    minHeight: '100vh',
    padding: '2rem',
    boxSizing: 'border-box',
  },
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '14px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    padding: '2rem',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  h1: {
    textAlign: 'center',
    color: '#333',
    margin: '0 0 1rem',
    paddingBottom: '0.75rem',
    borderBottom: '2px solid #4CAF50',
  },
  h2: {
    fontSize: '1.2rem',
    color: '#333',
    margin: 0,
  },
  todayBadge: {
    textAlign: 'center',
    color: '#666',
    fontSize: '0.9rem',
    marginBottom: '1.75rem',
  },
  formGroup: {
    marginBottom: '1.4rem',
  },
  label: {
    display: 'block',
    marginBottom: '0.5rem',
    color: '#333',
    fontWeight: '700',
  },
  input: {
    width: '100%',
    padding: '0.85rem',
    border: '1px solid #ccc',
    borderRadius: '7px',
    fontSize: '1rem',
    boxSizing: 'border-box',
    backgroundColor: '#fff',
  },
  peopleInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  peopleUnit: {
    fontWeight: '700',
    fontSize: '1.1rem',
  },
  helpText: {
    marginTop: '0.4rem',
    fontSize: '0.8rem',
    color: '#777',
  },
  scheduleSection: {
    borderTop: '1px solid #eee',
    paddingTop: '1.4rem',
    marginTop: '0.5rem',
  },
  scheduleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  scheduleDescription: {
    color: '#666',
    fontSize: '0.85rem',
    margin: '0.35rem 0 0',
  },
  capacityLegend: {
    display: 'flex',
    gap: '0.5rem',
    fontSize: '0.75rem',
  },
  legendAvailable: {
    padding: '0.35rem 0.55rem',
    backgroundColor: '#ecfdf5',
    color: '#047857',
    borderRadius: '999px',
  },
  legendUnavailable: {
    padding: '0.35rem 0.55rem',
    backgroundColor: '#e5e7eb',
    color: '#6b7280',
    borderRadius: '999px',
  },
  slotGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
    gap: '0.7rem',
  },
  slotButton: {
    border: '2px solid #a7f3d0',
    backgroundColor: '#f0fdf4',
    borderRadius: '9px',
    padding: '0.9rem',
    cursor: 'pointer',
    textAlign: 'left',
    minHeight: '105px',
    boxSizing: 'border-box',
  },
  slotButtonSelected: {
    border: '3px solid #2563eb',
    backgroundColor: '#eff6ff',
  },
  slotButtonDisabled: {
    border: '2px solid #d1d5db',
    backgroundColor: '#e5e7eb',
    color: '#9ca3af',
    cursor: 'not-allowed',
  },
  slotTime: {
    fontSize: '1.15rem',
    fontWeight: '800',
    color: '#111827',
    marginBottom: '0.45rem',
  },
  slotRemaining: {
    fontSize: '0.95rem',
    fontWeight: '700',
  },
  fullLabel: {
    marginTop: '0.3rem',
    fontSize: '0.75rem',
    fontWeight: '700',
    color: '#6b7280',
  },
  selectedLabel: {
    marginTop: '0.35rem',
    fontSize: '0.75rem',
    fontWeight: '800',
    color: '#2563eb',
  },
  selectedSummary: {
    marginTop: '1.2rem',
    padding: '1rem',
    borderRadius: '8px',
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    textAlign: 'center',
  },
  selectedSummaryLabel: {
    fontSize: '0.8rem',
    color: '#64748b',
  },
  selectedSummaryTime: {
    fontSize: '1.6rem',
    fontWeight: '800',
    color: '#1d4ed8',
    margin: '0.2rem 0',
  },
  selectedSummaryCapacity: {
    fontSize: '0.8rem',
    color: '#475569',
  },
  lineCheckbox: {
    margin: '1.4rem 0',
    padding: '1rem',
    backgroundColor: '#fffbe6',
    border: '1px solid #ffe08a',
    borderRadius: '8px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.7rem',
    cursor: 'pointer',
  },
  checkbox: {
    width: '20px',
    height: '20px',
    marginTop: '2px',
    flexShrink: 0,
  },
  checkboxLabelSmall: {},
  message: {
    padding: '1rem',
    borderRadius: '7px',
    margin: '1rem 0',
    textAlign: 'center',
  },
  errorMessage: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
  },
  successMessage: {
    backgroundColor: '#d4edda',
    color: '#155724',
  },
  warningBox: {
    marginTop: '1rem',
    padding: '0.9rem',
    borderRadius: '7px',
    backgroundColor: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#9a3412',
    textAlign: 'center',
    fontSize: '0.9rem',
  },
  infoBox: {
    padding: '1rem',
    borderRadius: '7px',
    backgroundColor: '#f3f4f6',
    color: '#4b5563',
    textAlign: 'center',
    fontSize: '0.9rem',
  },
  button: {
    width: '100%',
    padding: '1rem',
    fontSize: '1.05rem',
    fontWeight: '800',
    border: 'none',
    borderRadius: '7px',
    transition: 'opacity 0.2s',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    color: '#fff',
  },
  newButton: {
    backgroundColor: '#007bff',
    color: '#fff',
    marginTop: '1rem',
  },
  successMark: {
    width: '70px',
    height: '70px',
    margin: '0 auto 1rem',
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '2.8rem',
    fontWeight: '800',
  },
  confirmBox: {
    padding: '1.2rem',
    borderRadius: '9px',
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    marginBottom: '1.2rem',
  },
  confirmLabel: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: '0.85rem',
  },
  confirmTime: {
    textAlign: 'center',
    color: '#111827',
    fontSize: '2rem',
    fontWeight: '800',
    margin: '0.2rem 0 1rem',
  },
  confirmRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.55rem 0',
    borderTop: '1px solid #e5e7eb',
  },
  lineBox: {
    marginTop: '1rem',
    padding: '1.3rem',
    border: '1px solid #ddd',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    textAlign: 'center',
  },
  qrCode: {
    width: '180px',
    height: '180px',
    marginTop: '0.7rem',
    objectFit: 'contain',
  },
  reservationCodeBox: {
    marginTop: '1rem',
    padding: '0.8rem',
    backgroundColor: '#fff',
    border: '2px dashed #f59e0b',
    borderRadius: '8px',
    display: 'inline-block',
  },
  reservationCodeLabel: {
    fontSize: '0.8rem',
    color: '#92400e',
    fontWeight: '700',
  },
  reservationCodeValue: {
    fontSize: '2.2rem',
    fontWeight: '900',
    letterSpacing: '0.3rem',
    color: '#92400e',
  },
};