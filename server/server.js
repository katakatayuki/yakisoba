const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT']
}));
app.use(express.json({ limit: '50kb' }));

// ==========================================================
// Firebase 初期化（既存のまま）
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
const { FieldValue } = admin.firestore;

const COLORS = ['blue', 'red', 'green']; // 青=共感 / 赤=反対 / 緑=疑問
const MAX_TEXT = 1000;

// ==========================================================
// 共通
// ==========================================================

// フロントの Firebase 匿名ログインで得た ID トークンを検証する
async function auth(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'ログインが必要です。' });
    try {
        req.uid = (await admin.auth().verifyIdToken(m[1])).uid;
        next();
    } catch {
        res.status(401).json({ error: '認証に失敗しました。' });
    }
}

const wrap = (fn) => (req, res) =>
    fn(req, res).catch((e) => {
        console.error(e);
        res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    });

const ms = (v) => v?.toMillis?.() ?? null;

const postOut = (d) => {
    const x = d.data();
    return {
        id: d.id,
        text: x.text,
        authorName: x.authorName,
        annotationCount: x.annotationCount || 0,
        createdAt: ms(x.createdAt)
    };
};

const annOut = (d) => {
    const { uid, start, end, color, score, note } = d.data();
    return { id: d.id, uid, start, end, color, score, note };
};

// ==========================================================
// 投稿
// 投稿は編集不可。編集を許すと注釈の文字位置(start/end)がずれるため。
// ==========================================================

app.get('/api/posts', auth, wrap(async (req, res) => {
    const snap = await db.collection('posts')
        .orderBy('createdAt', 'desc').limit(50).get();
    res.json(snap.docs.map(postOut));
}));

app.post('/api/posts', auth, wrap(async (req, res) => {
    const text = String(req.body.text ?? '').trim();
    if (!text || text.length > MAX_TEXT) {
        return res.status(400).json({ error: `本文は1〜${MAX_TEXT}文字で入力してください。` });
    }
    const ref = await db.collection('posts').add({
        text,
        authorId: req.uid,
        authorName: 'user-' + req.uid.slice(0, 4),
        annotationCount: 0,
        createdAt: FieldValue.serverTimestamp()
    });
    res.json({ id: ref.id });
}));

// 投稿 + 全員の注釈（ヒートマップはフロントで集計）
app.get('/api/posts/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('posts').doc(req.params.id);
    const [post, anns] = await Promise.all([ref.get(), ref.collection('annotations').get()]);
    if (!post.exists) return res.status(404).json({ error: '投稿が見つかりません。' });
    res.json({ post: postOut(post), annotations: anns.docs.map(annOut) });
}));

// ==========================================================
// 注釈（マーカー + なめらかな評価 + 自分の意見）
// ==========================================================

app.post('/api/posts/:id/annotations', auth, wrap(async (req, res) => {
    const ref = db.collection('posts').doc(req.params.id);
    const post = await ref.get();
    if (!post.exists) return res.status(404).json({ error: '投稿が見つかりません。' });

    const len = post.data().text.length;
    const start = parseInt(req.body.start, 10);
    const end = parseInt(req.body.end, 10);
    const score = Math.round(Number(req.body.score));
    const color = req.body.color;
    const note = String(req.body.note ?? '').trim().slice(0, 500);

    if (!(start >= 0 && end > start && end <= len)) {
        return res.status(400).json({ error: '範囲が正しくありません。' });
    }
    if (!COLORS.includes(color) || !(score >= 0 && score <= 100)) {
        return res.status(400).json({ error: '色または評価が正しくありません。' });
    }

    const aRef = ref.collection('annotations').doc();
    const batch = db.batch();
    batch.set(aRef, {
        uid: req.uid, start, end, color, score, note,
        createdAt: FieldValue.serverTimestamp()
    });
    batch.update(ref, { annotationCount: FieldValue.increment(1) });
    await batch.commit();

    res.json({ id: aRef.id });
}));

app.delete('/api/posts/:id/annotations/:aid', auth, wrap(async (req, res) => {
    const ref = db.collection('posts').doc(req.params.id);
    const aRef = ref.collection('annotations').doc(req.params.aid);
    const a = await aRef.get();
    if (!a.exists) return res.status(404).json({ error: '見つかりません。' });
    if (a.data().uid !== req.uid) return res.status(403).json({ error: '自分の注釈だけ削除できます。' });

    const batch = db.batch();
    batch.delete(aRef);
    batch.update(ref, { annotationCount: FieldValue.increment(-1) });
    await batch.commit();

    res.json({ ok: true });
}));

app.get('/', (req, res) => res.send('nameraka-sns api'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
