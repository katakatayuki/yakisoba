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

// ==========================================================
// Firebase 初期化
// ==========================================================

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

} catch (e) {
    console.error(
        'Firebase initialization failed. Check FIREBASE_SERVICE_ACCOUNT variable.'
    );
    console.error(e);
    process.exit(1);
}

const db = admin.firestore();

const COUNTER_DOC = 'settings/counters';

// ==========================================================
// LINE Push
// ==========================================================

async function sendLinePush(toUserId, messageText) {

    if (!process.env.LINE_ACCESS_TOKEN) {
        console.error('LINE_ACCESS_TOKEN is not set.');
        return;
    }

    try {
        const res = await fetch(
            'https://api.line.me/v2/bot/message/push',
            {
                method: 'POST',
                headers: {
                    Authorization:
                        `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    to: toUserId,
                    messages: [
                        {
                            type: 'text',
                            text: messageText
                        }
                    ]
                })
            }
        );

        if (!res.ok) {
            const errorText = await res.text();
            console.error(
                'LINE push failed:',
                res.status,
                errorText
            );
        }

    } catch (error) {
        console.error('LINE push error:', error);
    }
}

// ==========================================================
// LINE Reply
// ==========================================================

async function sendLineReply(replyToken, messageText) {

    if (!process.env.LINE_ACCESS_TOKEN) {
        return;
    }

    try {
        const res = await fetch(
            'https://api.line.me/v2/bot/message/reply',
            {
                method: 'POST',
                headers: {
                    Authorization:
                        `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    replyToken,
                    messages: [
                        {
                            type: 'text',
                            text: messageText
                        }
                    ]
                })
            }
        );

        if (!res.ok) {
            const errorText = await res.text();

            console.error(
                'LINE reply failed:',
                res.status,
                errorText
            );
        }

    } catch (error) {
        console.error('LINE reply error:', error);
    }
}

// ==========================================================
// LINE Webhook
// ==========================================================

async function processLineWebhookEvents(events) {

    for (const event of events) {

        const lineUserId =
            event.source?.userId;

        const replyToken =
            event.replyToken;

        const inputText =
            event.type === 'message' &&
            event.message?.type === 'text'
                ? event.message.text.trim()
                : null;

        // --------------------------------------------------
        // 友だち追加
        // --------------------------------------------------

        if (event.type === 'follow') {

            await sendLineReply(
                replyToken,
                '友だち追加ありがとうございます！\n受付番号をメッセージで送信してください。例: 1'
            );

            continue;
        }

        // --------------------------------------------------
        // 「はい」
        // --------------------------------------------------

        if (
            event.type === 'message' &&
            inputText === 'はい'
        ) {

            const pendingSnap =
                await db.collection('reservations')
                    .where(
                        'pendingLineUserId',
                        '==',
                        lineUserId
                    )
                    .where(
                        'status',
                        '==',
                        'waiting'
                    )
                    .limit(1)
                    .get();

            if (pendingSnap.empty) {

                await sendLineReply(
                    replyToken,
                    '変更を保留中の受付番号が見つかりませんでした。'
                );

                continue;
            }

            const reservationDoc =
                pendingSnap.docs[0];

            const reservationNumber =
                reservationDoc.data().number;

            await reservationDoc.ref.update({

                lineUserId,

                pendingLineUserId:
                    admin.firestore.FieldValue.delete()

            });

            await sendLineReply(
                replyToken,
                `番号 ${reservationNumber} の通知先を、このLINEアカウントに変更しました！`
            );

            continue;
        }

        // --------------------------------------------------
        // 受付番号入力
        // --------------------------------------------------

        if (
            event.type === 'message' &&
            event.message?.type === 'text'
        ) {

            const reservationNumber =
                parseInt(inputText, 10);

            if (
                isNaN(reservationNumber) ||
                reservationNumber <= 0
            ) {

                await sendLineReply(
                    replyToken,
                    '受付番号を半角数字で入力してください。例: 1'
                );

                continue;
            }

            const reservationSnap =
                await db.collection('reservations')
                    .where(
                        'number',
                        '==',
                        reservationNumber
                    )
                    .where(
                        'status',
                        'in',
                        ['waiting', 'called']
                    )
                    .limit(1)
                    .get();

            if (reservationSnap.empty) {

                await sendLineReply(
                    replyToken,
                    `番号 ${reservationNumber} の予約が見つかりませんでした。`
                );

                continue;
            }

            const reservationDoc =
                reservationSnap.docs[0];

            const data =
                reservationDoc.data();

            // すでにLINE登録済み
            if (data.lineUserId) {

                if (
                    data.lineUserId === lineUserId
                ) {

                    await sendLineReply(
                        replyToken,
                        `番号 ${reservationNumber} は、すでにこのLINEに登録されています。`
                    );

                } else {

                    await reservationDoc.ref.update({
                        pendingLineUserId: lineUserId
                    });

                    await sendLineReply(
                        replyToken,
                        `番号 ${reservationNumber} は別のLINEに登録されています。\n変更する場合は「はい」と返信してください。`
                    );
                }

                continue;
            }

            // 新規登録
            await reservationDoc.ref.update({
                lineUserId
            });

            await sendLineReply(
                replyToken,
                `番号 ${reservationNumber} をこのLINEに登録しました！準備ができたら通知します。`
            );
        }
    }
}

// ==========================================================
// POST /api/reserve
//
// Reception.js から呼ばれる予約API
// ==========================================================

app.post('/api/reserve', async (req, res) => {

    try {

        const {
            name,
            quantity,
            items,
            wantsLine,
            lineUserId
        } = req.body;

        // --------------------------------------------------
        // 入力チェック
        // --------------------------------------------------

        if (!name || !name.trim()) {

            return res.status(400).json({
                error: '氏名を入力してください。'
            });
        }

        const numQuantity =
            parseInt(quantity, 10);

        if (
            isNaN(numQuantity) ||
            numQuantity <= 0
        ) {

            return res.status(400).json({
                error: '数量は1以上で指定してください。'
            });
        }

        // --------------------------------------------------
        // Firestore Transaction
        // --------------------------------------------------

        const newNumber =
            await db.runTransaction(async (transaction) => {

                const counterRef =
                    db.doc(COUNTER_DOC);

                const counterDoc =
                    await transaction.get(counterRef);

                let currentNumber = 1;

                if (counterDoc.exists) {

                    const data =
                        counterDoc.data();

                    if (
                        typeof data.currentNumber ===
                        'number'
                    ) {

                        currentNumber =
                            data.currentNumber + 1;
                    }
                }

                // カウンター更新
                transaction.set(
                    counterRef,
                    {
                        currentNumber,
                        updatedAt:
                            admin.firestore.FieldValue.serverTimestamp()
                    },
                    {
                        merge: true
                    }
                );

                // 予約作成
                const reservationRef =
                    db.collection('reservations').doc();

                transaction.set(
                    reservationRef,
                    {
                        number: currentNumber,

                        name: name.trim(),

                        quantity: numQuantity,

                        items:
                            items || {
                                yakisoba: numQuantity
                            },

                        wantsLine:
                            !!wantsLine,

                        lineUserId:
                            lineUserId || null,

                        status: 'waiting',

                        createdAt:
                            admin.firestore.FieldValue.serverTimestamp(),

                        calledAt: null
                    }
                );

                return currentNumber;
            });

        console.log(
            `Reservation created: ${newNumber}`
        );

        // --------------------------------------------------
        // Reception.jsへJSONを返す
        // --------------------------------------------------

        return res.json({
            success: true,
            number: newNumber
        });

    } catch (error) {

        console.error(
            'Error creating reservation:',
            error
        );

        return res.status(500).json({
            error: '予約の登録に失敗しました。'
        });
    }
});

// ==========================================================
// POST /api/line-webhook
// ==========================================================

app.post('/api/line-webhook', async (req, res) => {

    if (
        !process.env.LINE_ACCESS_TOKEN
    ) {

        console.error(
            'LINE_ACCESS_TOKEN is missing.'
        );

        return res.sendStatus(500);
    }

    // LINEには即座に200を返す
    res.sendStatus(200);

    try {

        const events =
            req.body.events;

        if (
            events &&
            events.length > 0
        ) {

            processLineWebhookEvents(events)
                .catch(error => {
                    console.error(
                        'LINE event processing error:',
                        error
                    );
                });
        }

    } catch (error) {

        console.error(
            'LINE webhook error:',
            error
        );
    }
});

// ==========================================================
// POST /api/compute-call
//
// 管理側から呼び出し番号を決定
// ==========================================================

app.post('/api/compute-call', async (req, res) => {

    try {

        if (
            req.body.apiSecret !==
            process.env.API_SECRET
        ) {

            return res
                .status(403)
                .send('forbidden');
        }

        const availablePeople =
            parseInt(
                req.body.availableCount,
                10
            );

        if (
            isNaN(availablePeople) ||
            availablePeople <= 0
        ) {

            return res
                .status(400)
                .send(
                    'bad available'
                );
        }

        const waitingSnap =
            await db.collection('reservations')
                .where(
                    'status',
                    '==',
                    'waiting'
                )
                .orderBy(
                    'createdAt',
                    'asc'
                )
                .get();

        let totalNeeded = 0;

        const selected = [];

        waitingSnap.forEach(doc => {

            if (
                totalNeeded >=
                availablePeople
            ) {
                return;
            }

            const data =
                doc.data();

            const need =
                data.quantity || 1;

            if (
                totalNeeded + need <=
                availablePeople
            ) {

                totalNeeded += need;

                selected.push({
                    id: doc.id,
                    data
                });
            }
        });

        if (selected.length === 0) {

            return res.json({
                success: true,
                called: [],
                totalNeeded: 0
            });
        }

        const batch =
            db.batch();

        const now =
            admin.firestore.FieldValue.serverTimestamp();

        const calledNumbers = [];

        selected.forEach(item => {

            const reservationNumber =
                item.data.number;

            const reservationRef =
                db.collection('reservations')
                    .doc(item.id);

            batch.update(
                reservationRef,
                {
                    status: 'called',
                    calledAt: now
                }
            );

            calledNumbers.push(
                reservationNumber
            );

            // LINE通知
            if (
                item.data.wantsLine &&
                item.data.lineUserId
            ) {

                const message =
                    `ご準備ができました。番号 ${reservationNumber} のお客様は受付までお戻りください。`;

                sendLinePush(
                    item.data.lineUserId,
                    message
                ).catch(error => {
                    console.error(
                        'LINE notification error:',
                        error
                    );
                });
            }
        });

        await batch.commit();

        return res.json({
            success: true,
            called: calledNumbers,
            totalNeeded
        });

    } catch (error) {

        console.error(
            'CRITICAL ERROR IN COMPUTE-CALL:',
            error
        );

        return res
            .status(500)
            .send(
                'Internal Server Error'
            );
    }
});

// ==========================================================
// GET /api/reservations
//
// 管理画面用
// ==========================================================

app.get('/api/reservations', async (req, res) => {

    try {

        const snap =
            await db.collection('reservations')
                .orderBy(
                    'createdAt',
                    'desc'
                )
                .limit(100)
                .get();

        const reservations =
            snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

        return res.json(
            reservations
        );

    } catch (error) {

        console.error(
            'Error fetching reservations:',
            error
        );

        return res.status(500).json({
            error:
                'Failed to fetch reservations'
        });
    }
});

// ==========================================================
// PUT /api/reservations/:id
// ==========================================================

app.put('/api/reservations/:id', async (req, res) => {

    try {

        if (
            req.body.apiSecret !==
            process.env.API_SECRET
        ) {

            return res
                .status(403)
                .send('forbidden');
        }

        const { id } =
            req.params;

        const { status } =
            req.body;

        const validStatuses = [
            'waiting',
            'called',
            'seatEnter',
            'cancel'
        ];

        if (
            !validStatuses.includes(status)
        ) {

            return res
                .status(400)
                .send(
                    'Invalid status value.'
                );
        }

        const reservationRef =
            db.collection('reservations')
                .doc(id);

        const updateData = {
            status
        };

        if (status === 'called') {

            updateData.calledAt =
                admin.firestore.FieldValue.serverTimestamp();

        } else if (
            status === 'waiting' ||
            status === 'cancel'
        ) {

            updateData.calledAt = null;
        }

        await reservationRef.update(
            updateData
        );

        return res.json({
            success: true,
            id,
            newStatus: status
        });

    } catch (error) {

        console.error(
            'Error updating reservation:',
            error
        );

        return res.status(500).send(
            'Status update failed.'
        );
    }
});

// ==========================================================
// DELETE /api/reservations/:id
// ==========================================================

app.delete('/api/reservations/:id', async (req, res) => {

    try {

        if (
            req.body.apiSecret !==
            process.env.API_SECRET
        ) {

            return res
                .status(403)
                .send('forbidden');
        }

        const { id } =
            req.params;

        await db
            .collection('reservations')
            .doc(id)
            .delete();

        return res.json({
            success: true,
            id
        });

    } catch (error) {

        console.error(
            'Error deleting reservation:',
            error
        );

        return res.status(500).send(
            'Reservation deletion failed.'
        );
    }
});

// ==========================================================
// ヘルスチェック
// ==========================================================

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'yakisoba-reservation-server'
    });
});

// ==========================================================
// サーバー起動
// ==========================================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {
        console.log(
            `Server is running on port ${PORT}`
        );
    }
);