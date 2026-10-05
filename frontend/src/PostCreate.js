import React, { useState } from 'react';

import { api } from './firebase';
import { THEME } from './lib';

// ====================================================================
// 投稿作成画面 (旧 Reception.js: フォーム入力 → サーバーAPIへPOST → 完了)
//
// 企画書 §31 の STEP 1(本文を書く)をここで行う。
// STEP 2〜4(線を引く・考えを書く・出典を足す)は投稿詳細画面で行い、
// 投稿時点ですべて完成させる必要はない。
// ====================================================================

const MAX_TITLE = 100; // server.js と同じ
const MAX_BODY = 2000000; // server.js と同じ

export default function PostCreate() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!title.trim()) {
      setMessage('タイトルを入力してください。');
      return;
    }
    if (!body.trim()) {
      setMessage('本文を入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api('/api/posts', {
        method: 'POST',
        body: { title: title.trim(), body },
      });
      // 投稿後は詳細画面へ。まず自分の読み跡を付けてみる流れにする
      window.location.hash = `#/post/${result.id}?first=1`;
    } catch (err) {
      console.error('投稿エラー:', err);
      setMessage(err.message || '通信エラーが発生しました。');
      setSubmitting(false);
    }
  };

  return (
    <main style={S.main}>
      <form onSubmit={handleSubmit} style={S.sheet}>
        <h1 style={S.h1}>文章を投稿する</h1>

        <ol style={S.steps}>
          <li style={S.stepNow}>本文を書く（いまここ）</li>
          <li>投稿後に、重要だと思う箇所へ線を引く</li>
          <li>それぞれの主張について、評価や自分の考えを書く</li>
          <li>必要なら出典を足す</li>
        </ol>
        <p style={S.note}>
          2〜4は投稿のあとで、他の読者といっしょに進められます。いま完成させなくて大丈夫です。
        </p>

        <label style={S.label} htmlFor="title">タイトル</label>
        <input
          id="title"
          style={S.input}
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 学校でのスマホ利用について"
        />

        <label style={S.label} htmlFor="body">本文</label>
        <textarea
          id="body"
          style={S.textarea}
          value={body}
          maxLength={MAX_BODY}
          onChange={(e) => setBody(e.target.value)}
          placeholder="一つの文章の中に、いくつかの主張が混ざっていてかまいません。読者が自分なりに分けて考えます。"
        />
        <div style={S.counter}>{body.length.toLocaleString()} / {MAX_BODY.toLocaleString()} 文字</div>

        <p style={S.warn}>
          本文は投稿後に編集できません。読者が線を引いた位置がずれてしまうためです。投稿前に読み返してください。
        </p>

        {message && <div style={S.error}>{message}</div>}

        <button type="submit" disabled={submitting} style={{ ...S.submit, ...(submitting ? S.submitDisabled : null) }}>
          {submitting ? '投稿中…' : '投稿する'}
        </button>
      </form>
    </main>
  );
}

const S = {
  main: { maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem 4rem' },
  sheet: { backgroundColor: THEME.paper, padding: '2rem', borderRadius: 4, boxShadow: '0 1px 0 #cfd3db, 0 8px 24px rgba(28,32,48,0.06)' },
  h1: { fontFamily: THEME.serif, fontSize: '1.5rem', margin: '0 0 1rem' },
  steps: { margin: '0 0 0.5rem', paddingLeft: '1.4rem', lineHeight: 1.9, color: THEME.muted, fontSize: '0.92rem' },
  stepNow: { color: THEME.ink, fontWeight: 700 },
  note: { color: THEME.muted, fontSize: '0.85rem', margin: '0 0 1.5rem' },
  label: { display: 'block', fontWeight: 600, margin: '1.25rem 0 0.5rem' },
  input: { width: '100%', boxSizing: 'border-box', padding: '0.75rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, fontSize: '1rem' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 320, padding: '1rem', border: `1px solid ${THEME.rule}`, borderRadius: 6, fontSize: '1.02rem', lineHeight: 2, fontFamily: THEME.serif, resize: 'vertical' },
  counter: { textAlign: 'right', color: THEME.faint, fontSize: '0.8rem', marginTop: 4 },
  warn: { backgroundColor: '#fff4de', color: '#7a4a00', padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.88rem', lineHeight: 1.7 },
  error: { backgroundColor: '#ffe3e0', color: '#8a1c14', padding: '0.75rem 1rem', borderRadius: 6, margin: '1rem 0', textAlign: 'center' },
  submit: { width: '100%', marginTop: '1rem', padding: '1rem', border: 'none', borderRadius: 6, backgroundColor: '#1f4fd8', color: '#fff', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer' },
  submitDisabled: { backgroundColor: '#98a2b3', cursor: 'not-allowed' },
};
