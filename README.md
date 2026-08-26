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

### 3.0 一键启动 (推荐,普通用户用这个就行)

```bash
# 1. 装好 Docker (https://docs.docker.com/engine/install/)
# 2. 拉代码 (或解压缩源码包)
git clone <你的 repo URL> my2ndbrain
cd my2ndbrain

# 3. 一条命令起! (自动检测环境、自动 build image、自动等健康)
./start.sh
```

`start.sh` **会**自**动**:
- 检**查** Docker daemon、port 8000 **是**否**空**、**足**够**磁**盘**/RAM
- 如**果**没**有** `.env` 就**从** `.env.example` **复**制** (默认 `DB_PASSWORD=*** ***)**
- 如**果**没**有** `my2ndbrain:latest` image **就** build (~1GB, **首**次** 5-10 min, **后**续** 1-2 min)
- `docker compose up -d`
- **等** `/api/health` 返**回** 200 (最**多** 120s)
- 打**印**访**问** URL **和**管**理**命令

启**动**完**成**后**会**显**示**:
```
Web UI    : http://<host>:8000/
Health    : http://<host>:8000/api/health
Swagger   : http://<host>:8000/docs
Data      : stored in named volume 'my2ndbrain-data'
```

**日**常**管**理** (数**据** **全**部**保**留**):
```bash
./start.sh    # 启**动** (如**果**已**经**起**了**就**没**事)
./stop.sh     # **停**止** (数**据** **保**留**)
./status.sh   # **查**看**状**态** + last logs
./backup.sh   # 备**份**到** ./backups/*.sql
./restore.sh  # 从**备**份**恢**复** (**会** **清**空**当**前**数**据**)
docker logs -f my2ndbrain    # 实时看**日**志
```

**彻**底**清**理** (会** **丢**数**据**):
```bash
./stop.sh --rm            # 删**除** container
docker volume rm my2ndbrain-data   # 删**除** data volume
```

### 3.1 方式 A — Docker (推荐,5 分钟起)

**前置**: Docker 20+ 已装

**步骤 1 — 启动**

```bash
# 单 container 已包含 PostgreSQL 16 + pgvector + 后端 + 前端
# 第一次跑会下载镜像 (~1GB,需要 5-10 分钟)
docker build -t my2ndbrain:latest .

# 后台启动
#  -p 8000:8000    → 容器 8000 暴露到 host 8000
#  -v my2ndbrain-data:... → 数据持久化(重建镜像不丢数据)
#  -e DB_PASSWORD=...  → 数据库密码
docker run -d -p 8000:8000 \
    --name my2ndbrain \
    -v my2ndbrain-data:/var/lib/postgresql/data \
    -e DB_PASSWORD=*** my2ndbrain:latest
```

**步骤 2 — 启动后内置的 PostgreSQL 数据库首次自检**(entrypoint 自动跑)

容器第一次启动时,`docker-entrypoint.sh` 顺序执行:

```bash
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

整个流程 5-10 秒,看到 `Uvicorn running on http://0.0.0.0:8000` 就 OK 了。

**步骤 3 — 浏览器访问**

打开 `http://localhost:8000/` (同机) 或 `http://<host-ip>:8000/` (局域网/物理机)。

**步骤 4 — 验证**

```bash
# 看 logs
docker logs -f my2ndbrain

# 健康检查
curl http://localhost:8000/api/health
# → {"status":"ok","embedding_backend":"_SentenceTransformerEmbedder (dim=384)"}
```

**步骤 5 — 停止 / 重启 / 删除**

```bash
docker stop my2ndbrain            # 停止 (数据保留)
docker start my2ndbrain           # 再次启动
docker rm my2ndbrain              # 删除容器 (数据保留!)
docker rmi my2ndbrain:latest      # 删除镜像 (数据保留!)
docker volume rm my2ndbrain-data  # 真的删数据 (慎用!)
```

**数据备份与迁移** — 数据存在 `my2ndbrain-data` named volume 里(`/var/lib/docker/volumes/my2ndbrain-data/_data`)。备份用 `pg_dump`:

```bash
# 导出
docker exec my2ndbrain-prod su - postgres -c "pg_dump my2ndbrain" > backup_$(date +%Y%m%d).sql

# 恢复(到新容器)
docker exec -i my2ndbrain-prod su - postgres -c "psql my2ndbrain" < backup_20260826.sql
```

**详细配置 / 故障排查 / 网络访问 / registry 推送看 [DOCKER.md](DOCKER.md)**。

---

### 3.2 方式 B — 直接本地运行 (开发模式,代码 hot reload)

**前置**:
- Python 3.11+
- Node 20+
- PostgreSQL 16 + pgvector extension

#### 步骤 1 — 启动 PostgreSQL + pgvector

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

**其他系统**(CentOS / Arch / Windows) — 装 `postgresql-16` + `postgresql-16-pgvector` 包即可,后面的 SQL 完全一样。

#### 步骤 2 — 配置环境变量

```bash
cd my2ndbrain-repo
cp .env.example .env
# 编辑 .env,设 DB_PASSWORD=my2ndbrain(或上面你设的密码)
```

#### 步骤 3 — 启动后端 (开发模式)

```bash
# 装 Python deps
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 起 uvicorn (热重载)
PYTHONPATH=. uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

看到 `Uvicorn running on http://127.0.0.1:8000` 就 OK。日志在 `.run/backend.log` (如果用 start.sh)。

#### 步骤 4 — 启动前端 (开发模式)

```bash
cd frontend
npm install
npm run dev
# → Vite dev server: http://127.0.0.1:5173/
#    Vite 自动把 /api/* 代理到后端的 :8000
```

#### 步骤 5 — 一键起后端+前端 (推荐,生产前端)

```bash
# 用仓库根目录的 start.sh (把后端 + 前端 dev 一起管)
cd my2ndbrain-repo
./start.sh start    # 拉起后端 :8000 + 前端 :5173
./start.sh status   # 看进程 + http 健康
./start.sh logs     # tail 日志
./start.sh stop     # 停
```

`start.sh` 是**幂等**的:重复跑 `start` 不会重复拉起进程。

**生产模式**(让 FastAPI 服静态前端):
```bash
cd frontend && npm run build       # 输出到 frontend/dist/
cd ..
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000
# → http://<host>:8000/   (FastAPI 自己 serve React build)
```

---

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

## 附 — 故障速查

| 症状 | 原因 | 解 |
|---|---|---|
| `ModuleNotFoundError: No module named 'uvicorn'` | Dockerfile builder / runtime Python 版本不匹配 | `git pull` 重 build |
| `Could not import module "app.main"` | entrypoint 没 `cd $APP_HOME` | `git pull` 拉 ffb78e4 |
| `Connection refused` to 127.0.0.1:5432 | postgres 没起 / 5432 端口冲突 | `docker logs` 看 entrypoint 报错 |
| `value too long for type character varying(50)` | node title 太长 | 后端 schema 已扩到 200,重 build |
| 浏览器加载白屏 | 前端 dist 没 build | `cd frontend && npm run build` |
| Docker Hub 拉镜像 429 Too Many Requests | 配置的 mirror 限速 | 改用 `mirror.gcr.io` |
| `/api/health` 返回 500 | embedding 模型加载失败 | 用 `--build-arg HF_HUB_OFFLINE=1` 重 build (走 TF-IDF fallback) |
