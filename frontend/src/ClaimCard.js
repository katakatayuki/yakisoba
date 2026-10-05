import React, { useEffect, useState } from 'react';

import { api } from './firebase';
import { THEME, PEN, PEN_KEYS, SCORES, signed, toMillis, formatDate } from './lib';
import { U, MiniBar, EvalButtons, SCORE_COLOR, ACCENT } from './ui';
import Marginalia, { PrivateNotesTab } from './Marginalia';
import ClaimGraph from './ClaimGraph';

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
};

const TABS = [
  { key: 'react', label: '評価' },
  { key: 'margin', label: '余白' },
  { key: 'source', label: '出典' },
  { key: 'graph', label: 'つながり' },
  { key: 'memo', label: '🔒メモ' },
];

export default function ClaimCard({
  claim, label, expanded, onToggle, user, myColor, myReaction, myEvals,
  annotations, sources, notes, notesReady, act,
}) {
  const [tab, setTab] = useState('react');

  const changeColor = (color) => act(() => api(`/api/markings/${claim.id}`, { method: 'PUT', body: { color } }));
  const removeMark = () => act(() => api(`/api/markings/${claim.id}`, { method: 'DELETE' }), '線を消しました。');
  const addMark = (color) => act(
    () => api('/api/claims', {
      method: 'POST',
      body: { postId: claim.postId, startIndex: claim.startIndex, endIndex: claim.endIndex, color },
    }),
    'この主張に線を引きました。'
  );

  const counts = { margin: annotations.length, source: sources.length, memo: notes.length };

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

      <div style={C.meta}>
        <MiniBar counts={claim.reactionCounts} total={claim.reactionTotal || 0} />
        <div style={C.stats}>
          線 {Math.max(0, claim.usageCount || 0)}　評価 {claim.reactionTotal || 0}　余白 {claim.annotationCount || 0}　出典 {claim.sourceCount || 0}
          {(claim.revisedCount || 0) > 0 && <span style={C.revisedTag}>考えを更新した人 {claim.revisedCount}</span>}
        </div>
      </div>

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

          <div style={C.tabs} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                style={{ ...C.tab, ...(tab === t.key ? C.tabActive : null) }}
              >
                {t.label}
                {counts[t.key] > 0 && <span style={C.count}>{counts[t.key]}</span>}
              </button>
            ))}
          </div>

          {tab === 'react' && <ReactionBox claim={claim} myReaction={myReaction} act={act} />}
          {tab === 'margin' && (
            <Marginalia
              claim={claim}
              annotations={annotations}
              notes={notes}
              myEvals={myEvals}
              myColor={myColor}
              hasReaction={!!myReaction}
              user={user}
              act={act}
            />
          )}
          {tab === 'source' && <SourcesBox claim={claim} sources={sources} myEvals={myEvals} user={user} act={act} />}
          {tab === 'graph' && <ClaimGraph claim={claim} />}
          {tab === 'memo' && (
            <PrivateNotesTab claim={claim} notes={notes} annotations={annotations} notesReady={notesReady} act={act} />
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

function ReactionBox({ claim, myReaction, act }) {
  const saved = myReaction ? myReaction.score : undefined;
  const savedConf = myReaction && myReaction.confidence !== undefined ? myReaction.confidence : null;

  const [useConf, setUseConf] = useState(savedConf !== null);
  const [conf, setConf] = useState(savedConf !== null ? savedConf : 50);

  useEffect(() => {
    setUseConf(savedConf !== null);
    setConf(savedConf !== null ? savedConf : 50);
  }, [claim.id, savedConf]);

  const commit = (score, confidence) => {
    if (score === saved && confidence === savedConf) return;
    act(() => api(`/api/claims/${claim.id}/reaction`, { method: 'PUT', body: { score, confidence } }));
  };

  const pick = (value) => commit(value, useConf ? conf : null);

  const toggleConf = (on) => {
    setUseConf(on);
    if (!on && saved !== undefined) commit(saved, null);
  };

  const dist = claim.reactionCounts || {};
  const total = claim.reactionTotal || 0;
  const current = SCORES.find((s) => s.value === saved);
  const ticks = [...SCORES].reverse(); // 左が反対、右が賛成
  const history = (myReaction && myReaction.history) || [];

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
              onClick={() => pick(s.value)}
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

      {saved !== undefined && (
        <>
          <label style={{ display: 'block', fontSize: '0.85rem', margin: '12px 0 4px' }}>
            <input type="checkbox" checked={useConf} onChange={(e) => toggleConf(e.target.checked)} />
            {' '}確信度も記録する
          </label>
          {useConf && (
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>この判断への自信 {conf}%</div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={conf}
                aria-label="確信度"
                onChange={(e) => setConf(Number(e.target.value))}
                onPointerUp={(e) => commit(saved, Number(e.currentTarget.value))}
                onKeyUp={(e) => commit(saved, Number(e.currentTarget.value))}
                style={{ width: '100%', accentColor: THEME.ink }}
              />
            </div>
          )}
        </>
      )}

      <div style={C.dist}>
        <div style={U.faint}>みんなの評価（{total} 人）</div>
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
          <div style={{ ...U.faint, marginTop: 8 }}>
            この主張では、{claim.revisedCount} 人が読んで考えを更新しています。
          </div>
        )}
      </div>

      {history.length > 0 && <Trajectory claim={claim} history={history} act={act} />}
    </div>
  );
}

// ---- 考えの軌跡(本人にだけ見える) ----

function Trajectory({ claim, history, act }) {
  const revisions = history.length - 1;
  const lastIndex = history.length - 1;
  const last = history[lastIndex];

  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(last.note || '');

  // 評価が変わって最新の履歴が入れ替わったら、入力欄も新しくする
  useEffect(() => {
    setNote(last.note || '');
    setEditing(false);
  }, [history.length, last.note]);

  const saveNote = async () => {
    const result = await act(
      () => api(`/api/claims/${claim.id}/reaction/note`, { method: 'PUT', body: { note: note.trim() } }),
      '理由を残しました。'
    );
    if (result) setEditing(false);
  };

  return (
    <div style={C.traj}>
      <div style={C.trajTitle}>
        あなたの考えの軌跡
        {revisions > 0 && <span style={C.revisedTag}>考えを {revisions} 回更新</span>}
      </div>
      <div style={{ ...U.faint, marginBottom: 12 }}>
        {revisions > 0
          ? '読み、考え続けたからこそ起きた変化です。この記録はあなたにだけ見えます。'
          : 'あとで考えが変わったら、ここに積み重なっていきます。この記録はあなたにだけ見えます。'}
      </div>

      {history.map((h, i) => {
        const s = SCORES.find((x) => x.value === h.score);
        const isLast = i === lastIndex;
        return (
          <div key={`${toMillis(h.at)}-${i}`} style={{ ...C.step, paddingBottom: isLast ? 0 : 12 }}>
            <div style={C.rail}>
              <span style={{ ...C.dot, backgroundColor: SCORE_COLOR[String(h.score)] }} />
              {!isLast && <span style={C.line} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={C.stepHead}>
                {s ? s.label : signed(h.score)}（{signed(h.score)}）
                <span style={{ ...U.faint, marginLeft: 8, fontWeight: 400 }}>
                  {i === 0 ? '最初の評価' : '考えを更新'}　{formatDate(h.at)}
                </span>
              </div>

              {h.note && !(isLast && editing) && <div style={C.stepNote}>「{h.note}」</div>}

              {isLast && (editing ? (
                <div style={{ marginTop: 6 }}>
                  <textarea
                    style={U.textarea}
                    rows={2}
                    maxLength={200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={i === 0 ? 'なぜこの評価にしましたか？(任意)' : 'なぜ考えが変わりましたか？(任意)'}
                  />
                  <div style={C.buttons}>
                    <button type="button" style={U.submit} onClick={saveNote}>残す</button>
                    <button type="button" style={U.ghost} onClick={() => { setEditing(false); setNote(last.note || ''); }}>やめる</button>
                  </div>
                </div>
              ) : (
                <button type="button" style={{ ...U.linkBtn, marginLeft: -6 }} onClick={() => setEditing(true)}>
                  {last.note ? '理由を直す' : i === 0 ? '理由を書き残す' : 'なぜ変わったかを書き残す'}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ====================================================================
// 出典 (§17, §18, §36)
// ====================================================================

function SourcesBox({ claim, sources, myEvals, user, act }) {
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

      {open ? (
        <SourceForm claim={claim} act={act} onDone={() => setOpen(false)} />
      ) : (
        <button type="button" style={C.addSource} onClick={() => setOpen(true)}>＋ 資料を追加する</button>
      )}
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
