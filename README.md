# SysMonitor AI Agent

An AI-powered system monitoring dashboard built with a **LangGraph ReAct agent** backend and a **Next.js** frontend. The agent can inspect CPU, memory, disk, network, processes, and logs in real time, answer natural language questions about your system, and remember conversation history across sessions.

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

## Setup

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

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

### 3. Frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Architecture

```
Next.js (port 3000)
    │  REST /quick-stats  (polling every 3s for live metrics)
    │  POST /chat         (single-turn)
    │  WS  /ws/chat       (streaming agent responses)
    ▼
FastAPI (port 8000)
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
        ├── get_cpu_stats          psutil
        ├── get_memory_stats       psutil
        ├── get_disk_stats         psutil
        ├── get_network_stats      psutil
        ├── list_processes         psutil
        ├── read_system_logs       /var/log or journalctl
        ├── get_system_info        platform + psutil
        └── get_public_ip_geolocation  ip-api.com (external API)
```

### Agent flow (ReAct loop)

1. User sends a message via WebSocket
2. The `call_model` node sends the conversation (with system prompt) to the LLM
3. If the LLM decides to call tools, the graph transitions to `call_tools`
4. Tool results are appended to the message list and sent back to `call_model`
5. The loop continues until the LLM returns a plain text response
6. Every state transition is checkpointed to SQLite (long-term memory)
7. LangSmith traces the entire run automatically via environment variables

---

## Optional Tasks Implemented

### Medium: Long-term memory (LangGraph SQLite checkpointer)
Every conversation is persisted to `sysmon_memory.db` using `SqliteSaver`. Sessions are identified by `session_id` (UUID), which the frontend generates once and reuses. This means you can close the browser, come back, and the agent remembers your conversation.

```python
memory = SqliteSaver.from_conn_string(memory_db_path)
graph.compile(checkpointer=memory)
```

The `GET /history/{session_id}` endpoint lets the frontend load past messages.

### Medium: Token usage + cost display
Every `call_model` node extracts `usage_metadata` from the LLM response and accumulates it in the graph state. The WebSocket sends a final `token_usage` object when the run completes. The frontend displays per-response and session-total token counts, and calculates USD cost using a pricing table keyed by model name.

### Medium: External API tool — `get_public_ip_geolocation`
Uses `ip-api.com` (free, no key required) to fetch the machine's public IP and geolocation data. The agent can answer questions like *"Where is this server located?"* or include geo data in a full system report.

### Hard: LangSmith observability
Simply set `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` in `.env`. LangSmith automatically instruments every LangGraph run. In the LangSmith dashboard you can see:
- Full agent traces with tool call inputs/outputs
- Token counts and latency per node
- Cost per run
- Side-by-side comparisons across runs

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

### WebSocket message format

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

---

## Example questions to ask the agent

- *"How is my system doing overall?"* — triggers CPU, memory, disk, and network tools
- *"What process is using the most memory?"* — calls `list_processes(sort_by="memory")`
- *"Are there any errors in my system logs?"* — calls `read_system_logs(pattern="error")`
- *"Where is this server located?"* — calls the external `get_public_ip_geolocation` tool
- *"What's my disk usage on each partition?"* — calls `get_disk_stats`
- *"Give me a full system health report"* — the agent chains multiple tools together

---

## Project Review Talking Points

### Problem definition
This agent solves real DevOps/SRE pain: getting a quick, conversational system health overview without memorising shell commands. Target users are developers and sysadmins who want to ask natural language questions about a server.

### Agent architecture
- **ReAct pattern**: the agent reasons (LLM) then acts (tools) in a loop until it has enough data to answer
- **Why LangGraph over plain LangChain agents?** LangGraph gives explicit state management and a checkpointer interface, making long-term memory trivial to add. It also makes the control flow auditable.

### Core concepts
- **Function calling**: tools are defined with `@tool` decorators; LangGraph passes them to `bind_tools()` which tells the LLM what JSON schemas to call
- **Short-term memory**: the full conversation history is kept in `AgentState.messages` for the duration of a run
- **Long-term memory**: `SqliteSaver` persists state between runs using `thread_id` (= `session_id`)
- **Streaming**: the WebSocket streams `updates` from LangGraph, parsing `token` events from the model node

### Potential problems & improvements
- The agent rebuilds on every WebSocket message (due to dynamic model/tool config); in production, cache agent instances per config hash
- `psutil` on some Linux systems requires elevated permissions for full process info
- `ip-api.com` has rate limits (45 req/min); add retry logic with exponential backoff for production
- Add alerting: if CPU > 80% for 3 consecutive polls, push a WebSocket notification
- Add RAG over historical log data using FAISS or Chroma (Agentic RAG — Hard task)

### When to use agents vs RAG vs prompt engineering
- **Prompt engineering**: enough when the task is a single, well-defined transformation (summarisation, formatting)
- **RAG**: best when you have a large static knowledge base (docs, logs archive) that won't fit in context
- **Agents**: necessary when the system needs to *take actions* or *gather fresh data* at query time — exactly this use case

---

## LangSmith Setup (Hard Task)

1. Go to [smith.langchain.com](https://smith.langchain.com) and create a free account
2. Create a new project called `sysmon-agent`
3. Copy your API key to `.env` as `LANGCHAIN_API_KEY`
4. Set `LANGCHAIN_TRACING_V2=true`
5. Run the agent and watch traces appear in the LangSmith dashboard in real time

You will see each tool call, its input/output, the LLM's token usage, and end-to-end latency — all without any code changes beyond the two env vars.
