import type {
  NodeOut, GraphPayload, IngestResponse, AssistantResponse, SkillOut,
} from "../types";

const BASE = "";   // proxied by Vite in dev; same-origin in prod

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => http<{ status: string; embedding_backend: string }>("/api/health"),
  graph:  (category?: string) =>
    http<GraphPayload>(`/api/graph${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  listNodes: (category?: string) =>
    http<NodeOut[]>(`/api/nodes${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  node:    (id: string) => http<NodeOut>(`/api/nodes/${id}`),
  updateNode: (id: string, payload: {
    title?: string; content?: string; category?: string;
    keywords?: string[]; importance?: number;
  }) => http<NodeOut>(`/api/nodes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }),
  deleteNode: (id: string) => http<{ deleted: string }>(`/api/nodes/${id}`, { method: "DELETE" }),

  // --- inbox / drafts ---
  listDrafts: (includePromoted = false) =>
    http<import("../types").DraftOut[]>(`/api/drafts?include_promoted=${includePromoted ? "true" : "false"}`),
  createDraft: (content: string, source: string = "chat") =>
    http<import("../types").DraftOut>(`/api/drafts`, {
      method: "POST",
      body: JSON.stringify({ content, source }),
    }),
  updateDraft: (id: string, payload: { content?: string; pinned?: boolean }) =>
    http<import("../types").DraftOut>(`/api/drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteDraft: (id: string) =>
    http<{ deleted: string }>(`/api/drafts/${id}`, { method: "DELETE" }),
  promoteDrafts: (draftIds: string[], bodyOverride?: string, importance?: number) =>
    http<import("../types").PromoteResponse>(`/api/drafts/promote`, {
      method: "POST",
      body: JSON.stringify({
        draft_ids: draftIds,
        body_override: bodyOverride,
        importance,
      }),
    }),
  ingest: (payload: {
    title: string; content: string;
    category?: string; importance?: number; auto_link?: boolean;
  }) => http<IngestResponse>("/api/nodes", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  clusters: () => http<any[]>("/api/clusters"),
  recomputeClusters: () => http<{ recomputed: number }>("/api/clusters/recompute", { method: "POST" }),
  assistantAsk: (question: string) => http<AssistantResponse>("/api/assistant", {
    method: "POST", body: JSON.stringify({ question }),
  }),
  organise: (topic?: string) => http<any>("/api/assistant/organise", {
    method: "POST", body: JSON.stringify({ topic }),
  }),
  skills:    () => http<SkillOut[]>("/api/skills"),
  genSkill:  (focus?: string) => http<{ skill: SkillOut }>("/api/skills/generate", {
    method: "POST", body: JSON.stringify({ focus }),
  }),
};