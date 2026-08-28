# MySecondBrain · 我的第二大脑

> AI 驱动的个人知识图谱 + 长期记忆系统 —— 把零散的笔记、学习、经验、灵感,自动长成一个可探索、可生长、可理解的三维个人知识宇宙。

![screenshot](docs/screenshot.png)

---

## 0. 一键启动

```bash
git clone https://github.com/hyongtao-code/my2ndbrain.git && cd my2ndbrain
./compose.sh start                    # Docker compose
# 或者:
./start.sh start                      # 本地直接启动
```

打开 `http://localhost:8000/`。

---

## 1. 软件简介

**MySecondBrain** 是一个 100% 本地运行、开箱即用的「**第二大脑**」应用 —— 你的所有零散知识(笔记、问题、灵感、读书摘录、聊天对话)在三维球面上以节点的形式**自动**组织起来,系统会:

- 存你输入的任何东西
- LLM辅助识别关键词、推断分类
- LLM辅助建关联(谁和谁相关)
- LLM辅助归类聚类(像 "AI" / "日本战国" / "Python" 这种)
- 用 RAG 检索问答
- 把粗糙的草稿**清洗**成结构化的知识节点

> 和 Notion / Obsidian / Logseq 相比,MySecondBrain 强调:
>
> - **LLM主动参与**(自动关联、自动归类、自动回答问题)
> - **三维可视化**(球面 + 自动旋转 + 拖拽 + 关联线)
> - **不联网也能用**(本地 LLM + 本地 embedding)

---

## 2. 功能架构

### 2.1 顶层架构(单进程,3 层)

```
┌──────────────────────────────────────────────────┐
│  浏览器 (任何设备)                                 │
│  React SPA → 3D 球面 + 节点 + 关联线               │
│  HTTPS/HTTP over port 8000                       │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────┐
│  FastAPI (Python 3.11)                           │
│  - /api/nodes, /api/drafts, /api/graph           │
│  - /api/llm/* (设置 / 草稿整理 / RAG 问答)          │
│  - 静态 serve 前端 dist/                          │
│  uvicorn 0.27  ·  port 0.0.0.0:8000              │
└────┬───────────────────────────────────┬─────────┘
     │                                   │
     ▼                                   ▼
┌────────────────────┐         ┌─────────────────────┐
│  PostgreSQL 16     │         │  Embedding model    │
│  + pgvector ext    │         │  sentence-transform │
│  - knowledge_node  │ ◄──────│  (or TF-IDF 离线)     │
│  - knowledge_edge  │         └─────────────────────┘
│  - knowledge_draft │
│  - ai_skill        │
│  - category_cluster│
│  port 5432 (内部)  │
└────────────────────┘
```

### 2.2 前端核心模块

| 模块 | 文件 | 职责 |
|---|---|---|
| 3D 球面 | `KnowledgeSphere.tsx` | three.js + R3F 渲染节点、关联线、自动旋转、鼠标拖拽 |
| AI 助手面板 | `AssistantPanel.tsx` | Ask / Suggest / Settings / Draft 四 tab,可放大占左半屏 |
| 节点详情 | `NodeDetail.tsx` | 查看 / 编辑标题、内容、分类、关联 |
| 草稿 | `DraftPanel.tsx` | 快速记 → 调 AI 整理 → 入库 |
| 导入 | `ImportModal.tsx` | .md 批量上传(可多选) |
| 导出 | `ExportModal.tsx` | 多选节点 → 下载 zip / 单个 .md |
| FAB | `App.tsx` 右下角 + | 浮动操作按钮(加节点 / 上下传) |
| 搜索 | `App.tsx` 顶部 | 实时下拉(按标题 / 内容 / 关键词,top 5) |
| i18n | `i18n/` | 中英双语切换 |

### 2.3 后端核心 API

| 路径 | 用途 |
|---|---|
| `GET /api/health` | 健康检查(返回 embedding 后端) |
| `GET /api/nodes` | 列出所有节点 |
| `POST /api/nodes` | 创建新节点 |
| `PATCH /api/nodes/{id}` | 编辑节点 |
| `DELETE /api/nodes/{id}` | 删除节点 |
| `GET /api/drafts` | 列出草稿 |
| `POST /api/drafts` | 创建草稿(快速记) |
| `POST /api/llm/curate/clean-draft` | **AI 整理草稿** → 标准节点 |
| `POST /api/llm/curate/find-merges` | **AI 建议合并** (相似节点) |
| `POST /api/llm/curate/find-edges` | **AI 建议新关联** (同类节点) |
| `POST /api/llm/curate/ask` | **RAG 问答**(基于你的知识库) |
| `POST /api/llm/config` | 配置 LLM provider / key / model |
| `POST /api/llm/test` | 测试 LLM 连接 |
| `GET /api/graph` | 返回节点 + 关联(给 3D 球面用) |
| `POST /api/nodes/import-md` | 批量上传 .md |
| `GET /api/nodes/{id}/export-md` | 单节点导出 .md |
| `POST /api/nodes/export-md-batch` | 多节点打包导出 zip |

### 2.4 数据模型

```sql
-- 节点 = 一条知识
knowledge_node(id, title, content, source, category,
               importance, keywords, embedding vector(384), created_at, updated_at)
-- source: 'manual' | 'md-import' | 'llm-clean' | 'llm-merge'
-- embedding: sentence-transformers/all-MiniLM-L6-v2 (or TF-IDF fallback)

-- 关联 = 节点 A 跟 节点 B 有关系
knowledge_edge(id, source_id, target_id, relation, weight, created_at)

-- 草稿 = 粗糙的还没整理的笔记
knowledge_draft(id, content, source, promoted_to_node_id, created_at)

-- 分类
category_cluster(id, name, description, centroid vector(384), node_count)
```

---

## 3. 使用方法

本仓库同时提供两种启动方式, 二选一:

> 不要同时跑 `./start.sh start` 和 `./compose.sh start` — 它们 都要占 8000 端口, 会 冲突!

### 3.1 本地直接启动 (开发模式,推荐给开发者)

> `./start.sh` 是 直接本地启动 (uvicorn + vite dev), 不用 docker。

```bash
git clone https://github.com/hyongtao-code/my2ndbrain.git
cd my2ndbrain

# 一条命令起 (前置: PostgreSQL 16 + pgvector + Python 3.11 + Node 20)
./start.sh start      # 启动后端 + 前端
./start.sh stop       # 停两个
./start.sh status     # 查看状态 + 端口占用
./start.sh logs       # tail -20 后端+前端 log
./start.sh reset      # stop + 清数据 (会 丢 所有 nodes/drafts/edges, 不要 轻易跑)
./start.sh help       # 详细说明
```


### 3.2 Docker compose 启动

> `./compose.sh start` 是 Docker compose 启动 (postgres + pgvector + 后端 + 前端 全在一个 image 里)。

```bash
# 前置: 装好 Docker 20+
git clone https://github.com/hyongtao-code/my2ndbrain.git
cd my2ndbrain

# 一条命令起 (首次会自动 build image, 5-10 min)
./compose.sh start                     # smart: 只有 image 不存在才 build
./compose.sh start --rebuild          # 强制重新 build
./compose.sh start --pull             # 拉最新 base image (之后再 build)
./compose.sh start --help             # 详细说明
./compose.sh stop                      # 停 container (数据保留)
./compose.sh stop --rm                 # 停并删除 container (数据仍然保留)
./compose.sh --help                    # 完整 help

# 浏览器访问:
# http://localhost:8000/   (FastAPI + React build)

# 彻底清除数据 (慎用):
docker volume rm my2ndbrain-data
```

启动完成后会显示:
```
Web UI    : http://<host>:8000/
Health    : http://<host>:8000/api/health
Swagger   : http://<host>:8000/docs
Data      : stored in named volume 'my2ndbrain-data'
```

## 4. 视频教程

> 📹 **视频教程位置** 

---
