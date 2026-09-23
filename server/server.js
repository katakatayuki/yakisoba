const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const app = express();

// ==========================================================
// サーバー設定
// ==========================================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT']
}));

app.use(express.json());

// Firebaseの初期化
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (e) {
    console.error("Firebase initialization failed. Check FIREBASE_SERVICE_ACCOUNT variable.");
    process.exit(1);
}

const db = admin.firestore();

// ==========================================================
// 日時ユーティリティ（すべて日本時間 = JST基準で扱う）
// ==========================================================
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');

// サーバーがどのタイムゾーンで動いていても、JSTの「壁時計時刻」を取得する
function nowJST() {
    return new Date(Date.now() + JST_OFFSET_MS);
}

function getTodayStringJST() {
    const d = nowJST();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// 現在時刻を「その日の何分目か」に変換（0:00を0分とする）
function getNowMinutesJST() {
    const d = nowJST();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// "HH:MM" 形式の文字列を分に変換
function timeToMinutes(time) {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [h, m] = time.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
}

// ==========================================================
// LINE Push/Reply ユーティリティ
// ==========================================================

async function sendLinePush(toUserId, messageText) {
    if (!process.env.LINE_ACCESS_TOKEN) {
        console.error("LINE_ACCESS_TOKEN is not set.");
        return;
    }
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            to: toUserId,
            messages: [{ type: 'text', text: messageText }]
        })
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.error('LINE push failed:', res.status, errorText);
    }
}

async function sendLineReply(replyToken, messageText) {
    if (!process.env.LINE_ACCESS_TOKEN) return;

    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            replyToken: replyToken,
            messages: [{ type: 'text', text: messageText }]
        })
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.error('LINE reply failed:', res.status, errorText);
    }
}

// ==========================================================
// 予約コードの発行
// 予約1件ごとに4桁のコードを発行し、当日分で重複しないようにする
// （団体・連番制は廃止。時間割制のもとでは予約1件＝1コードで十分）
// ==========================================================
async function generateUniqueReservationCode(reservationDate) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const code = String(Math.floor(1000 + Math.random() * 9000)); // 1000〜9999

        const existing = await db.collection('reservations')
            .where('reservationDate', '==', reservationDate)
            .where('reservationCode', '==', code)
            .limit(1)
            .get();

        if (existing.empty) return code;
    }
    // 20回試しても衝突する場合はタイムスタンプ由来のコードにフォールバック
    return String(Date.now()).slice(-4);
}

// ==========================================================
// LINE Webhookイベント処理
// ==========================================================
async function processLineWebhookEvents(events) {
    const today = getTodayStringJST();

    for (const event of events) {
        const lineUserId = event.source?.userId;
        const replyToken = event.replyToken;
        const inputText = (event.type === 'message' && event.message.type === 'text')
            ? event.message.text.trim()
            : null;

        // -----------------------------------------------------
        // 1. 友だち追加時
        // -----------------------------------------------------
        if (event.type === 'follow') {
            const message = 'このたびは友だち追加いただき、誠にありがとうございます！\n\nご予約時間が近づいたら、こちらのLINEでお知らせいたします。\n\n通知を受け取るには、予約完了画面に表示された「予約コード（4桁）」をこのトークに送信してください。\n例: 3821';
            await sendLineReply(replyToken, message);
            continue;
        }

        if (event.type !== 'message' || event.message.type !== 'text') continue;

        // -----------------------------------------------------
        // 2. 「はい」= 別アカウントへの紐づけ変更を承認
        // -----------------------------------------------------
        if (inputText === 'はい') {
            const pendingSnap = await db.collection('reservations')
                .where('pendingLineUserId', '==', lineUserId)
                .limit(1)
                .get();

            if (pendingSnap.empty) {
                await sendLineReply(replyToken, '変更を保留中の予約コードが見つかりませんでした。もう一度、予約コードを送信してください。');
                continue;
            }

            const docRef = pendingSnap.docs[0].ref;
            const data = pendingSnap.docs[0].data();

            await docRef.update({
                lineUserId: lineUserId,
                pendingLineUserId: admin.firestore.FieldValue.delete(),
                reminderSentAt: null, // 紐づけ先が変わったので通知状態をリセット
            });

            await sendLineReply(
                replyToken,
                `予約コード ${data.reservationCode}（${data.slotStart}〜${data.slotEnd}）の通知先を、このアカウントに変更しました。`
            );
            continue;
        }

        // -----------------------------------------------------
        // 3. 4桁の予約コード入力
        // -----------------------------------------------------
        if (!/^\d{4}$/.test(inputText)) {
            await sendLineReply(
                replyToken,
                '予約完了画面に表示されている「予約コード（4桁の数字）」を送信してください。\n例: 3821'
            );
            continue;
        }

        const reservationSnap = await db.collection('reservations')
            .where('reservationDate', '==', today)
            .where('reservationCode', '==', inputText)
            .limit(1)
            .get();

        if (reservationSnap.empty) {
            await sendLineReply(
                replyToken,
                `予約コード ${inputText} が見つかりませんでした。本日分の予約コードか、入力に誤りがないかご確認ください。`
            );
            continue;
        }

        const doc = reservationSnap.docs[0];
        const data = doc.data();
        const docRef = doc.ref;

        if (data.status === 'used') {
            await sendLineReply(replyToken, `予約コード ${inputText} はすでに利用済みです。`);
            continue;
        }

        if (data.lineUserId) {
            if (data.lineUserId === lineUserId) {
                await sendLineReply(
                    replyToken,
                    `予約コード ${inputText}（${data.slotStart}〜${data.slotEnd}）は、すでにこのアカウントに連携済みです。`
                );
            } else {
                await sendLineReply(
                    replyToken,
                    `予約コード ${inputText}（${data.slotStart}〜${data.slotEnd}）は、既に別のLINEアカウントに連携されています。\n\nこのアカウントに変更しますか？\n変更する場合は【はい】と返信してください。`
                );
                await docRef.update({ pendingLineUserId: lineUserId });
            }
            continue;
        }

        // 新規紐づけ
        await docRef.update({ lineUserId: lineUserId });

        await sendLineReply(
            replyToken,
            `連携しました！\n\nご予約時間：${data.slotStart}〜${data.slotEnd}\nお名前：${data.name}様\n\nお時間の${data.notifyBeforeMinutes ?? 10}分前にこちらのLINEでお知らせします。`
        );
    }
}

// ==========================================================
// POST /api/line-webhook
// ==========================================================
app.post('/api/line-webhook', async (req, res) => {
    if (!process.env.LINE_ACCESS_TOKEN) {
        console.error("LINE_ACCESS_TOKEN is missing.");
        return res.sendStatus(500);
    }

    // LINEの応答期限（3秒）を守るため、先に200を返す
    res.sendStatus(200);

    try {
        const events = req.body.events;
        if (events && events.length > 0) {
            processLineWebhookEvents(events).catch((e) => {
                console.error("Error processing LINE webhook events:", e);
            });
        }
    } catch (e) {
        console.error("Error reading LINE webhook body:", e);
    }
});

// ==========================================================
// POST /api/reservations/:id/line
// Reception.js から「LINEで通知を受け取る」を選択して予約した直後に呼ばれる。
// 予約コードを発行し、通知のための情報をFirestoreに保存する。
// ==========================================================
app.post('/api/reservations/:id/line', async (req, res) => {
    try {
        const { id } = req.params;
        const { reservationDate, slotStart, slotEnd, name, people, notifyBeforeMinutes } = req.body;

        const reservationRef = db.collection('reservations').doc(id);
        const snap = await reservationRef.get();

        if (!snap.exists) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        const effectiveDate = reservationDate || snap.data().reservationDate || getTodayStringJST();
        const reservationCode = await generateUniqueReservationCode(effectiveDate);

        await reservationRef.update({
            wantsLine: true,
            reservationCode,
            notifyBeforeMinutes: Number.isFinite(Number(notifyBeforeMinutes))
                ? Number(notifyBeforeMinutes)
                : 10,
            reminderSentAt: null,
            // 念のためslot情報も同期しておく（Reception.js側の値を正とする）
            ...(slotStart ? { slotStart } : {}),
            ...(slotEnd ? { slotEnd } : {}),
            ...(name ? { name } : {}),
            ...(people ? { people: Number(people) } : {}),
        });

        res.json({ success: true, reservationCode });
    } catch (e) {
        console.error('Error issuing reservation code:', e);
        res.status(500).json({ error: 'Failed to issue reservation code' });
    }
});

// ==========================================================
// PUT /api/reservations/:id/status/entryGuidance
// Admin.js の「📢 入場案内」ボタンから呼ばれる。
// ステータス変更自体はAdmin.js側でFirestoreに直接反映されるため、
// ここではLINE連携済みなら「今すぐ受付にお越しください」を即時プッシュする。
// ==========================================================
app.put('/api/reservations/:id/status/entryGuidance', async (req, res) => {
    try {
        if (req.body.apiSecret !== process.env.API_SECRET) {
            return res.status(403).send('forbidden');
        }

        const { id } = req.params;
        const snap = await db.collection('reservations').doc(id).get();

        if (!snap.exists) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        const data = snap.data();

        if (data.wantsLine && data.lineUserId) {
            const text = `ご準備ができました！\n${data.name}様（${data.slotStart}〜${data.slotEnd}）\n受付までお越しください。`;
            sendLinePush(data.lineUserId, text).catch((e) => console.error('entryGuidance push failed:', e));
        }

        res.json({ success: true, id });
    } catch (e) {
        console.error(`Error in entryGuidance notification for ${req.params.id}:`, e);
        res.status(500).send('Notification failed.');
    }
});

// ==========================================================
// 事前リマインド送信（時間割ベースの自動チェック）
// 「予約時間 − 何分前に通知するか」を過ぎたら、まだ送っていない
// LINE連携済み予約に対してプッシュ通知を送る。
// ==========================================================
async function checkAndSendReminders() {
    try {
        const today = getTodayStringJST();
        const nowMinutes = getNowMinutesJST();

        const snap = await db.collection('reservations')
            .where('reservationDate', '==', today)
            .where('wantsLine', '==', true)
            .get();

        const tasks = [];

        snap.forEach((docSnap) => {
            const data = docSnap.data();

            if (data.status !== 'reserved') return; // 入場案内済み・利用済みは対象外
            if (!data.lineUserId) return; // LINE未連携
            if (data.reminderSentAt) return; // 送信済み
            if (!data.slotStart) return;

            const slotMinutes = timeToMinutes(data.slotStart);
            if (slotMinutes === null) return;

            const notifyBefore = Number.isFinite(Number(data.notifyBeforeMinutes))
                ? Number(data.notifyBeforeMinutes)
                : 10;
            const targetMinutes = slotMinutes - notifyBefore;

            if (nowMinutes >= targetMinutes) {
                const text = `まもなくご予約のお時間です。\n\nご予約時間：${data.slotStart}〜${data.slotEnd}\nお名前：${data.name}様\n\n受付までお越しください。`;

                tasks.push(
                    sendLinePush(data.lineUserId, text)
                        .then(() => docSnap.ref.update({
                            reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
                        }))
                        .catch((e) => console.error(`Reminder push failed for ${docSnap.id}:`, e))
                );
            }
        });

        await Promise.all(tasks);
    } catch (e) {
        console.error('checkAndSendReminders failed:', e);
    }
}

const REMINDER_CHECK_INTERVAL_MS = 60 * 1000; // 1分ごとにチェック
setInterval(checkAndSendReminders, REMINDER_CHECK_INTERVAL_MS);
checkAndSendReminders(); // 起動直後にも一度実行

// ==========================================================
// GET /api/reservations（管理用・任意）
// ==========================================================
app.get('/api/reservations', async (req, res) => {
    try {
        const snap = await db.collection('reservations')
            .orderBy('createdAt', 'desc')
            .limit(200)
            .get();

        const reservations = snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        res.json(reservations);
    } catch (e) {
        console.error('Error fetching reservations:', e);
        res.status(500).json({ error: 'Failed to fetch reservations' });
    }
});

// ==========================================================
// DELETE /api/reservations/:id（管理用・任意）
// ==========================================================
app.delete('/api/reservations/:id', async (req, res) => {
    try {
        if (req.body.apiSecret !== process.env.API_SECRET) {
            return res.status(403).send('forbidden');
        }

        const { id } = req.params;
        await db.collection('reservations').doc(id).delete();

        res.json({ success: true, id });
    } catch (e) {
        console.error(`Error deleting reservation ${req.params.id}:`, e);
        res.status(500).send('Reservation deletion failed.');
    }
});

// サーバーの待ち受け開始
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));