import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, onSnapshot, orderBy, limit } from 'firebase/firestore';

import { db } from './firebase';
import { THEME, MIN_EVALS, homeScore, toMillis, formatDate, clip } from './lib';

// ====================================================================
// ホーム画面 (旧 TVDisplay.js: onSnapshot で全体を購読して表示する画面)
//
// 目的は人気投稿を並べることではなく、「議論する価値のある主張」を見つけること。
// 並び順は BridgeScore × 最近の動き × 信頼度 (企画書 §35)。いいね数は使わない。
// ====================================================================

const BRIDGED_LIMIT = 10;

export default function Home() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [term, setTerm] = useState('');

  // リアルタイム購読。orderBy は単一フィールドなので複合インデックスは不要。
  useEffect(() => {
    const postsQuery = query(
      collection(db, 'posts'),
      orderBy('lastActivityAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      postsQuery,
      (snapshot) => {
        setPosts(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('投稿の購読エラー:', err);
        setError('投稿の取得に失敗しました。');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const { bridged, recent, total } = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const filtered = posts
      .filter((p) => p.visibility === 'public')
      .filter(
        (p) =>
          !needle ||
          [p.title, p.body, p.authorName].some((v) => String(v || '').toLowerCase().includes(needle))
      );

    const now = Date.now();
    const bridgedList = filtered
      .filter((p) => (p.bridgeScore || 0) > 0)
      .sort((a, b) => homeScore(b, now) - homeScore(a, now))
      .slice(0, BRIDGED_LIMIT);

    const shown = new Set(bridgedList.map((p) => p.id));
    const recentList = filtered
      .filter((p) => !shown.has(p.id))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    return { bridged: bridgedList, recent: recentList, total: filtered.length };
  }, [posts, term]);

  if (loading) return <div style={S.state}>読み込み中…</div>;
  if (error) return <div style={{ ...S.state, color: '#b42318' }}>{error}</div>;

  return (
    <main style={S.main}>
      <input
        style={S.search}
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="議論を探す（タイトル・本文・投稿者）"
        aria-label="議論を探す"
      />

      {total === 0 && (
        <div style={S.empty}>
          <p style={{ margin: '0 0 0.75rem' }}>
            {term ? '条件に合う投稿はありません。' : 'まだ投稿がありません。最初の文章を投稿してみましょう。'}
          </p>
          {!term && <a href="#/new" style={S.cta}>投稿する</a>}
        </div>
      )}

      {bridged.length > 0 && (
        <section style={S.section}>
          <h2 style={S.h2}>🌉 橋渡しされた意見</h2>
          <p style={S.note}>
            異なる反応をした人たちの間でも「参考になる」と評価された注釈や出典を含む議論です。
          </p>
          {bridged.map((p) => (
            <PostRow key={p.id} post={p} bridged />
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section style={S.section}>
          <h2 style={S.h2}>新しい投稿</h2>
          {recent.map((p) => (
            <PostRow key={p.id} post={p} />
          ))}
        </section>
      )}
    </main>
  );
}

function PostRow({ post, bridged = false }) {
  return (
    <a href={`#/post/${post.id}`} style={S.row}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.rowTitle}>{post.title}</div>
        <div style={S.rowBody}>{clip(post.body, 90)}</div>
        <div style={S.rowMeta}>
          {post.authorName || 'ななしさん'}　{formatDate(post.createdAt)}　主張 {post.claimCount || 0} 件
        </div>
        {bridged && (
          <div style={S.rowBridgeNote}>複数の考え方から有用と評価されています（評価 {post.evaluationCount || 0} 件）</div>
        )}
      </div>
      {bridged && (
        <div style={S.badge} title={`評価が${MIN_EVALS}件以上集まったものだけが対象です`}>
          <div style={{ fontSize: '0.7rem' }}>Bridge</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1 }}>{post.bridgeScore}</div>
        </div>
      )}
    </a>
  );
}

const S = {
  main: { maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem 4rem' },
  state: { textAlign: 'center', padding: '4rem 1rem', fontSize: '1.1rem', color: THEME.muted },
  search: { width: '100%', boxSizing: 'border-box', padding: '0.8rem 1rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, fontSize: '1rem', backgroundColor: THEME.paper },
  section: { marginTop: '2rem' },
  h2: { fontFamily: THEME.serif, fontSize: '1.2rem', margin: '0 0 0.4rem' },
  note: { color: THEME.muted, fontSize: '0.9rem', lineHeight: 1.7, margin: '0 0 0.9rem' },
  row: { display: 'flex', gap: '1rem', alignItems: 'flex-start', padding: '1rem 1.1rem', marginBottom: 2, backgroundColor: THEME.paper, color: THEME.ink, textDecoration: 'none', borderLeft: `4px solid ${THEME.rule}` },
  rowTitle: { fontFamily: THEME.serif, fontWeight: 700, fontSize: '1.08rem', marginBottom: 4 },
  rowBody: { color: '#475467', fontSize: '0.92rem', lineHeight: 1.7 },
  rowMeta: { color: THEME.faint, fontSize: '0.8rem', marginTop: 6 },
  rowBridgeNote: { color: THEME.bridge, fontSize: '0.82rem', marginTop: 6 },
  badge: { flexShrink: 0, textAlign: 'center', padding: '0.4rem 0.7rem', backgroundColor: THEME.bridgeBg, color: THEME.bridge, borderRadius: 4 },
  empty: { textAlign: 'center', padding: '3rem 1rem', color: THEME.muted },
  cta: { display: 'inline-block', padding: '0.7rem 1.5rem', backgroundColor: '#1f4fd8', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 700 },
};
