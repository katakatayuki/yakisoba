import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ====================================================================
// 環境変数
//   REACT_APP_FIREBASE_CONFIG  Firebaseコンソールの設定オブジェクトをJSON文字列で
//   REACT_APP_SERVER_URL       RenderのサーバーURL (例: https://nameraka-sns.onrender.com)
// ====================================================================

const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG
  ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG)
  : {};

export const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3000';

export const isFirebaseConfigured = Object.keys(firebaseConfig).length > 0;

const app = isFirebaseConfigured
  ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp())
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// ====================================================================
// サーバーAPI呼び出し
// ログイン中ユーザーのIDトークンを付けて送る。
// (旧: apiSecret をクライアントに埋め込む方式は廃止)
// ====================================================================

export async function api(path, { method = 'GET', body } = {}) {
  const user = auth && auth.currentUser;
  if (!user) throw new Error('ログインが必要です。');

  const token = await user.getIdToken();

  let response;
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('サーバーに接続できませんでした。時間をおいてもう一度お試しください。');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    // JSON以外のレスポンスは無視
  }

  if (!response.ok) {
    throw new Error((data && data.error) || `サーバーエラーが発生しました (${response.status})`);
  }
  return data;
}
