# SysMonitor AI Agent

An AI-powered system monitoring dashboard built with a **LangGraph ReAct agent** backend and a **Next.js** frontend. The agent can inspect CPU, memory, disk, network, processes, and logs in real time, answer natural language questions about your system, and remember conversation history across sessions.

---

## Table of Contents

1. [Features](#features)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Setup & Installation](#setup--installation)
5. [Running the Application](#running-the-application)
6. [Architecture](#architecture)
7. [API Reference](#api-reference)
8. [Environment Variables](#environment-variables)
9. [Optional Tasks Implemented](#optional-tasks-implemented)
10. [Development Journey & Troubleshooting](#development-journey--troubleshooting)
11. [AI-Assisted Development: Prompting Strategy](#ai-assisted-development-prompting-strategy)
12. [Common Errors Quick Reference](#common-errors-quick-reference)
13. [Example Questions](#example-questions)
14. [LangSmith Setup](#langsmith-setup-hard-task)
15. [Project Review Talking Points](#project-review-talking-points)
16. [Conclusion](#conclusion)

---

## Features

| Feature | Requirement |
|---|---|
| CPU, Memory, Disk, Network, Process, Log monitoring | Core task |
| LangGraph ReAct agent with 8 tools | Core task |
| Next.js dashboard with real-time charts | Core task |
| Long-term memory via SQLite checkpointer | Medium optional |
| Token usage + cost display per response | Medium optional |
| External API call (`ip-api.com` geolocation) | Medium optional |
| LangSmith tracing & observability | Hard optional |

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14 + React | UI framework and routing |
| Frontend | TypeScript | Type-safe JavaScript |
| Frontend | Tailwind CSS | Utility-first styling |
| Backend | FastAPI (Python) | REST API + WebSocket server |
| Backend | psutil | System metrics collection |
| Backend | LangGraph + LangChain | ReAct agent framework |
| Backend | OpenAI API | AI chat completions (GPT-4o-mini) |
| Backend | SQLite | Long-term conversation memory |
| Backend | Uvicorn | ASGI server |
| Communication | WebSocket | Real-time chat streaming |
| Communication | REST (HTTP) | Stats and tools polling |
| Observability | LangSmith | Agent tracing and monitoring |

---

## Project Structure

```
sysmon-agent/
├── backend/
│   ├── agent.py          # LangGraph agent, all 8 tools, memory
│   ├── main.py           # FastAPI server (REST + WebSocket)
│   ├── requirements.txt
│   └── .env.example      # Copy to .env and fill in keys
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx       # Main dashboard page
    │   │   ├── layout.tsx
    │   │   └── globals.css
    │   ├── components/
    │   │   ├── MetricCard.tsx    # Radial gauge for CPU/RAM/Disk
    │   │   ├── HistoryChart.tsx  # 60-second resource history line chart
    │   │   ├── TokenDisplay.tsx  # Token usage + cost display
    │   │   └── ToolPanel.tsx     # Enable/disable individual agent tools
    │   └── lib/
    │       └── api.ts            # API client + cost calculation
    ├── package.json
    ├── tailwind.config.js
    └── next.config.js
```

---

## Setup & Installation

### Prerequisites

- Python 3.9+
- Node.js 18+ and npm
- Git Bash or any terminal (Windows users: Git Bash recommended)
- OpenAI API key

### 1. Clone and configure

```bash
git clone <your-repo-url>
cd sysmon-agent
```

### 2. Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-...            # Required
LANGCHAIN_API_KEY=ls-...         # Required for LangSmith (Hard task)
LANGCHAIN_TRACING_V2=true        # Enables LangSmith tracing
LANGCHAIN_PROJECT=sysmon-agent   # LangSmith project name
DEFAULT_MODEL=gpt-4o-mini
MEMORY_DB=sysmon_memory.db
```

> ⚠️ **Important:** Add CORS middleware to `main.py` (after `app = FastAPI()`) or the frontend will be blocked by the browser's security policy:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Start the backend:

```bash
uvicorn main:app --reload --port 8001
```

### 3. Frontend

```bash
cd ../frontend
npm install
npx next dev
```

Open [http://localhost:3000](http://localhost:3000) (or 3001/3002 if those ports are occupied).

---

## Running the Application

> ⚠️ **Both servers must run simultaneously in two separate terminal windows. Do not close either terminal while using the application.**

**Terminal 1 — Backend:**
```bash
cd sysmon-agent/backend
uvicorn main:app --reload --port 8001
```

**Terminal 2 — Frontend:**
```bash
cd sysmon-agent/frontend
npx next dev
```

Then open your browser at the URL shown by Next.js.

---

## Architecture

```
Next.js (port 3000)
    │  REST /quick-stats  (polling every 3s for live metrics)
    │  POST /chat         (single-turn)
    │  WS  /ws/chat       (streaming agent responses)
    ▼
FastAPI (port 8001)
    │
    ▼
LangGraph ReAct Agent
    ├── call_model  →  ChatOpenAI (streaming)
    ├── call_tools  →  8 psutil/httpx tools
    └── SQLite checkpointer  →  long-term memory per session_id
    │
    ├── LangSmith (LANGCHAIN_TRACING_V2=true)
    │   Traces every agent run: tool calls, tokens, latency
    │
    └── Tools:
        ├── get_cpu_stats                psutil
        ├── get_memory_stats             psutil
        ├── get_disk_stats               psutil
        ├── get_network_stats            psutil
        ├── list_processes               psutil
        ├── read_system_logs             /var/log or journalctl
        ├── get_system_info              platform + psutil
        └── get_public_ip_geolocation    ip-api.com (external API)
```

### Agent Flow (ReAct Loop)

1. User sends a message via WebSocket
2. The `call_model` node sends the conversation (with system prompt) to the LLM
3. If the LLM decides to call tools, the graph transitions to `call_tools`
4. Tool results are appended to the message list and sent back to `call_model`
5. The loop continues until the LLM returns a plain text response
6. Every state transition is checkpointed to SQLite (long-term memory)
7. LangSmith traces the entire run automatically via environment variables

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/tools` | List all agent tools |
| GET | `/quick-stats` | Live system metrics (no agent) |
| POST | `/chat` | Single-turn REST chat |
| GET | `/history/{session_id}` | Load conversation from memory |
| WS | `/ws/chat` | Streaming agent chat |

### WebSocket Message Format

**Send:**
```json
{
  "message": "How is my CPU doing?",
  "session_id": "uuid-here",
  "model": "gpt-4o-mini",
  "temperature": 0.0,
  "enabled_tools": ["get_cpu_stats", "get_memory_stats"]
}
```

**Receive (streamed):**
```json
{ "type": "token",     "content": "Your CPU..." }
{ "type": "tool_call", "content": "🔧 Querying system..." }
{ "type": "done",      "session_id": "...", "token_usage": { ... } }
{ "type": "error",     "content": "error message" }
```

### Example Response — `/quick-stats`

```json
{
  "cpu": { "percent": 29.3, "cores": 8, "per_core": [25.4, 15.9, 34.6, 17.9] },
  "memory": { "percent": 79.0, "used_gb": 13.36, "total_gb": 16.92 },
  "disk": { "percent": 82.6, "used_gb": 210.43, "total_gb": 254.69 },
  "network": { "bytes_sent_mb": 83.39, "bytes_recv_mb": 1333.22 },
  "system": { "hostname": "JOSELYNN", "os": "Windows 10", "uptime": "105h 33m 21s" }
}
```

---

## Environment Variables

### Backend (`.env`)

```env
OPENAI_API_KEY=sk-...            # Required: your OpenAI API key
LANGCHAIN_API_KEY=ls-...         # Required for LangSmith
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=sysmon-agent
DEFAULT_MODEL=gpt-4o-mini
MEMORY_DB=sysmon_memory.db
```

### Frontend (`next.config.js`)

```js
NEXT_PUBLIC_API_URL=http://localhost:8001
```

> **Note:** The `NEXT_PUBLIC_` prefix is required for Next.js to expose environment variables to the browser. Without it, the variable is only available server-side.

---

## Optional Tasks Implemented

### Medium: Long-term Memory (LangGraph SQLite Checkpointer)

Every conversation is persisted to `sysmon_memory.db` using `SqliteSaver`. Sessions are identified by `session_id` (UUID), which the frontend generates once and reuses. Close the browser, come back, and the agent still remembers your conversation.

```python
memory = SqliteSaver.from_conn_string(memory_db_path)
graph.compile(checkpointer=memory)
```

### Medium: Token Usage + Cost Display

Every `call_model` node extracts `usage_metadata` from the LLM response and accumulates it in the graph state. The WebSocket sends a final `token_usage` object when the run completes. The frontend displays per-response and session-total token counts with USD cost calculated from a pricing table keyed by model name.

### Medium: External API Tool — `get_public_ip_geolocation`

Uses `ip-api.com` (free, no key required) to fetch the machine's public IP and geolocation data. The agent can answer *"Where is this server located?"* or include geo data in a full system report.

### Hard: LangSmith Observability

Set `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` in `.env`. LangSmith automatically instruments every LangGraph run showing full traces, token counts, latency per node, cost per run, and side-by-side comparisons — all without any code changes.

---

## Development Journey & Troubleshooting

This section documents every real problem encountered during development and the exact steps taken to resolve each one.

---

### Issue #1: Port 8000 Access Denied (WinError 10013)

**Problem:**
```
ERROR: [WinError 10013] An attempt was made to access a socket
in a way forbidden by its access permissions
```

**Root Cause:** Port 8000 was blocked by Windows Firewall or already in use by another process.

**Solution:** Start the backend on port 8001 instead:
```bash
uvicorn main:app --reload --port 8001
```

---

### Issue #2: Frontend Running on Port 3002

**Problem:**
```
⚠ Port 3000 is in use, trying 3001 instead.
⚠ Port 3001 is in use, trying 3002 instead.
```

**Root Cause:** Ports 3000 and 3001 were occupied by other running applications.

**Solution:** Next.js automatically found and used port 3002. Application accessed at `http://localhost:3002`.

---

### Issue #3: Backend Offline Warning in UI

**Problem:** Despite both servers running, the UI showed *"Backend offline — start FastAPI server"*. The frontend was connecting to port 8000 instead of 8001.

**Investigation:**
```bash
grep -r "localhost" ~/Downloads/sysmon-agent/sysmon-agent/frontend/src
```

Found `next.config.js` was overriding the correct port with 8000.

**Solution:**
```js
// next.config.js
NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001",
```

Then deleted build cache:
```bash
rm -rf .next
npx next dev
```

---

### Issue #4: CORS Policy Blocking API Requests

**Problem (browser console):**
```
Access to fetch at 'http://localhost:8001/quick-stats' from origin
'http://localhost:3002' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Root Cause:** FastAPI had no CORS middleware. Browsers block cross-origin requests (port 3002 → port 8001) by default.

**Solution:** Added to `main.py`:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

> Must be placed after `app = FastAPI()` but before any route definitions.

---

## AI-Assisted Development: Prompting Strategy

Claude AI (claude.ai) was used throughout development to diagnose errors and find solutions fast. Below are the exact prompts used and what each achieved.

### Prompt 1 — Fixing the Port Error
> *[Pasted terminal error output showing WinError 10013]*

Claude identified port 8000 as blocked, provided 5 ranked solutions, and recommended port 8001 as the fastest fix.

**Outcome:** Backend started successfully on port 8001.

---

### Prompt 2 — Frontend Still Showing Backend Offline
> *[Screenshot of UI showing 'Backend offline' + terminal showing both servers running]*

Claude provided the `grep` command to find hardcoded URLs and identified `next.config.js` as the culprit overriding the correct port.

**Outcome:** URL config fixed in `next.config.js`.

---

### Prompt 3 — Cache Not Clearing
> *"STILL" [screenshot showing offline warning persisting after config change]*

Claude explained that `.next/` caches the old compiled build with port 8000 baked in, and that deleting it forces a full recompile.

**Outcome:** `rm -rf .next` + restart resolved it.

---

### Prompt 4 — Diagnosing Persistent Offline
> *"still, am tired" — Claude asked for browser console output (F12)*

The console revealed CORS errors — the real problem was not the port at all, but the backend rejecting all cross-origin requests.

**Outcome:** Root cause identified as missing CORS configuration.

---

### Prompt 5 — Final Fix: CORS Configuration
> *[Pasted browser console CORS errors]*

Claude explained CORS, provided the exact `CORSMiddleware` code with placement instructions.

**Outcome:** Middleware added, uvicorn auto-reloaded, connection established. ✅

---

## Common Errors Quick Reference

| Error | Cause | Fix |
|-------|-------|-----|
| WinError 10013 | Port blocked by Windows | Use `--port 8001` instead |
| Backend offline warning | Wrong port in config | Update `next.config.js`, delete `.next`, restart |
| CORS policy blocked | Missing CORS middleware | Add `CORSMiddleware` to `main.py` |
| `curl: Failed to connect` | Backend not running | Start uvicorn in a separate terminal |
| Port 3000/3001 in use | Other apps using ports | Next.js auto-picks next available port |
| Backend shuts down randomly | Terminal was closed | Keep both terminals open simultaneously |

---

## Example Questions

- *"How is my system doing overall?"* — triggers CPU, memory, disk, and network tools
- *"What process is using the most memory?"* — calls `list_processes(sort_by="memory")`
- *"Are there any errors in my system logs?"* — calls `read_system_logs(pattern="error")`
- *"Where is this server located?"* — calls the external `get_public_ip_geolocation` tool
- *"What's my disk usage on each partition?"* — calls `get_disk_stats`
- *"Give me a full system health report"* — the agent chains multiple tools together

---

## LangSmith Setup (Hard Task)

1. Go to [smith.langchain.com](https://smith.langchain.com) and create a free account
2. Create a new project called `sysmon-agent`
3. Copy your API key to `.env` as `LANGCHAIN_API_KEY`
4. Set `LANGCHAIN_TRACING_V2=true`
5. Run the agent and watch traces appear in real time

You will see each tool call, its input/output, token usage, and end-to-end latency — all without any code changes beyond the two env vars.

---

## Project Review Talking Points

### Problem Definition
This agent solves real DevOps/SRE pain: getting a quick, conversational system health overview without memorising shell commands. Target users are developers and sysadmins who want to ask natural language questions about a server.

### Agent Architecture
- **ReAct pattern**: the agent reasons (LLM) then acts (tools) in a loop until it has enough data to answer
- **Why LangGraph?** Explicit state management and a checkpointer interface make long-term memory trivial to add and the control flow auditable

### Core Concepts
- **Function calling**: tools defined with `@tool` decorators; LangGraph passes them to `bind_tools()`
- **Short-term memory**: full conversation history in `AgentState.messages` for the duration of a run
- **Long-term memory**: `SqliteSaver` persists state between runs using `thread_id` (= `session_id`)
- **Streaming**: WebSocket streams `updates` from LangGraph, parsing `token` events from the model node

### Potential Improvements
- Cache agent instances per config hash (currently rebuilds on every WebSocket message)
- Add retry logic for `ip-api.com` rate limits (45 req/min)
- Add alerting: if CPU > 80% for 3 consecutive polls, push a WebSocket notification
- Add RAG over historical log data using FAISS or Chroma

### When to Use Agents vs RAG vs Prompt Engineering
- **Prompt engineering**: enough for single, well-defined transformations (summarisation, formatting)
- **RAG**: best for large static knowledge bases that won't fit in context
- **Agents**: necessary when the system needs to *take actions* or *gather fresh data* at query time — exactly this use case

---

## Conclusion

This project demonstrates the development of a full-stack AI-powered monitoring application. The development process involved navigating real-world challenges including OS-level port permission issues, build caching problems, and browser security policies (CORS).

Each obstacle was diagnosed systematically using browser developer tools, terminal output analysis, and source code inspection. The use of Claude AI as a development assistant significantly accelerated troubleshooting — transforming error messages into actionable solutions within seconds.

The final application provides a working, real-time system monitoring dashboard with natural language querying capabilities, demonstrating the integration of modern web frameworks, Python backend services, WebSocket communication, and large language model APIs.

---

*SysMonitor AI — 2026*