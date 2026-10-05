// ==========================================================
// なめらかなSNS サーバー (Express + firebase-admin / Render)
//
// 旧: 焼きそば予約サーバー → 新: 主張単位の読み書きを仲介するAPI
//
// 方針
//  - 書き込みはすべてこのサーバー経由 (Firestoreルールではクライアント書き込みを禁止)
//  - 読み取りはクライアントが Firestore を onSnapshot で直接購読
//  - 認証は Firebase ID トークン (Authorization: Bearer ...) で行う
//    (旧 apiSecret 方式はクライアントに秘密が露出するため廃止)
//
// 環境変数
//  FIREBASE_SERVICE_ACCOUNT  サービスアカウントJSON(文字列)
//  ALLOWED_ORIGIN            (任意) フロントのURL。未設定なら全許可
//  PORT                      Renderが自動設定
// ==========================================================

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json({ limit: '300kb' }));

// ==========================================================
// Firebase 初期化
// ==========================================================

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
    console.error('Firebase initialization failed. Check FIREBASE_SERVICE_ACCOUNT variable.');
    console.error(e);
    process.exit(1);
}

const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// ==========================================================
// 定数 (企画書 §13, §16, §18, §23, §33)
// ==========================================================

const IOU_THRESHOLD = 0.8;          // 同一の主張候補とみなす重なり率 (§33)
const MAX_TITLE = 100;
const MAX_BODY = 20000;
const MAX_CLAIM_LENGTH = 1000;
const MAX_COMMENT = 200000;

const COLORS = ['blue', 'red', 'green'];                                       // §12
const SCORES = [-2, -1, 0, 1, 2];                                              // §13
const ANNOTATION_TYPES = ['opinion', 'question', 'counter', 'supplement', 'perspective']; // §16
const EVAL_TYPES = ['useful', 'partiallyUseful', 'needsVerification', 'counterEvidence']; // §18
const EVAL_WEIGHT = { useful: 1, partiallyUseful: 0.5, needsVerification: 0, counterEvidence: 0 };

// マルジナリアへの返信 / 私的メモ / 意見の更新履歴 / 主張グラフ
const MAX_DEPTH = 3;                // 返信の深さの上限 (クライアント src/ui.js の MAX_DEPTH と揃える)
const MAX_NOTE = 2000;              // 私的メモの長さ
const MAX_REASON = 200;             // 評価を変えた理由の長さ
const MATCH_MIN_CONTAIN = 8;        // 「含む」と判定する主張の最小文字数
const MATCH_MIN_FUZZY = 6;          // 「似ている」を判定する最小文字数
const GRAPH_SCAN_LIMIT = 1500;      // 主張グラフで照合する主張の最大件数 (プロトタイプ用の全件走査)

// 橋渡しスコア (§23)。評価が少ないものが偶然上位に来ないよう抑制する
const MIN_EVALS = 3;                // これ未満なら橋渡しスコアは 0
const FULL_CONFIDENCE_AT = 10;      // この件数で信頼度が 1.0 になる
// ※ MIN_EVALS はクライアント(src/lib.js)にも同じ値があります。変更時は両方揃えてください。

// ==========================================================
// 共通ユーティリティ
// ==========================================================

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function requireId(value, label = 'ID') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
        throw new HttpError(400, `${label}が正しくありません。`);
    }
    return value;
}

function requireText(value, label, max) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new HttpError(400, `${label}を入力してください。`);
    if (text.length > max) throw new HttpError(400, `${label}は${max}文字以内で入力してください。`);
    return text;
}

function optionalText(value, label, max) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length > max) throw new HttpError(400, `${label}は${max}文字以内で入力してください。`);
    return text;
}

function requireInt(value, label) {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new HttpError(400, `${label}が正しくありません。`);
    return n;
}

function requireOneOf(value, list, label) {
    if (!list.includes(value)) throw new HttpError(400, `${label}が正しくありません。`);
    return value;
}

// 出典URLは http / https のみ許可 (§36: 外部URLはそのまま信頼しない)
function requireHttpUrl(value) {
    let url;
    try {
        url = new URL(String(value || '').trim());
    } catch (e) {
        throw new HttpError(400, 'URLの形式が正しくありません。');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new HttpError(400, 'URLは http または https で始まる必要があります。');
    }
    return url.toString();
}

// ==========================================================
// 認証・レート制限 (§36)
// ==========================================================

const requireAuth = wrap(async (req, res, next) => {
    const match = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!match) throw new HttpError(401, 'ログインが必要です。');
    try {
        req.user = await admin.auth().verifyIdToken(match[1]);
    } catch (e) {
        throw new HttpError(401, '認証に失敗しました。もう一度ログインしてください。');
    }
    next();
});

// ユーザーごとの簡易スライディングウィンドウ。
// メモリ上なので Render の再起動でリセットされます(プロトタイプ用)。
function rateLimit(max, windowMs) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const recent = (hits.get(req.user.uid) || []).filter(t => now - t < windowMs);
        if (recent.length >= max) {
            return res.status(429).json({
                error: '操作が多すぎます。少し待ってからもう一度お試しください。'
            });
        }
        recent.push(now);
        hits.set(req.user.uid, recent);
        next();
    };
}

const limitWrite = rateLimit(40, 60 * 1000);
const limitEval = rateLimit(20, 60 * 1000);
const limitPost = rateLimit(5, 60 * 1000);

// ==========================================================
// 主張範囲の計算 (§33)
// ==========================================================

function iou(a0, a1, b0, b1) {
    const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    const union = Math.max(a1, b1) - Math.min(a0, b0);
    return union > 0 ? inter / union : 0;
}

// 範囲の前後の空白・改行を除く
function trimRange(body, start, end) {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(body[s])) s++;
    while (e > s && /\s/.test(body[e - 1])) e--;
    return [s, e];
}

// ==========================================================
// 主張の照合 (主張グラフ用)
//
// 別々の投稿に書かれた「同じ主張」「主張を含む文」を、文字の一致度で探す簡易版。
// LLM や埋め込みは使わない。表記ゆれ(全角半角・記号・空白)だけ吸収する。
//   same     : 正規化後に一致、または文字2-gramの重なり(Jaccard)が 0.7 以上
//   contains : 一方がもう一方を丸ごと含む (短いほうが MATCH_MIN_CONTAIN 文字以上)
//   similar  : Jaccard が 0.5 以上
// ==========================================================

function normalizeForMatch(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(norm) {
    const set = new Set();
    for (let i = 0; i < norm.length - 1; i += 1) set.add(norm.slice(i, i + 2));
    return set;
}

function matchClaims(a, b) {
    if (!a || !b) return null;
    if (a === b) return { kind: 'same', score: 1 };

    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length >= MATCH_MIN_CONTAIN && long.includes(short)) {
        return { kind: 'contains', score: 0.9 };
    }
    if (short.length < MATCH_MIN_FUZZY) return null;

    const ga = bigrams(a);
    const gb = bigrams(b);
    if (ga.size === 0 || gb.size === 0) return null;
    let inter = 0;
    ga.forEach((g) => { if (gb.has(g)) inter += 1; });
    const jaccard = inter / (ga.size + gb.size - inter);

    if (jaccard >= 0.7) return { kind: 'same', score: jaccard };
    if (jaccard >= 0.5) return { kind: 'similar', score: jaccard };
    return null;
}

function clipText(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ==========================================================
// 橋渡しスコア (§22, §23)
//
// 「反応パターン」の簡易版:
//   評価者がその主張に付けた評価値を 反対(neg) / 保留(neutral) / 賛成(pos) の3群に分ける。
//   これは議論ごとの内部計算であり、ユーザーの属性としては保存・表示しない (§20, §21)。
//
//   Usefulness : 群ごとの有用率の「平均」と「最低値」を半分ずつ混ぜる
//                (人数の多い群に引きずられず、どこかの群で低評価なら大きく下がる)
//   Diversity  : 評価者の群分布の正規化エントロピー(1つの群だけなら 0)
//   Confidence : 評価件数に応じた信頼度
//   Bridge     : 100 × Usefulness × Diversity × Confidence
//
// 主張に自分の評価を入れていない人の有用性評価は、群が決まらないため
// 橋渡し計算から除外します(有用性の件数表示には含まれます)。
// ==========================================================

const patternOf = (score) => (score < 0 ? 'neg' : score > 0 ? 'pos' : 'neutral');

function normalizedEntropy(counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return 0;
    let h = 0;
    for (const c of counts) {
        if (c > 0) {
            const p = c / total;
            h -= p * Math.log(p);
        }
    }
    return h / Math.log(counts.length);
}

function computeBridge(evals, patternByUser) {
    const groups = { neg: { n: 0, s: 0 }, neutral: { n: 0, s: 0 }, pos: { n: 0, s: 0 } };
    let counted = 0;

    for (const ev of evals) {
        const p = patternByUser.get(ev.userId);
        if (!p) continue;
        groups[p].n += 1;
        groups[p].s += EVAL_WEIGHT[ev.type] ?? 0;
        counted += 1;
    }

    // 群ごとの有用率を出し、「群の平均」と「最も低い群」を半分ずつ混ぜる。
    // 平均だけだと、1つの群だけが絶賛しているものが中程度の点になってしまうため。
    const present = Object.values(groups).filter(g => g.n > 0);
    const rates = present.map(g => g.s / g.n);
    const usefulness = rates.length
        ? 0.5 * (rates.reduce((a, b) => a + b, 0) / rates.length) + 0.5 * Math.min(...rates)
        : 0;

    if (counted < MIN_EVALS) {
        return { bridgeScore: 0, usefulness: Math.round(usefulness * 100), evalCount: counted };
    }

    const diversity = normalizedEntropy(Object.values(groups).map(g => g.n));
    const confidence = Math.min(1, counted / FULL_CONFIDENCE_AT);

    return {
        bridgeScore: Math.round(100 * usefulness * diversity * confidence),
        usefulness: Math.round(usefulness * 100),
        evalCount: counted
    };
}

// 1つの主張について、反応の集計と、注釈・出典の橋渡しスコアを再計算する
async function recomputeClaim(claimId) {
    const [reacts, evals, anns, srcs] = await Promise.all([
        db.collection('reactions').where('claimId', '==', claimId).get(),
        db.collection('evaluations').where('claimId', '==', claimId).get(),
        db.collection('annotations').where('claimId', '==', claimId).get(),
        db.collection('sources').where('claimId', '==', claimId).get()
    ]);

    const pattern = new Map();
    const reactionCounts = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
    let revisedCount = 0; // 評価を一度でも更新した人数 (誰がかは保存・表示しない)
    reacts.forEach(d => {
        const r = d.data();
        pattern.set(r.userId, patternOf(r.score));
        reactionCounts[String(r.score)] += 1;
        if ((r.history || []).length > 1) revisedCount += 1;
    });

    const byTarget = new Map();
    evals.forEach(d => {
        const e = d.data();
        const key = `${e.targetType}:${e.targetId}`;
        if (!byTarget.has(key)) byTarget.set(key, []);
        byTarget.get(key).push(e);
    });

    // バッチ上限(500)に対し、1主張あたりの注釈+出典が十分少ない前提(プロトタイプ)
    const batch = db.batch();
    batch.update(db.doc(`claims/${claimId}`), { reactionCounts, reactionTotal: reacts.size, revisedCount });

    const apply = (snap, type) => snap.forEach(d => {
        const list = byTarget.get(`${type}:${d.id}`) || [];
        const result = computeBridge(list, pattern);
        const evalCounts = {};
        list.forEach(e => { evalCounts[e.type] = (evalCounts[e.type] || 0) + 1; });
        batch.update(d.ref, {
            bridgeScore: result.bridgeScore,
            usefulness: result.usefulness,
            evalCount: result.evalCount,
            evalCounts
        });
    });
    apply(anns, 'annotation');
    apply(srcs, 'source');

    await batch.commit();
}

// 投稿のスコア = 橋渡し力の高い上位3件(スコア>0)の平均 (§35 のホーム並び替えに使用)
async function recomputePostStats(postId) {
    const [anns, srcs] = await Promise.all([
        db.collection('annotations').where('postId', '==', postId).get(),
        db.collection('sources').where('postId', '==', postId).get()
    ]);

    const targets = [...anns.docs, ...srcs.docs].map(d => d.data());
    const top = targets
        .map(t => t.bridgeScore || 0)
        .filter(s => s > 0)
        .sort((a, b) => b - a)
        .slice(0, 3);

    const bridgeScore = top.length ? Math.round(top.reduce((a, b) => a + b, 0) / top.length) : 0;
    const evaluationCount = targets.reduce((a, t) => a + (t.evalCount || 0), 0);

    await db.doc(`posts/${postId}`).update({
        bridgeScore,
        evaluationCount,
        lastActivityAt: FieldValue.serverTimestamp()
    });
}

async function afterChange(claimId, postId) {
    await recomputeClaim(claimId);
    await recomputePostStats(postId);
}

async function touchPost(postId) {
    await db.doc(`posts/${postId}`).update({ lastActivityAt: FieldValue.serverTimestamp() });
}

async function displayNameOf(user) {
    const snap = await db.doc(`users/${user.uid}`).get();
    return (snap.exists && snap.data().displayName) || user.name || 'ななしさん';
}

async function loadClaim(claimId) {
    const snap = await db.doc(`claims/${claimId}`).get();
    if (!snap.exists) throw new HttpError(404, '主張が見つかりません。');
    return snap;
}

// ==========================================================
// PUT /api/users/me
// ログイン直後に表示名を登録する。思想・属性は一切保存しない (§32)
// ==========================================================

app.put('/api/users/me', requireAuth, limitWrite, wrap(async (req, res) => {
    const ref = db.doc(`users/${req.user.uid}`);
    const snap = await ref.get();
    const given = optionalText(req.body.displayName, '表示名', 30);

    if (snap.exists && !given) return res.json({ success: true });

    await ref.set({
        displayName: given || req.user.name || 'ななしさん',
        photoURL: req.user.picture || null,
        ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
    }, { merge: true });

    res.json({ success: true });
}));

// ==========================================================
// POST /api/posts
// 投稿作成。本文は原文のまま保存し、投稿後は編集不可
// (主張の範囲を文字位置で記録しているため)
// ==========================================================

app.post('/api/posts', requireAuth, limitPost, wrap(async (req, res) => {
    const title = requireText(req.body.title, 'タイトル', MAX_TITLE);
    const body = requireText(
        String(req.body.body || '').replace(/\r\n?/g, '\n'),
        '本文',
        MAX_BODY
    );

    const ref = db.collection('posts').doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
        authorId: req.user.uid,
        authorName: await displayNameOf(req.user),
        title,
        body,
        visibility: 'public',
        claimCount: 0,
        bridgeScore: 0,
        evaluationCount: 0,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now
    });

    res.json({ success: true, id: ref.id });
}));

// ==========================================================
// POST /api/claims
// 範囲を主張として登録 + 自分の読み跡(マーカー)を記録
//
// 既存の主張と IoU >= 0.8 なら同じ主張候補を共有する (§33)。
// 最初に登録された範囲がその主張の代表範囲になる。
// ==========================================================

app.post('/api/claims', requireAuth, limitWrite, wrap(async (req, res) => {
    const uid = req.user.uid;
    const postId = requireId(req.body.postId, '投稿ID');
    const color = requireOneOf(req.body.color, COLORS, 'マーカー色');
    const rawStart = requireInt(req.body.startIndex, '開始位置');
    const rawEnd = requireInt(req.body.endIndex, '終了位置');

    const postRef = db.doc(`posts/${postId}`);

    const result = await db.runTransaction(async (tx) => {
        const postSnap = await tx.get(postRef);
        if (!postSnap.exists) throw new HttpError(404, '投稿が見つかりません。');
        const post = postSnap.data();

        if (rawStart < 0 || rawEnd > post.body.length || rawStart >= rawEnd) {
            throw new HttpError(400, '選択範囲が正しくありません。');
        }
        const [start, end] = trimRange(post.body, rawStart, rawEnd);
        if (start >= end) throw new HttpError(400, '空白だけの範囲は登録できません。');
        if (end - start > MAX_CLAIM_LENGTH) {
            throw new HttpError(400, `1つの主張は${MAX_CLAIM_LENGTH}文字以内にしてください。`);
        }

        // 読み取りを先にすべて済ませる(Transactionの制約)
        const claimsSnap = await tx.get(db.collection('claims').where('postId', '==', postId));
        let best = null;
        let bestIou = 0;
        claimsSnap.forEach(d => {
            const c = d.data();
            const v = iou(start, end, c.startIndex, c.endIndex);
            if (v >= IOU_THRESHOLD && v > bestIou) {
                best = d;
                bestIou = v;
            }
        });

        const claimRef = best ? best.ref : db.collection('claims').doc();
        const markRef = db.doc(`markings/${uid}_${claimRef.id}`);
        const markSnap = await tx.get(markRef);

        const marking = {
            userId: uid,
            postId,
            claimId: claimRef.id,
            color,
            startIndex: start,
            endIndex: end,
            createdAt: markSnap.exists ? markSnap.data().createdAt : FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        if (best) {
            tx.set(markRef, marking);
            if (!markSnap.exists) tx.update(claimRef, { usageCount: FieldValue.increment(1) });
        } else {
            tx.set(claimRef, {
                postId,
                startIndex: start,
                endIndex: end,
                text: post.body.slice(start, end),
                createdBy: uid,
                createdAt: FieldValue.serverTimestamp(),
                usageCount: 1,
                reactionCounts: { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 },
                reactionTotal: 0,
                annotationCount: 0,
                sourceCount: 0
            });
            tx.set(markRef, marking);
            tx.update(postRef, { claimCount: FieldValue.increment(1) });
        }

        return { claimId: claimRef.id, created: !best };
    });

    await touchPost(postId);
    res.json({ success: true, ...result });
}));

// ==========================================================
// PUT /api/markings/:claimId  マーカー色の変更
// DELETE /api/markings/:claimId  自分の線を消す
// ==========================================================

app.put('/api/markings/:claimId', requireAuth, limitWrite, wrap(async (req, res) => {
    const claimId = requireId(req.params.claimId, '主張ID');
    const color = requireOneOf(req.body.color, COLORS, 'マーカー色');
    const ref = db.doc(`markings/${req.user.uid}_${claimId}`);

    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'この主張にはまだ線を引いていません。');

    await ref.update({ color, updatedAt: FieldValue.serverTimestamp() });
    res.json({ success: true });
}));

app.delete('/api/markings/:claimId', requireAuth, limitWrite, wrap(async (req, res) => {
    const claimId = requireId(req.params.claimId, '主張ID');
    const markRef = db.doc(`markings/${req.user.uid}_${claimId}`);
    const claimRef = db.doc(`claims/${claimId}`);

    await db.runTransaction(async (tx) => {
        const markSnap = await tx.get(markRef);
        const claimSnap = await tx.get(claimRef);
        if (!markSnap.exists) throw new HttpError(404, 'この主張にはまだ線を引いていません。');

        tx.delete(markRef);
        if (claimSnap.exists) tx.update(claimRef, { usageCount: FieldValue.increment(-1) });
    });

    res.json({ success: true });
}));

// ==========================================================
// POST /api/segmentations/adopt
// 「みんなの分割」から1つの分け方を採用する (§10, §30)
// ==========================================================

app.post('/api/segmentations/adopt', requireAuth, limitWrite, wrap(async (req, res) => {
    const uid = req.user.uid;
    const postId = requireId(req.body.postId, '投稿ID');
    const color = requireOneOf(req.body.color || 'blue', COLORS, 'マーカー色');
    const claimIds = Array.isArray(req.body.claimIds) ? [...new Set(req.body.claimIds)] : [];

    if (claimIds.length === 0 || claimIds.length > 50) {
        throw new HttpError(400, '採用する分け方が正しくありません。');
    }
    claimIds.forEach(id => requireId(id, '主張ID'));

    await db.runTransaction(async (tx) => {
        const claimSnaps = await Promise.all(claimIds.map(id => tx.get(db.doc(`claims/${id}`))));
        const markSnaps = await Promise.all(claimIds.map(id => tx.get(db.doc(`markings/${uid}_${id}`))));

        claimSnaps.forEach((claimSnap, i) => {
            if (!claimSnap.exists || claimSnap.data().postId !== postId) {
                throw new HttpError(400, 'この投稿に属さない主張が含まれています。');
            }
            const c = claimSnap.data();
            const markSnap = markSnaps[i];

            tx.set(markSnap.ref, {
                userId: uid,
                postId,
                claimId: claimSnap.id,
                color: markSnap.exists ? markSnap.data().color : color,
                startIndex: c.startIndex,
                endIndex: c.endIndex,
                createdAt: markSnap.exists ? markSnap.data().createdAt : FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            if (!markSnap.exists) tx.update(claimSnap.ref, { usageCount: FieldValue.increment(1) });
        });
    });

    await touchPost(postId);
    res.json({ success: true, adopted: claimIds.length });
}));

// ==========================================================
// PUT /api/claims/:claimId/reaction
// 主張への評価 -2〜+2 と確信度(任意)。変化の履歴は本人だけが見られる (§13, §14, §25)
// 評価の変化に「成功/失敗」の区別は付けない (§26)
//
// 評価を変えたときは、任意で「なぜ考えが変わったか」(note) を履歴に残せる。
// PUT /api/claims/:claimId/reaction/note で、直近の変化に後から理由を書き足せる。
// ==========================================================

app.put('/api/claims/:claimId/reaction', requireAuth, limitWrite, wrap(async (req, res) => {
    const uid = req.user.uid;
    const claimId = requireId(req.params.claimId, '主張ID');
    const score = requireInt(req.body.score, '評価');
    requireOneOf(score, SCORES, '評価');
    const note = optionalText(req.body.note, '理由', MAX_REASON);

    let confidence = null;
    if (req.body.confidence !== null && req.body.confidence !== undefined) {
        confidence = requireInt(req.body.confidence, '確信度');
        if (confidence < 0 || confidence > 100) {
            throw new HttpError(400, '確信度は0〜100で指定してください。');
        }
    }

    const claimSnap = await loadClaim(claimId);
    const postId = claimSnap.data().postId;

    const ref = db.doc(`reactions/${claimId}_${uid}`);
    const prevSnap = await ref.get();
    const prev = prevSnap.exists ? prevSnap.data() : null;

    let history = prev?.history || [];
    if (!prev || prev.score !== score) {
        const entry = { score, at: Timestamp.now() };
        if (note) entry.note = note;
        history = [...history, entry].slice(-100);
    }

    await ref.set({
        claimId,
        postId,
        userId: uid,
        score,
        confidence,
        history,
        createdAt: prev?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });

    await afterChange(claimId, postId);
    res.json({ success: true });
}));

app.put('/api/claims/:claimId/reaction/note', requireAuth, limitWrite, wrap(async (req, res) => {
    const uid = req.user.uid;
    const claimId = requireId(req.params.claimId, '主張ID');
    const note = optionalText(req.body.note, '理由', MAX_REASON);
    const ref = db.doc(`reactions/${claimId}_${uid}`);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const history = snap.exists ? [...(snap.data().history || [])] : [];
        if (history.length === 0) throw new HttpError(404, 'まだこの主張に評価を入れていません。');

        const last = { ...history[history.length - 1] };
        if (note) last.note = note;
        else delete last.note;
        history[history.length - 1] = last;

        tx.update(ref, { history, updatedAt: FieldValue.serverTimestamp() });
    });

    res.json({ success: true });
}));

// ==========================================================
// POST /api/claims/:claimId/annotations  マルジナリア (§15, §16)
//
// parentId を渡すと、他の人(または自分)のマルジナリアへの返信になる。
// 「余白への余白」は MAX_DEPTH 段まで。返信も有用性の評価(橋渡し)の対象。
// ==========================================================

async function createAnnotation({ user, claimSnap, type, body, parentId }) {
    const uid = user.uid;
    const claimId = claimSnap.id;
    const postId = claimSnap.data().postId;

    let depth = 0;
    let parentRef = null;
    if (parentId) {
        parentRef = db.doc(`annotations/${parentId}`);
        const parentSnap = await parentRef.get();
        if (!parentSnap.exists || parentSnap.data().claimId !== claimId) {
            throw new HttpError(404, '返信先のマルジナリアが見つかりません。');
        }
        depth = (parentSnap.data().depth || 0) + 1;
        if (depth > MAX_DEPTH) {
            throw new HttpError(400, 'これ以上深い返信はできません。元の余白に新しく書いてください。');
        }
    }

    // 色は「その人がこの主張に引いた線の色」。賛否ではない (§12)
    const markSnap = await db.doc(`markings/${uid}_${claimId}`).get();

    const ref = db.collection('annotations').doc();
    await ref.set({
        claimId,
        postId,
        authorId: uid,
        authorName: await displayNameOf(user),
        type,
        color: markSnap.exists ? markSnap.data().color : null,
        body,
        parentId: parentId || null,
        depth,
        replyCount: 0,
        bridgeScore: 0,
        usefulness: 0,
        evalCount: 0,
        evalCounts: {},
        createdAt: FieldValue.serverTimestamp()
    });

    if (parentRef) await parentRef.update({ replyCount: FieldValue.increment(1) });
    await claimSnap.ref.update({ annotationCount: FieldValue.increment(1) });
    await touchPost(postId);
    return ref.id;
}

app.post('/api/claims/:claimId/annotations', requireAuth, limitWrite, wrap(async (req, res) => {
    const claimId = requireId(req.params.claimId, '主張ID');
    const type = requireOneOf(req.body.type, ANNOTATION_TYPES, 'コメントの種類');
    const body = requireText(req.body.body, 'コメント', MAX_COMMENT);
    const parentId = req.body.parentId ? requireId(req.body.parentId, '返信先ID') : null;

    const claimSnap = await loadClaim(claimId);
    const id = await createAnnotation({ user: req.user, claimSnap, type, body, parentId });

    res.json({ success: true, id });
}));

// ==========================================================
// 私的マージナリア (自己対話モード)
//
// 本人にだけ見えるメモ。主張、または他の人のマルジナリアに付けられる。
// 集計・橋渡しスコア・ホームの並び順には一切使わない。
// 読み取りはクライアントが Firestore から直接行う
// (firestore.rules で userId が本人のものだけ許可すること)。
//
// POST   /api/private-notes              メモを書く
// PUT    /api/private-notes/:id          メモを直す
// DELETE /api/private-notes/:id          メモを消す
// POST   /api/private-notes/:id/publish  メモを余白(マルジナリア)として公開する
// ==========================================================

const NOTE_TARGETS = ['claim', 'annotation'];

async function loadOwnNote(req) {
    const id = requireId(req.params.id, 'メモID');
    const ref = db.doc(`privateNotes/${id}`);
    const snap = await ref.get();
    // 他人のメモは「存在しない」と同じ扱いにする
    if (!snap.exists || snap.data().userId !== req.user.uid) {
        throw new HttpError(404, 'メモが見つかりません。');
    }
    return { ref, note: snap.data() };
}

app.post('/api/private-notes', requireAuth, limitWrite, wrap(async (req, res) => {
    const uid = req.user.uid;
    const claimId = requireId(req.body.claimId, '主張ID');
    const targetType = requireOneOf(req.body.targetType || 'claim', NOTE_TARGETS, '対象の種類');
    const body = requireText(req.body.body, 'メモ', MAX_NOTE);

    const claimSnap = await loadClaim(claimId);

    let targetId = null;
    if (targetType === 'annotation') {
        targetId = requireId(req.body.targetId, '対象ID');
        const target = await db.doc(`annotations/${targetId}`).get();
        if (!target.exists || target.data().claimId !== claimId) {
            throw new HttpError(404, 'メモを付ける対象が見つかりません。');
        }
    }

    const ref = db.collection('privateNotes').doc();
    await ref.set({
        userId: uid,
        claimId,
        postId: claimSnap.data().postId,
        targetType,
        targetId,
        body,
        publishedAnnotationId: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: ref.id });
}));

app.put('/api/private-notes/:id', requireAuth, limitWrite, wrap(async (req, res) => {
    const { ref } = await loadOwnNote(req);
    const body = requireText(req.body.body, 'メモ', MAX_NOTE);
    await ref.update({ body, updatedAt: FieldValue.serverTimestamp() });
    res.json({ success: true });
}));

app.delete('/api/private-notes/:id', requireAuth, limitWrite, wrap(async (req, res) => {
    const { ref } = await loadOwnNote(req);
    await ref.delete();
    res.json({ success: true });
}));

app.post('/api/private-notes/:id/publish', requireAuth, limitWrite, wrap(async (req, res) => {
    const { ref, note } = await loadOwnNote(req);
    const type = requireOneOf(req.body.type || 'opinion', ANNOTATION_TYPES, 'コメントの種類');
    if (note.publishedAnnotationId) throw new HttpError(400, 'このメモはすでに公開しています。');

    const claimSnap = await loadClaim(note.claimId);
    const parentId = note.targetType === 'annotation' ? note.targetId : null;
    const id = await createAnnotation({ user: req.user, claimSnap, type, body: note.body, parentId });

    // メモ自体は残す(自己対話の記録として)。公開済みの印だけ付ける
    await ref.update({ publishedAnnotationId: id, updatedAt: FieldValue.serverTimestamp() });
    res.json({ success: true, id });
}));

// ==========================================================
// POST /api/claims/:claimId/sources  出典 (§17)
// 資料そのものと投稿者の解釈を分けて保存する
// ==========================================================

app.post('/api/claims/:claimId/sources', requireAuth, limitWrite, wrap(async (req, res) => {
    const uid = req.user.uid;
    const claimId = requireId(req.params.claimId, '主張ID');

    const url = requireHttpUrl(req.body.url);
    const title = requireText(req.body.title, '資料名', 200);
    const evidenceLocation = optionalText(req.body.evidenceLocation, '根拠箇所', 200);
    const description = optionalText(req.body.description, '資料が示していること', 1000);
    const interpretation = optionalText(req.body.interpretation, '解釈', 1000);

    const claimSnap = await loadClaim(claimId);
    const postId = claimSnap.data().postId;

    const ref = db.collection('sources').doc();
    await ref.set({
        claimId,
        postId,
        authorId: uid,
        authorName: await displayNameOf(req.user),
        url,
        title,
        evidenceLocation,
        description,
        interpretation,
        bridgeScore: 0,
        usefulness: 0,
        evalCount: 0,
        evalCounts: {},
        createdAt: FieldValue.serverTimestamp()
    });

    await claimSnap.ref.update({ sourceCount: FieldValue.increment(1) });
    await touchPost(postId);

    res.json({ success: true, id: ref.id });
}));

// ==========================================================
// GET /api/claims/:claimId/graph  主張グラフ
//
// 1つの主張を中心に、次の3つをつなげて返す。
//   related  : 別の投稿に書かれた「同じ / 含む / 似ている」主張
//   sources  : この主張(と、その同じ主張)を支える出典。「反証あり」の評価数つき
//   counters : この主張(と、その同じ主張)への「反論」マルジナリア
// 非公開の投稿の主張は含めない。
// ==========================================================

const limitGraph = rateLimit(20, 60 * 1000);

app.get('/api/claims/:claimId/graph', requireAuth, limitGraph, wrap(async (req, res) => {
    const claimId = requireId(req.params.claimId, '主張ID');
    const centerSnap = await loadClaim(claimId);
    const center = centerSnap.data();
    const centerNorm = normalizeForMatch(center.text);

    // 1. 他の投稿の、同じ・含む・似た主張を探す (プロトタイプ: 直近の主張を全件走査)
    const scan = await db.collection('claims')
        .orderBy('createdAt', 'desc')
        .limit(GRAPH_SCAN_LIMIT)
        .get();

    const matched = [];
    scan.forEach((d) => {
        if (d.id === claimId) return;
        const c = d.data();
        if (c.postId === center.postId) return;
        if ((c.usageCount || 0) <= 0) return;
        const m = matchClaims(centerNorm, normalizeForMatch(c.text));
        if (m) matched.push({ id: d.id, c, kind: m.kind, score: m.score });
    });
    matched.sort((x, y) => y.score - x.score);
    const top = matched.slice(0, 12);

    const postIds = [...new Set(top.map((t) => t.c.postId))];
    const postSnaps = await Promise.all(postIds.map((id) => db.doc(`posts/${id}`).get()));
    const posts = new Map();
    postSnaps.forEach((p) => {
        if (p.exists && p.data().visibility === 'public') posts.set(p.id, p.data());
    });

    const related = top
        .filter((t) => posts.has(t.c.postId))
        .map((t) => ({
            id: t.id,
            postId: t.c.postId,
            postTitle: posts.get(t.c.postId).title,
            text: clipText(t.c.text, 160),
            kind: t.kind,
            score: Math.round(t.score * 100) / 100,
            usageCount: t.c.usageCount || 0,
            reactionTotal: t.c.reactionTotal || 0,
            reactionCounts: t.c.reactionCounts || {}
        }));

    // 2. 出典と反論 (この主張 + 同じ主張にぶら下がるもの)
    const ids = [claimId, ...related.map((r) => r.id)];
    const [srcSnap, annSnap] = await Promise.all([
        db.collection('sources').where('claimId', 'in', ids).get(),
        db.collection('annotations').where('claimId', 'in', ids).get()
    ]);

    const sources = srcSnap.docs
        .map((d) => {
            const x = d.data();
            const counts = x.evalCounts || {};
            return {
                id: d.id,
                claimId: x.claimId,
                postId: x.postId,
                title: x.title,
                url: x.url,
                authorName: x.authorName || 'ななしさん',
                evidenceLocation: x.evidenceLocation || '',
                bridgeScore: x.bridgeScore || 0,
                evalCount: x.evalCount || 0,
                useful: (counts.useful || 0) + (counts.partiallyUseful || 0),
                counterEvidence: counts.counterEvidence || 0
            };
        })
        .sort((x, y) => y.bridgeScore - x.bridgeScore || y.useful - x.useful)
        .slice(0, 20);

    const counters = annSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => x.type === 'counter')
        .map((x) => ({
            id: x.id,
            claimId: x.claimId,
            postId: x.postId,
            authorName: x.authorName || 'ななしさん',
            body: clipText(x.body, 140),
            bridgeScore: x.bridgeScore || 0
        }))
        .sort((x, y) => y.bridgeScore - x.bridgeScore)
        .slice(0, 12);

    res.json({
        claim: { id: claimId, postId: center.postId, text: clipText(center.text, 160) },
        related,
        sources,
        counters,
        truncated: scan.size >= GRAPH_SCAN_LIMIT
    });
}));

// ==========================================================
// PUT /api/evaluations         有用性の評価 (§18, §19)
// DELETE /api/evaluations/:targetType/:targetId  評価の取り消し
//
// 主張への賛否(reactions)とは完全に別データ。
// 自分の投稿への評価は禁止 (§36)。
// ==========================================================

const TARGET_COLLECTION = { annotation: 'annotations', source: 'sources' };

async function loadTarget(targetType, targetId) {
    const collectionName = TARGET_COLLECTION[targetType];
    if (!collectionName) throw new HttpError(400, '評価対象の種類が正しくありません。');
    requireId(targetId, '評価対象ID');

    const snap = await db.doc(`${collectionName}/${targetId}`).get();
    if (!snap.exists) throw new HttpError(404, '評価対象が見つかりません。');
    return snap;
}

app.put('/api/evaluations', requireAuth, limitEval, wrap(async (req, res) => {
    const uid = req.user.uid;
    const { targetType, targetId } = req.body;
    const type = requireOneOf(req.body.type, EVAL_TYPES, '評価の種類');

    const target = await loadTarget(targetType, targetId);
    const t = target.data();

    if (t.authorId === uid) {
        throw new HttpError(403, '自分が書いたものは自分で評価できません。');
    }

    await db.doc(`evaluations/${targetType}_${targetId}_${uid}`).set({
        targetType,
        targetId,
        claimId: t.claimId,
        postId: t.postId,
        userId: uid,
        type,
        updatedAt: FieldValue.serverTimestamp()
    });

    await afterChange(t.claimId, t.postId);
    res.json({ success: true });
}));

app.delete('/api/evaluations/:targetType/:targetId', requireAuth, limitEval, wrap(async (req, res) => {
    const uid = req.user.uid;
    const { targetType, targetId } = req.params;
    const target = await loadTarget(targetType, targetId);
    const t = target.data();

    await db.doc(`evaluations/${targetType}_${targetId}_${uid}`).delete();

    await afterChange(t.claimId, t.postId);
    res.json({ success: true });
}));

// ==========================================================
// ヘルスチェック
// ==========================================================

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'nameraka-sns-server' });
});

// ==========================================================
// エラーハンドラ
// ==========================================================

app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
    }
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
        return res.status(400).json({ error: 'リクエストの形式が正しくありません。' });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'サーバーでエラーが発生しました。' });
});

// ==========================================================
// サーバー起動
// ==========================================================

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// テスト用に純粋関数を公開
module.exports = {
    app, iou, trimRange, computeBridge, normalizedEntropy, patternOf,
    normalizeForMatch, matchClaims
};