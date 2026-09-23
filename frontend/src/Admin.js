import React, { useState, useEffect, useMemo, useCallback } from 'react';

// ====================================================================
// Firebase/API インポート
// ====================================================================
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, doc, updateDoc, orderBy } from "firebase/firestore";
import { setLogLevel } from 'firebase/firestore';

// 🚨 【要変更】あなたのRenderサーバーのURLに置き換えてください
const API_BASE_URL = 'https://yakisoba-1.onrender.com';

// --------------------------------------------------------------------------------
// Firebase設定の読み込み
// --------------------------------------------------------------------------------
const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG) : {};
const initialAuthToken = null;
const initialAppId = firebaseConfig.appId || 'default-app-id';

// 管理者トークン (🚨 【要変更】Admin認証に使用するシークレットなトークンに置き換えてください)
const ADMIN_CUSTOM_AUTH_TOKEN = "your-admin-custom-token-here";

// --------------------------------------------------------------------------------
// 商品定義（焼きそば単品販売のため団体・グループの概念は廃止）
// --------------------------------------------------------------------------------
const ITEM_KEY = 'yakisoba';
const ITEM_NAME = '焼きそば';
const ITEM_PRICE = 400; // 🚨 【要変更】Reception.jsと同じ値に合わせてください

// --------------------------------------------------------------------------------
// スタイル定義 (Tailwind CSSの代わりにインラインスタイルを使用)
// --------------------------------------------------------------------------------

const styles = {
    screenContainer: {
        minHeight: '100vh',
        backgroundColor: '#f3f4f6', // gray-100
        padding: '32px', // p-8
    },
    maxContainer: {
        maxWidth: '1280px', // max-w-7xl
        margin: '0 auto',
    },
    header: {
        fontSize: '32px', // text-4xl (少し小さめに調整)
        fontWeight: '800', // font-extrabold
        color: '#1f2937', // text-gray-900
        marginBottom: '24px', // mb-6
        borderBottom: '4px solid #f59e0b', // border-b-4 border-yellow-500
        paddingBottom: '8px', // pb-2
    },
    cardGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '24px', // gap-6
        marginBottom: '32px', // mb-8
    },
    panel: {
        backgroundColor: 'white',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)', // shadow-xl
        borderRadius: '12px', // rounded-xl
        padding: '24px', // p-6
    },
    listTitle: {
        fontSize: '24px', // text-2xl
        fontWeight: 'bold',
        color: '#1f2937', // text-gray-800
        marginBottom: '16px', // mb-4
        borderBottom: '1px solid #e5e7eb', // border-b
        paddingBottom: '8px', // pb-2
    },
    listItem: {
        padding: '16px', // p-4
        border: '1px solid #d1d5db', // border
        borderRadius: '8px', // rounded-lg
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', // shadow-sm
        backgroundColor: '#f9fafb', // bg-gray-50
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '12px',
    },
    statusTagBase: {
        padding: '4px 12px', // px-3 py-1
        fontSize: '12px', // text-sm
        fontWeight: '600', // font-semibold
        borderRadius: '9999px', // rounded-full
        border: '1px solid',
    },
    // デバッグ画面用スタイル
    errorContainer: {
        minHeight: '100vh',
        backgroundColor: '#fef2f2', // bg-red-50
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
    },
    errorBox: {
        padding: '32px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', // shadow-2xl
        border: '4px solid #ef4444', // border-red-500
        maxWidth: '512px', // max-w-lg
    }
};


// --------------------------------------------------------------------------------
// サブコンポーネント (インラインスタイルに変換)
// --------------------------------------------------------------------------------

// 統計カードのサブコンポーネント
const StatCard = ({ title, value, color }) => {
    let cardStyle = {
        ...styles.panel,
        padding: '16px', // p-4
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)', // shadow-md
        border: '1px solid #e5e7eb',
        backgroundColor: color === 'bg-white' ? 'white' : color,
    };

    return (
        <div style={cardStyle}>
            <p style={{ fontSize: '14px', fontWeight: '500', color: '#6b7280' }}>{title}</p>
            <p style={{ fontSize: '24px', fontWeight: '800', color: '#1f2937', marginTop: '4px' }}>{value}</p>
        </div>
    );
};

// ボタンのサブコンポーネント
const AdminButton = ({ onClick, color, label }) => {
    let buttonStyle = {
        padding: '4px 12px',
        fontSize: '14px',
        fontWeight: '600',
        borderRadius: '6px',
        transition: 'all 0.15s ease-in-out',
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        border: 'none',
        cursor: 'pointer',
    };

    switch (color) {
        case 'blue': buttonStyle = { ...buttonStyle, backgroundColor: '#3b82f6', color: 'white' }; break;
        case 'green': buttonStyle = { ...buttonStyle, backgroundColor: '#10b981', color: 'white' }; break;
        case 'gray': buttonStyle = { ...buttonStyle, backgroundColor: '#6b7280', color: 'white' }; break;
        case 'red': buttonStyle = { ...buttonStyle, backgroundColor: '#ef4444', color: 'white' }; break;
        case 'red-outline': buttonStyle = { ...buttonStyle, border: '1px solid #ef4444', color: '#ef4444', backgroundColor: 'transparent' }; break;
        default: buttonStyle = { ...buttonStyle, backgroundColor: '#e5e7eb', color: '#374151' }; break;
    }

    // ホバーエフェクトはインラインでは難しいので省略または簡略化
    return (
        <button onClick={onClick} style={buttonStyle}>
            {label}
        </button>
    );
};


// --------------------------------------------------------------------------------
// メインコンポーネント
// --------------------------------------------------------------------------------

export default function Admin() {
    // ----------------------------------------------------------------
    // 状態管理
    // ----------------------------------------------------------------
    // 完成した焼きそばの数（この数をもとに最適な番号を呼び出す）
    const [completedCount, setCompletedCount] = useState(1);
    const [reservations, setReservations] = useState([]);
    const [salesStats, setSalesStats] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showCompleted, setShowCompleted] = useState(true);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [dbInstance, setDbInstance] = useState(null);
    const [userId, setUserId] = useState(null);

    // 予約ステータス
    const STATUS_MAP = useMemo(() => ({
        waiting: { label: '待機中', color: '#fcd34d', bgColor: '#fffbeb', textColor: '#92400e' }, // yellow-400
        called: { label: '呼び出し中', color: '#f87171', bgColor: '#fef2f2', textColor: '#991b1b' }, // red-400
        completed: { label: '完了/受取済み', color: '#34d399', bgColor: '#ecfdf5', textColor: '#065f46' }, // green-400
        missed: { label: '不在', color: '#9ca3af', bgColor: '#f9fafb', textColor: '#374151' }, // gray-400
        seatEnter: { label: '受取済み', color: '#34d399', bgColor: '#ecfdf5', textColor: '#065f46' },
    }), []);


    // ----------------------------------------------------------------
    // 認証とFirebase初期化処理
    // ----------------------------------------------------------------
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            setError("Fatal Error: Firebase設定が見つかりません。");
            setLoading(false);
            return;
        }

        try {
            let app;
            if (!getApps().length) {
                app = initializeApp(firebaseConfig);
                console.log("✅ [Admin] Firebase App Initialized (New).");
            } else {
                app = getApp();
                console.log("✅ [Admin] Firebase App Initialized (Existing).");
            }

            const authInstance = getAuth(app);
            const firestoreInstance = getFirestore(app);
            setLogLevel('debug');

            setDbInstance(firestoreInstance);

            const authenticateAdmin = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authInstance, initialAuthToken);
                    }
                    else if (ADMIN_CUSTOM_AUTH_TOKEN && ADMIN_CUSTOM_AUTH_TOKEN !== "your-admin-custom-token-here") {
                        await signInWithCustomToken(authInstance, ADMIN_CUSTOM_AUTH_TOKEN);
                    }
                    else {
                        await signInAnonymously(authInstance);
                    }
                } catch (authError) {
                    console.error("❌ Admin Auth Failed:", authError);
                    setError(`管理者認証エラー: ${authError.message}`);
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

            return () => {
                unsubscribeAuth();
            };

        } catch (e) {
            console.error("❌ [Admin] Firebase Initialization Error:", e);
            setError(`Firebase初期化エラー: ${e.message}. ブラウザキャッシュをクリアしてください。`);
            setLoading(false);
        }
    }, []);

    // ----------------------------------------------------------------
    // リアルタイムデータ購読処理
    // ----------------------------------------------------------------
    useEffect(() => {
        if (!dbInstance || !userId) return;

        // 1. 予約リストのリアルタイム購読
        const reservationsCollectionPath = 'reservations';
        const qReservations = query(
            collection(dbInstance, reservationsCollectionPath),
            orderBy('createdAt', 'desc')
        );

        const unsubscribeReservations = onSnapshot(qReservations, (snapshot) => {
            const list = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : doc.data().createdAt,
                calledAt: doc.data().calledAt?.toDate ? doc.data().calledAt.toDate() : doc.data().calledAt,
            }));
            setReservations(list);
        }, (err) => {
            console.error("Firestore Listen Failed (Reservations):", err);
            setError(`データ取得エラー (予約): ${err.message}`);
        });

        // 2. 販売実績のリアルタイム購読
        const salesStatsRef = doc(dbInstance, 'settings', 'salesStats');
        const unsubscribeSalesStats = onSnapshot(salesStatsRef, (docSnap) => {
            if (docSnap.exists()) {
                setSalesStats(docSnap.data());
            } else {
                setSalesStats({ [ITEM_KEY]: 0 });
            }
        }, (err) => {
            console.error("販売実績の購読エラー:", err);
            setError("販売実績の取得に失敗しました。");
        });


        return () => {
            unsubscribeReservations();
            unsubscribeSalesStats();
        };

    }, [dbInstance, userId]);


    // ----------------------------------------------------------------
    // 自動呼び出し処理
    // 完成した焼きそばの数を入力 → 最適な番号を呼び出し
    // ----------------------------------------------------------------
    const handleCall = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/compute-call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    availableCount: Number(completedCount),
                    apiSecret: process.env.REACT_APP_API_SECRET,
                })
            });

            if (!response.ok) {
                throw new Error(`API呼び出しに失敗しました: ${response.status}`);
            }

            const data = await response.json();
            if (data.called && data.called.length > 0) {
                alert('以下の番号を呼び出しました: ' + data.called.join(', '));
            } else {
                alert('呼び出せる予約がありませんでした。');
            }
        } catch (error) {
            console.error('呼出エラー:', error);
            alert('呼出処理中にエラーが発生しました。コンソールを確認してください。');
        }
    }, [completedCount]);


    // ----------------------------------------------------------------
    // 予約のステータス変更処理
    // ----------------------------------------------------------------
    const handleStatusChange = useCallback(async (id, currentStatus, newStatus) => {

        if (!dbInstance || !userId) return;

        const isConfirmed = window.confirm(`予約番号 ${reservations.find(r => r.id === id)?.number || 'N/A'} のステータスを "${STATUS_MAP[newStatus].label}" に変更しますか？`);
        if (!isConfirmed) return;


        if (newStatus === 'called' && currentStatus === 'waiting') {
            // API経由の呼び出し (LINE通知のため)
            try {
                const response = await fetch(`${API_BASE_URL}/api/reservations/${id}/status/${newStatus}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiSecret: 'YOUR_API_SECRET', userId: userId, reservationId: id })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'APIエラー');
                }
            } catch (e) {
                console.error('Failed to update status via API:', e);
                console.log(`ステータス更新に失敗しました: ${e.message}`);
            }
        } else {
            // Firestore直接操作
            try {
                const collectionPath = 'reservations';
                await updateDoc(doc(dbInstance, collectionPath, id), {
                    status: newStatus,
                    updatedAt: new Date(),
                });
            } catch (e) {
                console.error('Failed to update status directly:', e);
                console.log(`ステータス更新に失敗しました: ${e.message}`);
            }
        }
    }, [dbInstance, userId, reservations, STATUS_MAP]);



    // ----------------------------------------------------------------
    // 予約の削除処理
    // ----------------------------------------------------------------
    const handleDelete = useCallback(async (id) => {
        if (!window.confirm("この予約を完全に削除してもよろしいですか？")) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/reservations/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiSecret: 'YOUR_API_SECRET' })
            });

            if (!response.ok) {
                throw new Error('削除APIエラー');
            }
        } catch (e) {
            console.error('Failed to delete reservation:', e);
            console.log(`削除に失敗しました: ${e.message}`);
        }
    }, []);

    // ----------------------------------------------------------------
    // 予約状況のサマリー計算
    // ----------------------------------------------------------------
    const summary = useMemo(() => {
        const s = {
            total: 0,
            waiting: 0,
            called: 0,
            waitingYakisobaCount: 0, // 待機中の焼きそば注文数の合計
        };

        reservations.forEach(r => {
            s.total++;
            const yakisobaCount = r.quantity ?? r.items?.[ITEM_KEY] ?? 0;
            if (r.status === 'waiting') {
                s.waiting++;
                s.waitingYakisobaCount += yakisobaCount;
            }
            if (r.status === 'called') {
                s.called++;
            }
        });
        return s;
    }, [reservations]);

    // ----------------------------------------------------------------
    // フィルタリングとソート
    // ----------------------------------------------------------------
    const filteredAndSortedReservations = useMemo(() => {
        const TEN_MINUTES_MS = 10 * 60 * 1000;
        const now = new Date();

        const getStatusPriority = (r) => {
            if (r.status === 'called') {
                const calledAtTime = r.calledAt ? new Date(r.calledAt).getTime() : 0;
                return (now.getTime() - calledAtTime) > TEN_MINUTES_MS ? 2 : 1;
            }
            if (r.status === 'waiting') return 3;
            if (r.status === 'completed' || r.status === 'seatEnter') return 4;
            return 5;
        };

        return reservations
            .filter(r => {
                const isCompleted = r.status === 'completed' || r.status === 'seatEnter';
                if (!showCompleted && isCompleted) return false;

                if (searchTerm === '') return true;

                const number = String(r.number || '');
                const name = r.name || '';
                return number.toLowerCase().includes(searchTerm.toLowerCase()) || name.toLowerCase().includes(searchTerm.toLowerCase());
            })
            .sort((a, b) => {
                const priorityA = getStatusPriority(a);
                const priorityB = getStatusPriority(b);
                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return timeA - timeB;
            });
    }, [reservations, searchTerm, showCompleted]);


    // ----------------------------------------------------------------
    // レンダリング
    // ----------------------------------------------------------------
    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#f9fafb' }}>
                <p style={{ fontSize: '20px', color: '#4b5563' }}>管理画面をロード中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div style={styles.errorContainer}>
                <div style={styles.errorBox}>
                    <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#dc2626', marginBottom: '16px' }}>致命的なエラー</h1>
                    <p style={{ color: '#374151' }}>{error}</p>
                    <p style={{ marginTop: '16px', fontSize: '12px', color: '#6b7280' }}>開発者向け情報: 認証ユーザーID = {userId || 'N/A'}</p>
                    <p style={{ fontSize: '12px', color: '#6b7280' }}>App ID = {initialAppId}</p>
                </div>
            </div>
        );
    }


    return (
        <div style={styles.screenContainer}>
            <div style={styles.maxContainer}>
                <h1 style={styles.header}>
                    🍜 {ITEM_NAME} 予約・呼び出し管理ダッシュボード
                </h1>
                <p style={{ fontSize: '14px', color: '#4b5563', marginBottom: '16px' }}>ユーザーID: {userId || '未認証'}</p>

                {/* 自動呼び出し & 販売実績 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                    {/* 自動呼び出しパネル */}
                    <div style={{ ...styles.panel, borderLeft: '4px solid #3b82f6' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1f2937', marginBottom: '16px', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>自動呼び出し</h2>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>完成した{ITEM_NAME}の数：</label>
                            <input
                                type="number"
                                value={completedCount}
                                onChange={(e) => setCompletedCount(e.target.value)}
                                min={0}
                                style={{ display: 'block', width: '100%', borderRadius: '6px', border: '1px solid #d1d5db', padding: '8px' }}
                            />
                        </div>

                        <button
                            onClick={handleCall}
                            style={{ width: '100%', padding: '10px 16px', backgroundColor: '#2563eb', color: 'white', fontWeight: '600', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                        >
                            📢 呼出実行 (API経由)
                        </button>
                    </div>

                    {/* 販売実績パネル */}
                    <div style={{ ...styles.panel, borderLeft: '4px solid #10b981' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1f2937', marginBottom: '16px', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>販売実績 (リアルタイム)</h2>
                        {salesStats === null ? (
                            <p style={{ color: '#6b7280' }}>読み込み中...</p>
                        ) : (
                            <p style={{ color: '#374151' }}>
                                {ITEM_NAME}: <strong style={{ fontSize: '24px', color: '#047857' }}>{salesStats[ITEM_KEY] || 0}</strong> 食
                            </p>
                        )}
                    </div>
                </div>


                {/* 統計サマリーカード */}
                <div style={styles.cardGrid}>
                    <StatCard title="合計予約数" value={summary.total} color="white" />
                    <StatCard title="待機中件数" value={summary.waiting} color="#fde68a" /> {/* yellow-200 */}
                    <StatCard title="呼び出し中件数" value={summary.called} color="#fecaca" /> {/* red-200 */}
                    <StatCard
                        title="待機中の焼きそば数"
                        value={`${summary.waitingYakisobaCount} 食`}
                        color="#e0e7ff" /> {/* indigo-100 */}
                </div>

                {/* 予約リスト */}
                <div style={styles.panel}>
                    <h2 style={styles.listTitle}>予約リスト ({filteredAndSortedReservations.length}件 / 全{reservations.length}件)</h2>

                    {/* 検索・フィルター */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                        <input
                            type="text"
                            placeholder="番号 or 名前で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ flexGrow: 1, minWidth: '200px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: '#374151', fontWeight: '500' }}>
                            <input
                                type="checkbox"
                                checked={showCompleted}
                                onChange={(e) => setShowCompleted(e.target.checked)}
                                style={{ marginRight: '8px', width: '16px', height: '16px' }}
                            />
                            <span>完了/受取済みを表示</span>
                        </label>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {filteredAndSortedReservations.length === 0 ? (
                            <p style={{ color: '#6b7280', textAlign: 'center', padding: '40px 0' }}>該当する予約はありません。</p>
                        ) : (
                            filteredAndSortedReservations.map((r) => {
                                const statusInfo = STATUS_MAP[r.status] || STATUS_MAP.missed;
                                const isWaiting = r.status === 'waiting';
                                const isCalled = r.status === 'called';
                                const isOvertime = isCalled && r.calledAt && (new Date().getTime() - new Date(r.calledAt).getTime()) > (10 * 60 * 1000);

                                const yakisobaCount = r.quantity ?? r.items?.[ITEM_KEY] ?? 0;
                                const totalCost = r.totalCost ?? (yakisobaCount * ITEM_PRICE);

                                return (
                                    <div
                                        key={r.id}
                                        style={{
                                            ...styles.listItem,
                                            backgroundColor: isOvertime ? '#fef2f2' : '#f9fafb', // bg-red-50 vs bg-gray-50
                                            border: `1px solid ${isOvertime ? statusInfo.color : '#d1d5db'}`,
                                        }}
                                    >
                                        {/* 予約情報 */}
                                        <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                                                <span
                                                    style={{
                                                        ...styles.statusTagBase,
                                                        backgroundColor: statusInfo.bgColor,
                                                        color: statusInfo.textColor,
                                                        borderColor: statusInfo.color,
                                                    }}
                                                >
                                                    {statusInfo.label}{isOvertime && ' (10分超過)'}
                                                </span>
                                                <span style={{ fontSize: '18px', fontWeight: '800', color: '#1f2937' }}>
                                                    番号: {r.number}
                                                </span>
                                            </div>
                                            <p style={{ fontSize: '16px', color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <span style={{ fontWeight: '600' }}>{ITEM_NAME}:</span> {yakisobaCount}食 / <span style={{ fontWeight: '600' }}>合計:</span> {totalCost.toLocaleString()}円
                                            </p>
                                            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                                                受付: {r.createdAt ? new Date(r.createdAt).toLocaleTimeString('ja-JP') : 'N/A'}
                                                {r.lineUserId && (
                                                    <span style={{ marginLeft: '12px', color: '#3b82f6', fontWeight: '500' }}> (LINE通知希望)</span>
                                                )}
                                                {r.name && (
                                                    <span style={{ marginLeft: '12px', color: '#6b7280', fontWeight: '500' }}> 氏名: {r.name}</span>
                                                )}
                                            </p>
                                        </div>

                                        {/* アクションボタン */}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                                            {isWaiting && (
                                                <AdminButton
                                                    onClick={() => handleStatusChange(r.id, 'waiting', 'called')}
                                                    color="red"
                                                    label="📢 呼び出し"
                                                />
                                            )}
                                            {isCalled && (
                                                <>
                                                    <AdminButton
                                                        onClick={() => handleStatusChange(r.id, 'called', 'completed')}
                                                        color="green"
                                                        label="✅ 完了/受取"
                                                    />
                                                    <AdminButton
                                                        onClick={() => handleStatusChange(r.id, 'called', 'missed')}
                                                        color="gray"
                                                        label="❌ 不在"
                                                    />
                                                </>
                                            )}
                                            {r.status !== 'waiting' && (
                                                <AdminButton
                                                    onClick={() => handleStatusChange(r.id, r.status, 'waiting')}
                                                    color="blue"
                                                    label="↩️ 待機へ戻す"
                                                />
                                            )}
                                            <AdminButton
                                                onClick={() => handleDelete(r.id)}
                                                color="red-outline"
                                                label="🗑️ 削除"
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}