import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';

import { auth, api, isFirebaseConfigured } from './firebase';
import { THEME } from './lib';
import Home from './Home';
import PostCreate from './PostCreate';
import PostDetail from './PostDetail';

// ====================================================================
// ハッシュルーター (追加ライブラリなし)
//   #/            ホーム
//   #/new         投稿作成
//   #/post/:id    投稿詳細
// ====================================================================

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const [path, queryString = ''] = hash.slice(1).split('?');
  return { path: path || '/', query: new URLSearchParams(queryString) };
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。',
  'auth/weak-password': 'パスワードは6文字以上にしてください。',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/popup-closed-by-user': 'ログインがキャンセルされました。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください。',
};

// ====================================================================
// ログイン / 新規登録
// ====================================================================

function Login() {
  const [mode, setMode] = useState('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fail = (e) => {
    console.error(e);
    setError(AUTH_ERRORS[e.code] || 'ログインに失敗しました。もう一度お試しください。');
  };

  const registerProfile = (name) =>
    // サーバーが寝ていても画面は進める。失敗しても次回ログイン時に再登録される
    api('/api/users/me', { method: 'PUT', body: { displayName: name } }).catch(console.error);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && !displayName.trim()) {
      setError('表示名を入力してください。');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: displayName.trim() });
        registerProfile(displayName.trim());
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        registerProfile(cred.user.displayName || '');
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      registerProfile(cred.user.displayName || '');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.loginWrap}>
      <div style={S.loginSheet}>
        <h1 style={S.brand}>なめらかなSNS</h1>
        <p style={S.lead}>
          文章に線を引き、一つひとつの主張について考える。
          <br />
          「賛成か反対か」ではなく、「この主張には賛成、ここは保留」と言える場所です。
        </p>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label style={S.label}>
              表示名
              <input
                style={S.input}
                value={displayName}
                maxLength={30}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          )}
          <label style={S.label}>
            メールアドレス
            <input
              style={S.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={S.label}>
            パスワード
            <input
              style={S.input}
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <div style={S.error}>{error}</div>}

          <button type="submit" disabled={busy} style={S.primary}>
            {busy ? '処理中…' : mode === 'signup' ? '登録して始める' : 'ログイン'}
          </button>
        </form>

        <button type="button" onClick={google} disabled={busy} style={S.secondary}>
          Googleアカウントで続ける
        </button>

        <button
          type="button"
          style={S.textLink}
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin' ? 'はじめての方は新規登録' : 'アカウントをお持ちの方はログイン'}
        </button>
      </div>
    </div>
  );
}

// ====================================================================
// アプリ本体
// ====================================================================

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  if (!isFirebaseConfigured) {
    return (
      <div style={S.center}>
        Firebase設定が見つかりません。環境変数 REACT_APP_FIREBASE_CONFIG を確認してください。
      </div>
    );
  }
  if (!authReady) return <div style={S.center}>読み込み中…</div>;
  if (!user) return <Login />;

  const postMatch = route.path.match(/^\/post\/([A-Za-z0-9_-]+)$/);

  let screen;
  if (postMatch) {
    screen = <PostDetail key={postMatch[1]} postId={postMatch[1]} user={user} isFirst={route.query.get('first') === '1'} />;
  } else if (route.path === '/new') {
    screen = <PostCreate />;
  } else {
    screen = <Home />;
  }

  return (
    <div style={S.app}>
      <header style={S.header}>
        <a href="#/" style={S.headerBrand}>なめらかなSNS</a>
        <nav style={S.nav}>
          <a href="#/new" style={S.navLink}>投稿する</a>
          <span style={S.who}>{user.displayName || user.email}</span>
          <button type="button" style={S.logout} onClick={() => signOut(auth)}>ログアウト</button>
        </nav>
      </header>
      {screen}
    </div>
  );
}

// ====================================================================
// スタイル
// ====================================================================

const S = {
  app: { minHeight: '100vh', backgroundColor: THEME.desk, fontFamily: THEME.sans, color: THEME.ink },
  center: { padding: '4rem 1rem', textAlign: 'center', fontFamily: THEME.sans, color: THEME.muted },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.5rem',
    padding: '0.75rem 1.25rem',
    backgroundColor: THEME.paper,
    borderBottom: `1px solid ${THEME.rule}`,
  },
  headerBrand: { fontFamily: THEME.serif, fontWeight: 700, fontSize: '1.15rem', color: THEME.ink, textDecoration: 'none' },
  nav: { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  navLink: { color: '#1f4fd8', fontWeight: 600, textDecoration: 'none' },
  who: { color: THEME.muted, fontSize: '0.9rem' },
  logout: { border: `1px solid ${THEME.rule}`, background: 'transparent', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer', color: THEME.muted },

  loginWrap: { minHeight: '100vh', backgroundColor: THEME.desk, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', fontFamily: THEME.sans },
  loginSheet: { width: '100%', maxWidth: 420, backgroundColor: THEME.paper, padding: '2.25rem 2rem', borderRadius: 4, boxShadow: '0 1px 0 #cfd3db, 0 8px 24px rgba(28,32,48,0.08)' },
  brand: { fontFamily: THEME.serif, fontSize: '1.7rem', margin: '0 0 0.75rem' },
  lead: { color: THEME.muted, lineHeight: 1.8, fontSize: '0.92rem', margin: '0 0 1.5rem' },
  label: { display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '0.7rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, fontSize: '1rem' },
  error: { backgroundColor: '#ffe3e0', color: '#8a1c14', padding: '0.7rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' },
  primary: { width: '100%', padding: '0.85rem', border: 'none', borderRadius: 6, backgroundColor: '#1f4fd8', color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' },
  secondary: { width: '100%', padding: '0.8rem', marginTop: '0.75rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, backgroundColor: THEME.paper, fontSize: '0.95rem', cursor: 'pointer' },
  textLink: { display: 'block', margin: '1.25rem auto 0', border: 'none', background: 'none', color: '#1f4fd8', cursor: 'pointer', fontSize: '0.9rem' },
};