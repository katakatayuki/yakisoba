import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, onSnapshot, orderBy, limit } from 'firebase/firestore';

import { db } from './firebase';
import { THEME, MIN_EVALS, homeScore, toMillis, formatDate, clip } from './lib';
import { Avatar } from './ui';

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
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    <main style={{ ...S.layout, ...(narrow ? S.layoutNarrow : null) }}>
      <section style={S.feed}>
        <div style={S.feedHead}>
          <div>
            <div style={S.eyebrow}>HOME</div>
            <h1 style={S.h1}>いま、考えられていること</h1>
          </div>
          <a href="#/new" style={S.composeSmall}>＋ 投稿</a>
        </div>

        <a href="#/new" style={S.startCard}>
          <span style={S.startIcon}>✎</span>
          <span><b>文章を投稿する</b><small>まずは自分の言葉を書き、あとから線を引いて考えます。</small></span>
          <span aria-hidden="true" style={S.arrow}>›</span>
        </a>

        <label style={S.searchWrap}>
          <span aria-hidden="true">⌕</span>
          <input
            style={S.search}
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="投稿・話題・投稿者を探す"
            aria-label="議論を探す"
          />
        </label>

        {total === 0 && (
          <div style={S.empty}>
            <p>{term ? '条件に合う投稿はありません。' : 'まだ投稿がありません。最初の文章を投稿してみましょう。'}</p>
            {!term && <a href="#/new" style={S.cta}>文章を投稿する</a>}
          </div>
        )}

        {bridged.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <div><span style={S.sectionKicker}>BRIDGE</span><h2 style={S.h2}>立場を越えて読まれている投稿</h2></div>
              <span style={S.sectionCount}>{bridged.length}</span>
            </div>
            {bridged.map((p) => <PostRow key={p.id} post={p} bridged />)}
          </section>
        )}

        {recent.length > 0 && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <div><span style={S.sectionKicker}>LATEST</span><h2 style={S.h2}>新しい投稿</h2></div>
              <span style={S.sectionCount}>{recent.length}</span>
            </div>
            {recent.map((p) => <PostRow key={p.id} post={p} />)}
          </section>
        )}
      </section>

      {!narrow && <aside style={S.aside}>
        <div style={S.guide}>
          <div style={S.guideTitle}>なめらかな読み方</div>
          <p>投稿を丸ごと賛成・反対にしません。気になる一文に線を引き、その下に自分の考えを残せます。</p>
          <div style={S.guideSteps}><span>1　読む</span><span>2　線を引く</span><span>3　余白に書く</span></div>
        </div>
      </aside>}
    </main>
  );
}

function PostRow({ post, bridged = false }) {
  return (
    <article style={S.row}>
      <a href={`#/post/${post.id}`} style={S.rowLink}>
        <div style={S.author}><Avatar name={post.authorName || 'ななしさん'} size={42} /><span><b>{post.authorName || 'ななしさん'}</b><small>{formatDate(post.createdAt)}</small></span></div>
        <h3 style={S.rowTitle}>{post.title}</h3>
        <p style={S.rowBody}>{clip(post.body, 130)}</p>
        {bridged && <div style={S.rowBridgeNote}>🌉 異なる考え方の人からも有用と評価されています</div>}
        <footer style={S.rowMeta}>
          <span>⌇ 主張 {post.claimCount || 0}</span>
          <span>◌ 評価 {post.evaluationCount || 0}</span>
          {bridged && <span style={S.badge} title={`評価が${MIN_EVALS}件以上集まったものだけが対象です`}>Bridge {post.bridgeScore}</span>}
          <span style={S.readMore}>読む →</span>
        </footer>
      </a>
    </article>
  );
}

const S = {
  layout: { maxWidth: 1040, margin: '0 auto', padding: '1.75rem 1rem 4rem', display: 'grid', gridTemplateColumns: 'minmax(0, 680px) 280px', gap: '1.5rem', alignItems: 'start' },
  layoutNarrow: { display: 'block', padding: '1.15rem 0.75rem 4rem' },
  feed: { minWidth: 0 },
  feedHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '1rem' },
  eyebrow: { color: '#1f4fd8', fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.12em', marginBottom: 3 },
  h1: { fontFamily: THEME.serif, fontSize: '1.65rem', margin: 0, letterSpacing: '0.02em' },
  composeSmall: { backgroundColor: '#1f4fd8', color: '#fff', textDecoration: 'none', borderRadius: 999, padding: '0.55rem 0.95rem', fontSize: '0.84rem', fontWeight: 700 },
  state: { textAlign: 'center', padding: '4rem 1rem', fontSize: '1.1rem', color: THEME.muted },
  startCard: { display: 'flex', gap: 12, alignItems: 'center', padding: '0.9rem 1rem', backgroundColor: '#fff', border: `1px solid ${THEME.rule}`, borderRadius: 16, boxShadow: '0 2px 8px rgba(16,24,40,0.04)', color: THEME.ink, textDecoration: 'none' },
  startIcon: { width: 34, height: 34, borderRadius: '50%', backgroundColor: '#e8efff', color: '#1f4fd8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  arrow: { marginLeft: 'auto', fontSize: '1.6rem', color: THEME.faint },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.9rem', padding: '0 0.8rem', backgroundColor: '#fff', border: `1px solid ${THEME.rule}`, borderRadius: 999, color: THEME.faint },
  search: { width: '100%', boxSizing: 'border-box', padding: '0.72rem 0', border: 'none', outline: 'none', fontSize: '0.92rem', backgroundColor: 'transparent', fontFamily: 'inherit' },
  section: { marginTop: '2rem' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '0.65rem' },
  sectionKicker: { fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.12em', color: THEME.faint },
  h2: { fontFamily: THEME.serif, fontSize: '1.18rem', margin: '0.15rem 0 0' },
  sectionCount: { color: THEME.faint, fontSize: '0.8rem' },
  row: { backgroundColor: THEME.paper, border: `1px solid ${THEME.rule}`, borderRadius: 16, overflow: 'hidden', marginBottom: '0.75rem', boxShadow: '0 2px 7px rgba(16,24,40,0.035)' },
  rowLink: { display: 'block', padding: '1rem', color: THEME.ink, textDecoration: 'none' },
  author: { display: 'flex', gap: 9, alignItems: 'center', fontSize: '0.85rem' },
  rowTitle: { fontFamily: THEME.serif, fontWeight: 700, fontSize: '1.12rem', lineHeight: 1.5, margin: '0.75rem 0 0.35rem' },
  rowBody: { color: '#475467', fontSize: '0.92rem', lineHeight: 1.75, margin: 0 },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', color: THEME.faint, fontSize: '0.78rem', marginTop: '0.9rem', paddingTop: '0.65rem', borderTop: `1px solid ${THEME.rule}` },
  rowBridgeNote: { display: 'inline-block', color: THEME.bridge, backgroundColor: THEME.bridgeBg, fontSize: '0.78rem', marginTop: '0.75rem', padding: '3px 8px', borderRadius: 999 },
  badge: { padding: '2px 7px', backgroundColor: THEME.bridgeBg, color: THEME.bridge, borderRadius: 999, fontWeight: 700 },
  readMore: { marginLeft: 'auto', color: '#1f4fd8', fontWeight: 700 },
  aside: { position: 'sticky', top: 76 },
  guide: { backgroundColor: '#fff', border: `1px solid ${THEME.rule}`, borderRadius: 16, padding: '1rem', color: THEME.muted, fontSize: '0.86rem', lineHeight: 1.75 },
  guideTitle: { fontFamily: THEME.serif, color: THEME.ink, fontSize: '1rem', fontWeight: 700 },
  guideSteps: { display: 'grid', gap: 5, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${THEME.rule}`, color: THEME.ink, fontWeight: 600, fontSize: '0.8rem' },
  empty: { textAlign: 'center', padding: '3rem 1rem', color: THEME.muted },
  cta: { display: 'inline-block', padding: '0.7rem 1.5rem', backgroundColor: '#1f4fd8', color: '#fff', borderRadius: 999, textDecoration: 'none', fontWeight: 700 },
};
