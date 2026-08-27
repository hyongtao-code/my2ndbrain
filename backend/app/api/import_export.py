"""/api/nodes — extra endpoints for the Import/Export UI.

We do NOT touch the existing /api/nodes CRUD; these are new
endpoints that batch-import .md files as new nodes and export a
list of nodes back as a single .zip of .md files.
"""
from __future__ import annotations

import io
import re
import zipfile
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.knowledge import ingest_node

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


# Frontmatter is optional but common in .md files. We strip a leading
# YAML frontmatter block (--- ... ---) and use the FIRST non-empty
# line of the body as the title.
_FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)


def _parse_md(content: str, filename: str) -> tuple[str, str]:
    """Return (title, body) from a .md file's text content.

    Title is the filename without its .md / .markdown extension. We
    keep the body as the full file content (including any leading
    ``#`` heading, frontmatter, etc.) so the round-trip back to
    markdown loses nothing.

    Note: we used to derive the title from the first ``# heading``
    inside the file, but the user explicitly wants the FILENAME to
    drive the title (so the .md file on disk and the node in the
    graph share the same name).
    """
    title = re.sub(r"\.(md|markdown)$", "", filename, flags=re.IGNORECASE).strip()
    title = title or filename or "(untitled)"
    return title, content


class ImportResult(BaseModel):
    filename: str
    title: str
    node_id: str | None = None
    ok: bool
    error: str | None = None


class ImportResponse(BaseModel):
    results: list[ImportResult]
    created_count: int
    failed_count: int


@router.post("/import-md", response_model=ImportResponse)
async def import_md(
    files: list[UploadFile] = File(..., description="One or more .md files"),
    db: Session = Depends(get_db),
) -> ImportResponse:
    """Import a batch of .md files as new knowledge nodes.

    Each uploaded file becomes a new node. The title is taken from the
    first non-blank line of the file (a `# Heading` is preferred;
    otherwise the first line itself). The full file content is the
    node's content. importance defaults to 5.0 as requested.

    Read-only: we never delete or modify existing rows. The endpoint
    only INSERTs new ones. Failed files (e.g. binary, empty, decoding
    errors) are reported in the response but do not abort the rest
    of the batch.
    """
    if not files:
        raise HTTPException(400, "no files provided")

    results: list[ImportResult] = []
    created = 0
    failed = 0
    for f in files:
        filename = f.filename or "(unnamed)"
        # Read raw bytes, then decode as utf-8 (most common .md
        # encoding); fall back to latin-1 if it fails so the user
        # still gets *something* in there.
        try:
            raw = await f.read()
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                content = raw.decode("latin-1")
            if not content.strip():
                results.append(ImportResult(
                    filename=filename,
                    title=filename,
                    ok=False,
                    error="empty file",
                ))
                failed += 1
                continue
            # Filename as fallback title
            title, body = _parse_md(content, filename)
            res = ingest_node(
                db,
                title=title,
                content=body,
                category="",          # heuristic will fill in
                importance=5.0,
                source="md-import",
                auto_link=True,
            )
            node_id = res["node"]["id"] if isinstance(res.get("node"), dict) else None
            results.append(ImportResult(
                filename=filename,
                title=title,
                node_id=node_id,
                ok=True,
            ))
            created += 1
        except Exception as e:
            results.append(ImportResult(
                filename=filename,
                title=filename,
                ok=False,
                error=f"{type(e).__name__}: {e}",
            ))
            failed += 1
    return ImportResponse(
        results=results,
        created_count=created,
        failed_count=failed,
    )


@router.get("/{node_id}/export-md")
def export_md(node_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    """Export a single node as a .md file (Content-Disposition: attachment).

    The filename is the node's title, slug-ified, with .md appended.
    """
    from uuid import UUID
    try:
        uid = UUID(node_id)
    except ValueError:
        raise HTTPException(400, "invalid uuid")
    from app.models.knowledge import KnowledgeNode
    node = db.get(KnowledgeNode, uid)
    if not node:
        raise HTTPException(404, "node not found")
    body = node.content or ""
    # Build a markdown document: title as # heading, then a
    # frontmatter-ish metadata block (key: value), then the body.
    title = str(node.title)
    summary = str(node.summary or "")
    category = str(node.category or "")
    md_lines = [f"# {title}", ""]
    if summary:
        md_lines += [f"> {summary}", ""]
    if category:
        md_lines += [f"_category: {category}_", ""]
    md_lines += [body]
    md = "\n".join(md_lines)
    # Strip filesystem-unsafe chars but keep CJK / unicode.
    safe_title = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", title).strip()[:80] or node_id[:8]
    filename_ascii = safe_title.encode("ascii", "replace").decode("ascii").replace("?", "_") or node_id[:8]
    filename_utf8 = quote(safe_title, safe="")
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{filename_ascii}.md"; '
            f"filename*=UTF-8''{filename_utf8}.md"
        ),
        "Content-Type": "text/markdown; charset=utf-8",
    }
    return StreamingResponse(
        io.BytesIO(md.encode("utf-8")),
        media_type="text/markdown",
        headers=headers,
    )


class ExportBatchRequest(BaseModel):
    node_ids: list[str]


@router.post("/export-md-batch")
def export_md_batch(
    payload: ExportBatchRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Export a list of nodes as a single .zip of .md files.

    Used by the Settings tab "Download" modal where the user
    multi-selects nodes and wants them all in one go.
    """
    from uuid import UUID

    from app.models.knowledge import KnowledgeNode

    if not payload.node_ids:
        raise HTTPException(400, "node_ids is empty")

    buf = io.BytesIO()
    seen_names: set[str] = set()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for raw_id in payload.node_ids:
            try:
                uid = UUID(raw_id)
            except ValueError:
                continue
            node = db.get(KnowledgeNode, uid)
            if not node:
                continue
            title = str(node.title)
            summary = str(node.summary or "")
            category = str(node.category or "")
            md_lines = [f"# {title}", ""]
            if summary:
                md_lines += [f"> {summary}", ""]
            if category:
                md_lines += [f"_category: {category}_", ""]
            md_lines += [node.content or ""]
            md = "\n".join(md_lines)
            # Strip filesystem-unsafe chars but keep CJK / unicode.
            safe = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", title).strip()[:80] or uid.hex[:8]
            # Ensure unique filename inside the zip
            arcname = f"{safe}.md"
            if arcname in seen_names:
                arcname = f"{safe}_{uid.hex[:8]}.md"
            seen_names.add(arcname)
            zf.writestr(arcname, md.encode("utf-8"))
    buf.seek(0)
    headers = {
        "Content-Disposition": 'attachment; filename="my2ndbrain-export.zip"',
        "Content-Type": "application/zip",
    }
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers=headers,
    )