import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// ★ ここだけ自分の値に書き換える
export const API_URL = 'https://YOUR-SERVICE.onrender.com';
const firebaseConfig = {
    apiKey: '',
    authDomain: '',
    projectId: ''
};

const auth = getAuth(initializeApp(firebaseConfig));

// 匿名ログインが済むまで待つ（Firebase Console で「匿名」認証を有効化しておく）
const ready = new Promise((resolve) =>
    onAuthStateChanged(auth, (u) => (u ? resolve(u) : signInAnonymously(auth)))
);

async function call(path, method = 'GET', body) {
    const user = await ready;
    const res = await fetch(API_URL + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (await user.getIdToken())
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '通信に失敗しました。');
    return data;
}

export const myUid = () => auth.currentUser?.uid;

export const api = {
    posts: () => call('/api/posts'),
    post: (id) => call(`/api/posts/${id}`),
    create: (text) => call('/api/posts', 'POST', { text }),
    annotate: (id, a) => call(`/api/posts/${id}/annotations`, 'POST', a),
    remove: (id, aid) => call(`/api/posts/${id}/annotations/${aid}`, 'DELETE')
};
