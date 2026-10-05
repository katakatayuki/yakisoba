import React, { useEffect, useMemo, useState } from 'react';

import { api } from './firebase';
import { THEME, clip } from './lib';
import { U, MiniBar } from './ui';

// ====================================================================
// 主張グラフ
//   中心の主張に、次の3種類をつなげて見せる。
//     🔗 別の投稿の「同じ / 含む / 似ている」主張
//     📄 支える出典(「反証あり」の評価がついたものは赤い点線)
//     ⚠  反論のマルジナリア
//   同じ主張かどうかは文字の一致度による簡易判定。人が確かめる前提で、
//   「どう判定したか」(同じ/含む/似ている)を必ず表示する。
// ====================================================================

const SIZE = 340;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RING = 122;
const MAX_NODES = { related: 6, source: 6, counter: 5 };

const KIND_LABEL = { same: '同じ', contains: '含む関係', similar: '似ている' };
const COLOR = { related: '#667085', source: '#1f8a4c', counter: '#d6372f' };

const G = {
  wrap: { marginTop: 4 },
  svg: { width: '100%', maxWidth: 380, display: 'block', margin: '0 auto' },
  legend: { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.75rem', color: THEME.muted, margin: '4px 0 12px' },
  h4: { fontSize: '0.85rem', margin: '16px 0 6px' },
  item: { padding: '8px 10px', borderRadius: 12, border: `1px solid ${THEME.rule}`, marginBottom: 6, fontSize: '0.88rem', lineHeight: 1.6 },
  itemFocus: { borderColor: THEME.ink, backgroundColor: '#f6f7fa' },
  badge: { display: 'inline-block', borderRadius: 999, padding: '0 8px', fontSize: '0.72rem', marginRight: 6, border: `1px solid ${THEME.rule}`, color: THEME.muted },
  warn: { display: 'inline-block', borderRadius: 999, padding: '0 8px', fontSize: '0.72rem', marginLeft: 6, backgroundColor: '#ffe3e0', color: '#8a1c14' },
  link: { color: '#1f4fd8', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' },
};

function layout(related, sources, counters) {
  const nodes = [
    ...related.slice(0, MAX_NODES.related).map((r) => ({ key: `r:${r.id}`, kind: 'related', label: clip(r.postTitle, 6), icon: '🔗', claimId: r.id })),
    ...sources.slice(0, MAX_NODES.source).map((x) => ({
      key: `s:${x.id}`,
      kind: 'source',
      label: clip(x.title, 6),
      icon: '📄',
      claimId: x.claimId,
      disputed: x.counterEvidence > x.useful,
    })),
    ...counters.slice(0, MAX_NODES.counter).map((c) => ({ key: `c:${c.id}`, kind: 'counter', label: clip(c.body, 6), icon: '⚠', claimId: c.claimId })),
  ];
  const n = Math.max(nodes.length, 1);
  nodes.forEach((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    node.x = CX + RING * Math.cos(angle);
    node.y = CY + RING * Math.sin(angle);
  });
  return nodes;
}

export default function ClaimGraph({ claim }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api(`/api/claims/${claim.id}/graph`)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message || 'つながりを読み込めませんでした。'); });
    return () => { alive = false; };
  }, [claim.id]);

  const nodes = useMemo(
    () => (data ? layout(data.related, data.sources, data.counters) : []),
    [data]
  );

  if (error) return <div style={U.faint}>{error}</div>;
  if (!data) return <div style={U.faint}>つながりを探しています…</div>;

  const empty = data.related.length === 0 && data.sources.length === 0 && data.counters.length === 0;
  if (empty) {
    return (
      <div style={U.faint}>
        まだつながりがありません。同じ内容の主張が別の投稿に書かれたり、出典や反論が付いたりすると、ここに現れます。
      </div>
    );
  }

  // 別の投稿の同じ主張に付いた出典は、その主張のノードから線を引く
  const relatedPos = new Map(nodes.filter((n) => n.kind === 'related').map((n) => [n.claimId, n]));
  const edgeFrom = (node) => {
    if (node.kind !== 'related' && node.claimId !== claim.id && relatedPos.has(node.claimId)) {
      return relatedPos.get(node.claimId);
    }
    return { x: CX, y: CY };
  };

  const pick = (key) => setFocus((cur) => (cur === key ? null : key));

  return (
    <div style={G.wrap}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={G.svg} role="img" aria-label="この主張のつながり">
        {nodes.map((node) => {
          const from = edgeFrom(node);
          const dashed = node.kind === 'counter' || node.disputed;
          return (
            <line
              key={`e-${node.key}`}
              x1={from.x}
              y1={from.y}
              x2={node.x}
              y2={node.y}
              stroke={node.disputed ? COLOR.counter : COLOR[node.kind]}
              strokeWidth={focus === node.key ? 2.5 : 1.3}
              strokeDasharray={dashed ? '4 3' : undefined}
              opacity={focus && focus !== node.key ? 0.25 : 0.8}
            />
          );
        })}

        <circle cx={CX} cy={CY} r={38} fill={THEME.ink} />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">この主張</text>

        {nodes.map((node) => (
          <g key={node.key} onClick={() => pick(node.key)} style={{ cursor: 'pointer' }}>
            <circle
              cx={node.x}
              cy={node.y}
              r={focus === node.key ? 19 : 16}
              fill="#fff"
              stroke={node.disputed ? COLOR.counter : COLOR[node.kind]}
              strokeWidth="2"
            />
            <text x={node.x} y={node.y + 5} textAnchor="middle" fontSize="14">{node.icon}</text>
            <text x={node.x} y={node.y + 31} textAnchor="middle" fontSize="9.5" fill={THEME.muted}>{node.label}</text>
          </g>
        ))}
      </svg>

      <div style={G.legend}>
        <span>🔗 別の投稿の主張</span>
        <span>📄 出典</span>
        <span>⚠ 反論</span>
        <span>┄ 反証あり・反論</span>
      </div>

      {data.related.length > 0 && (
        <>
          <h4 style={G.h4}>他の投稿に書かれた、同じ・近い主張</h4>
          {data.related.map((r) => {
            const key = `r:${r.id}`;
            return (
              <div key={key} style={{ ...G.item, ...(focus === key ? G.itemFocus : null) }} onClick={() => pick(key)}>
                <span style={G.badge}>{KIND_LABEL[r.kind] || r.kind}</span>
                {clip(r.text, 80)}
                <div style={U.faint}>
                  <a href={`#/post/${r.postId}?claim=${r.id}`} style={G.link}>「{clip(r.postTitle, 24)}」で読む →</a>
                </div>
                <div style={{ marginTop: 6 }}>
                  <MiniBar counts={r.reactionCounts} total={r.reactionTotal} height={6} />
                  <div style={U.faint}>{r.reactionTotal} 人が評価 ・ {r.usageCount} 人が線</div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {data.sources.length > 0 && (
        <>
          <h4 style={G.h4}>この主張を支える出典</h4>
          {data.sources.map((x) => {
            const key = `s:${x.id}`;
            const viaOther = x.claimId !== claim.id;
            return (
              <div key={key} style={{ ...G.item, ...(focus === key ? G.itemFocus : null) }} onClick={() => pick(key)}>
                <a href={x.url} target="_blank" rel="noopener noreferrer" style={G.link}>{x.title}</a>
                {x.counterEvidence > 0 && <span style={G.warn}>反証あり {x.counterEvidence}</span>}
                <div style={U.faint}>
                  {x.authorName}
                  {x.evidenceLocation ? `　根拠箇所: ${x.evidenceLocation}` : ''}
                  {viaOther ? '　(別の投稿の同じ主張に付いた資料)' : ''}
                </div>
                {x.bridgeScore > 0 && <span style={U.bridgeBadge}>🌉 Bridge {x.bridgeScore}</span>}
              </div>
            );
          })}
        </>
      )}

      {data.counters.length > 0 && (
        <>
          <h4 style={G.h4}>この主張への反論</h4>
          {data.counters.map((c) => {
            const key = `c:${c.id}`;
            return (
              <div key={key} style={{ ...G.item, ...(focus === key ? G.itemFocus : null) }} onClick={() => pick(key)}>
                {c.body}
                <div style={U.faint}>
                  {c.authorName}　
                  {c.claimId !== claim.id && (
                    <a href={`#/post/${c.postId}?claim=${c.claimId}`} style={G.link}>別の投稿の同じ主張で読む →</a>
                  )}
                </div>
                {c.bridgeScore > 0 && <span style={U.bridgeBadge}>🌉 Bridge {c.bridgeScore}</span>}
              </div>
            );
          })}
        </>
      )}

      <div style={U.footnote}>
        「同じ・含む・似ている」は文字の一致度による簡易判定です。意味が違うこともあるので、リンク先で文脈を確かめてください。
        {data.truncated && ' (主張の数が多いため、新しいものから一部だけを照合しています)'}
      </div>
    </div>
  );
}
