import React, { useMemo, useState } from 'react';

import { api } from './firebase';
import { THEME, PEN, ANNOTATION_TYPES, buildThread, timeAgo, toMillis, clip } from './lib';
import { U, Avatar, EvalButtons, MAX_DEPTH } from './ui';

// ====================================================================
// マルジナリア(この主張への余白)
//   - 余白には、さらに余白(返信)を書ける。MAX_DEPTH 段まで。
//   - どの余白にも「🔒 自分用のメモ」を付けられる。メモは本人にしか見えない。
// 本文の線は賛否ではなく読む行為の色 (§12)。左の罫線の色は書いた人の線の色。
// ====================================================================

const M = {
  bridgedBox: { backgroundColor: THEME.bridgeBg, padding: '0.7rem 0.8rem', borderRadius: 12, marginBottom: '1rem' },
  bridgedTitle: { color: THEME.bridge, fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 },
  row: { display: 'flex', gap: 10, padding: '0.6rem 0' },
  head: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' },
  badge: { border: `1px solid ${THEME.rule}`, borderRadius: 999, padding: '0 8px', fontSize: '0.72rem', color: THEME.muted },
  body: { margin: '0.25rem 0 0.2rem', lineHeight: 1.8, fontSize: '0.93rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  actions: { display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 4, marginLeft: -6 },
  children: { marginLeft: 16, paddingLeft: 12, borderLeft: `2px solid ${THEME.rule}` },
  formWrap: { marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${THEME.rule}` },
  formTitle: { fontWeight: 700, fontSize: '0.88rem', marginBottom: 8 },
  typeRow: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 },
  formButtons: { display: 'flex', gap: 8, marginTop: 8 },

  noteBox: {
    marginTop: 8,
    padding: '0.6rem 0.8rem',
    border: `1px dashed ${THEME.faint}`,
    borderRadius: 12,
    backgroundColor: '#fafaf6',
  },
  noteLabel: { fontSize: '0.72rem', color: THEME.muted, marginBottom: 4 },
  noteBody: { fontSize: '0.92rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  noteIntro: { fontSize: '0.85rem', color: THEME.muted, lineHeight: 1.8, marginBottom: 12 },
  prompts: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  published: { fontSize: '0.72rem', color: '#14532d', backgroundColor: '#e3f6ea', borderRadius: 999, padding: '0 8px', marginLeft: 6 },
};

// ====================================================================
// 余白の一覧(入れ子)
// ====================================================================

export default function Marginalia({ claim, annotations, notes, myEvals, myColor, hasReaction, user, act }) {
  const roots = useMemo(() => buildThread(annotations), [annotations]);

  const notesByTarget = useMemo(() => {
    const map = {};
    notes
      .filter((n) => n.targetType === 'annotation')
      .forEach((n) => {
        (map[n.targetId] = map[n.targetId] || []).push(n);
      });
    Object.values(map).forEach((list) => list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
    return map;
  }, [notes]);

  const bridged = roots
    .filter((a) => (a.bridgeScore || 0) > 0)
    .sort((a, b) => b.bridgeScore - a.bridgeScore)
    .slice(0, 3);
  const bridgedIds = new Set(bridged.map((a) => a.id));
  const rest = roots.filter((a) => !bridgedIds.has(a.id));

  const ctx = { claim, myEvals, user, act, myColor, notesByTarget };

  return (
    <div>
      {annotations.length === 0 && (
        <div style={U.faint}>まだ余白への書き込みはありません。最初の一言を書いてみましょう。</div>
      )}

      {bridged.length > 0 && (
        <div style={M.bridgedBox}>
          <div style={M.bridgedTitle}>🌉 立場を越えて有用とされた余白</div>
          {bridged.map((n) => <AnnotationNode key={n.id} node={n} depth={0} ctx={ctx} />)}
        </div>
      )}

      {rest.map((n) => <AnnotationNode key={n.id} node={n} depth={0} ctx={ctx} />)}

      {!hasReaction && annotations.length > 0 && (
        <div style={U.footnote}>
          橋渡しの指標に反映されるのは、この主張に自分の評価（「評価」タブ）を入れた人の「有用」評価です。
        </div>
      )}

      <div style={M.formWrap}>
        <div style={M.formTitle}>余白に書く</div>
        <AnnotationForm claim={claim} myColor={myColor} act={act} placeholder="この主張について、考えたこと・疑問・根拠など" />
      </div>
    </div>
  );
}

function AnnotationNode({ node, depth, ctx }) {
  const { claim, myEvals, user, act, myColor, notesByTarget } = ctx;
  const [replying, setReplying] = useState(false);
  const [noting, setNoting] = useState(false);
  const [open, setOpen] = useState(depth < 1); // 深い返信は畳んでおく

  const type = ANNOTATION_TYPES.find((t) => t.value === node.type);
  const myNotes = notesByTarget[node.id] || [];
  const canReply = (node.depth || 0) < MAX_DEPTH;
  const replyCount = node.children.length;

  return (
    <div>
      <div style={M.row}>
        <Avatar name={node.authorName} size={depth > 0 ? 28 : 34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={M.head}>
            <b>{node.authorName || 'ななしさん'}</b>
            <span style={M.badge}>{type ? type.label : node.type}</span>
            <span style={U.faint}>{timeAgo(node.createdAt)}</span>
            {node.color && (
              <span
                title={`この人の線: ${PEN[node.color].label}`}
                style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: PEN[node.color].ink }}
              />
            )}
          </div>

          <div style={M.body}>{node.body}</div>

          <EvalButtons targetType="annotation" target={node} myEvals={myEvals} user={user} act={act} />

          <div style={M.actions}>
            {canReply && (
              <button type="button" style={U.linkBtn} onClick={() => setReplying((v) => !v)}>
                ↩ 余白に返信
              </button>
            )}
            <button type="button" style={U.linkBtn} onClick={() => setNoting((v) => !v)}>
              🔒 自分用のメモ
            </button>
            {replyCount > 0 && (
              <button type="button" style={U.linkBtn} onClick={() => setOpen((v) => !v)}>
                💬 返信 {replyCount} {open ? '（隠す）' : '（見る）'}
              </button>
            )}
          </div>

          {replying && (
            <AnnotationForm
              claim={claim}
              parentId={node.id}
              myColor={myColor}
              act={act}
              onDone={() => setReplying(false)}
              placeholder={`${node.authorName || 'ななしさん'}さんの余白への返信`}
            />
          )}

          {myNotes.map((n) => <NoteItem key={n.id} note={n} act={act} />)}
          {noting && (
            <NoteForm
              claim={claim}
              targetType="annotation"
              targetId={node.id}
              act={act}
              onDone={() => setNoting(false)}
              placeholder="この余白を読んで思ったこと(自分にだけ見えます)"
            />
          )}
        </div>
      </div>

      {open && replyCount > 0 && (
        <div style={M.children}>
          {node.children.map((c) => <AnnotationNode key={c.id} node={c} depth={depth + 1} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function AnnotationForm({ claim, parentId = null, myColor, act, onDone, placeholder }) {
  const [type, setType] = useState('opinion');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const result = await act(
      () => api(`/api/claims/${claim.id}/annotations`, {
        method: 'POST',
        body: { type, body: body.trim(), ...(parentId ? { parentId } : {}) },
      }),
      parentId ? '返信しました。' : '余白に書きました。'
    );
    setBusy(false);
    if (result) {
      setBody('');
      if (onDone) onDone();
    }
  };

  const off = busy || !body.trim();
  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      <div style={M.typeRow}>
        {ANNOTATION_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            style={{ ...U.chip, ...(type === t.value ? U.chipActive : null) }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        style={{ ...U.textarea, borderLeft: `4px solid ${myColor ? PEN[myColor].ink : THEME.rule}` }}
        rows={3}
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
      />
      <div style={M.formButtons}>
        <button type="submit" disabled={off} style={{ ...U.submit, ...(off ? U.submitOff : null) }}>
          {busy ? '送信中…' : parentId ? '返信する' : '余白に書く'}
        </button>
        {onDone && <button type="button" style={U.ghost} onClick={onDone}>やめる</button>}
      </div>
    </form>
  );
}

// ====================================================================
// 私的マージナリア (自己対話モード)
// ====================================================================

const SELF_PROMPTS = [
  '賛成できるのは…',
  'ひっかかるのは…',
  'この主張が正しいとしたら…',
];

export function NoteForm({ claim, targetType = 'claim', targetId = null, act, onDone, placeholder }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const result = await act(
      () => api('/api/private-notes', {
        method: 'POST',
        body: { claimId: claim.id, targetType, targetId, body: body.trim() },
      }),
      'メモを書きました。(あなたにだけ見えます)'
    );
    setBusy(false);
    if (result) {
      setBody('');
      if (onDone) onDone();
    }
  };

  const addPrompt = (text) => setBody((prev) => (prev ? `${prev}\n${text}` : text));
  const off = busy || !body.trim();

  return (
    <form onSubmit={submit} style={M.noteBox}>
      <div style={M.noteLabel}>🔒 あなただけに見えます</div>
      {targetType === 'claim' && (
        <div style={M.prompts}>
          {SELF_PROMPTS.map((p) => (
            <button key={p} type="button" style={U.chip} onClick={() => addPrompt(p)}>{p}</button>
          ))}
        </div>
      )}
      <textarea
        style={U.textarea}
        rows={3}
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
      />
      <div style={M.formButtons}>
        <button type="submit" disabled={off} style={{ ...U.submit, ...(off ? U.submitOff : null) }}>
          {busy ? '保存中…' : 'メモを残す'}
        </button>
        {onDone && <button type="button" style={U.ghost} onClick={onDone}>やめる</button>}
      </div>
    </form>
  );
}

export function NoteItem({ note, act, context }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [publishing, setPublishing] = useState(false);
  const [pubType, setPubType] = useState('opinion');

  const save = async () => {
    if (!text.trim()) return;
    const result = await act(
      () => api(`/api/private-notes/${note.id}`, { method: 'PUT', body: { body: text.trim() } }),
      'メモを更新しました。'
    );
    if (result) setEditing(false);
  };

  const remove = () => {
    if (window.confirm('このメモを削除しますか？')) {
      act(() => api(`/api/private-notes/${note.id}`, { method: 'DELETE' }), 'メモを削除しました。');
    }
  };

  const publish = async () => {
    const result = await act(
      () => api(`/api/private-notes/${note.id}/publish`, { method: 'POST', body: { type: pubType } }),
      '余白として公開しました。'
    );
    if (result) setPublishing(false);
  };

  return (
    <div style={M.noteBox}>
      <div style={M.noteLabel}>
        🔒 自分用のメモ　{timeAgo(note.createdAt)}
        {note.publishedAnnotationId && <span style={M.published}>公開済み</span>}
      </div>
      {context && <div style={{ ...U.faint, marginBottom: 4 }}>{context}</div>}

      {editing ? (
        <>
          <textarea style={U.textarea} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={M.formButtons}>
            <button type="button" style={U.submit} onClick={save}>保存</button>
            <button type="button" style={U.ghost} onClick={() => { setEditing(false); setText(note.body); }}>やめる</button>
          </div>
        </>
      ) : (
        <div style={M.noteBody}>{note.body}</div>
      )}

      {!editing && (
        <div style={M.actions}>
          <button type="button" style={U.linkBtn} onClick={() => setEditing(true)}>編集</button>
          <button type="button" style={U.linkBtn} onClick={remove}>削除</button>
          {!note.publishedAnnotationId && (
            <button type="button" style={U.linkBtn} onClick={() => setPublishing((v) => !v)}>
              余白に公開する…
            </button>
          )}
        </div>
      )}

      {publishing && (
        <div style={{ marginTop: 6 }}>
          <div style={U.faint}>
            公開すると、みんなに見える余白{note.targetType === 'annotation' ? '(返信)' : ''}になります。メモ自体は手元に残ります。
          </div>
          <div style={{ ...M.typeRow, marginTop: 6 }}>
            {ANNOTATION_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setPubType(t.value)}
                style={{ ...U.chip, ...(pubType === t.value ? U.chipActive : null) }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={M.formButtons}>
            <button type="button" style={U.submit} onClick={publish}>公開する</button>
            <button type="button" style={U.ghost} onClick={() => setPublishing(false)}>やめる</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 「🔒メモ」タブの中身
export function PrivateNotesTab({ claim, notes, annotations, notesReady, act }) {
  if (!notesReady) {
    return (
      <div style={U.faint}>
        自分用のメモを読み込めませんでした。Firestore のルールに <code>privateNotes</code> の読み取り許可
        (userId が本人のものだけ)が入っているか確認してください。
      </div>
    );
  }

  const annById = new Map(annotations.map((a) => [a.id, a]));
  const sorted = [...notes].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  return (
    <div>
      <div style={M.noteIntro}>
        ここは、この主張とひとりで向き合う場所です。書いたことはあなたにしか見えず、評価や橋渡しにも使われません。
        「賛成できるところ」と「ひっかかるところ」を両方探してみてください。
        人に見てほしくなったら、あとから余白として公開できます。
      </div>

      <NoteForm claim={claim} act={act} placeholder="この主張について、自分に向けて書く" />

      {sorted.map((n) => {
        const target = n.targetType === 'annotation' ? annById.get(n.targetId) : null;
        const context = n.targetType === 'annotation'
          ? `↳ ${target ? `${target.authorName || 'ななしさん'}さんの余白「${clip(target.body, 30)}」へのメモ` : '余白へのメモ'}`
          : null;
        return <NoteItem key={n.id} note={n} act={act} context={context} />;
      })}
    </div>
  );
}
