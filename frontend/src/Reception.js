import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

// ====================================================================
// サーバーとLINEのQRコード定義
// ====================================================================

// 🚨 【要変更】あなたのRenderサーバーのURLに置き換えてください
const SERVER_URL = "https://yakisoba-lvls.onrender.com";

// 🚨 【要変更】LINE友だち追加用QRコード画像のURLに置き換えてください
const LINE_QR_CODE_URL = '/QRRCODE.png';

// ====================================================================
// Firebase 設定
// 環境変数から読み込むことを推奨します
// ====================================================================

const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG
  ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG)
  : {};

// ====================================================================
// 商品定義（焼きそば単品販売）
// ====================================================================

const ITEM_KEY = 'yakisoba';
const ITEM_NAME = '焼きそば';
const ITEM_PRICE = 400; // 🚨 【要変更】実際の販売価格に合わせて調整してください

// ====================================================================
// メインコンポーネント
// ====================================================================

export default function Reception() {
  // ----------------------------------------------------------------
  // 状態管理 (State)
  // ----------------------------------------------------------------

  // Firebaseインスタンス
  const [db, setDb] = useState(null);

  // フォーム入力値
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [wantsLine, setWantsLine] = useState(false);

  // 在庫管理（リアルタイム更新用）
  const [stockLimit, setStockLimit] = useState(null); // 焼きそばの最大在庫数
  const [sold, setSold] = useState(null); // 焼きそばの販売実績

  // UI制御
  const [isReserved, setIsReserved] = useState(false);
  const [reservedNumber, setReservedNumber] = useState(null);
  const [loading, setLoading] = useState(true); // 初期化・データ取得ローディング
  const [submitting, setSubmitting] = useState(false); // フォーム送信中
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null); // 成功・エラーメッセージ

  // ----------------------------------------------------------------
  // 計算済みプロパティ
  // ----------------------------------------------------------------

  // 残り在庫数をリアルタイムで計算
  const remainingStock = useMemo(() => {
    if (stockLimit === null || sold === null) return null;
    return Math.max(0, stockLimit - sold);
  }, [stockLimit, sold]);

  const isSoldOut = remainingStock === 0;

  // 合計金額を計算
  const totalPrice = quantity * ITEM_PRICE;

  // ----------------------------------------------------------------
  // Firebase 初期化と認証
  // ----------------------------------------------------------------

  useEffect(() => {
    if (!Object.keys(firebaseConfig).length) {
      setError("Firebase設定が見つかりません。");
      setLoading(false);
      return;
    }
    try {
      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      const auth = getAuth(app);
      const firestore = getFirestore(app);

      setDb(firestore);

      // 匿名認証でFirestoreへの読み取りアクセスを確保
      if (!auth.currentUser) {
        signInAnonymously(auth).catch(authError => {
          console.error("Firebase匿名認証エラー:", authError);
          setError("データベースへの接続に失敗しました。");
        });
      }
    } catch (e) {
      console.error("Firebase初期化エラー:", e);
      setError("アプリケーションの初期化に失敗しました。");
      setLoading(false);
    }
  }, []);

  // ----------------------------------------------------------------
  // リアルタイム在庫監視 (Firestore onSnapshot)
  // ----------------------------------------------------------------

  useEffect(() => {
    if (!db) return;

    setLoading(true);

    // settings/stockLimits ドキュメントの { yakisoba: <上限数> } フィールドを監視
    const unsubStock = onSnapshot(doc(db, 'settings', 'stockLimits'), (docSnap) => {
      if (docSnap.exists()) {
        setStockLimit(docSnap.data()[ITEM_KEY] ?? 0);
      } else {
        setError("在庫上限設定が見つかりません。");
      }
    }, (err) => {
      console.error("在庫上限の購読エラー:", err);
      setError("在庫上限の取得に失敗しました。");
    });

    // settings/salesStats ドキュメントの { yakisoba: <販売済み数> } フィールドを監視
    const unsubSales = onSnapshot(doc(db, 'settings', 'salesStats'), (docSnap) => {
      if (docSnap.exists()) {
        setSold(docSnap.data()[ITEM_KEY] ?? 0);
      } else {
        // 販売実績がない場合は0とみなす
        setSold(0);
      }
      setLoading(false); // データが揃ったらローディング完了
    }, (err) => {
      console.error("販売実績の購読エラー:", err);
      setError("販売実績の取得に失敗しました。");
      setLoading(false);
    });

    return () => {
      unsubStock();
      unsubSales();
    };
  }, [db]);


  // ----------------------------------------------------------------
  // イベントハンドラ
  // ----------------------------------------------------------------

  // 注文数変更
  const handleQuantityChange = useCallback((value) => {
    const amount = Math.max(0, parseInt(value, 10) || 0);
    const stock = remainingStock ?? 0;

    // 在庫数を超えないように制限
    setQuantity(Math.min(amount, stock));
  }, [remainingStock]);

  // 新規予約の開始
  const handleNewReservation = () => {
    setIsReserved(false);
    setReservedNumber(null);
    setName('');
    setQuantity(1);
    setWantsLine(false);
    setMessage(null);
  };

  // フォーム送信（予約登録）
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    // バリデーション
    if (!name.trim()) {
      setMessage({ type: 'error', text: '氏名を入力してください。' });
      return;
    }
    if (quantity <= 0) {
      setMessage({ type: 'error', text: `${ITEM_NAME}の数量を1つ以上指定してください。` });
      return;
    }

    setSubmitting(true);

    // quantity: 完成数に基づく呼び出し判定で使用する焼きそばの注文数
    // items: 既存のデータ構造との互換性のため単品でも { yakisoba: 数量 } の形で保持
    const reservationData = {
      name: name.trim(),
      quantity,
      items: { [ITEM_KEY]: quantity },
      wantsLine,
      lineUserId: null, // LINE IDはサーバー側で紐付けするため常にnull
    };

    try {
      const response = await fetch(`${SERVER_URL}/api/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reservationData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '予約処理中にサーバーエラーが発生しました。');
      }

      // 予約成功
      setReservedNumber(result.number);
      setIsReserved(true);

    } catch (err) {
      console.error("予約処理中のエラー:", err);
      setMessage({ type: 'error', text: err.message || '通信エラーが発生しました。' });
    } finally {
      setSubmitting(false);
    }
  };


  // ----------------------------------------------------------------
  // レンダリング
  // ----------------------------------------------------------------

  // ローディング中
  if (loading) {
    return <div style={styles.container}><h1>在庫情報を読み込み中...</h1></div>;
  }

  // エラー発生時
  if (error) {
    return <div style={styles.container}><h1 style={{color: 'red'}}>エラー: {error}</h1></div>;
  }

  // 予約完了画面
  if (isReserved) {
    return (
      <div style={{...styles.container, ...styles.centered}}>
        <div style={styles.card}>
          <div style={{ fontSize: '3rem', color: '#28a745' }}>✓</div>
          <h1 style={styles.h1}>受付完了</h1>
          <p style={{ fontSize: '1.2rem', margin: '1rem 0' }}>
            受付番号: <span style={styles.reservedNumber}>{reservedNumber}</span>
          </p>
          {wantsLine && (
            <div style={styles.lineBox}>
              <p style={{ fontWeight: 'bold' }}>LINE通知をご希望のお客様へ</p>
              <p style={{ fontSize: '0.9rem', color: '#c00' }}>
                お手数ですが、以下のQRコードを読み込んで「番号」を送信してください。
              </p>
              <img src={LINE_QR_CODE_URL} alt="LINE QR Code" style={{ width: '150px', height: '150px', marginTop: '1rem' }}/>
            </div>
          )}
          <button onClick={handleNewReservation} style={{...styles.button, ...styles.newButton}}>
            新規受付
          </button>
        </div>
      </div>
    );
  }

  // 受付フォーム画面
  return (
    <div style={styles.container}>
      <div style={{...styles.card, maxWidth: '600px'}}>
        <h1 style={styles.h1}>{ITEM_NAME} 予約受付フォーム</h1>

        <form onSubmit={handleSubmit}>
          {/* 基本情報 */}
          <div style={styles.formSection}>
            <div style={styles.formGroup}>
              <label style={styles.label}>氏名</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required style={styles.input} placeholder="例: 日野フエス"/>
            </div>
          </div>

          {/* 商品注文（焼きそば単品） */}
          <div style={{...styles.formSection, borderTop: '1px solid #eee', paddingTop: '1rem'}}>
            <h2 style={styles.h2}>ご注文</h2>
            <div style={styles.itemRow}>
              <label style={{...styles.label, flex: 3, color: isSoldOut ? '#aaa' : '#333'}}>
                {ITEM_NAME}（{ITEM_PRICE.toLocaleString()}円）
              </label>
              <span style={{flex: 2, color: isSoldOut ? 'red' : '#555', fontWeight: 'bold' }}>
                {isSoldOut ? "完売" : `残り: ${remainingStock}`}
              </span>
              <input
                type="number"
                value={quantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
                min="0"
                max={remainingStock ?? 0}
                disabled={isSoldOut}
                style={{...styles.input, flex: 1, textAlign: 'center'}}
              />
            </div>
          </div>

          {/* 合計 */}
          <div style={styles.totalBox}>
            <span>合計: <strong>{totalPrice.toLocaleString()} 円</strong> ({quantity} 食)</span>
          </div>

          {/* LINE通知 */}
          <div style={styles.lineCheckbox}>
            <label>
              <input
                type="checkbox"
                checked={wantsLine}
                onChange={(e) => setWantsLine(e.target.checked)}
                style={{ marginRight: '10px' }}
              />
              LINEで呼び出し通知を受け取る
            </label>
          </div>

          {/* メッセージ表示 */}
          {message && (
             <div style={{...styles.message, backgroundColor: message.type === 'error' ? '#f8d7da' : '#d4edda', color: message.type === 'error' ? '#721c24' : '#155724'}}>
              {message.text}
            </div>
          )}

          {/* 送信ボタン */}
          <button type="submit" disabled={submitting || quantity <= 0 || isSoldOut} style={{...styles.button, ...styles.submitButton}}>
            {submitting ? '予約中...' : 'この内容で予約する'}
          </button>
        </form>
      </div>
    </div>
  );
}


// ====================================================================
// スタイル定義
// ====================================================================

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    padding: '2rem',
    margin: '0 auto',
    width: '100%',
  },
  h1: {
    textAlign: 'center',
    color: '#333',
    marginBottom: '2rem',
    borderBottom: '2px solid #4CAF50',
    paddingBottom: '0.5rem',
  },
  h2: {
    fontSize: '1.2rem',
    color: '#555',
    marginBottom: '1rem',
  },
  formSection: {
    marginBottom: '1.5rem',
  },
  formGroup: {
    marginBottom: '1rem',
  },
  label: {
    display: 'block',
    marginBottom: '0.5rem',
    color: '#333',
    fontWeight: '600',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #ccc',
    borderRadius: '6px',
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  totalBox: {
    textAlign: 'right',
    fontSize: '1.2rem',
    fontWeight: 'bold',
    margin: '1.5rem 0',
    padding: '1rem',
    backgroundColor: '#e9f5e9',
    borderRadius: '6px',
  },
  lineCheckbox: {
    margin: '1.5rem 0',
    padding: '1rem',
    backgroundColor: '#fffbe6',
    border: '1px solid #ffeeba',
    borderRadius: '6px',
    textAlign: 'center',
  },
  message: {
    padding: '1rem',
    borderRadius: '6px',
    margin: '1rem 0',
    textAlign: 'center',
  },
  button: {
    width: '100%',
    padding: '1rem',
    fontSize: '1.1rem',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    color: 'white',
    ':disabled': {
        backgroundColor: '#aaa',
        cursor: 'not-allowed',
    }
  },
  newButton: {
      backgroundColor: '#007bff',
      color: 'white',
      marginTop: '1.5rem',
  },
  reservedNumber: {
    fontSize: '3rem',
    color: '#d9534f',
    fontWeight: 'bold',
  },
  lineBox: {
    marginTop: '1.5rem',
    padding: '1.5rem',
    border: '1px solid #ddd',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    textAlign: 'center',
  },
};