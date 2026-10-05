import { useEffect, useState } from 'react';
import { api, myUid } from './api';
import Annotator from './Annotator';
import './styles.css';

const ago = (t) => {
    const m = Math.floor((Date.now() - t) / 60000);
    return m < 1 ? 'たった今' : m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`;
};

function Reader({ id, onClose }) {
    const [d, setD] = useState(null);
    const load = () => api.post(id).then(setD);
    useEffect(() => { window.scrollTo(0, 0); load(); }, [id]);

    return (
        <div className="reader">
            <button className="ghost back" onClick={onClose}>← 戻る</button>
            {d && (
                <>
                    <div className="meta"><span>{d.post.authorName}</span><span>{ago(d.post.createdAt)}</span></div>
                    <Annotator
                        text={d.post.text}
                        annotations={d.annotations}
                        uid={myUid()}
                        onSave={async (a) => { await api.annotate(id, a); await load(); }}
                        onDelete={async (aid) => { await api.remove(id, aid); await load(); }}
                    />
                </>
            )}
        </div>
    );
}

export default function App() {
    const [posts, setPosts] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [text, setText] = useState('');
    const [err, setErr] = useState('');

    const load = () => api.posts().then(setPosts).catch((e) => setErr(e.message));
    useEffect(() => { load(); }, []);

    const submit = async () => {
        try { await api.create(text); setText(''); setErr(''); load(); }
        catch (e) { setErr(e.message); }
    };

    return (
        <div className="app">
            <header>なめらか</header>

            {openId && <Reader id={openId} onClose={() => { setOpenId(null); load(); }} />}

            <div style={{ display: openId ? 'none' : 'block' }}>
                <div className="composer">
                    <textarea placeholder="意見を書く。読む人があなたの文章に線を引きます。"
                        maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
                    <div className="meta">
                        <span>{text.length} / 1000</span>
                        <button disabled={!text.trim()} onClick={submit}>投稿</button>
                    </div>
                </div>

                {err && <p className="err">{err}</p>}
                {posts?.length === 0 && <p className="hint">まだ投稿がありません。最初の意見を書いてみましょう。</p>}

                {posts?.map((p) => (
                    <article key={p.id} className="card" onClick={() => setOpenId(p.id)}>
                        <div className="meta"><span>{p.authorName}</span><span>{ago(p.createdAt)}</span></div>
                        <p className="body">{p.text}</p>
                        <div className="meta"><span>線 {p.annotationCount}</span><span>開いて線を引く</span></div>
                    </article>
                ))}
            </div>
        </div>
    );
}
