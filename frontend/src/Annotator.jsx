import { useEffect, useMemo, useRef, useState } from 'react';

export const COLORS = {
    blue: { label: '共感', c: '#8db8ff' },
    red: { label: '反対', c: '#ff9aa2' },
    green: { label: '疑問', c: '#9be0b0' }
};

const label = (s) =>
    s < 20 ? '反対' : s < 40 ? '弱い反対' : s < 60 ? '中立' : s < 80 ? '弱い賛同' : '賛同';

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function Annotator({ text, annotations, uid, onSave, onDelete }) {
    const box = useRef(null);
    const [draft, setDraft] = useState(null); // {start,end}
    const [caret, setCaret] = useState(0);
    const [markFrom, setMarkFrom] = useState(null);
    const [color, setColor] = useState('blue');
    const [score, setScore] = useState(50);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    // 境界ヒートマップ: 位置 -> その位置で区切った「人数」（1人1票）
    const heat = useMemo(() => {
        const m = {};
        const seen = new Set();
        for (const a of annotations) {
            for (const p of [a.start, a.end]) {
                if (p <= 0 || p >= text.length) continue;
                const k = a.uid + ':' + p;
                if (seen.has(k)) continue;
                seen.add(k);
                m[p] = (m[p] || 0) + 1;
            }
        }
        return m;
    }, [annotations, text]);
    const maxHeat = Math.max(1, ...Object.values(heat));

    // スマホ: スクロール量に応じて ┃ が文章上を進む
    useEffect(() => {
        if (!coarse) return;
        const onScroll = () => {
            const r = box.current.getBoundingClientRect();
            const f = (window.innerHeight * 0.4 - r.top) / r.height;
            setCaret(Math.round(Math.min(1, Math.max(0, f)) * text.length));
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [text]);

    const mine = annotations.filter((a) => a.uid === uid);
    const sel = draft ?? (markFrom != null
        ? { start: Math.min(markFrom, caret), end: Math.max(markFrom, caret) }
        : null);

    const cuts = [...new Set([
        0, text.length,
        ...Object.keys(heat).map(Number),
        ...mine.flatMap((a) => [a.start, a.end]),
        ...(sel ? [sel.start, sel.end] : []),
        ...(coarse ? [caret] : [])
    ])].sort((a, b) => a - b);

    const parts = [];
    cuts.forEach((p, i) => {
        if (heat[p]) {
            parts.push(
                <i key={'h' + p} className="cut"
                    style={{ opacity: 0.15 + 0.85 * (heat[p] / maxHeat) }}
                    title={`${heat[p]}人がここで区切っています`} />
            );
        }
        if (coarse && p === caret) parts.push(<b key="caret" className="caret" />);
        const n = cuts[i + 1];
        if (n == null) return;
        const hit = mine.filter((a) => a.start <= p && a.end >= n);
        const inSel = sel && sel.start <= p && sel.end >= n;
        parts.push(
            <span key={p} className={inSel ? 'sel' : ''}
                style={hit.length ? {
                    backgroundImage: `linear-gradient(transparent 50%, ${COLORS[hit[hit.length - 1].color].c} 50%)`
                } : undefined}>
                {text.slice(p, n)}
            </span>
        );
    });

    // PC: ドラッグ選択 → 範囲確定
    const onMouseUp = () => {
        if (coarse) return;
        const s = window.getSelection();
        if (!s.rangeCount || s.isCollapsed) return;
        if (!box.current.contains(s.anchorNode) || !box.current.contains(s.focusNode)) return;
        const r = s.getRangeAt(0);
        const pre = document.createRange();
        pre.selectNodeContents(box.current);
        pre.setEnd(r.startContainer, r.startOffset);
        const start = pre.toString().length;
        const end = start + r.toString().length;
        s.removeAllRanges();
        if (end > start) setDraft({ start, end });
    };

    // スマホ: マーク開始 → 終了
    const mark = () => {
        if (markFrom == null) return setMarkFrom(caret);
        const start = Math.min(markFrom, caret);
        const end = Math.max(markFrom, caret);
        if (end > start) setDraft({ start, end });
    };

    const cancel = () => { setDraft(null); setMarkFrom(null); };

    const save = async () => {
        setBusy(true);
        try {
            await onSave({ ...draft, color, score, note });
            cancel();
            setNote('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <p ref={box} className="body reader-body" onMouseUp={onMouseUp}>{parts}</p>
            <p className="hint">
                {coarse
                    ? 'スクロールすると ┃ が進みます。「マーク開始」と「マーク終了」で線を引きます。'
                    : '文章をドラッグして線を引きます。縦の細い線は、他の人が区切った位置です。'}
            </p>

            <ul className="notes">
                {[...annotations].sort((a, b) => a.start - b.start).map((a) => (
                    <li key={a.id} style={{ '--c': COLORS[a.color].c }}>
                        <q>{text.slice(a.start, a.end)}</q>
                        <div className="meta">
                            <span>
                                {a.uid === uid ? 'あなた' : '他の人'}・{COLORS[a.color].label}・{label(a.score)}（{a.score}）
                            </span>
                            {a.uid === uid && (
                                <button className="ghost" onClick={() => onDelete(a.id)}>削除</button>
                            )}
                        </div>
                        {a.note && <p>{a.note}</p>}
                    </li>
                ))}
            </ul>

            {coarse && !draft && (
                <div className="bar">
                    <input type="range" min="0" max={text.length} value={caret}
                        onChange={(e) => setCaret(+e.target.value)} />
                    <div className="row">
                        <button onClick={mark}>{markFrom == null ? 'マーク開始' : 'マーク終了'}</button>
                        {markFrom != null && (
                            <button className="ghost" onClick={() => setMarkFrom(null)}>取消</button>
                        )}
                    </div>
                </div>
            )}

            {draft && (
                <div className="sheet">
                    <q>{text.slice(draft.start, draft.end)}</q>
                    <div className="chips">
                        {Object.entries(COLORS).map(([k, v]) => (
                            <button key={k} className={'chip' + (k === color ? ' on' : '')}
                                style={{ '--c': v.c }} onClick={() => setColor(k)}>
                                {v.label}
                            </button>
                        ))}
                    </div>
                    <label className="rate">
                        <span>{label(score)}（{score}）</span>
                        <input type="range" min="0" max="100" value={score}
                            onChange={(e) => setScore(+e.target.value)} />
                    </label>
                    <textarea placeholder="この部分について、自分はどう思う？" maxLength={500}
                        value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="row">
                        <button className="ghost" onClick={cancel}>やめる</button>
                        <button disabled={busy} onClick={save}>線を引く</button>
                    </div>
                </div>
            )}
        </>
    );
}
