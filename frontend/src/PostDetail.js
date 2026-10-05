import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db, api } from './firebase';
import {
  THEME, PEN, PEN_KEYS,
  buildPieces, selectionToRange, pointToIndex, snapToPunctuation,
  nextSentenceEnd, prevSentenceEnd, computePatterns,
  formatDate, clip,
} from './lib';
import ClaimCard from './ClaimCard';

// ====================================================================
// 投稿詳細画面
// 読む → 線を引く → 考える → 書く → 他人の線を見る
// ====================================================================

function useIsNarrow(breakpoint = 960) {
  const [narrow, setNarrow] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return narrow;
}

const claimLabel = (index) => (index < 26 ? String.fromCharCode(65 + index) : String(index + 1));
const claimLength = (c) => c.endIndex - c.startIndex;

// ====================================================================
// メインコンポーネント
// ====================================================================

export default function PostDetail({ postId, user, isFirst }) {
  // ---- Firestore の購読結果 ----
  const [post, setPost] = useState(null);
  const [claims, setClaims] = useState([]);
  const [markings, setMarkings] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [sources, setSources] = useState([]);
  const [notes, setNotes] = useState([]);
  const [notesReady, setNotesReady] = useState(false);
  const [myReactions, setMyReactions] = useState({}); // claimId -> reaction
  const [myEvals, setMyEvals] = useState({}); // `${targetType}_${targetId}` -> type
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---- 画面状態 ----
  const [selectedId, setSelectedId] = useState(null);
  const [mobileMode, setMobileMode] = useState(
    () => (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false)
  );
  const [cursor, setCursor] = useState(null); // ┃ カーソルの位置
  const [markStart, setMarkStart] = useState(null); // 「マーク開始」を押した位置
  const [pending, setPending] = useState(null); // 範囲が確定し、色を選ぶ待ち
  const [showSeg, setShowSeg] = useState(false);
  const [adoptColor, setAdoptColor] = useState('blue');
  const [showFirst, setShowFirst] = useState(!!isFirst);
  const [notice, setNotice] = useState(null);

  const narrow = useIsNarrow();
  const bodyRef = useRef(null);
  const cursorElRef = useRef(null);
  const cursorXRef = useRef(null);
  const cursorFromButton = useRef(false);
  const suppressScrollUntil = useRef(0);
  const rafRef = useRef(0);
  const noticeTimer = useRef(null);

  const bodyText = post ? post.body : '';
  const hasPost = !!post;

  // ----------------------------------------------------------------
  // Firestore 購読
  // ----------------------------------------------------------------
  useEffect(() => {
    setLoading(true);
    setError(null);

    const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byPost = (name) => query(collection(db, name), where('postId', '==', postId));
    const mine = (name) =>
      query(collection(db, name), where('postId', '==', postId), where('userId', '==', user.uid));
    const fail = (label) => (err) => {
      console.error(`${label}の購読エラー:`, err);
      setError(`${label}の取得に失敗しました。`);
      setLoading(false);
    };

    const unsubs = [
      onSnapshot(doc(db, 'posts', postId), (snap) => {
        if (snap.exists()) setPost({ id: snap.id, ...snap.data() });
        else setError('投稿が見つかりません。');
        setLoading(false);
      }, fail('投稿')),
      onSnapshot(byPost('claims'), (s) => setClaims(toList(s)), fail('主張')),
      onSnapshot(byPost('markings'), (s) => setMarkings(toList(s)), fail('線')),
      onSnapshot(byPost('annotations'), (s) => setAnnotations(toList(s)), fail('注釈')),
      onSnapshot(byPost('sources'), (s) => setSources(toList(s)), fail('出典')),
      onSnapshot(mine('reactions'), (s) => {
        setMyReactions(Object.fromEntries(toList(s).map((r) => [r.claimId, r])));
      }, fail('評価')),
      onSnapshot(mine('evaluations'), (s) => {
        setMyEvals(Object.fromEntries(toList(s).map((e) => [`${e.targetType}_${e.targetId}`, e.type])));
      }, fail('有用性評価')),
      onSnapshot(mine('notes'), (s) => {
        setNotes(toList(s));
        setNotesReady(true);
      }, (err) => {
        console.error('メモの購読エラー:', err);
        setNotesReady(true);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [postId, user.uid]);

  // ----------------------------------------------------------------
  // 派生データ
  // ----------------------------------------------------------------
  const visibleClaims = useMemo(
    () => claims
      .filter((c) => (c.usageCount || 0) > 0 || (c.reactionTotal || 0) > 0
        || (c.annotationCount || 0) > 0 || (c.sourceCount || 0) > 0)
      .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex),
    [claims]
  );

  const labels = useMemo(
    () => Object.fromEntries(visibleClaims.map((c, i) => [c.id, claimLabel(i)])),
    [visibleClaims]
  );

  const myColors = useMemo(
    () => Object.fromEntries(markings.filter((m) => m.userId === user.uid).map((m) => [m.claimId, m.color])),
    [markings, user.uid]
  );

  const patterns = useMemo(() => computePatterns(visibleClaims, markings), [visibleClaims, markings]);

  const highlight = useMemo(() => {
    if (markStart !== null && cursor !== null) {
      return { start: Math.min(markStart, cursor), end: Math.max(markStart, cursor), live: true };
    }
    return pending ? { ...pending, live: false } : null;
  }, [markStart, cursor, pending]);

  // 選択された主張へスクロール
  useEffect(() => {
    if (selectedId) {
      const el = document.getElementById(`claim-${selectedId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedId]);

  // ----------------------------------------------------------------
  // 通知と API 呼び出し
  // ----------------------------------------------------------------
  const flash = useCallback((type, text) => {
    setNotice({ type, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const act = useCallback(async (fn, okText) => {
    try {
      const result = await fn();
      if (okText) flash('ok', okText);
      return result === undefined ? {} : result;
    } catch (err) {
      flash('error', err.message || '処理に失敗しました。');
      return null;
    }
  }, [flash]);

  // ----------------------------------------------------------------
  // マーク操作 (PC: ドラッグ選択 / スマホ: ┃ カーソル)
  // ----------------------------------------------------------------
  const handleMouseUp = () => {
    if (mobileMode) return;
    setTimeout(() => {
      const range = selectionToRange(bodyRef.current);
      if (range && range.end > range.start) {
        setPending({ start: range.start, end: range.end });
        window.getSelection().removeAllRanges();
      }
    }, 0);
  };

  const syncCursorFromViewport = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = window.innerHeight * 0.45;
    const x = Math.min(
      Math.max(cursorXRef.current !== null ? cursorXRef.current : rect.left + rect.width / 2, rect.left + 6),
      rect.right - 6
    );
    const index = pointToIndex(el, x, y);
    if (index !== null) setCursor(snapToPunctuation(bodyText, index));
  }, [bodyText]);

  useEffect(() => {
    if (!mobileMode || !hasPost) {
      setCursor(null);
      setMarkStart(null);
      return undefined;
    }

    syncCursorFromViewport();

    const onScroll = () => {
      if (pending || Date.now() < suppressScrollUntil.current || rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        syncCursorFromViewport();
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [mobileMode, hasPost, pending, syncCursorFromViewport]);

  useEffect(() => {
    if (cursorFromButton.current && cursorElRef.current) {
      cursorXRef.current = cursorElRef.current.getBoundingClientRect().left;
      cursorFromButton.current = false;
    }
  }, [cursor]);

  const moveCursor = (index, scrollIntoView = false) => {
    const next = Math.max(0, Math.min(bodyText.length, index));
    cursorFromButton.current = true;
    setCursor(next);
    if (scrollIntoView) {
      suppressScrollUntil.current = Date.now() + 600;
      setTimeout(() => {
        if (cursorElRef.current) cursorElRef.current.scrollIntoView({ block: 'center' });
      }, 30);
    }
  };

  const startMark = () => {
    if (cursor === null) return;
    setMarkStart(cursor);
  };

  const finishMark = () => {
    if (markStart === null || cursor === null) return;
    const start = Math.min(markStart, cursor);
    const end = Math.max(markStart, cursor);
    if (end <= start) {
      flash('error', '範囲が空です。カーソルを動かしてから「マーク終了」を押してください。');
      return;
    }
    setPending({ start, end });
    setMarkStart(null);
  };

  const cancelMark = () => {
    setPending(null);
    setMarkStart(null);
  };

  const registerMark = async (color) => {
    if (!highlight || highlight.end <= highlight.start) return;
    const result = await act(
      () => api('/api/claims', {
        method: 'POST',
        body: { postId, startIndex: highlight.start, endIndex: highlight.end, color },
      }),
      '主張として登録しました。'
    );
    if (result) {
      setSelectedId(result.claimId);
      cancelMark();
    }
  };

  const adoptSegmentation = async (claimIds) => {
    const result = await act(
      () => api('/api/segmentations/adopt', {
        method: 'POST',
        body: { postId, claimIds, color: adoptColor },
      }),
      'この分け方を使いました。'
    );
    if (result) setShowSeg(false);
  };

  // ----------------------------------------------------------------
  // レンダリング
  // ----------------------------------------------------------------
  if (loading) return <div style={S.state}>読み込み中…</div>;
  if (error) return <div style={{ ...S.state, color: '#b42318' }}>{error}</div>;
  if (!post) return null;

  const barVisible = !!pending || mobileMode;

  const claimListEl = (
    <ClaimList
      claims={visibleClaims}
      labels={labels}
      myColors={myColors}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );

  const panelEl = visibleClaims.length > 0 ? (
    visibleClaims.map((c) => (
      <ClaimCard
        key={c.id}
        claim={c}
        label={labels[c.id]}
        expanded={selectedId === c.id}
        onToggle={() => setSelectedId((cur) => (cur === c.id ? null : c.id))}
        user={user}
        myColor={myColors[c.id] || null}
        myReaction={myReactions[c.id] || null}
        myEvals={myEvals}
        annotations={annotations.filter((a) => a.claimId === c.id)}
        sources={sources.filter((s) => s.claimId === c.id)}
        notes={notes.filter((n) => n.claimId === c.id)}
        notesReady={notesReady}
        act={act}
      />
    ))
  ) : (
    <div style={S.panelEmpty}>
      文章の気になる箇所に線を引くと、ここに主張が並び、評価やコメントを書けるようになります。
    </div>
  );

  return (
    <div style={{ ...S.page, paddingBottom: barVisible ? 170 : 48 }}>
      <style>{'@keyframes nsCursor{50%{opacity:.2}}'}</style>

      {notice && (
        <div role="status" style={{ ...S.notice, ...(notice.type === 'error' ? S.noticeError : S.noticeOk) }}>
          {notice.text}
        </div>
      )}

      {mobileMode && <div aria-hidden="true" style={S.readingLine} />}

      <div style={narrow ? S.layoutNarrow : S.layoutWide}>
        {!narrow && (
          <aside style={S.left}>
            <h2 style={S.paneTitle}>主張一覧</h2>
            {claimListEl}
          </aside>
        )}

        <article style={S.sheet}>
          <h1 style={S.title}>{post.title}</h1>
          <div style={S.meta}>
            {post.authorName || 'ななしさん'} {formatDate(post.createdAt)}
          </div>

          {showFirst && (
            <div style={S.firstBanner}>
              投稿しました。次は、重要だと思う箇所に線を引いてみましょう。
              <button type="button" style={S.bannerClose} onClick={() => setShowFirst(false)}>閉じる</button>
            </div>
          )}

          <div style={S.modeRow}>
            <span style={S.hint}>
              {mobileMode
                ? '画面中央の線にカーソル(┃)が合います。スクロールで動かし、「マーク開始」「マーク終了」で範囲を決めます。'
                : '文章をドラッグして選ぶと、主張として登録できます。'}
            </span>
            <button
              type="button"
              style={S.modeButton}
              onClick={() => { cancelMark(); setMobileMode((m) => !m); }}
            >
              {mobileMode ? 'ドラッグ選択にする' : '┃ カーソルで選ぶ'}
            </button>
          </div>

          {patterns.total > 0 && (
            <div style={S.segHint}>
              この文章には {patterns.total} 人が線を引いています。
              <button type="button" style={S.linkButton} onClick={() => setShowSeg((v) => !v)}>
                {showSeg ? 'みんなの分割を閉じる' : 'みんなの分割を見る'}
              </button>
            </div>
          )}

          {showSeg && (
            <SegmentationPanel
              patterns={patterns}
              claims={visibleClaims}
              labels={labels}
              myColors={myColors}
              adoptColor={adoptColor}
              onColor={setAdoptColor}
              onAdopt={adoptSegmentation}
              onClose={() => setShowSeg(false)}
            />
          )}

          <BodyView
            text={bodyText}
            claims={visibleClaims}
            myColors={myColors}
            selectedId={selectedId}
            highlight={highlight}
            cursor={cursor}
            markStart={markStart}
            bodyRef={bodyRef}
            cursorRef={cursorElRef}
            onMouseUp={handleMouseUp}
            onSelectClaim={setSelectedId}
          />
        </article>

        {narrow && <div style={S.stackBlock}>{claimListEl}</div>}

        <section style={narrow ? S.stackBlock : S.right}>{panelEl}</section>
      </div>

      <MarkBar
        mobileMode={mobileMode}
        pending={pending}
        highlight={highlight}
        markStart={markStart}
        text={bodyText}
        onColor={registerMark}
        onCancel={cancelMark}
        onMove={moveCursor}
        cursor={cursor}
        onStart={startMark}
        onFinish={finishMark}
      />
    </div>
  );
}

// ====================================================================
// 本文描画コンポーネント
// ====================================================================

function BodyView({
  text, claims, myColors, selectedId, highlight, cursor, markStart,
  bodyRef, cursorRef, onMouseUp, onSelectClaim,
}) {
  const claimsById = useMemo(() => new Map(claims.map((c) => [c.id, c])), [claims]);
  const pieces = useMemo(
    () => buildPieces(text, claims, [highlight && highlight.start, highlight && highlight.end, cursor, markStart]),
    [text, claims, highlight, cursor, markStart]
  );

  const handlePick = (covering) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (covering.length === 0) return;

    const sorted = [...covering].sort((a, b) => claimLength(a) - claimLength(b));
    const at = sorted.findIndex((c) => c.id === selectedId);
    onSelectClaim(sorted[(at + 1) % sorted.length].id);
  };

  const cursorEl = <span ref={cursorRef} style={S.cursor} />;

  return (
    <div ref={bodyRef} onMouseUp={onMouseUp} style={S.body}>
      {pieces.map((p) => {
        const covering = p.claimIds.map((id) => claimsById.get(id)).filter(Boolean);
        const mine = covering
          .filter((c) => myColors[c.id])
          .sort((a, b) => claimLength(a) - claimLength(b));

        const style = {};
        if (mine.length > 0) {
          style.backgroundColor = PEN[myColors[mine[0].id]].tint;
        } else if (covering.length > 0) {
          style.textDecoration = 'underline dotted';
          style.textDecorationColor = THEME.faint;
          style.textUnderlineOffset = '5px';
        }
        if (selectedId && p.claimIds.includes(selectedId)) {
          style.textDecoration = 'underline solid';
          style.textDecorationColor = mine.length > 0 ? PEN[myColors[mine[0].id]].ink : THEME.ink;
          style.textDecorationThickness = '3px';
          style.textUnderlineOffset = '5px';
        }
        if (highlight && p.start >= highlight.start && p.end <= highlight.end) {
          style.backgroundColor = '#ffe39a';
        }
        if (covering.length > 0) style.cursor = 'pointer';

        return (
          <React.Fragment key={p.start}>
            {markStart === p.start && <span style={S.startFlag} />}
            {cursor === p.start && cursorEl}
            <span style={style} onClick={() => handlePick(covering)}>{p.text}</span>
          </React.Fragment>
        );
      })}
      {cursor === text.length && cursor !== null && cursorEl}
    </div>
  );
}

// ====================================================================
// 下部ツールバー
// ====================================================================

function MarkBar({ mobileMode, pending, highlight, markStart, text, cursor, onColor, onCancel, onMove, onStart, onFinish }) {
  if (!pending && !mobileMode) return null;

  const snippet = highlight && highlight.end > highlight.start
    ? clip(text.slice(highlight.start, highlight.end), 40)
    : '';

  if (pending) {
    return (
      <div style={S.bar}>
        <div style={S.barText}>「{snippet}」を主張として登録</div>
        <div style={S.barRow}>
          {PEN_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onColor(key)}
              style={{ ...S.penButton, borderColor: PEN[key].ink, color: PEN[key].ink, backgroundColor: PEN[key].tint }}
            >
              {PEN[key].label}
            </button>
          ))}
          <button type="button" style={S.ghostButton} onClick={onCancel}>やめる</button>
        </div>
      </div>
    );
  }

  const atText = cursor === null ? '' : cursor;
  return (
    <div style={S.bar}>
      <div style={S.barText}>
        {markStart !== null
          ? (snippet ? `選択中: 「${snippet}」` : 'カーソルを動かして終わりの位置に合わせます')
          : 'カーソルを動かして、始まりの位置に合わせます'}
      </div>
      <div style={S.barRow}>
        <button type="button" style={S.moveButton} onClick={() => onMove(prevSentenceEnd(text, atText), true)}>文頭へ</button>
        <button type="button" style={S.moveButton} onClick={() => onMove(atText - 1)} aria-label="1文字戻る">◀</button>
        <button type="button" style={S.moveButton} onClick={() => onMove(atText + 1)} aria-label="1文字進む">▶</button>
        <button type="button" style={S.moveButton} onClick={() => onMove(nextSentenceEnd(text, atText), true)}>文末へ</button>
      </div>
      <div style={S.barRow}>
        {markStart === null ? (
          <button type="button" style={S.primaryButton} onClick={onStart}>マーク開始</button>
        ) : (
          <>
            <button type="button" style={S.primaryButton} onClick={onFinish}>マーク終了</button>
            <button type="button" style={S.ghostButton} onClick={onCancel}>やめる</button>
          </>
        )}
      </div>
    </div>
  );
}

// ====================================================================
// 左ペイン: 主張一覧
// ====================================================================

function ClaimList({ claims, labels, myColors, selectedId, onSelect }) {
  if (claims.length === 0) {
    return <div style={S.faint}>まだ主張がありません。</div>;
  }
  return (
    <ul style={S.claimList}>
      {claims.map((c) => {
        const color = myColors[c.id];
        const active = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              style={{ ...S.claimItem, ...(active ? S.claimItemActive : null) }}
            >
              <span
                style={{
                  ...S.claimLabel,
                  backgroundColor: color ? PEN[color].tint : 'transparent',
                  borderColor: color ? PEN[color].ink : THEME.rule,
                  color: color ? PEN[color].ink : THEME.muted,
                }}
              >
                {labels[c.id]}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={S.claimText}>{clip(c.text, 36)}</span>
                <span style={S.claimSub}>
                  線 {Math.max(0, c.usageCount || 0)} 評価 {c.reactionTotal || 0} コメント {c.annotationCount || 0}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ====================================================================
// みんなの分割
// ====================================================================

function SegmentationPanel({ patterns, claims, labels, myColors, adoptColor, onColor, onAdopt, onClose }) {
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const mineKey = Object.keys(myColors).filter((id) => claimsById.has(id))
    .sort((a, b) => claimsById.get(a).startIndex - claimsById.get(b).startIndex
      || claimsById.get(a).endIndex - claimsById.get(b).endIndex || a.localeCompare(b))
    .join('|');

  const top = patterns.list.slice(0, 3);
  const restRatio = patterns.list.slice(3).reduce((a, g) => a + g.ratio, 0);

  return (
    <div style={S.seg}>
      <div style={S.segHead}>
        <strong>この文章をどう分けた人が多い？</strong>
        <button type="button" style={S.linkButton} onClick={onClose}>閉じる</button>
      </div>
      <p style={S.segNote}>どの分け方が正しい、ということはありません。読み方の違いとして並べています。</p>

      {top.map((g) => (
        <div key={g.key} style={S.segRow}>
          <div style={S.segRatio}>{Math.round(g.ratio * 100)}%</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.segChips}>
              {g.claimIds.map((id) => (
                <span key={id} style={S.segChip}>
                  <b>{labels[id]}</b> {clip(claimsById.get(id).text, 18)}
                </span>
              ))}
            </div>
            {g.key === mineKey ? (
              <span style={S.faint}>あなたの分け方です</span>
            ) : (
              <button type="button" style={S.adoptButton} onClick={() => onAdopt(g.claimIds)}>
                この分け方を使う
              </button>
            )}
          </div>
        </div>
      ))}

      {restRatio > 0 && (
        <div style={S.segRow}>
          <div style={S.segRatio}>{Math.round(restRatio * 100)}%</div>
          <div style={S.faint}>その他の分け方</div>
        </div>
      )}

      <div style={S.segColors}>
        <span style={S.faint}>採用するときの色:</span>
        {PEN_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onColor(key)}
            style={{
              ...S.colorChip,
              borderColor: PEN[key].ink,
              backgroundColor: adoptColor === key ? PEN[key].tint : 'transparent',
              color: PEN[key].ink,
              fontWeight: adoptColor === key ? 700 : 400,
            }}
          >
            {PEN[key].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ====================================================================
// スタイル定義
// ====================================================================

const S = {
  page: { maxWidth: 1360, margin: '0 auto', padding: '1.25rem 1rem' },
  state: { textAlign: 'center', padding: '4rem 1rem', fontSize: '1.1rem', color: THEME.muted },
  layoutWide: { display: 'grid', gridTemplateColumns: '230px minmax(0, 1fr) 390px', gap: '1.25rem', alignItems: 'start' },
  layoutNarrow: { display: 'block' },
  left: { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' },
  right: { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', paddingRight: 4 },
  stackBlock: { marginTop: '1.25rem' },

  paneTitle: { fontSize: '0.95rem', margin: '0 0 0.6rem', color: THEME.muted, fontWeight: 600 },
  sheet: { backgroundColor: THEME.paper, padding: '2rem 2.25rem', borderRadius: 4, boxShadow: '0 1px 0 #cfd3db, 0 8px 24px rgba(28,32,48,0.06)', minWidth: 0 },
  title: { fontFamily: THEME.serif, fontSize: '1.6rem', lineHeight: 1.4, margin: '0 0 0.4rem' },
  meta: { color: THEME.faint, fontSize: '0.85rem', marginBottom: '1rem' },
  body: { fontFamily: THEME.serif, fontSize: '1.08rem', lineHeight: 2.1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '40em', WebkitTouchCallout: 'none' },

  firstBanner: { backgroundColor: '#e8efff', color: '#1a3fa6', padding: '0.7rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.92rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' },
  bannerClose: { border: 'none', background: 'none', color: '#1a3fa6', cursor: 'pointer', fontSize: '0.85rem', flexShrink: 0 },
  modeRow: { display: 'flex', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', padding: '0.6rem 0', margin: '0 0 1rem', borderTop: `1px solid ${THEME.rule}`, borderBottom: `1px solid ${THEME.rule}` },
  hint: { color: THEME.muted, fontSize: '0.85rem', lineHeight: 1.6, flex: 1, minWidth: 220 },
  modeButton: { border: `1px solid ${THEME.rule}`, background: THEME.paper, borderRadius: 6, padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' },
  segHint: { fontSize: '0.88rem', color: THEME.muted, marginBottom: '1rem' },
  linkButton: { border: 'none', background: 'none', color: '#1f4fd8', cursor: 'pointer', fontSize: '0.88rem', padding: '0 0 0 0.5rem' },

  cursor: { display: 'inline-block', width: 0, height: '1.25em', borderLeft: `3px solid ${THEME.ink}`, verticalAlign: 'text-bottom', animation: 'nsCursor 1.1s ease-in-out infinite' },
  startFlag: { display: 'inline-block', width: 0, height: '1.25em', borderLeft: '3px solid #1f4fd8', verticalAlign: 'text-bottom' },
  readingLine: { position: 'fixed', left: 0, right: 0, top: '45vh', height: 0, borderTop: '1px dashed rgba(28,32,48,0.2)', pointerEvents: 'none', zIndex: 5 },

  notice: { position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 100, padding: '0.7rem 1.2rem', borderRadius: 6, fontSize: '0.92rem', maxWidth: '90vw', boxShadow: '0 6px 20px rgba(0,0,0,0.15)' },
  noticeOk: { backgroundColor: '#e3f6ea', color: '#14532d' },
  noticeError: { backgroundColor: '#ffe3e0', color: '#8a1c14' },

  bar: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: THEME.paper, borderTop: `1px solid ${THEME.rule}`, padding: '0.6rem 1rem calc(0.6rem + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -4px 16px rgba(28,32,48,0.08)' },
  barText: { fontSize: '0.88rem', color: THEME.muted, marginBottom: '0.5rem', textAlign: 'center' },
  barRow: { display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.4rem' },
  penButton: { minHeight: 44, padding: '0 1rem', border: '2px solid', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700 },
  moveButton: { minHeight: 44, minWidth: 64, border: `1px solid ${THEME.rule}`, background: THEME.paper, borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem' },
  primaryButton: { minHeight: 48, minWidth: 160, border: 'none', borderRadius: 6, backgroundColor: '#1f4fd8', color: '#fff', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' },
  ghostButton: { minHeight: 44, padding: '0 1rem', border: `1px solid ${THEME.rule}`, background: 'transparent', borderRadius: 6, cursor: 'pointer', color: THEME.muted },

  claimList: { listStyle: 'none', margin: 0, padding: 0 },
  claimItem: { display: 'flex', gap: '0.6rem', width: '100%', textAlign: 'left', padding: '0.6rem 0.7rem', border: 'none', borderLeft: '3px solid transparent', background: 'transparent', cursor: 'pointer', color: THEME.ink, fontFamily: 'inherit' },
  claimItemActive: { backgroundColor: THEME.paper, borderLeftColor: THEME.ink },
  claimLabel: { flexShrink: 0, width: 24, height: 24, border: '1.5px solid', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700 },
  claimText: { display: 'block', fontSize: '0.88rem', lineHeight: 1.5 },
  claimSub: { display: 'block', fontSize: '0.72rem', color: THEME.faint, marginTop: 2 },

  seg: { backgroundColor: '#f6f7fa', border: `1px solid ${THEME.rule}`, padding: '1rem', borderRadius: 4, marginBottom: '1.25rem' },
  segHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  segNote: { color: THEME.muted, fontSize: '0.82rem', margin: '0.3rem 0 0.8rem' },
  segRow: { display: 'flex', gap: '0.8rem', padding: '0.5rem 0', borderTop: `1px solid ${THEME.rule}` },
  segRatio: { width: 48, flexShrink: 0, fontWeight: 700, fontSize: '1.05rem' },
  segChips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  segChip: { backgroundColor: THEME.paper, border: `1px solid ${THEME.rule}`, borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem' },
  adoptButton: { border: '1px solid #1f4fd8', color: '#1f4fd8', background: THEME.paper, borderRadius: 6, padding: '0.3rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' },
  segColors: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: `1px solid ${THEME.rule}` },
  colorChip: { border: '1.5px solid', borderRadius: 14, padding: '2px 10px', cursor: 'pointer', fontSize: '0.8rem' },

  panelEmpty: { color: THEME.muted, fontSize: '0.92rem', lineHeight: 1.8, padding: '1rem 0.5rem' },
  faint: { color: THEME.faint, fontSize: '0.8rem', lineHeight: 1.6 },
};