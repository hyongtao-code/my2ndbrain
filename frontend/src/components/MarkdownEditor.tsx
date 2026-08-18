// MarkdownEditor — toolbar + textarea + live preview tabs.
// Used by both AddNodeModal (new node) and NodeDetail (edit existing).
// Submits plain markdown text (we just send the raw value through
// to the backend unchanged).
import { useMemo, useRef, useState } from "react";
import { marked } from "marked";

type Props = {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    rows?: number;
    minHeight?: number;  // px
};

type Tab = "edit" | "preview" | "split";

function wrapSelection(textarea: HTMLTextAreaElement, before: string, after = before) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const next = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
    const cursorStart = start + before.length;
    const cursorEnd = cursorStart + selected.length;
    // set the value via React-friendly callback, but caller controls state.
    // We just provide the resulting string and let the caller update state.
    return { next, cursorStart, cursorEnd };
}

export default function MarkdownEditor({ value, onChange, placeholder, rows = 8, minHeight = 200 }: Props) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    const [tab, setTab] = useState<Tab>("edit");

    const insert = (before: string, after = before) => {
        const ta = taRef.current;
        if (!ta) {
            onChange((value || "") + before + "selection" + after);
            return;
        }
        const { next, cursorStart, cursorEnd } = wrapSelection(ta, before, after);
        onChange(next);
        // restore selection after React re-renders the textarea
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(cursorStart, cursorEnd);
        });
    };

    const html = useMemo(() => {
        try {
            // marked returns string | Promise<string>; we always want sync.
            return marked.parse(value || "", { async: false, breaks: true }) as string;
        } catch {
            return "<pre>" + escapeHtml(value || "") + "</pre>";
        }
    }, [value]);

    return (
        <div className="md-editor">
            <div className="md-toolbar">
                <button type="button" className="md-tool" title="Bold (**)"
                        onClick={() => insert("**")}>B</button>
                <button type="button" className="md-tool md-tool-em" title="Italic (*)"
                        onClick={() => insert("*")}>I</button>
                <button type="button" className="md-tool" title="Inline code"
                        onClick={() => insert("`")}>{"</>"}</button>
                <button type="button" className="md-tool" title="Code block"
                        onClick={() => insert("\n```\n", "\n```\n")}>{"{ }"}</button>
                <button type="button" className="md-tool" title="Link"
                        onClick={() => insert("[", "](https://)")}>🔗</button>
                <button type="button" className="md-tool" title="Bullet list"
                        onClick={() => insert("\n- ", "")}>•</button>
                <button type="button" className="md-tool" title="Numbered list"
                        onClick={() => insert("\n1. ", "")}>1.</button>
                <button type="button" className="md-tool" title="Heading"
                        onClick={() => insert("\n## ", "")}>H</button>
                <button type="button" className="md-tool" title="Blockquote"
                        onClick={() => insert("\n> ", "")}>“”</button>
                <button type="button" className="md-tool md-tool-code"
                        title="Insert horizontal rule"
                        onClick={() => insert("\n---\n")}>―</button>
                <div className="md-tabs">
                    <button type="button" className={`md-tab ${tab === "edit" ? "active" : ""}`} onClick={() => setTab("edit")}>
                        Edit
                    </button>
                    <button type="button" className={`md-tab ${tab === "split" ? "active" : ""}`} onClick={() => setTab("split")}>
                        Split
                    </button>
                    <button type="button" className={`md-tab ${tab === "preview" ? "active" : ""}`} onClick={() => setTab("preview")}>
                        Preview
                    </button>
                </div>
            </div>

            <div className={`md-body md-${tab}`} style={{ minHeight }}>
                {(tab === "edit" || tab === "split") && (
                    <textarea
                        ref={taRef}
                        className="md-textarea"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        rows={rows}
                        spellCheck={false}
                    />
                )}
                {(tab === "preview" || tab === "split") && (
                    <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
                )}
            </div>
        </div>
    );
}

function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) =>
        ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]!));
}