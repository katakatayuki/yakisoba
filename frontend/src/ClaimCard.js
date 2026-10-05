import React, { useEffect, useState } from 'react';

import { api } from './firebase';
import { THEME, PEN, PEN_KEYS, SCORES, signed, toMillis } from './lib';
import { U, MiniBar, EvalButtons, SCORE_COLOR, ACCENT } from './ui';
import Marginalia, { PrivateNotesTab } from './Marginalia';

// ====================================================================
// 主張カード
//   折りたたみ時: 主張の文 + 評価の分布 + 件数
//   開いたとき  : 線の色 / タブ(評価・余白・出典・つながり・🔒メモ)
// ====================================================================

const C = {
  card: { ...U.card, marginBottom: 12, overflow: 'hidden', scrollMarginTop: 64 },
  cardOpen: { borderColor: THEME.ink },
  head: {
    display: 'flex',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    padding: '14px 16px 8px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: THEME.ink,
  },
  label: {
    flexShrink: 0,
    width: 26,
    height: 26,
    border: '1.5px solid',
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.82rem',
    fontWeight: 700,
  },
  quote: { fontFamily: THEME.serif, fontSize: '1.02rem', lineHeight: 1.9, flex: 1, minWidth: 0, wordBreak: 'break-word' },
  quoteClamp: { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  meta: { padding: '0 16px 14px 52px' },
  stats: { ...U.faint, marginTop: 6 },
  body: { padding: '0 16px 16px', borderTop: `1px solid ${THEME.rule}` },
  penRow: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0' },
  penChip: { border: '1.5px solid', borderRadius: 999, padding: '2px 12px', cursor: 'pointer', fontSize: '0.8rem', background: 'transparent', fontFamily: 'inherit' },
  tabs: { display: 'flex', gap: 2, overflowX: 'auto', borderBottom: `1px solid ${THEME.rule}`, marginBottom: 14 },
  tab: { border: 'none', background: 'transparent', padding: '8px 12px', cursor: 'pointer', fontSize: '0.88rem', color: THEME.muted, borderBottom: '2px solid transparent', whiteSpace: 'nowrap', fontFamily: 'inherit' },
  tabActive: { color: THEME.ink, fontWeight: 700, borderBottomColor: THEME.ink },
  count: { marginLeft: 4, fontSize: '0.72rem', color: THEME.faint },

  scoreRow: { display: 'flex', gap: 4 },
  scoreBtn: { flex: 1, padding: '10px 2px', border: `1.5px solid ${THEME.rule}`, borderRadius: 10, background: THEME.paper, cursor: 'pointer', fontSize: '0.78rem', color: THEME.muted, fontFamily: 'inherit', lineHeight: 1.3 },
  scoreCurrent: { fontSize: '0.92rem', fontWeight: 700, margin: '0 0 8px' },
  dist: { marginTop: 14 },
  voiceLead: { color: THEME.ink, fontSize: '0.9rem', fontWeight: 700, marginBottom: 8 },
  distRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: '0.78rem' },
  distName: { width: 64, flexShrink: 0 },
  distTrack: { flex: 1, height: 8, backgroundColor: '#eceef3', borderRadius: 4, overflow: 'hidden' },
  distPct: { width: 36, textAlign: 'right', color: THEME.muted },

  traj: { marginTop: 18, padding: '12px 14px', borderRadius: 12, backgroundColor: '#f6f7fa' },
  trajTitle: { fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 },
  step: { display: 'flex', gap: 10, position: 'relative', paddingBottom: 12 },
  rail: { width: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 },
  dot: { width: 12, height: 12, borderRadius: '50%', marginTop: 4, border: '2px solid #fff', boxShadow: `0 0 0 1px ${THEME.rule}` },
  line: { flex: 1, width: 2, backgroundColor: THEME.rule, marginTop: 2 },
  stepHead: { fontSize: '0.88rem', fontWeight: 600 },
  stepNote: { fontSize: '0.85rem', lineHeight: 1.7, color: THEME.ink, marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  revisedTag: { display: 'inline-block', marginLeft: 6, padding: '0 8px', borderRadius: 999, backgroundColor: '#e3f6ea', color: '#14532d', fontSize: '0.72rem', fontWeight: 600 },

  source: { padding: '10px 12px', border: `1px solid ${THEME.rule}`, borderRadius: 12, marginBottom: 8 },
  sourceTitle: { fontWeight: 700, color: ACCENT, wordBreak: 'break-all', textDecoration: 'none' },
  sourceLine: { fontSize: '0.85rem', lineHeight: 1.7, marginTop: 4 },
  sourceInterp: { fontSize: '0.85rem', lineHeight: 1.7, marginTop: 4, padding: '0.4rem 0.6rem', backgroundColor: '#f6f7fa', borderRadius: 8 },
  addSource: { border: `1px dashed ${THEME.faint}`, background: 'transparent', borderRadius: 12, padding: '0.6rem 1rem', cursor: 'pointer', color: THEME.muted, width: '100%', fontFamily: 'inherit' },
  buttons: { display: 'flex', gap: 8, marginTop: 6 },

  actionButton: { display: 'flex', width: '100%', alignItems: 'center', gap: 10, textAlign: 'left', padding: '0.8rem 0.85rem', marginTop: 16, border: `1px solid #b8c9ff`, borderRadius: 12, backgroundColor: '#f6f8ff', color: THEME.ink, cursor: 'pointer', fontFamily: 'inherit' },
  actionButtonOpen: { borderColor: '#1f4fd8', backgroundColor: '#eef3ff' },
  actionIcon: { width: 29, height: 29, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', backgroundColor: '#dbe6ff', color: '#1f4fd8', fontWeight: 700, flexShrink: 0 },
  actionArrow: { marginLeft: 'auto', fontSize: '1.2rem', color: '#1f4fd8' },
  writerPanel: { marginTop: 10, padding: '0.8rem', border: `1px solid ${THEME.rule}`, borderRadius: 12, backgroundColor: '#fcfdff' },
  sourceInMargin: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${THEME.rule}` },
  insetTitle: { color: THEME.ink, fontSize: '0.87rem', fontWeight: 700, marginBottom: 5 },
  moreActions: { display: 'grid', gap: 7, marginTop: 12 },
  secondaryAction: { display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 8, textAlign: 'left', alignItems: 'center', padding: '0.65rem 0.7rem', border: `1px solid ${THEME.rule}`, borderRadius: 10, backgroundColor: '#fff', color: THEME.ink, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.86rem' },
  secondaryActionOpen: { backgroundColor: '#f6f8fc', borderColor: '#aeb8cc' },
  secondaryText: { display: 'grid', gap: 2 },
  communityPanel: { marginTop: 10, padding: '0.85rem', border: `1px solid ${THEME.rule}`, borderRadius: 12, backgroundColor: '#fff' },
  memoPanel: { marginTop: 10, padding: '0.85rem', border: `1px solid ${THEME.rule}`, borderRadius: 12, backgroundColor: '#fafaf6' },
  panelTitle: { margin: '0 0 2px', fontSize: '1rem', fontFamily: THEME.serif },
  communitySection: { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${THEME.rule}` },
};

export default function ClaimCard({
  claim, label, expanded, onToggle, user, myColor, myReaction, myEvals,
  annotations, sources, notes, notesReady, act,
}) {
  const [writing, setWriting] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);

  useEffect(() => {
    if (!expanded) {
      setWriting(false);
      setCommunityOpen(false);
      setMemoOpen(false);
    }
  }, [expanded]);

  const changeColor = (color) => act(() => api(`/api/markings/${claim.id}`, { method: 'PUT', body: { color } }));
  const removeMark = () => act(() => api(`/api/markings/${claim.id}`, { method: 'DELETE' }), '線を消しました。');
  const addMark = (color) => act(
    () => api('/api/claims', {
      method: 'POST',
      body: { postId: claim.postId, startIndex: claim.startIndex, endIndex: claim.endIndex, color },
    }),
    'この主張に線を引きました。'
  );

  return (
    <article id={`claim-${claim.id}`} style={{ ...C.card, ...(expanded ? C.cardOpen : null) }}>
      <button type="button" style={C.head} onClick={onToggle} aria-expanded={expanded}>
        <span
          style={{
            ...C.label,
            backgroundColor: myColor ? PEN[myColor].tint : 'transparent',
            borderColor: myColor ? PEN[myColor].ink : THEME.rule,
            color: myColor ? PEN[myColor].ink : THEME.muted,
          }}
        >
          {label}
        </span>
        <span style={{ ...C.quote, ...(expanded ? null : C.quoteClamp) }}>{claim.text}</span>
      </button>

      {!expanded && (
        <div style={C.meta}>
          <MiniBar counts={claim.reactionCounts} total={claim.reactionTotal || 0} />
          <div style={C.stats}>
            線 {Math.max(0, claim.usageCount || 0)}　評価 {claim.reactionTotal || 0}　余白 {claim.annotationCount || 0}　出典 {claim.sourceCount || 0}
            {(claim.revisedCount || 0) > 0 && <span style={C.revisedTag}>考えを更新した人 {claim.revisedCount}</span>}
          </div>
        </div>
      )}

      {expanded && (
        <div style={C.body}>
          <div style={C.penRow}>
            <span style={U.faint}>{myColor ? 'あなたの線:' : 'この主張に線を引く:'}</span>
            {PEN_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => (myColor ? changeColor(key) : addMark(key))}
                style={{
                  ...C.penChip,
                  borderColor: PEN[key].ink,
                  color: PEN[key].ink,
                  backgroundColor: myColor === key ? PEN[key].tint : 'transparent',
                  fontWeight: myColor === key ? 700 : 400,
                }}
              >
                {PEN[key].label}
              </button>
            ))}
            {myColor && <button type="button" style={U.linkBtn} onClick={removeMark}>線を消す</button>}
          </div>

          <ReactionBox claim={claim} myReaction={myReaction} act={act} mode="personal" />

          <button type="button" style={{ ...C.actionButton, ...(writing ? C.actionButtonOpen : null) }} onClick={() => setWriting((value) => !value)}>
            <span style={C.actionIcon}>✎</span>
            <span><b>余白に書く</b><small>この主張を読んで、自分が考えたことを残す</small></span>
            <span style={C.actionArrow}>{writing ? '−' : '＋'}</span>
          </button>

          {writing && (
            <div style={C.writerPanel}>
              <Marginalia
                claim={claim}
                annotations={annotations}
                notes={notes}
                myEvals={myEvals}
                myColor={myColor}
                hasReaction={!!myReaction}
                user={user}
                act={act}
                ownOnly
              />
              <div style={C.sourceInMargin}>
                <div style={C.insetTitle}>出典を添える</div>
                <div style={U.faint}>この余白の背景にある資料やデータを、必要なときだけ追加できます。</div>
                <SourcesBox claim={claim} sources={sources} myEvals={myEvals} user={user} act={act} />
              </div>
            </div>
          )}

          <div style={C.moreActions}>
            <button type="button" style={{ ...C.secondaryAction, ...(communityOpen ? C.secondaryActionOpen : null) }} onClick={() => setCommunityOpen((value) => !value)}>
              <span style={C.secondaryText}><b>みんなのこえ</b><small>評価 {claim.reactionTotal || 0} ・余白 {annotations.length} ・出典 {sources.length}</small></span><b>{communityOpen ? '⌃' : '⌄'}</b>
            </button>
            <button type="button" style={{ ...C.secondaryAction, ...(memoOpen ? C.secondaryActionOpen : null) }} onClick={() => setMemoOpen((value) => !value)}>
              <span style={C.secondaryText}><b>🔒 自分用のメモ</b><small>{notes.length ? `${notes.length}件のメモ` : '自分だけに見える'}</small></span><b>{memoOpen ? '⌃' : '⌄'}</b>
            </button>
          </div>

          {communityOpen && (
            <section style={C.communityPanel}>
              <h3 style={C.panelTitle}>みんなのこえ</h3>
              <ReactionBox claim={claim} myReaction={myReaction} act={act} mode="community" />
              <div style={C.communitySection}>
                <div style={C.insetTitle}>みんなの余白</div>
                <Marginalia
                  claim={claim}
                  annotations={annotations}
                  notes={notes}
                  myEvals={myEvals}
                  myColor={myColor}
                  hasReaction={!!myReaction}
                  user={user}
                  act={act}
                  showComposer={false}
                />
              </div>
              <div style={C.communitySection}>
                <div style={C.insetTitle}>余白に添えられた出典</div>
                <SourcesBox claim={claim} sources={sources} myEvals={myEvals} user={user} act={act} allowAdd={false} />
              </div>
            </section>
          )}

          {memoOpen && (
            <section style={C.memoPanel}>
              <PrivateNotesTab claim={claim} notes={notes} annotations={annotations} notesReady={notesReady} act={act} />
            </section>
          )}

        </div>
      )}
    </article>
  );
}

// ====================================================================
// 評価 (-2〜+2) と 考えの軌跡 (§13, §14, §25, §26)
//   評価を変えることは「取り消し」ではなく「考えが更新された記録」として残す。
//   どちらへ動いたか(賛成→反対 など)に、良い悪いの区別は付けない。
// ====================================================================

function ReactionBox({ claim, myReaction, act, mode = 'personal' }) {
  const saved = myReaction ? myReaction.score : undefined;
  const savedConf = myReaction && myReaction.confidence !== undefined ? myReaction.confidence : null;

  const commit = (score, confidence) => {
    if (score === saved && confidence === savedConf) return;
    act(() => api(`/api/claims/${claim.id}/reaction`, { method: 'PUT', body: { score, confidence } }));
  };

  const dist = claim.reactionCounts || {};
  const total = claim.reactionTotal || 0;
  const current = SCORES.find((s) => s.value === saved);
  const ticks = [...SCORES].reverse(); // 左が反対、右が賛成

  if (mode === 'community') {
    return (
      <div style={C.dist}>
        <div style={C.voiceLead}>みんなの評価（{total} 人）</div>
        {SCORES.map((s) => {
          const n = dist[String(s.value)] || 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <div key={s.value} style={C.distRow}>
              <span style={C.distName}>{s.short}{saved === s.value ? ' ●' : ''}</span>
              <span style={C.distTrack}>
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, backgroundColor: SCORE_COLOR[String(s.value)] }} />
              </span>
              <span style={C.distPct}>{pct}%</span>
            </div>
          );
        })}
        {(claim.revisedCount || 0) > 0 && (
          <div style={{ ...U.faint, marginTop: 8 }}>この主張では、{claim.revisedCount} 人が読んで考えを更新しています。</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={C.scoreCurrent}>
        {current ? `いまの評価: ${current.label}（${signed(saved)}）` : 'この主張への評価を選んでください'}
      </div>

      <div style={C.scoreRow}>
        {ticks.map((s) => {
          const active = saved === s.value;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={active}
              onClick={() => commit(s.value, savedConf)}
              style={{
                ...C.scoreBtn,
                borderColor: active ? SCORE_COLOR[String(s.value)] : THEME.rule,
                backgroundColor: active ? SCORE_COLOR[String(s.value)] : THEME.paper,
                color: active && s.value !== 0 ? '#fff' : active ? THEME.ink : THEME.muted,
                fontWeight: active ? 700 : 400,
              }}
            >
              {s.short}
            </button>
          );
        })}
      </div>

    </div>
  );
}

// ====================================================================
// 出典 (§17, §18, §36)
// ====================================================================

function SourcesBox({ claim, sources, myEvals, user, act, allowAdd = true }) {
  const [open, setOpen] = useState(false);
  const sorted = [...sources].sort((a, b) => (b.bridgeScore || 0) - (a.bridgeScore || 0)
    || toMillis(a.createdAt) - toMillis(b.createdAt));

  return (
    <div>
      {sorted.length === 0 && <div style={{ ...U.faint, marginBottom: 10 }}>まだ資料はありません。</div>}

      {sorted.map((s) => (
        <div key={s.id} style={C.source}>
          <a href={s.url} target="_blank" rel="noopener noreferrer" style={C.sourceTitle}>{s.title}</a>
          <div style={U.faint}>ユーザーが提示した資料　{s.authorName || 'ななしさん'}</div>
          {s.evidenceLocation && <div style={C.sourceLine}><b>根拠箇所:</b> {s.evidenceLocation}</div>}
          {s.description && <div style={C.sourceLine}><b>この資料が示していること:</b> {s.description}</div>}
          {s.interpretation && <div style={C.sourceInterp}><b>投稿者の解釈:</b> {s.interpretation}</div>}
          <EvalButtons targetType="source" target={s} myEvals={myEvals} user={user} act={act} />
        </div>
      ))}

      {allowAdd && open ? (
        <SourceForm claim={claim} act={act} onDone={() => setOpen(false)} />
      ) : allowAdd ? <button type="button" style={C.addSource} onClick={() => setOpen(true)}>＋ 出典を追加する</button> : null}
    </div>
  );
}

function SourceForm({ claim, act, onDone }) {
  const [f, setF] = useState({ title: '', url: '', evidenceLocation: '', description: '', interpretation: '' });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const result = await act(
      () => api(`/api/claims/${claim.id}/sources`, { method: 'POST', body: f }),
      '資料を追加しました。'
    );
    setBusy(false);
    if (result) onDone();
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      <label style={U.fieldLabel}>
        資料名
        <input style={U.input} value={f.title} onChange={set('title')} maxLength={200} required />
      </label>
      <label style={U.fieldLabel}>
        URL
        <input style={U.input} type="url" value={f.url} onChange={set('url')} placeholder="https://" required />
      </label>
      <label style={U.fieldLabel}>
        根拠箇所（表・ページなど）
        <input style={U.input} value={f.evidenceLocation} onChange={set('evidenceLocation')} maxLength={200} />
      </label>
      <label style={U.fieldLabel}>
        この資料が示していること
        <textarea style={{ ...U.textarea, marginTop: 4 }} rows={2} value={f.description} onChange={set('description')} maxLength={1000} />
      </label>
      <label style={U.fieldLabel}>
        あなたの解釈（資料そのものとは分けて書く）
        <textarea style={{ ...U.textarea, marginTop: 4 }} rows={2} value={f.interpretation} onChange={set('interpretation')} maxLength={1000} />
      </label>
      <div style={C.buttons}>
        <button type="submit" disabled={busy} style={{ ...U.submit, ...(busy ? U.submitOff : null) }}>
          {busy ? '送信中…' : '資料を追加する'}
        </button>
        <button type="button" style={U.ghost} onClick={onDone}>やめる</button>
      </div>
    </form>
  );
}
