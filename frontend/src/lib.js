// ====================================================================
// テーマ
// 三色ボールペンのインク(青・赤・緑)だけを色の主役にし、
// それ以外は白い紙とグレーの机に抑える。
// ====================================================================

export const THEME = {
  desk: '#e9ebef',
  paper: '#ffffff',
  ink: '#1c2030',
  muted: '#667085',
  faint: '#98a2b3',
  rule: '#d5d9e2',
  bridge: '#a35f00',
  bridgeBg: '#fff4de',
  serif: '"Noto Serif JP","Hiragino Mincho ProN","Yu Mincho",YuMincho,serif',
  sans: '"Noto Sans JP","Hiragino Sans","Yu Gothic UI",Meiryo,system-ui,sans-serif',
};

// マーカーの色は「賛否」ではなく「読むときの自分の行為」を表す (企画書 §12)
export const PEN = {
  blue: { label: '重要・納得', ink: '#1f4fd8', tint: '#dbe6ff' },
  red: { label: '疑問・反論', ink: '#d6372f', tint: '#ffdcd9' },
  green: { label: '自分の考え', ink: '#1f8a4c', tint: '#d6f2e0' },
};

export const PEN_KEYS = ['blue', 'red', 'green'];

// 主張への評価 (§13)。表示は「賛成」側が上
export const SCORES = [
  { value: 2, label: '賛成', short: '賛成' },
  { value: 1, label: 'やや賛成', short: 'やや賛成' },
  { value: 0, label: '保留・判断できない', short: '保留' },
  { value: -1, label: 'やや反対', short: 'やや反対' },
  { value: -2, label: '強く反対', short: '反対' },
];

export const ANNOTATION_TYPES = [
  { value: 'opinion', label: '意見' },
  { value: 'question', label: '疑問' },
  { value: 'counter', label: '反論' },
  { value: 'supplement', label: '補足' },
  { value: 'perspective', label: '別の視点' },
];

export const EVAL_TYPES = [
  { value: 'useful', label: '有用' },
  { value: 'partiallyUseful', label: '一部有用' },
  { value: 'needsVerification', label: '追加確認が必要' },
  { value: 'counterEvidence', label: '反証あり' },
];

// サーバー(server.js)の MIN_EVALS と同じ値にしておくこと
export const MIN_EVALS = 3;

// ====================================================================
// 表示用ヘルパー
// ====================================================================

export function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

export function formatDate(ts) {
  const ms = toMillis(ts);
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ホームの並び順 = BridgeScore × 最近の動き × 信頼度 (§35)。「いいね数」では並べない。
export function homeScore(post, now = Date.now()) {
  const bridge = post.bridgeScore || 0;
  const ageDays = Math.max(0, (now - toMillis(post.lastActivityAt)) / 86400000);
  const recency = Math.max(0.15, Math.pow(0.5, ageDays / 3));
  const confidence = Math.min(1, (post.evaluationCount || 0) / 10);
  return bridge * recency * confidence;
}

// ====================================================================
// 本文の文字位置の計算
// 本文は white-space: pre-wrap のテキストとして描画し、
// 先頭からの文字数(UTF-16)を「位置」として扱う。
// 本文コンテナの中に、文字として数えられるテキストを足さないこと。
// ====================================================================

// PC: ドラッグ選択 → 本文内の [start, end)
export function selectionToRange(container) {
  const sel = window.getSelection();
  if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);

  const start = pre.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

// スマホ: 画面上の座標 → 本文内の位置
export function pointToIndex(container, x, y) {
  let node = null;
  let offset = 0;

  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }

  if (!node || !container.contains(node)) return null;

  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(node, offset);
  return pre.toString().length;
}

const SENTENCE_END = '。！？!?\n';
const SOFT_STOP = '、，,';

// カーソルを句読点・文末へ軽く吸着させる (§9)
export function snapToPunctuation(text, index, radius = 3) {
  for (let d = 0; d <= radius; d += 1) {
    const candidates = d === 0 ? [index] : [index - d, index + d];
    for (const p of candidates) {
      if (p > 0 && p <= text.length && (SENTENCE_END + SOFT_STOP).includes(text[p - 1])) {
        return p;
      }
    }
  }
  return index;
}

export function nextSentenceEnd(text, index) {
  for (let i = index + 1; i <= text.length; i += 1) {
    if (SENTENCE_END.includes(text[i - 1])) return i;
  }
  return text.length;
}

export function prevSentenceEnd(text, index) {
  for (let i = index - 1; i > 0; i -= 1) {
    if (SENTENCE_END.includes(text[i - 1])) return i;
  }
  return 0;
}

// 本文を「どの主張に覆われているか」が同じ断片に分ける。
// extraCuts にはカーソル位置や選択中の範囲の端を渡す。
export function buildPieces(text, claims, extraCuts = []) {
  const cuts = new Set([0, text.length]);
  claims.forEach((c) => {
    cuts.add(c.startIndex);
    cuts.add(c.endIndex);
  });
  extraCuts.forEach((p) => {
    if (typeof p === 'number') cuts.add(p);
  });

  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const pieces = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    pieces.push({
      start,
      end,
      text: text.slice(start, end),
      claimIds: claims.filter((c) => c.startIndex <= start && c.endIndex >= end).map((c) => c.id),
    });
  }
  return pieces;
}

// ====================================================================
// みんなの分割 (§10, §11, §30)
// 各ユーザーが引いた線の組(=分け方)を集計する。
// 多数派を「正解」にはせず、採用率だけを返す。
// ====================================================================

export function computePatterns(claims, markings) {
  const claimMap = new Map(claims.map((c) => [c.id, c]));
  const byUser = new Map();

  markings.forEach((m) => {
    if (!claimMap.has(m.claimId)) return;
    if (!byUser.has(m.userId)) byUser.set(m.userId, new Set());
    byUser.get(m.userId).add(m.claimId);
  });

  const groups = new Map();
  byUser.forEach((set) => {
    const ids = [...set].sort((a, b) => {
      const ca = claimMap.get(a);
      const cb = claimMap.get(b);
      return ca.startIndex - cb.startIndex || ca.endIndex - cb.endIndex || a.localeCompare(b);
    });
    const key = ids.join('|');
    const group = groups.get(key) || { key, claimIds: ids, count: 0 };
    group.count += 1;
    groups.set(key, group);
  });

  const total = byUser.size;
  const list = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map((g) => ({ ...g, ratio: total ? g.count / total : 0 }));

  return { total, list };
}

// ====================================================================
// 追加: マルジナリアの返信スレッド / 時間表示 / アバター色
// ====================================================================

// 平らな注釈の配列を、parentId でつないだ木にする。
// 返信先が見つからないもの(削除など)は、いちばん上の階層に出す。
export function buildThread(annotations) {
  const nodes = new Map(annotations.map((a) => [a.id, { ...a, children: [] }]));
  const roots = [];
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const byTime = (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt);
  const sortAll = (list) => {
    list.sort(byTime);
    list.forEach((n) => sortAll(n.children));
  };
  sortAll(roots);
  return roots;
}

// 「3分前」「2日前」のような相対表示。1週間を超えたら日付にする
export function timeAgo(ts, now = Date.now()) {
  const ms = toMillis(ts);
  if (!ms) return '';
  const minutes = Math.floor(Math.max(0, now - ms) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return formatDate(ts);
}

// 名前から決まる、やわらかいアバター色
export function avatarColors(name) {
  let hue = 0;
  for (const ch of String(name || '')) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return { bg: `hsl(${hue}, 55%, 90%)`, fg: `hsl(${hue}, 45%, 30%)` };
}
