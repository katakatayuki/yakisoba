/* global __firebase_config, __initial_auth_token */
import React, { useEffect, useState, useMemo } from 'react';

// ====================================================================
// Firebase/API インポート
// ====================================================================
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, where, orderBy, doc } from "firebase/firestore"; // docを追加
import { setLogLevel } from 'firebase/firestore'; // ログレベル設定

// グローバル変数から設定を取得 (no-undefエラー対策済み)
//const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG) : {};


//const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const initialAuthToken = null; // グローバル変数への依存を排除

// 商品定義（焼きそば単品販売のため団体・グループの概念は廃止）
const ITEM_KEY = 'yakisoba';

export default function TVDisplay() {
  // Firebaseの初期化状態とインスタンス
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  
  // 呼び出し中の番号の状態
  const [calledNumbers, setCalledNumbers] = useState([]);
  
  // 待ち状況のサマリーの状態（件数と焼きそば数のみ）
  const [waitingSummary, setWaitingSummary] = useState({ orders: 0, yakisoba: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 1. Firebaseの初期化と認証
  useEffect(() => {
    if (!Object.keys(firebaseConfig).length) {
      setError("Firebase設定が見つかりません。");
      setLoading(false);
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);
      
      // デバッグログを有効にする（任意）
      setLogLevel('debug'); 

      const authenticate = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(authentication, initialAuthToken);
          } else {
            // トークンがない場合は匿名認証で続行（表示専用のため）
            await signInAnonymously(authentication);
          }
          setDb(firestore);
          setAuth(authentication);
          // 認証が完了しても、データ購読が完了するまでloadingをtrueに保つため、ここではfalseにしない
        } catch (e) {
          console.error("Firebase認証エラー:", e);
          setError("認証に失敗しました。");
          setLoading(false);
        }
      };
      
      authenticate();

    } catch (e) {
      console.error("Firebase初期化エラー:", e);
      setError("Firebaseの初期化に失敗しました。");
      setLoading(false);
    }
  }, []);

  // 2. onSnapshotによるリアルタイム購読
  useEffect(() => {
    if (!db) return; // DBインスタンスが準備できていなければ何もしない
    
    // データ購読開始時にloadingを再セット（認証完了時にloadingを解除しなかったため、ここでは不要だが念のため）
    if (!loading) setLoading(true); 

    // TV表示に必要な全ての予約データを取得するクエリ
    // 🚨 注意: Firestoreは複合クエリ（where + orderBy）でインデックスを要求することがありますが、
    // ここではwaiting/calledのデータ量が少ないことを想定し、シンプルに記述します。
    // 実際のエラーが発生した場合は、orderByを削除し、クライアント側でソートします。
    const reservationsQuery = query(
        collection(db, "reservations"),
        where('status', 'in', ['waiting', 'called']),
        orderBy("number", "asc")
    );

    // onSnapshotでリアルタイム購読を開始
    const unsubscribe = onSnapshot(reservationsQuery, (snapshot) => {
      let currentCalled = [];
      let summary = { orders: 0, yakisoba: 0 };

      snapshot.forEach((doc) => {
        const data = doc.data();
        
        // 1. 呼び出し中の番号を収集
        if (data.status === 'called') {
          currentCalled.push({ number: data.number });
        }
        
        // 2. 待ち状況のサマリーを計算（件数と焼きそば数）
        if (data.status === 'waiting') {
          summary.orders += 1;
          summary.yakisoba += (data.quantity ?? data.items?.[ITEM_KEY] ?? 0);
        }
      });

      setCalledNumbers(currentCalled.map(c => c.number));
      setWaitingSummary(summary);
      setLoading(false); // データ取得が完了したらloadingを解除
      
    }, (err) => {
      // リスニング失敗時のエラーハンドリング
      console.error("Firestoreリスニングエラー:", err);
      setError("データ取得に失敗しました。");
      setLoading(false);
    });

    // クリーンアップ関数
    return () => unsubscribe();
  }, [db]); // dbインスタンスがセットされたら実行

  // --------------------------------------------------------------------------------
  // useMemo (フックのルールに従い、常にトップレベルで呼び出されます)
  // --------------------------------------------------------------------------------
  const getStatusMessage = useMemo(() => {
    if (calledNumbers.length > 0) {
      return `現在の呼び出し番号: ${calledNumbers.join(', ')}`;
    }
    if (waitingSummary.orders > 0) {
        // 待っている注文が存在する場合
        return `現在 ${waitingSummary.orders} 件（焼きそば ${waitingSummary.yakisoba} 食）調理中です。`;
    }
    return "受付は終了しました。";
  }, [calledNumbers, waitingSummary]);


  // --------------------------------------------------------------------------------
  // UI (早期リターン)
  // --------------------------------------------------------------------------------
  
  if (loading || !db) return <div style={{ textAlign: 'center', padding: '50px', fontSize: '30px', color: '#666' }}>⚡️ リアルタイムデータを読み込み中...</div>;
  if (error) return <div style={{ textAlign: 'center', padding: '50px', fontSize: '30px', color: 'red' }}>エラー: {error}</div>;


  return (
    <div style={{ 
      padding: '40px', 
      minHeight: '100vh', 
      backgroundColor: '#00264d', // 濃い青の背景
      color: 'white', 
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center'
    }}>
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* 待ち状況エリア */}
      <div style={{
        backgroundColor: '#0055aa',
        width: '90%',
        borderRadius: '15px',
        padding: '20px',
        boxShadow: '0 8px 15px rgba(0, 0, 0, 0.3)',
        marginBottom: '40px'
      }}>
        <h2 style={{ fontSize: '1.8em', marginBottom: '15px', borderBottom: '2px solid #3385ff', paddingBottom: '10px' }}>🍜 焼きそば 待ち状況</h2>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '15px', flexWrap: 'wrap', gap: '15px' }}>
          <div style={{ 
              padding: '10px 30px', 
              backgroundColor: '#007bff',
              borderRadius: '10px',
              minWidth: '200px'
          }}>
            <h4 style={{ fontSize: '1.5em', margin: '0 0 5px 0' }}>調理待ち</h4>
            <p style={{ fontSize: '1.1em', margin: '0' }}>件数: <strong>{waitingSummary.orders}</strong> 件 / 焼きそば: <strong>{waitingSummary.yakisoba}</strong> 食</p>
          </div>
        </div>
      </div>
      
      {/* 呼び出し中の番号リスト */}
      <div style={{ 
        width: '90%',
        backgroundColor: '#fff',
        color: '#333',
        borderRadius: '15px',
        padding: '30px 20px',
        boxShadow: '0 12px 25px rgba(0, 0, 0, 0.5)'
      }}> 
        <h1 style={{ fontSize: '2.5em', color: '#dc3545', margin: '0 0 20px 0' }}>現在呼び出し中の番号</h1>

        {calledNumbers.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '20px' }}>
            {calledNumbers.map((n, index) => (
              <div key={index} style={{
                minWidth: '150px',
                margin: '10px',
                padding: '25px 35px',
                border: '4px solid #dc3545',
                borderRadius: '10px',
                backgroundColor: '#ffe5e5',
                color: '#dc3545',
                fontSize: '3em', // 大きなフォント
                fontWeight: '900',
                animation: 'pulse 1.5s infinite', // アニメーション
                boxShadow: '0 4px 10px rgba(220, 53, 69, 0.5)'
              }}>
                {n}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '1.8em', color: '#555', padding: '50px 0' }}>
            {getStatusMessage}
          </p>
        )}
      </div>

      <p style={{ marginTop: '30px', fontSize: '1.2em', opacity: 0.8 }}>
        お呼び出し後、10分以内にお受け取りください。
      </p>
    </div>
  );
}