# MySecondBrain · 我的第二大脑

AI 驱动的个人知识图谱 + 长期记忆系统。

把所有输入的知识、经验、学习记录自动整理成一个可探索、可生长、可理解的 3D 个人知识宇宙。

![screenshot](docs/screenshot.png)

## ✨ 核心特性

- 🧠 **3D 知识球**：所有节点以气泡形式分布在球面上，自动旋转、鼠标拖动、点击聚焦
- 🔗 **自动关联**：新建节点时，AI 自动计算与已有节点的向量相似度 + 关键词重合度，连成知识网络
- 🏷️ **智能分类**：AI 抽取关键词、推断分类，自动聚类成领域（如「大模型」「编程开发」「投资财经」…）
- ✏️ **标题校验**：检测标题与正文是否匹配，给出建议（如「标题 'DPO' 但内容在讲 PPO」）
- 🤖 **AI 助手**：自然语言问答，从你大脑里 RAG 出答案，并标注知识盲区
- ✨ **自动蒸馏 Skill**：从你最熟悉的领域自动提炼成结构化 Skill，可作为 Agent 记忆 / RAG 知识库

## 🌿 Git 工作流 (`dev` 分支)

- **不要直接 push 到 `main`** — main 是稳定 release，development 在 `dev` 分支上做。
- 第一次 clone 这台机器后：
  ```bash
  git checkout -b dev origin/dev   # 创建并跟踪远端 dev
  ```
- 日常 push / pull 都用 `dev`：
  ```bash
  git push origin dev
  git pull origin dev
  ```
- 本机有一个 `pre-push` hook 拦截到 `main`/`master` 的 push（`GIT_ALLOW_MAIN_PUSH=1` 可临时放行）。它在 `.git/hooks/pre-push`，新 clone 的机器还得手动装：
  ```bash
  ln -s ../../scripts/git-hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
  ```
## 🧱 架构

```
┌────────────────────────────────────────────────────────────────┐
│  Frontend (React 19 + TypeScript + Three.js / @react-three/fiber) │
│  - 3D 球体 + 节点 + 连线 + 拖拽 + tooltip                         │
│  - 详情面板 / 新增 Modal / AI 助手面板                            │
└──────────────────────────┬─────────────────────────────────────┘
                           │ REST
┌──────────────────────────▼─────────────────────────────────────┐
│  Backend  (FastAPI + SQLAlchemy 2 + Pydantic v2)                │
│  - /api/nodes        节点 CRUD + AI 摄入流水线                  │
│  - /api/graph        3D 球面布局 (Fibonacci 球 + 类心压缩)        │
│  - /api/assistant    RAG 问答 / 整理 / Skill 生成                │
│  - /api/clusters     领域聚合                                    │
│  - /api/skills       蒸馏技能管理                                │
└────────┬───────────────────────────────────┬────────────────────┘
         │                                   │
   ┌─────▼────────────┐             ┌────────▼─────────────┐
   │  PostgreSQL 16   │             │  Embedding / LLM    │
   │  + pgvector 0.6  │             │  - sentence-xform   │
   │  knowledge_node  │             │    (all-MiniLM-L6)   │
   │  knowledge_edge  │             │  - TF-IDF + SVD    │
   │  category_cluster│             │    (offline fallback)│
   │  ai_skill        │             │  - heuristic LLM    │
   └──────────────────┘             │  - OpenAI / Ollama  │
                                    │    (optional)       │
                                    └─────────────────────┘
```

## 🚀 启动

### ⚡ 一键启动（推荐）

仓库根目录有一个 `start.sh`，把启动 / 停止 / 查看状态 / 重置 / 看日志都包了。

```bash
# 前置：PostgreSQL 16 + pgvector 已经装好（见下方"高级：手工安装"），
#       .env 已经从 .env.example 复制并填了 DB_PASSWORD。

./start.sh start    # 后端 :8000 + 前端 :5173
./start.sh status   # 看进程 + http 健康
./start.sh stop     # 停
./start.sh reset    # 清空所有知识 + 重新灌种子 + 重启
./start.sh logs     # tail 日志（也可 logs backend / logs frontend）
./start.sh help     # 详细
```

`start.sh` 是**幂等**的：再跑一次 `start` 会复用已经在跑的进程；只有真的 down 才会拉起新进程。第一次跑会先建 `.env`（从 `.env.example` 复制，密码置空让用户填）。

启动成功后浏览器打开 **<http://127.0.0.1:5173/>**。

### 🐳 Docker 部署（一条命令起整套服务）

**推荐生产 / 远程 / 物理机访问场景。** 仓库里 `Dockerfile` + `docker-compose.yml` + `docker-entrypoint.sh` 把 **PostgreSQL 16 + pgvector + FastAPI 后端 + React 前端** 全打到一个镜像里：

```bash
docker build -t my2ndbrain:latest .
docker run -d -p 8000:8000 \
    --name my2ndbrain \
    -v my2ndbrain-data:/var/lib/postgresql/data \
    -e DB_PASSWORD=*** \
    my2ndbrain:latest
```

打开 **<http://<host>:8000/>** 即可。物理机浏览器可以直接访问（前端用相对 URL，不受 host 限制）。

数据用 Docker named volume 持久化，**`docker stop` + `docker rm` 不丢数据**，要彻底重置再 `docker volume rm my2ndbrain-data`。

详细配置 / 故障排查 / 数据迁移 / 跨机部署看 **[DOCKER.md](DOCKER.md)**。

### 高级：手工启动（想自己控每个进程的话）

#### 1. 后端

```bash
cd backend
pip install -r requirements.txt

# PostgreSQL + pgvector 一次性启动
sudo apt install -y postgresql-16 postgresql-16-pgvector
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE USER my2ndbrain WITH PASSWORD 'my2ndbrain' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE my2ndbrain OWNER my2ndbrain;"
sudo -u postgres psql -d my2ndbrain -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 初始化表 + 灌种子
PYTHONPATH=. python3 scripts/init_db.py
PYTHONPATH=. python3 scripts/seed.py     # 可选：放 7 条 demo 知识

# 启动 API
PYTHONPATH=. uvicorn app.main:app --host 127.0.0.1 --port 8000
```

#### 2. 前端

```bash
cd frontend
npm install
npm run dev               # 开发：Vite + HMR 在 :5173（带 /api 代理）
# 或
npm run build             # 生产构建，输出到 dist/，由 FastAPI 直接 serve
```

访问 <http://127.0.0.1:8000/>（生产构建） / <http://127.0.0.1:5173/>（dev）

### start.sh 在做什么

| 步骤 | 行为 |
|------|------|
| 1 | 检查 `python3 / node / npm / ss / curl` 是否在 PATH |
| 2 | `.env` 不存在就拷 `.env.example`，要求 DB_PASSWORD 非空 |
| 3 | 检测后端是否已在 :8000（health check），是 → adopt pid，否则拉起 |
| 4 | 检测前端是否已在 :5173，同上 |
| 5 | 打印访问 URL、日志路径、停止命令 |
| 6 | `start` 不存在的目录时自动 `npm install` |

### 🗃️ 数据库查询 (`query.sh`)

仓库根的 `query.sh` 是一个轻量的 psql 封装，**第一次跑会自动把 `.env` 里的 DB 凭据写到 `~/.pgpass`**，之后 psql 不用输密码。

```bash
./query.sh                  # 默认：列出所有节点标题（按 importance 倒序）
./query.sh --limit 10       # 只要前 10 个
./query.sh --all            # 带 UUID / category / importance / created_at
./query.sh --category 厨艺  # 按分类过滤
./query.sh --ids            # 只打印 UUID（每行一个）
./query.sh --json           # JSON 行输出（管道给 jq）
./query.sh psql             # 进 psql 交互模式
./query.sh --help           # 完整帮助
```

数据库共 4 张表：`knowledge_node`、`knowledge_edge`、`category_cluster`、`ai_skill`。直接在 `./query.sh psql` 里跑 `\d` / `\dt` 看 schema。

## 🔌 API 一览

| Method | Path | 说明 |
|--------|------|------|
| GET    | `/api/health`                 | 健康检查 + 当前 embedding 后端 |
| GET    | `/api/nodes`                  | 列出节点（支持 `?category=`） |
| POST   | `/api/nodes`                  | 新增节点（自动跑 AI 摄入管线） |
| GET    | `/api/nodes/{id}`             | 节点详情（含邻居） |
| PATCH  | `/api/nodes/{id}`             | 更新节点（自动重新 embedding） |
| DELETE | `/api/nodes/{id}`             | 删除节点（级联清理边） |
| GET    | `/api/graph`                  | 3D 球面布局（nodes + edges + clusters + stats） |
| GET    | `/api/clusters`               | 列出领域 |
| POST   | `/api/clusters/recompute`     | 重算领域大小 + 颜色 |
| POST   | `/api/assistant`              | RAG 问答（同时返回知识盲区） |
| POST   | `/api/assistant/organise`     | 按主题整理成知识树 |
| GET    | `/api/skills`                 | 列出蒸馏的 Skill |
| POST   | `/api/skills/generate`        | 从最强领域蒸馏 Skill |

### 摄入管线 (`POST /api/nodes`)

```
title + content  →  ① title_check     (启发式 LLM)
                  →  ② extract         (启发式 LLM: keywords + summary + category)
                  →  ③ embed           (sentence-transformers / TF-IDF fallback)
                  →  ④ persist         (PostgreSQL + pgvector)
                  →  ⑤ auto_link       (KNN + 关键词 jaccard，加边)
                  →  ⑥ upsert_cluster  (领域聚合)
```

响应示例：

```json
{
  "node": { "id": "...", "title": "GRPO", "category": "AI人工智能", "...": "..." },
  "title_check": { "ok": false, "confidence": 0.0, "suggestion": "Quantized", "reason": "..." },
  "suggested_links": [
    { "target_id": "...", "target_title": "LoRA", "similarity": 0.566, "applied": true }
  ],
  "cluster_suggestion": { "name": "AI人工智能", "size": 7 }
}
```

## ⚙️ 配置 (`backend/app/core/config.py`)

通过环境变量覆盖：

```bash
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_USER=my2ndbrain
export DB_PASSWORD=my2ndbrain
export DB_NAME=my2ndbrain
export EMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2
export EMBED_DEVICE=cpu                # 或 cuda
export LLM_PROVIDER=heuristic           # heuristic / openai / ollama
export OPENAI_API_KEY=sk-...            # LLM_PROVIDER=openai 时需要
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export AUTO_EDGE_THRESHOLD=0.55
```

## 🧪 Embedding 后端选择

`app/services/embedding.py` 自动选择：

1. **sentence-transformers** (`all-MiniLM-L6-v2`, 384 维, ~90MB) — 装好即用
2. **TF-IDF + TruncatedSVD** (384 维) — 纯 sklearn fallback，**离线**、无需下载

切到真模型：

```bash
pip install -U sentence-transformers httpx[socks]
# 重启后端，health 返回 "_SentenceTransformerEmbedder"
```

## 🛣️ 路线图

| 阶段 | 状态 | 内容 |
|------|------|------|
| 一 | ✅ | DB / CRUD / pgvector / AI 摄入 / 3D 球 / 详情 |
| 二 | ✅ | 自动聚类 / 关联发现 / AI 整理 / Skill 生成 |
| 三 | ⏳ | Agent Memory 协议 / RAG 对接 / 多用户 / 鉴权 / 增量导入 / 移动端 |

阶段三需要的：
- 把 `AISkill` 的 `body` 字段导出为可挂载到 Claude / Hermes Agent 的 SKILL.md
- 把 `assistant_answer()` 暴露成 OpenAI-compatible `/v1/chat/completions` 端点，让任何 Agent 把你的第二大脑当 RAG 用