"""
FastAPI backend for SysMonitor Agent.
Provides REST endpoints and a WebSocket for streaming agent responses.
"""

import os
import json
import uuid
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from dotenv import load_dotenv

from agent import build_agent, ALL_TOOLS

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

AGENT = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global AGENT
    AGENT = build_agent(
        model_name=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"),
        memory_db_path=os.getenv("MEMORY_DB", "sysmon_memory.db"),
    )
    logger.info("SysMonitor agent ready")
    yield
    logger.info("SysMonitor agent shutting down")


app = FastAPI(title="SysMonitor Agent API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    model: str = "gpt-4o-mini"
    temperature: float = 0.0
    enabled_tools: Optional[list[str]] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    token_usage: dict


class QuickStatsResponse(BaseModel):
    cpu: dict
    memory: dict
    disk: dict
    network: dict
    system: dict


# ---------------------------------------------------------------------------
# REST Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "agent": "SysMonitor"}


@app.get("/tools")
def list_tools():
    """Return all available tool names and their descriptions."""
    return [
        {"name": t.name, "description": t.description}
        for t in ALL_TOOLS
    ]


@app.get("/quick-stats")
async def quick_stats():
    """Directly call psutil tools for the dashboard metrics panel."""
    import psutil, platform, datetime

    cpu = psutil.cpu_percent(interval=0.5)
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    net = psutil.net_io_counters()
    boot = psutil.boot_time()
    uptime_s = int(datetime.datetime.now().timestamp() - boot)
    h, rem = divmod(uptime_s, 3600)
    m, s = divmod(rem, 60)

    return {
        "cpu": {
            "percent": cpu,
            "cores": psutil.cpu_count(logical=True),
            "per_core": psutil.cpu_percent(percpu=True),
        },
        "memory": {
            "percent": ram.percent,
            "used_gb": round(ram.used / 1e9, 2),
            "total_gb": round(ram.total / 1e9, 2),
        },
        "disk": {
            "percent": disk.percent,
            "used_gb": round(disk.used / 1e9, 2),
            "total_gb": round(disk.total / 1e9, 2),
        },
        "network": {
            "bytes_sent_mb": round(net.bytes_sent / 1e6, 2),
            "bytes_recv_mb": round(net.bytes_recv / 1e6, 2),
        },
        "system": {
            "hostname": platform.node(),
            "os": f"{platform.system()} {platform.release()}",
            "uptime": f"{h}h {m}m {s}s",
        },
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Single-turn REST chat endpoint."""
    if not AGENT:
        raise HTTPException(status_code=503, detail="Agent not ready")

    session_id = req.session_id or str(uuid.uuid4())

    # Rebuild agent if model/tools changed
    agent = build_agent(
        model_name=req.model,
        temperature=req.temperature,
        enabled_tools=req.enabled_tools,
    )

    config = {"configurable": {"thread_id": session_id}}
    result = await asyncio.to_thread(
        agent.invoke,
        {"messages": [HumanMessage(content=req.message)], "token_usage": {}},
        config=config,
    )

    last_msg = result["messages"][-1]
    reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

    return ChatResponse(
        reply=reply,
        session_id=session_id,
        token_usage=result.get("token_usage", {}),
    )


@app.get("/history/{session_id}")
async def get_history(session_id: str):
    """Return conversation history for a session from long-term memory."""
    if not AGENT:
        raise HTTPException(status_code=503, detail="Agent not ready")
    config = {"configurable": {"thread_id": session_id}}
    try:
        state = AGENT.get_state(config)
        messages = []
        for msg in state.values.get("messages", []):
            role = "assistant" if msg.__class__.__name__ in ("AIMessage",) else "user"
            content = msg.content if hasattr(msg, "content") else str(msg)
            messages.append({"role": role, "content": content})
        return {"session_id": session_id, "messages": messages}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------------------------------------------------------------------------
# WebSocket for streaming
# ---------------------------------------------------------------------------

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """WebSocket endpoint that streams agent tokens to the client."""
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            message = data.get("message", "")
            session_id = data.get("session_id") or str(uuid.uuid4())
            model = data.get("model", "gpt-4o-mini")
            temperature = data.get("temperature", 0.0)
            enabled_tools = data.get("enabled_tools")

            agent = build_agent(
                model_name=model,
                temperature=temperature,
                enabled_tools=enabled_tools,
            )
            config = {"configurable": {"thread_id": session_id}}

            # Stream events from the agent
            full_response = ""
            token_usage = {}

            for event in agent.stream(
                {"messages": [HumanMessage(content=message)], "token_usage": {}},
                config=config,
                stream_mode="updates",
            ):
                for node, update in event.items():
                    if node == "model":
                        msgs = update.get("messages", [])
                        for msg in msgs:
                            content = msg.content if hasattr(msg, "content") else ""
                            if content:
                                full_response += content
                                await websocket.send_json({
                                    "type": "token",
                                    "content": content,
                                    "session_id": session_id,
                                })
                        tu = update.get("token_usage")
                        if tu:
                            token_usage = tu
                    elif node == "tools":
                        await websocket.send_json({
                            "type": "tool_call",
                            "content": "🔧 Querying system...",
                            "session_id": session_id,
                        })

            await websocket.send_json({
                "type": "done",
                "session_id": session_id,
                "token_usage": token_usage,
            })

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass
