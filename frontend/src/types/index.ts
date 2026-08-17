export type NodeOut = {
  id: string;
  title: string;
  content: string;
  summary: string;
  category: string;
  keywords: string[];
  importance: number;
  source: string;
  created_at?: string;
  updated_at?: string;
  neighbor_count?: number;
  neighbors?: Array<{ id: string; title?: string; score: number; relation: string }>;
};

export type GraphNode = {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  importance: number;
  x: number; y: number; z: number;
  cluster_color: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  similarity_score: number;
  relation_type: string;
};

export type GraphCluster = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  color: string;
  size: number;
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  stats: {
    node_count: number;
    edge_count: number;
    cluster_count: number;
    categories: string[];
  };
};

export type SuggestedLink = {
  target_id: string;
  target_title: string;
  target_category: string;
  similarity: number | null;
  applied: boolean;
};

export type IngestResponse = {
  node: NodeOut;
  suggested_links: SuggestedLink[];
  title_check: { ok: boolean; confidence: number; suggestion: string; reason: string };
  cluster_suggestion: { name: string; size: number };
};

export type AssistantResponse = {
  answer: string;
  related_nodes: Array<{ id: string; title: string; summary: string; category: string; keywords: string[]; similarity: number }>;
  blind_spots?: { missing: string[]; covered: string[] };
};

export type SkillOut = {
  id: string;
  name: string;
  summary: string;
  body: string;
  trigger: string;
  based_on_nodes: string[];
  created_at?: string;
};

// -------- Drafts (transient inbox) --------

export type DraftOut = {
  id: string;
  content: string;
  source: string;
  pinned: boolean;
  promoted_to_node_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PromoteResult = {
  draft_id: string;
  merged_with: string[];
  node: any | null;        // NodeOut-shaped or null on failure
  error: string | null;
};

export type PromoteResponse = {
  results: PromoteResult[];
  promoted_count: number;
  failed_count: number;
};
