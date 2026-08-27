# MySecondBrain · 我的第二大脑

> AI 驱动的个人知识图谱 + 长期记忆系统 —— 把零散的笔记、学习、经验、灵感,自动长成一个可探索、可生长、可理解的三维个人知识宇宙。

![screenshot](docs/screenshot.png)

---

## 1. 软件简介

**MySecondBrain** 是一个 100% 本地运行、开箱即用的「**第二大脑**」应用 —— 你的所有零散知识(笔记、问题、灵感、读书摘录、聊天对话)在三维球面上以节点的形式**自动**组织起来,系统会:

- 存你输入的任何东西
- 自动识别关键词、推断分类
- 自动建关联(谁和谁相关)
- 自动归类聚类(像 "AI" / "日本战国" / "Python" 这种)
- 用 RAG 检索问答(`"我之前讲过 LLM 微调的事,具体怎么操作?"`)
- 把粗糙的草稿**清洗**成结构化的知识节点

> 和 Notion / Obsidian / Logseq 相比,MySecondBrain 强调:
>
> - **AI 主动参与**(自动关联、自动归类、自动回答问题)
> - **三维可视化**(球面 + 自动旋转 + 拖拽 + 关联线)
> - **不联网也能用**(本地 LLM + 本地 embedding)

---

## 2. 功能架构

### 2.1 顶层架构(单进程,3 层)

```
┌──────────────────────────────────────────────────┐
│  浏览器 (任何设备)                                │
│  React SPA → 3D 球面 + 节点 + 关联线              │
│  HTTPS/HTTP over port 8000                        │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────┐
│  FastAPI (Python 3.11)                           │
│  - /api/nodes, /api/drafts, /api/graph          │
│  - /api/llm/* (设置 / 草稿整理 / RAG 问答)     │
│  - 静态 serve 前端 dist/                          │
│  uvicorn 0.27  ·  port 0.0.0.0:8000              │
└────┬───────────────────────────────────┬─────────┘
     │                                   │
     ▼                                   ▼
┌────────────────────┐         ┌────────────────────┐
│  PostgreSQL 16     │         │  Embedding model   │
│  + pgvector ext    │         │  sentence-transform │
│  - knowledge_node  │ ◄──────│  (or TF-IDF 离线) │
│  - knowledge_edge  │         └────────────────────┘
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

-- AI 提炼的技能
ai_skill(id, name, description, steps, triggers, source_node_id, created_at)

-- 分类
category_cluster(id, name, description, centroid vector(384), node_count)
```

---

## 3. 使用方法

本仓库同时** 提供两种启动方式**, 二选一:

| 方式 | 脚本 | 实际位置 | 适合谁 | 数据存哪 |
|---|---|---|---|---|
| **A. Docker compose (推荐,产品/服务器/给朋友用**)** | `./start.sh` | `scripts/start.sh` (root 有 thin shim) | 普通用户**; 不想装 PostgreSQL/Node/Python | host 上的 named volume `my2ndbrain-data` |
| **B. 本地直接 (开发/调试/贡献代码)** | `./dev.sh` | `scripts/dev.sh` (root 有 thin shim) | 开发者; 要看** Vite HMR / 改** Python 源码** | 你装的** postgres (host 或 docker) |

所有 user-facing 脚本 (`start` / `stop` / `status` / `backup` / `restore` / `prereq` / `dev`) 都在 `scripts/` 下, root 只有 1 行 shim 让 `./start.sh` 和 `./dev.sh` 还能直接用 (与 `Dockerfile COPY docker-entrypoint.sh` 不冲突 — entrypoint 在 root, 没移动)。 你可以用 `./scripts/start.sh` 或 `./start.sh` — 都能 work。

不要同时跑 `./start.sh` 和 `./dev.sh` — 它们 都要占 8000 端口**, 会 冲突**!

### 3.0 一键启动 (推荐,普通用户用这个就行)

```bash
# 1. 装好 Docker (https://docs.docker.com/engine/install/)
# 2. 拉代码 (或解压缩源码包)
git clone <你的 repo URL> my2ndbrain
cd my2ndbrain

# 3. 一条命令起! (自动检测环境、自动 build image、自动等健康)
./start.sh
```

> `start.sh` 在 `scripts/start.sh` (root 有 shim 转发)。 你可以用 `./start.sh` 或 `./scripts/start.sh`, 两个一样。

`start.sh` 会自动:
- 检查 Docker daemon、port 8000 是否空、足够磁盘/RAM
- 如果没有 `.env` 就从 `.env.example` 复制** (默认 `DB_PASSWORD=*** ***)**
- 如果没有 `my2ndbrain:latest` image 就 build (~1GB, 首次** 5-10 min, 后续** 1-2 min)
- `docker compose up -d`
- 等 `/api/health` 返回 200 (最多 120s)
- 打印访问 URL 和管理命令

启动完成后会显示:
```
Web UI    : http://<host>:8000/
Health    : http://<host>:8000/api/health
Swagger   : http://<host>:8000/docs
Data      : stored in named volume 'my2ndbrain-data'
```

日常管理** (数据 全部保留**):
```bash
./start.sh    # 启动 (如果已经起了就没事)
./stop.sh     # 停止** (数据 保留**)
./status.sh   # 查看状态 + last logs
./backup.sh   # 备份到 ./backups/*.sql
./restore.sh  # 从备份恢复** (会 清空当前数据**)
docker logs -f my2ndbrain    # 实时看日志
```

彻底清理** (会** 丢数据):
```bash
./stop.sh --rm            # 删除 container
docker volume rm my2ndbrain-data   # 删除 data volume
```

### 3.0b 本地直接启动 (开发模式,开发者用这个)

> 如果你要改 Python 源码、改前端 component、看 Vite HMR 热重载, 用 `./dev.sh` 代替 `./start.sh`。 它启动的是 host 上的 `uvicorn` + `vite dev` (热重载), 不是 Docker 容器。
>
> 前置:
> - Python 3.11+ (`apt install python3.11-venv`)
> - Node 20+ (`apt install nodejs npm`)
> - PostgreSQL 16 + pgvector (见 § 3.2 手工安装) 或 跑完 `docker run -d postgres:16-pgvector` 后让** host 上的** backend 连它

```bash
./dev.sh status    # 看看 PostgreSQL / port 8000 / port 5173 状态
./dev.sh start     # 启动后端 (uvicorn) + 前端 (Vite dev)
./dev.sh logs      # tail -20 后端+前端 log
./dev.sh status    # 再查状态 (start 后)
./dev.sh stop      # 停

# 浏览器访问:
#   http://localhost:8000/    (FastAPI + React dev build)
#   http://localhost:5173/    (Vite dev server, HMR)
```

> `dev.sh` 在 `scripts/dev.sh` (root 有 shim 转发)。 你可以用 `./dev.sh` 或 `./scripts/dev.sh`, 两个一样。

`dev.sh` 支持的子命令:
```bash
./dev.sh start      # 启动后端 + 前端 (idempotent: 已经 在跑就不会重启)
./dev.sh stop       # 停两个
./dev.sh status     # 查看状态 + 端口占用
./dev.sh logs       # tail -20 后端+前端 log
./dev.sh reset      # stop + 清数据** (会** 丢 所有** nodes/drafts/edges, 不要** 轻易跑)
./dev.sh help       # 详细说明
```

### 3.1 Docker 深入:启动顺序 (entrypoint 内部)

> 新手用户不用看这一节。 一键启动 `./start.sh` 会自动做完所有事。 这一节只记录 `docker-entrypoint.sh` 在容器里的 8 步执行序列,方便排查问题时对账。

容器第一次启动时, `docker-entrypoint.sh` 顺序执行:

```
1. 检查 /var/lib/postgresql/data 是否为空
   → 空 → 跑 initdb (创建 PostgreSQL cluster)
   → 已有 PG_VERSION → 跳过 (直接用历史数据)

2. 配置 pg_hba.conf 为 trust (容器内本地访问无需密码)

3. listen_addresses = '127.0.0.1'  (容器内本地端口)

4. 启动 postgres:
   gosu postgres pg_ctl -D /var/lib/postgresql/data start

5. 等待 postgres ready (pg_isready -h 127.0.0.1)

6. 创建 role + database (idempotent):
   CREATE ROLE my2ndbrain LOGIN PASSWORD '$DB_PASSWORD';
   CREATE DATABASE my2ndbrain OWNER my2ndbrain;

7. 在 my2ndbrain 库里:
   CREATE EXTENSION IF NOT EXISTS vector;  (pgvector)

8. exec uvicorn 启动后端 on 0.0.0.0:8000
```

整个流程 5-10 秒, 看到 `Uvicorn running on http://0.0.0.0:8000` 就 OK 了。

`./start.sh` 的 summary 会打印 healthcheck URL, 你也可以直接 `curl http://localhost:8000/api/health` 验证。

详细配置 / 故障排查 / 网络访问 / registry 推送 / registry 镜像优化 看 [DOCKER.md](DOCKER.md)。

### 3.2 本地模式深入:跨平台 PostgreSQL 启动

> 新手用户不用看这一节。 `./dev.sh` 会自动检测 host 上是否已经有 postgres 在 5432 跑。 这一节只是详细的手动 PostgreSQL 装置文档, 给你不想用 docker 但也不想让 `./dev.sh` 管 postgres 的情况用。

**macOS (Homebrew)**:
```bash
brew install postgresql@16
brew services start postgresql@16

# 创建库
psql postgres -c "CREATE USER my2ndbrain WITH PASSWORD 'my2ndbrain' SUPERUSER;"
psql postgres -c "CREATE DATABASE my2ndbrain OWNER my2ndbrain;"
psql -d my2ndbrain -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

**Ubuntu / Debian (官方 apt)**:
```bash
# 1. 装 postgresql 16 + pgvector
sudo apt install -y postgresql-16 postgresql-16-pgvector

# 2. 启动系统 postgres 服务
sudo pg_ctlcluster 16 main start
# 验证: ss -tlnp | grep 5432  →  0.0.0.0:5432 postgres 就有

# 3. 创建库 + 装 pgvector
sudo -u postgres psql -c "CREATE USER my2ndbrain WITH PASSWORD 'my2ndbrain' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE my2ndbrain OWNER my2ndbrain;"
sudo -u postgres psql -d my2ndbrain -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 4. 验证
sudo -u postgres psql -d my2ndbrain -c "\dx"
# → 应看到 'vector' 扩展
```

**其他系统** (CentOS / Arch / Windows) — 装 `postgresql-16` + `postgresql-16-pgvector` 包即可, 后面的 SQL 完全一样。

自动化版本的 ./dev.sh start 已经帮你跑完了上面所有事情 (创建 role + db + pgvector extension), 所以手动只在你要单独管 PostgreSQL 时用。

## 4. 视频教程(待上传)

> 📹 **视频教程位置** — 即将上传,届时将在此放置 YouTube / B 站嵌入链接
>
> **计划内容**:
> - 第一集:5 分钟上手(用 Docker 一键起,创 3 个节点,跑一次 AI 整理)
> - 第二集:3D 球面交互(旋转 / 拖拽 / 搜索 / 过滤 / 关联)
> - 第三集:AI 助手 4 tab 详解(Ask 问答 / Suggest 整理 / Settings 配 LLM / Draft 草稿)
> - 第四集:数据导入导出(批量 .md / 单节点 .md)
> - 第五集:高级(自定义 LLM、重新计算 embedding、多设备同步)
>
> ⏳ 视频制作中,占位待上传

---
