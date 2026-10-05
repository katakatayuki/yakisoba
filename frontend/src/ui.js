import React from 'react';

import { api } from './firebase';
import { THEME, EVAL_TYPES, MIN_EVALS, avatarColors } from './lib';

// ====================================================================
// 共通のUI部品 (フィード型レイアウト用)
// ====================================================================

// マルジナリアへの返信の深さの上限。server.js の MAX_DEPTH と同じ値にしておくこと
export const MAX_DEPTH = 3;

export const ACCENT = '#1f4fd8';

// 評価(-2〜+2)の色。賛否に善悪をつけないよう、橙↔青緑の中立的な配色にする
export const SCORE_COLOR = {
  '-2': '#b5541c',
  '-1': '#e9a76b',
  '0': '#cfd4dc',
  '1': '#74b9a8',
  '2': '#1b7f6b',
};

export const U = {
  card: {
    backgroundColor: THEME.paper,
    border: `1px solid ${THEME.rule}`,
    borderRadius: 16,
  },
  faint: { color: THEME.faint, fontSize: '0.8rem', lineHeight: 1.6 },
  footnote: { color: THEME.faint, fontSize: '0.78rem', lineHeight: 1.6, marginTop: 4 },
  h3: { fontSize: '0.95rem', margin: '0 0 0.6rem' },

  chip: {
    border: `1px solid ${THEME.rule}`,
    background: THEME.paper,
    borderRadius: 999,
    padding: '4px 12px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    color: THEME.muted,
    fontFamily: 'inherit',
  },
  chipActive: { borderColor: THEME.ink, backgroundColor: THEME.ink, color: '#fff' },

  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.7rem 0.8rem',
    border: `1px solid ${THEME.rule}`,
    borderRadius: 12,
    fontSize: '0.95rem',
    lineHeight: 1.7,
    fontFamily: 'inherit',
    resize: 'vertical',
    backgroundColor: '#fff',
  },
  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 4,
    padding: '0.55rem 0.7rem',
    border: `1px solid ${THEME.rule}`,
    borderRadius: 10,
    fontSize: '0.92rem',
    fontFamily: 'inherit',
  },
  fieldLabel: { display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.7rem' },

  submit: {
    padding: '0.5rem 1.2rem',
    border: 'none',
    borderRadius: 999,
    backgroundColor: ACCENT,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontFamily: 'inherit',
  },
  submitOff: { backgroundColor: '#98a2b3', cursor: 'not-allowed' },
  ghost: {
    padding: '0.5rem 1rem',
    border: `1px solid ${THEME.rule}`,
    background: 'transparent',
    borderRadius: 999,
    cursor: 'pointer',
    color: THEME.muted,
    fontSize: '0.88rem',
    fontFamily: 'inherit',
  },
  linkBtn: {
    border: 'none',
    background: 'none',
    color: THEME.muted,
    cursor: 'pointer',
    fontSize: '0.8rem',
    padding: '4px 6px',
    fontFamily: 'inherit',
  },
  bridgeBadge: {
    display: 'inline-block',
    marginTop: 4,
    padding: '1px 8px',
    borderRadius: 999,
    backgroundColor: THEME.bridgeBg,
    color: THEME.bridge,
    fontSize: '0.78rem',
    fontWeight: 700,
  },
};

// 名前の頭文字のアバター
export function Avatar({ name, size = 40 }) {
  const { bg, fg } = avatarColors(name);
  const initial = Array.from(String(name || 'な').trim())[0] || 'な';
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  );
}

// 5段階評価の分布を1本の帯で見せる
export function MiniBar({ counts = {}, total = 0, height = 8 }) {
  if (!total) {
    return <div style={{ height, borderRadius: height / 2, backgroundColor: '#eceef3' }} />;
  }
  return (
    <div style={{ display: 'flex', height, borderRadius: height / 2, overflow: 'hidden' }}>
      {[-2, -1, 0, 1, 2].map((v) => {
        const n = counts[String(v)] || 0;
        return n ? (
          <span key={v} style={{ width: `${(n / total) * 100}%`, backgroundColor: SCORE_COLOR[String(v)] }} />
        ) : null;
      })}
    </div>
  );
}

// ---- 有用性の評価。主張への賛否とは別のデータ (§19) ----

const E = {
  row: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 },
  chip: {
    border: `1px solid ${THEME.rule}`,
    background: THEME.paper,
    borderRadius: 999,
    padding: '2px 10px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    color: THEME.muted,
    fontFamily: 'inherit',
  },
  chipActive: { borderColor: THEME.ink, color: '#fff', backgroundColor: THEME.ink },
};

export function EvalButtons({ targetType, target, myEvals, user, act }) {
  const mine = myEvals[`${targetType}_${target.id}`];
  const counts = target.evalCounts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (target.authorId === user.uid) {
    return (
      <div style={E.row}>
        <span style={U.faint}>あなたが書いたものです</span>
        <BridgeNote target={target} total={total} />
      </div>
    );
  }

  const toggle = (type) => act(() => (
    mine === type
      ? api(`/api/evaluations/${targetType}/${target.id}`, { method: 'DELETE' })
      : api('/api/evaluations', { method: 'PUT', body: { targetType, targetId: target.id, type } })
  ));

  return (
    <div>
      <div style={E.row}>
        {EVAL_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => toggle(t.value)}
            style={{ ...E.chip, ...(mine === t.value ? E.chipActive : null) }}
          >
            {t.label}{counts[t.value] ? ` ${counts[t.value]}` : ''}
          </button>
        ))}
      </div>
      <BridgeNote target={target} total={total} />
    </div>
  );
}

export function BridgeNote({ target, total }) {
  if ((target.bridgeScore || 0) > 0) {
    return <span style={U.bridgeBadge}>🌉 Bridge {target.bridgeScore}</span>;
  }
  if (total > 0) {
    return (
      <div style={U.footnote}>
        評価 {total} 件（橋渡しの指標に使われる評価 {target.evalCount || 0}/{MIN_EVALS}）
      </div>
    );
  }
  return null;
}
