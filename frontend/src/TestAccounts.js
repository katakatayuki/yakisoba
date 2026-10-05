import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';

import { auth, api } from './firebase';
import { THEME } from './lib';

// ====================================================================
// プロトタイプ用テストアカウント
//
// 本物のメールアドレスは使わず、アプリ側で
//   test-xxxxxxxxxx@example.com + ランダムなパスワード
// を自動生成して Firebase に登録する。
// 作ったアカウントはこのブラウザの localStorage に保存しておき、
// ヘッダーの切り替えメニューからいつでも別人としてログインし直せる。
//
// ※ Firebaseコンソール → Authentication → Sign-in method で
//    「メール/パスワード」が有効になっている必要があります。
// ※ ブラウザのデータを消すと、保存したアカウントの一覧も消えます。
// ====================================================================

const STORAGE_KEY = 'nameraka_test_accounts';
export const ACCOUNTS_CHANGED = 'nameraka-accounts-changed';

export function loadTestAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveTestAccounts(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error(e);
  }
}

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (n) => chars[n % chars.length]).join('');
}

export function describeError(e) {
  switch (e && e.code) {
    case 'auth/operation-not-allowed':
      return 'Firebaseコンソールの Authentication → Sign-in method で「メール/パスワード」を有効にしてください。';
    case 'auth/network-request-failed':
      return 'ネットワークに接続できませんでした。';
    case 'auth/too-many-requests':
      return '試行回数が多すぎます。しばらく待ってからお試しください。';
    default:
      return `アカウントを作れませんでした (${(e && (e.code || e.message)) || '不明なエラー'})`;
  }
}

// 作成すると、そのままそのアカウントでログイン状態になる
export async function createTestAccount(name) {
  const displayName = (name || '').trim() || `ゲスト${Math.floor(1000 + Math.random() * 9000)}`;
  const email = `test-${randomString(10)}@example.com`;
  const password = randomString(20);

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  // 途中で失敗しても作ったアカウントを見失わないよう、先に保存する
  saveTestAccounts([...loadTestAccounts(), { uid: cred.user.uid, name: displayName, email, password }]);
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED));

  await updateProfile(cred.user, { displayName });
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED));

  // サーバー側の users/{uid} に表示名を登録 (投稿やコメントの名前に使われる)
  await api('/api/users/me', { method: 'PUT', body: { displayName } }).catch(console.error);

  return cred.user;
}

export async function switchToTestAccount(account) {
  await signInWithEmailAndPassword(auth, account.email, account.password);
}

// ====================================================================
// ログイン画面に置く「メールなしで始める」ブロック
// ====================================================================

export function TestAccountStart() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const accounts = loadTestAccounts();

  // 成功するとログイン画面ごと消えるので、成功時は busy を戻さない
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <div style={S.box}>
      <div style={S.title}>プロトタイプ用: メールなしで始める</div>

      <input
        style={S.input}
        value={name}
        maxLength={30}
        placeholder="表示名（空欄なら自動で付きます）"
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="button"
        disabled={busy}
        style={S.start}
        onClick={() => run(() => createTestAccount(name))}
      >
        {busy ? '処理中…' : 'この名前でアカウントを作って始める'}
      </button>

      {accounts.length > 0 && (
        <div style={S.saved}>
          <div style={S.savedTitle}>このブラウザで作ったアカウント</div>
          {accounts.map((a) => (
            <button
              key={a.uid}
              type="button"
              disabled={busy}
              style={S.savedItem}
              onClick={() => run(() => switchToTestAccount(a))}
            >
              {a.name} としてログイン
            </button>
          ))}
        </div>
      )}

      {error && <div style={S.error}>{error}</div>}
    </div>
  );
}

// ====================================================================
// ヘッダーに置く「アカウント切り替え」
// 切り替えても今開いている画面はそのまま (同じ投稿に別人として意見を足せる)
// ====================================================================

export function AccountSwitcher({ user }) {
  const [busy, setBusy] = useState(false);
  const accounts = loadTestAccounts();
  const current = accounts.some((a) => a.uid === user.uid) ? user.uid : '';

  const onChange = async (e) => {
    const value = e.target.value;
    if (!value) return;

    setBusy(true);
    try {
      if (value === '__new__') {
        const name = window.prompt('新しいテストアカウントの表示名（空欄なら自動）', '');
        if (name === null) return;
        await createTestAccount(name);
      } else {
        const target = accounts.find((a) => a.uid === value);
        if (target) await switchToTestAccount(target);
      }
    } catch (err) {
      console.error(err);
      window.alert(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <select value={current} onChange={onChange} disabled={busy} style={S.select} aria-label="アカウント切り替え">
      <option value="" disabled>
        {accounts.length ? 'アカウント切り替え' : 'テストアカウント'}
      </option>
      {accounts.map((a) => (
        <option key={a.uid} value={a.uid}>
          {a.name}
        </option>
      ))}
      <option value="__new__">＋ 新しいアカウントを作る</option>
    </select>
  );
}

const S = {
  box: { border: `1px dashed ${THEME.faint}`, borderRadius: 6, padding: '1rem', marginBottom: '1.5rem', backgroundColor: '#f7f8fb' },
  title: { fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', padding: '0.7rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, fontSize: '1rem' },
  start: { width: '100%', marginTop: '0.6rem', padding: '0.8rem', border: 'none', borderRadius: 6, backgroundColor: '#1f8a4c', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' },
  saved: { marginTop: '1rem', borderTop: `1px solid ${THEME.rule}`, paddingTop: '0.75rem' },
  savedTitle: { color: THEME.muted, fontSize: '0.8rem', marginBottom: '0.4rem' },
  savedItem: { display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.7rem', marginBottom: '0.35rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, backgroundColor: THEME.paper, cursor: 'pointer', fontSize: '0.9rem' },
  error: { backgroundColor: '#ffe3e0', color: '#8a1c14', padding: '0.7rem', borderRadius: 6, marginTop: '0.75rem', fontSize: '0.88rem' },
  select: { border: `1px solid ${THEME.rule}`, background: 'transparent', borderRadius: 6, padding: '0.3rem 0.5rem', color: THEME.ink, fontSize: '0.9rem', cursor: 'pointer' },
};
