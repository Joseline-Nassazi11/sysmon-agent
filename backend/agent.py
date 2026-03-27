"""
SysMonitor AI Agent
LangGraph ReAct agent with system monitoring tools, LangSmith tracing,
long-term memory, external API call, and token usage tracking.
"""

import os
import json
import platform
import datetime
import subprocess
from typing import Annotated, Any

import psutil
import httpx
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.sqlite import SqliteSaver
from typing_extensions import TypedDict
from langsmith import traceable
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    token_usage: dict
    alert_triggered: bool


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

@tool
def get_cpu_stats() -> dict:
    """Get current CPU usage statistics including per-core usage and frequency."""
    cpu_percent = psutil.cpu_percent(interval=0.5, percpu=True)
    freq = psutil.cpu_freq()
    load = psutil.getloadavg() if hasattr(psutil, "getloadavg") else (0, 0, 0)
    return {
        "overall_percent": sum(cpu_percent) / len(cpu_percent),
        "per_core_percent": cpu_percent,
        "core_count": psutil.cpu_count(logical=True),
        "physical_cores": psutil.cpu_count(logical=False),
        "frequency_mhz": round(freq.current, 1) if freq else None,
        "load_avg_1m": round(load[0], 2),
        "load_avg_5m": round(load[1], 2),
        "load_avg_15m": round(load[2], 2),
    }


@tool
def get_memory_stats() -> dict:
    """Get RAM and swap memory usage statistics."""
    ram = psutil.virtual_memory()
    swap = psutil.swap_memory()
    return {
        "ram": {
            "total_gb": round(ram.total / 1e9, 2),
            "used_gb": round(ram.used / 1e9, 2),
            "available_gb": round(ram.available / 1e9, 2),
            "percent": ram.percent,
        },
        "swap": {
            "total_gb": round(swap.total / 1e9, 2),
            "used_gb": round(swap.used / 1e9, 2),
            "percent": swap.percent,
        },
    }


@tool
def get_disk_stats() -> dict:
    """Get disk usage and I/O statistics for all mounted partitions."""
    partitions = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
            partitions.append({
                "device": part.device,
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "total_gb": round(usage.total / 1e9, 2),
                "used_gb": round(usage.used / 1e9, 2),
                "free_gb": round(usage.free / 1e9, 2),
                "percent": usage.percent,
            })
        except PermissionError:
            continue
    io = psutil.disk_io_counters()
    return {
        "partitions": partitions,
        "io": {
            "read_mb": round(io.read_bytes / 1e6, 2) if io else 0,
            "write_mb": round(io.write_bytes / 1e6, 2) if io else 0,
        },
    }


@tool
def get_network_stats() -> dict:
    """Get network interface statistics including bytes sent/received per interface."""
    io = psutil.net_io_counters(pernic=True)
    interfaces = {}
    for nic, stats in io.items():
        if nic == "lo":
            continue
        interfaces[nic] = {
            "bytes_sent_mb": round(stats.bytes_sent / 1e6, 2),
            "bytes_recv_mb": round(stats.bytes_recv / 1e6, 2),
            "packets_sent": stats.packets_sent,
            "packets_recv": stats.packets_recv,
            "errors_in": stats.errin,
            "errors_out": stats.errout,
        }
    connections = len(psutil.net_connections(kind="inet"))
    return {"interfaces": interfaces, "active_connections": connections}


@tool
def list_processes(sort_by: str = "cpu", limit: int = 10) -> list:
    """
    List top processes sorted by CPU or memory usage.
    Args:
        sort_by: 'cpu' or 'memory'
        limit: number of processes to return (max 20)
    """
    limit = min(limit, 20)
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "status", "username"]):
        try:
            info = p.info
            procs.append({
                "pid": info["pid"],
                "name": info["name"],
                "cpu_percent": round(info["cpu_percent"] or 0, 2),
                "memory_percent": round(info["memory_percent"] or 0, 2),
                "status": info["status"],
                "user": info["username"] or "unknown",
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    key = "cpu_percent" if sort_by == "cpu" else "memory_percent"
    procs.sort(key=lambda x: x[key], reverse=True)
    return procs[:limit]


@tool
def read_system_logs(lines: int = 50, pattern: str = "") -> dict:
    """
    Read recent system log entries, optionally filtering by a pattern.
    Args:
        lines: number of recent log lines to return
        pattern: optional string to grep for (e.g. 'error', 'warning')
    """
    log_paths = ["/var/log/syslog", "/var/log/messages", "/var/log/system.log"]
    found_log = None
    for path in log_paths:
        if os.path.exists(path):
            found_log = path
            break

    if not found_log:
        # Fallback: use journalctl if available
        try:
            cmd = ["journalctl", "-n", str(lines), "--no-pager"]
            if pattern:
                cmd += ["-g", pattern]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            entries = result.stdout.strip().split("\n")
            return {"source": "journalctl", "entries": entries, "count": len(entries)}
        except Exception as e:
            return {"source": "unavailable", "entries": [], "error": str(e)}

    try:
        with open(found_log, "r", errors="replace") as f:
            all_lines = f.readlines()
        recent = all_lines[-lines:]
        if pattern:
            recent = [l for l in recent if pattern.lower() in l.lower()]
        entries = [l.strip() for l in recent]
        return {"source": found_log, "entries": entries, "count": len(entries)}
    except Exception as e:
        return {"source": found_log, "entries": [], "error": str(e)}


@tool
def get_system_info() -> dict:
    """Get general system information: OS, hostname, uptime, Python version."""
    boot = psutil.boot_time()
    uptime_seconds = (datetime.datetime.now().timestamp() - boot)
    hours, remainder = divmod(int(uptime_seconds), 3600)
    minutes, seconds = divmod(remainder, 60)
    return {
        "hostname": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "architecture": platform.machine(),
        "python_version": platform.python_version(),
        "uptime": f"{hours}h {minutes}m {seconds}s",
        "boot_time": datetime.datetime.fromtimestamp(boot).isoformat(),
    }


@tool
def get_public_ip_geolocation() -> dict:
    """
    Get the machine's public IP address and geolocation data using ip-api.com (external API).
    Useful for identifying where the monitored server is located.
    """
    try:
        resp = httpx.get("http://ip-api.com/json/", timeout=5.0)
        data = resp.json()
        return {
            "ip": data.get("query"),
            "city": data.get("city"),
            "region": data.get("regionName"),
            "country": data.get("country"),
            "isp": data.get("isp"),
            "org": data.get("org"),
            "timezone": data.get("timezone"),
            "lat": data.get("lat"),
            "lon": data.get("lon"),
        }
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# All tools registry
# ---------------------------------------------------------------------------

ALL_TOOLS = [
    get_cpu_stats,
    get_memory_stats,
    get_disk_stats,
    get_network_stats,
    list_processes,
    read_system_logs,
    get_system_info,
    get_public_ip_geolocation,
]

TOOL_MAP = {t.name: t for t in ALL_TOOLS}


# ---------------------------------------------------------------------------
# Agent graph builder
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are SysMonitor, an expert AI system monitoring assistant.
You have access to tools that let you inspect the host system in real time:
CPU, memory, disk, network, processes, logs, system info, and geolocation.

Guidelines:
- Always use the relevant tool(s) to get fresh data before answering.
- When the user asks a vague question like "how is my system doing?", call
  get_cpu_stats, get_memory_stats, get_disk_stats, and get_network_stats.
- Flag potential issues proactively (CPU > 80%, RAM > 90%, disk > 85%).
- Be concise but include exact numbers from the tools.
- Format responses with clear sections using markdown.
- For historical questions, reference the conversation memory.
"""


def build_agent(
    model_name: str = "gpt-4o-mini",
    temperature: float = 0.0,
    enabled_tools: list[str] | None = None,
    memory_db_path: str = "sysmon_memory.db",
):
    """Build and return the LangGraph agent with SQLite memory."""

    # Filter tools if the user toggled some off
    active_tools = ALL_TOOLS
    if enabled_tools is not None:
        active_tools = [t for t in ALL_TOOLS if t.name in enabled_tools]

    llm = ChatOpenAI(
        model=model_name,
        temperature=temperature,
        streaming=True,
    ).bind_tools(active_tools)

    tool_map = {t.name: t for t in active_tools}

    def call_model(state: AgentState) -> dict:
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
        response = llm.invoke(messages)

        # Track token usage
        usage = {}
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            meta = response.usage_metadata
            usage = {
                "input_tokens": meta.get("input_tokens", 0),
                "output_tokens": meta.get("output_tokens", 0),
                "total_tokens": meta.get("total_tokens", 0),
            }

        existing = state.get("token_usage") or {}
        combined = {
            "input_tokens": existing.get("input_tokens", 0) + usage.get("input_tokens", 0),
            "output_tokens": existing.get("output_tokens", 0) + usage.get("output_tokens", 0),
            "total_tokens": existing.get("total_tokens", 0) + usage.get("total_tokens", 0),
        }

        return {"messages": [response], "token_usage": combined}

    def call_tools(state: AgentState) -> dict:
        last = state["messages"][-1]
        tool_results = []
        for tc in last.tool_calls:
            fn = tool_map.get(tc["name"])
            if fn:
                try:
                    result = fn.invoke(tc["args"])
                except Exception as e:
                    result = {"error": str(e)}
            else:
                result = {"error": f"Tool '{tc['name']}' not enabled"}
            tool_results.append(
                ToolMessage(content=json.dumps(result), tool_call_id=tc["id"])
            )
        return {"messages": tool_results}

    def should_continue(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("model", call_model)
    graph.add_node("tools", call_tools)
    graph.set_entry_point("model")
    graph.add_conditional_edges("model", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "model")

    memory = SqliteSaver.from_conn_string(memory_db_path)
    return graph.compile(checkpointer=memory)
