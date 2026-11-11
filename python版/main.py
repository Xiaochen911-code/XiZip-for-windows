#!/usr/bin/env python3
"""XiZip - 本地压缩包管理器（7-Zip 内核）

启动：
    python main.py
直接打开独立的桌面窗口（WebView2），不经过浏览器。
"""

from __future__ import annotations

import atexit
import mimetypes
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
SEVEN_ZIP = BASE_DIR / "7z" / "7z.exe"
APP_VERSION = "1.1.0"
KERNEL_VERSION = ""

# pywebview 窗口句柄
WINDOWS: dict[str, object] = {}

TEMP_ROOT = Path(tempfile.mkdtemp(prefix="xizip_"))
SESSIONS: dict[str, dict] = {}
LOCK = threading.Lock()

# 解压 / 新建任务：前端轮询进度
JOBS: dict[str, dict] = {}
JOB_LOCK = threading.Lock()
PROCS: dict[str, subprocess.Popen] = {}
CANCEL_JOBS: set[str] = set()
PROGRESS_RE = re.compile(r"^\s*(\d{1,3})%")

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

TEXT_EXTS = {
    "txt", "md", "markdown", "json", "js", "mjs", "ts", "tsx", "jsx", "css",
    "scss", "html", "htm", "xml", "yml", "yaml", "toml", "ini", "conf", "log",
    "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php",
    "sh", "bat", "ps1", "sql", "csv", "tsv", "env", "gitignore", "license",
}
IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"}
AUDIO_EXTS = {"mp3", "wav", "ogg", "flac", "m4a", "aac"}
VIDEO_EXTS = {"mp4", "webm", "mov", "mkv", "avi"}
ARCHIVE_EXTS = {"zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz", "tbz2",
                "txz", "cab", "iso", "apk", "jar", "whl", "epub"}


# --------------------------------------------------------------------------- #
# 7-Zip 内核
# --------------------------------------------------------------------------- #

def seven_zip(args: list[str], cwd: str | Path | None = None,
              timeout: int = 180, binary: bool = False):
    if not SEVEN_ZIP.exists():
        raise RuntimeError(f"未找到 7-Zip 内核：{SEVEN_ZIP}")
    return subprocess.run(
        [str(SEVEN_ZIP), *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=not binary,
        encoding=None if binary else "utf-8",
        errors=None if binary else "replace",
        timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )


def _split_blocks(text: str) -> list[dict[str, str]]:
    blocks = []
    for chunk in re.split(r"\r?\n\r?\n", text.replace("\r\n", "\n").strip()):
        kv: dict[str, str] = {}
        for line in chunk.split("\n"):
            if " = " in line:
                key, value = line.split(" = ", 1)
                kv[key.strip()] = value.strip()
        if kv:
            blocks.append(kv)
    return blocks


def list_entries(archive: Path) -> list[dict]:
    proc = seven_zip(["l", "-slt", "-ba", "-sccUTF-8", str(archive)])
    if proc.returncode not in (0, 1):
        raise RuntimeError((proc.stdout or "") + (proc.stderr or ""))

    rows: list[dict] = []
    for kv in _split_blocks(proc.stdout or ""):
        raw_path = kv.get("Path")
        if not raw_path:
            continue
        if kv.get("Type"):          # 归档文件自身的元数据块
            continue

        path = raw_path.replace("\\", "/").strip("/")
        if not path or path in (".", "/"):
            continue

        is_dir = (
            kv.get("Folder") == "+"
            or raw_path.endswith("/")
            or raw_path.endswith("\\")
            or kv.get("Attributes", "").startswith("D")
        )
        size = _to_int(kv.get("Size"))
        packed = _to_int(kv.get("Packed Size"))
        name = path.rsplit("/", 1)[-1]
        ext = "" if is_dir else name.rsplit(".", 1)[-1].lower() if "." in name else ""

        rows.append({
            "path": path,
            "name": name,
            "is_dir": is_dir,
            "size": 0 if is_dir else size,
            "packed": 0 if is_dir else packed,
            "mtime": kv.get("Modified", ""),
            "crc": kv.get("CRC", ""),
            "ext": ext,
        })

    # 补齐压缩包中未显式记录的父级目录
    known = {r["path"] for r in rows if r["is_dir"]}
    for row in list(rows):
        if row["is_dir"]:
            continue
        acc = ""
        for part in row["path"].split("/")[:-1]:
            acc = f"{acc}/{part}" if acc else part
            if acc not in known:
                known.add(acc)
                rows.append({
                    "path": acc,
                    "name": part,
                    "is_dir": True,
                    "size": 0,
                    "packed": 0,
                    "mtime": "",
                    "crc": "",
                    "ext": "",
                })

    # 目录大小 = 内部文件之和
    dir_sizes: dict[str, int] = {}
    for row in rows:
        if row["is_dir"]:
            continue
        parts = row["path"].split("/")[:-1]
        acc = ""
        for part in parts:
            acc = f"{acc}/{part}" if acc else part
            dir_sizes[acc] = dir_sizes.get(acc, 0) + row["size"]
    for row in rows:
        if row["is_dir"]:
            row["size"] = dir_sizes.get(row["path"], 0)

    rows.sort(key=lambda r: (not r["is_dir"], r["path"].lower()))
    return rows


def _to_int(value: str | None) -> int:
    try:
        return int((value or "0").strip())
    except ValueError:
        return 0


def build_payload(sid: str) -> dict:
    session = SESSIONS[sid]
    archive: Path = session["path"]
    entries = list_entries(archive)
    files = [e for e in entries if not e["is_dir"]]
    dirs = [e for e in entries if e["is_dir"]]
    total = sum(e["size"] for e in files)
    packed = sum(e["packed"] for e in files)
    return {
        "id": sid,
        "name": session["name"],
        "size": archive.stat().st_size,
        "entryCount": len(files) + len(dirs),
        "fileCount": len(files),
        "dirCount": len(dirs),
        "totalSize": total,
        "packedSize": packed,
        "ratio": round(packed / total, 3) if total else 0,
        "entries": entries,
    }


def new_session(archive_path: Path, display_name: str) -> str:
    sid = uuid.uuid4().hex[:12]
    folder = TEMP_ROOT / sid
    folder.mkdir(parents=True, exist_ok=True)
    with LOCK:
        SESSIONS[sid] = {"path": archive_path, "name": display_name, "dir": folder}
    return sid


def safe_basename(filename: str) -> str:
    name = os.path.basename(filename.replace("\\", "/"))
    name = re.sub(r'[<>:"|?*\x00-\x1f]', "_", name).strip().rstrip(".")
    return name or "file"


def mime_for(ext: str) -> str:
    ext = ext.lower()
    if ext == "svg":
        return "image/svg+xml"
    if ext in TEXT_EXTS:
        return "text/plain; charset=utf-8"
    guessed, _ = mimetypes.guess_type(f"x.{ext}")
    return guessed or "application/octet-stream"


# --------------------------------------------------------------------------- #
# Flask
# --------------------------------------------------------------------------- #

app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 600
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


@app.after_request
def no_store(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": "文件过大"}), 413


@app.errorhandler(500)
def server_error(_):
    return jsonify({"error": "服务器内部错误"}), 500


@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": SEVEN_ZIP.exists(), "kernel": str(SEVEN_ZIP)})


GPU_INFO: dict | None = None


def detect_gpu() -> dict:
    """读取主显示适配器名称，用于界面显示硬件加速状态。"""
    global GPU_INFO
    if GPU_INFO is not None:
        return GPU_INFO

    name = ""
    if os.name == "nt":
        try:
            import ctypes

            class DISPLAY_DEVICEW(ctypes.Structure):
                _fields_ = [
                    ("cb", ctypes.c_uint32),
                    ("DeviceName", ctypes.c_wchar * 32),
                    ("DeviceString", ctypes.c_wchar * 128),
                    ("StateFlags", ctypes.c_uint32),
                    ("DeviceID", ctypes.c_wchar * 128),
                    ("DeviceKey", ctypes.c_wchar * 128),
                ]

            device = DISPLAY_DEVICEW()
            device.cb = ctypes.sizeof(device)
            if ctypes.windll.user32.EnumDisplayDevicesW(None, 0, ctypes.byref(device), 0):
                name = (device.DeviceString or "").strip()
        except Exception:  # noqa: BLE001
            name = ""

    lowered = name.lower()
    if "nvidia" in lowered:
        vendor = "NVIDIA"
    elif "amd" in lowered or "radeon" in lowered:
        vendor = "AMD"
    elif "intel" in lowered:
        vendor = "Intel"
    else:
        vendor = ""

    GPU_INFO = {
        "name": name,
        "vendor": vendor,
        "accelerated": bool(name) and "basic" not in lowered,
    }
    return GPU_INFO


@app.get("/api/gpu")
def api_gpu():
    return jsonify(detect_gpu())


def kernel_version() -> str:
    """读取 7-Zip 内核自报的版本号。"""
    global KERNEL_VERSION
    if KERNEL_VERSION:
        return KERNEL_VERSION
    try:
        proc = seven_zip([], timeout=30)
        text = (proc.stdout or "") + (proc.stderr or "")
        match = re.search(r"7-Zip\s+(\d+\.\d+)", text)
        KERNEL_VERSION = match.group(1) if match else "未知"
    except Exception:  # noqa: BLE001
        KERNEL_VERSION = "未知"
    return KERNEL_VERSION


def webview2_version() -> str:
    """扫描 WebView2 运行时目录，返回已安装的最高版本。"""
    candidates: list[str] = []
    for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if not base:
            continue
        root = Path(base) / "Microsoft" / "EdgeWebView" / "Application"
        if not root.is_dir():
            continue
        for child in root.iterdir():
            if child.is_dir() and re.fullmatch(r"\d+(\.\d+){2,3}", child.name):
                candidates.append(child.name)
    if not candidates:
        return "未检测到"
    return sorted(candidates, key=lambda v: [int(p) for p in v.split(".")])[-1]


@app.get("/api/about")
def api_about():
    return jsonify({
        "app": APP_VERSION,
        "kernel": str(SEVEN_ZIP) if SEVEN_ZIP.exists() else "未找到 7-Zip 内核",
        "kernelVersion": kernel_version(),
        "webview": webview2_version(),
        "gpu": detect_gpu(),
        "python": platform.python_version(),
    })


@app.post("/api/window/size")
def api_window_size():
    """MINI 用小窗口，MAX 用大窗口，切换视图时同步调整窗口尺寸。"""
    data = request.get_json(silent=True) or {}
    mode = "mini" if data.get("mode") == "mini" else "max"
    window = WINDOWS.get("main")
    if window is None:
        return jsonify({"ok": False, "reason": "no-window"})

    screen_w, screen_h = logical_screen_size()
    if mode == "mini":
        width, height = 940, 660
    else:
        width, height = max_window_size()
    width = min(width, screen_w)
    height = min(height, screen_h)
    try:
        window.resize(int(width), int(height))
        window.move(int(max(0, (screen_w - width) // 2)),
                    int(max(0, (screen_h - height) // 2)))
    except Exception:  # noqa: BLE001
        return jsonify({"ok": False, "reason": "resize-failed"})
    return jsonify({"ok": True, "mode": mode, "width": width, "height": height})


@app.post("/api/open")
def api_open():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"error": "没有收到文件"}), 400

    name = safe_basename(upload.filename)
    sid = uuid.uuid4().hex[:12]
    folder = TEMP_ROOT / sid
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    upload.save(target)

    try:
        payload = build_payload_after_new(sid, target, name)
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(folder, ignore_errors=True)
        return jsonify({"error": f"无法读取压缩包：{exc}"}), 400
    return jsonify(payload)


def build_payload_after_new(sid: str, target: Path, name: str) -> dict:
    folder = target.parent
    SESSIONS[sid] = {"path": target, "name": name, "dir": folder}
    try:
        return build_payload(sid)
    except Exception:
        SESSIONS.pop(sid, None)
        raise


@app.post("/api/pick/files")
def api_pick_files():
    files = pick_files()
    if not files:
        return jsonify({"cancelled": True})
    items = []
    for raw in files:
        path = Path(raw)
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        items.append({"path": raw, "name": path.name, "size": size})
    return jsonify({"files": items})


@app.post("/api/pick/folder")
def api_pick_folder():
    folder = pick_folder()
    if not folder:
        return jsonify({"cancelled": True})
    return jsonify({"folder": folder})


@app.post("/api/create")
def api_create():
    data = request.get_json(silent=True) or {}
    files = [
        str(item) for item in (data.get("files") or [])
        if str(item).strip() and Path(str(item)).is_file()
    ]
    if not files:
        return jsonify({"error": "请先选择要压缩的文件"}), 400

    folder = str(data.get("folder") or "").strip()
    if not folder:
        return jsonify({"error": "请选择保存位置"}), 400

    name = safe_basename(str(data.get("name") or "").strip()) or "新建压缩包"
    if Path(name).suffix.lower() not in (
        ".zip", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz",
    ):
        name += ".zip"

    target = Path(folder) / name
    if target.exists():
        return jsonify({"error": "同名文件已存在，请换一个名称"}), 409

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return jsonify({"error": f"无法创建目录：{exc}"}), 500

    prune_jobs()
    job_id = uuid.uuid4().hex[:12]
    with JOB_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "kind": "create",
            "state": "running",
            "percent": 0,
            "current": "",
            "files": len(files),
            "total": len(files),
            "target": str(target),
            "name": name,
            "sid": "",
            "error": "",
            "started": time.time(),
            "finished": 0.0,
        }

    threading.Thread(
        target=create_worker,
        args=(job_id, files, target),
        name="xizip-create",
        daemon=True,
    ).start()
    return jsonify({
        "ok": True,
        "jobId": job_id,
        "target": str(target),
        "name": name,
        "total": len(files),
    })


@app.post("/api/demo")
def api_demo():
    demo_dir = TEMP_ROOT / "demo"
    demo_dir.mkdir(parents=True, exist_ok=True)
    demo_path = demo_dir / "XiZip 演示包.zip"
    if not demo_path.exists():
        demo_path.write_bytes(build_demo_zip())
    sid = new_session(demo_path, demo_path.name)
    return jsonify(build_payload(sid))


@app.get("/api/archives/<sid>/info")
def api_info(sid: str):
    if sid not in SESSIONS:
        return jsonify({"error": "压缩包会话已失效"}), 404
    return jsonify(build_payload(sid))


@app.get("/api/archives/<sid>/preview")
def api_preview(sid: str):
    session = SESSIONS.get(sid)
    if not session:
        return jsonify({"error": "压缩包会话已失效"}), 404

    entry_path = (request.args.get("path") or "").strip().strip("/")
    if not entry_path:
        return jsonify({"error": "缺少文件路径"}), 400

    entries = {e["path"]: e for e in list_entries(session["path"])}
    entry = entries.get(entry_path)
    if not entry:
        return jsonify({"error": "文件不存在"}), 404
    if entry["is_dir"]:
        return jsonify({"error": "目录无法预览"}), 400
    if entry["size"] > 40 * 1024 * 1024:
        return jsonify({"error": "文件超过 40 MB，暂不支持在线预览"}), 413

    proc = seven_zip(["e", "-so", "-bd", "-y", str(session["path"]), entry_path],
                     binary=True, timeout=120)
    if proc.returncode not in (0, 1) or not proc.stdout:
        # 个别文件名含通配符时回退为“解压到临时目录”
        tmp = Path(tempfile.mkdtemp(dir=session["dir"]))
        try:
            seven_zip(["x", "-o" + str(tmp), "-y", "-bd", str(session["path"]), entry_path])
            candidate = tmp / entry_path
            if not candidate.exists():
                hits = [p for p in tmp.rglob("*") if p.is_file()
                        and p.relative_to(tmp).as_posix() == entry_path]
                candidate = hits[0] if hits else None
            if not candidate or not candidate.exists():
                return jsonify({"error": "无法读取该文件内容"}), 500
            data = candidate.read_bytes()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    else:
        data = proc.stdout

    response = Response(data, mimetype=mime_for(entry["ext"]))
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-XiZip-Size"] = str(len(data))
    return response


def extract_folder_name(archive: Path) -> str:
    """解压时使用的子文件夹名：压缩包文件名去掉后缀。"""
    name = archive.name
    lower = name.lower()
    for suffix in (".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz"):
        if lower.endswith(suffix):
            return name[: -len(suffix)]
    return archive.stem or name


def extract_scope_stats(archive: Path, paths: list[str]) -> tuple[int, int]:
    """本次解压的文件数量与解压后总字节数，用于进度估算。"""
    files = 0
    total_bytes = 0
    for entry in list_entries(archive):
        if entry["is_dir"]:
            continue
        if paths and not any(
            entry["path"] == p or entry["path"].startswith(p + "/") for p in paths
        ):
            continue
        files += 1
        total_bytes += entry["size"]
    return files, total_bytes


def folder_bytes(root: Path, limit: int = 20000) -> int:
    """递归统计目录当前占用的字节数；项目过多时返回 -1 表示放弃估算。"""
    total = 0
    seen = 0
    stack = [str(root)]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
                    seen += 1
                    if seen > limit:
                        return -1
        except OSError:
            continue
    return total


def watch_extract_bytes(job: dict, target: Path, baseline: int,
                        total_bytes: int, stop: threading.Event) -> None:
    """7-Zip 输出被缓冲时，用落盘字节数补齐进度。"""
    while not stop.wait(0.22):
        size = folder_bytes(target)
        if size < 0 or total_bytes <= 0:
            return
        grown = size - baseline
        if grown <= 0:
            continue
        percent = min(99, int(grown * 100 / total_bytes))
        with JOB_LOCK:
            if percent > job["percent"]:
                job["percent"] = percent


def prune_jobs() -> None:
    now = time.time()
    with JOB_LOCK:
        for job_id, job in list(JOBS.items()):
            if job["state"] != "running" and now - job.get("finished", now) > 300:
                JOBS.pop(job_id, None)


def apply_progress_line(job: dict, line: str) -> None:
    """解析 7-Zip 的 ` 42% 7 - name` 进度行。"""
    match = PROGRESS_RE.match(line)
    if not match:
        return
    percent = min(100, int(match.group(1)))
    with JOB_LOCK:
        if percent > job["percent"]:
            job["percent"] = percent
        if " - " in line:
            name = line.split(" - ", 1)[1].strip()
            if name:
                job["current"] = name


def extract_worker(job_id: str, archive: Path, paths: list[str],
                   target: Path, total_bytes: int) -> None:
    job = JOBS[job_id]
    args = [
        str(SEVEN_ZIP), "x", str(archive), "-o" + str(target),
        "-y", "-aos", "-bsp1", *paths,
    ]
    baseline = folder_bytes(target)
    if baseline < 0:
        total_bytes = 0

    stop = threading.Event()
    if total_bytes > 0:
        threading.Thread(
            target=watch_extract_bytes,
            args=(job, target, max(0, baseline), total_bytes, stop),
            name="xizip-progress",
            daemon=True,
        ).start()

    try:
        proc = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as exc:  # noqa: BLE001
        stop.set()
        with JOB_LOCK:
            job.update(state="error", error=f"无法启动 7-Zip：{exc}", finished=time.time())
        return

    buffer = ""
    code = 1
    try:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(1024)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", "replace")
            pieces = re.split(r"[\r\n]+", buffer)
            buffer = pieces.pop()
            for line in pieces:
                apply_progress_line(job, line)
        if buffer:
            apply_progress_line(job, buffer)
        code = proc.wait()
    except Exception as exc:  # noqa: BLE001
        stop.set()
        with JOB_LOCK:
            job.update(state="error", error=str(exc), finished=time.time())
        return
    finally:
        stop.set()

    with JOB_LOCK:
        ok = code in (0, 1)
        job["state"] = "done" if ok else "error"
        if ok:
            job["percent"] = 100
        else:
            job["error"] = f"7-Zip 返回码 {code}"
        job["finished"] = time.time()


def create_worker(job_id: str, files: list[str], target: Path) -> None:
    """调用 7-Zip 把选中的文件打包成新压缩包，支持中途取消。"""
    job = JOBS[job_id]
    args = [
        str(SEVEN_ZIP), "a", "-y", "-sccUTF-8", "-bsp1",
        str(target), *files,
    ]
    try:
        proc = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as exc:  # noqa: BLE001
        with JOB_LOCK:
            job.update(state="error", error=f"无法启动 7-Zip：{exc}", finished=time.time())
        return

    with JOB_LOCK:
        PROCS[job_id] = proc

    buffer = ""
    code = 1
    detail = ""
    try:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(1024)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", "replace")
            pieces = re.split(r"[\r\n]+", buffer)
            buffer = pieces.pop()
            for line in pieces:
                apply_progress_line(job, line)
                if "ERROR" in line or "Can not open" in line:
                    detail = line.strip()
        code = proc.wait()
    except Exception as exc:  # noqa: BLE001
        detail = str(exc)
    finally:
        with JOB_LOCK:
            PROCS.pop(job_id, None)

    with JOB_LOCK:
        cancelled = job_id in CANCEL_JOBS
        CANCEL_JOBS.discard(job_id)
        if cancelled:
            job.update(state="cancelled", error="", finished=time.time())
        elif code in (0, 1):
            job.update(state="done", percent=100, finished=time.time())
        else:
            job.update(
                state="error",
                error=detail or f"7-Zip 返回码 {code}",
                finished=time.time(),
            )
        result = job["state"]

    if result != "done":
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        return

    try:
        sid = new_session(target, target.name)
        with JOB_LOCK:
            job["sid"] = sid
    except Exception as exc:  # noqa: BLE001
        with JOB_LOCK:
            job.update(state="error", error=f"无法读取压缩包：{exc}", finished=time.time())
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass


@app.post("/api/archives/<sid>/extract")
def api_extract(sid: str):
    session = SESSIONS.get(sid)
    if not session:
        return jsonify({"error": "压缩包会话已失效"}), 404

    data = request.get_json(silent=True) or {}
    paths = [p for p in (data.get("paths") or []) if isinstance(p, str) and p.strip()]
    target = (data.get("target") or "").strip()

    if not target:
        target = pick_folder()
        if not target:
            return jsonify({"ok": False, "reason": "cancelled"}), 200

    target_path = Path(target) / extract_folder_name(Path(session["path"]))
    try:
        target_path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return jsonify({"ok": False, "error": f"无法创建目录：{exc}"}), 500

    try:
        total, total_bytes = extract_scope_stats(session["path"], paths)
    except Exception:  # noqa: BLE001
        total, total_bytes = 0, 0

    prune_jobs()
    job_id = uuid.uuid4().hex[:12]
    with JOB_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "state": "running",
            "percent": 0,
            "current": "",
            "files": 0,
            "total": total,
            "bytes": total_bytes,
            "target": str(target_path),
            "error": "",
            "started": time.time(),
            "finished": 0.0,
        }

    threading.Thread(
        target=extract_worker,
        args=(job_id, session["path"], paths, target_path, total_bytes),
        name="xizip-extract",
        daemon=True,
    ).start()
    return jsonify({"ok": True, "jobId": job_id, "target": str(target_path), "total": total})


@app.get("/api/jobs/<job_id>")
def api_job(job_id: str):
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "任务不存在"}), 404
        snapshot = dict(job)
    return jsonify(snapshot)


@app.post("/api/jobs/<job_id>/cancel")
def api_job_cancel(job_id: str):
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "任务不存在"}), 404
        if job["state"] != "running":
            return jsonify({"ok": False, "state": job["state"]})
        CANCEL_JOBS.add(job_id)
        proc = PROCS.get(job_id)
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:  # noqa: BLE001
            pass
    return jsonify({"ok": True, "state": "cancelling"})


@app.post("/api/archives/<sid>/add")
def api_add(sid: str):
    session = SESSIONS.get(sid)
    if not session:
        return jsonify({"error": "压缩包会话已失效"}), 404

    uploads = request.files.getlist("files")
    if not uploads:
        return jsonify({"error": "没有收到文件"}), 400

    folder = (request.form.get("folder") or "").strip().strip("/")
    if ".." in folder.split("/") or folder.startswith("/"):
        folder = ""

    staging = Path(tempfile.mkdtemp(dir=session["dir"], prefix="add_"))
    rel_names: list[str] = []
    try:
        for upload in uploads:
            if not upload.filename:
                continue
            name = safe_basename(upload.filename)
            rel = f"{folder}/{name}" if folder else name
            dest = staging / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            upload.save(dest)
            rel_names.append(rel)

        if not rel_names:
            return jsonify({"error": "没有有效的文件"}), 400

        proc = seven_zip(["a", "-y", "-bd", str(session["path"]), *rel_names],
                         cwd=staging, timeout=600)
        if proc.returncode not in (0, 1):
            return jsonify({"ok": False, "error": (proc.stdout or "") + (proc.stderr or "")}), 500
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    payload = build_payload(sid)
    payload["added"] = len(rel_names)
    payload["addedPaths"] = rel_names
    return jsonify(payload)


@app.post("/api/archives/<sid>/delete")
def api_delete(sid: str):
    session = SESSIONS.get(sid)
    if not session:
        return jsonify({"error": "压缩包会话已失效"}), 404

    data = request.get_json(silent=True) or {}
    paths = [p for p in (data.get("paths") or []) if isinstance(p, str) and p.strip()]
    if not paths:
        return jsonify({"error": "没有选择要删除的项目"}), 400

    proc = seven_zip(["d", "-y", "-bd", "-sccUTF-8", str(session["path"]), *paths], timeout=600)
    if proc.returncode not in (0, 1):
        return jsonify({"ok": False, "error": (proc.stdout or "") + (proc.stderr or "")}), 500

    payload = build_payload(sid)
    payload["ok"] = True
    payload["deleted"] = len(paths)
    return jsonify(payload)


def pick_folder() -> str | None:
    """在独立进程中弹出系统目录选择框，避免 Tk 与 Web 线程冲突。"""
    script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "r = tk.Tk()\n"
        "r.withdraw()\n"
        "r.attributes('-topmost', True)\n"
        "p = filedialog.askdirectory(title='选择解压目录')\n"
        "r.destroy()\n"
        "print(p or '')\n"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, timeout=120,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:  # noqa: BLE001
        return None
    return (proc.stdout or "").strip() or None


def pick_files() -> list[str]:
    """在独立进程中弹出多选文件框，用于新建压缩包。"""
    script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "r = tk.Tk()\n"
        "r.withdraw()\n"
        "r.attributes('-topmost', True)\n"
        "p = filedialog.askopenfilenames(title='选择要压缩的文件')\n"
        "r.destroy()\n"
        "print('\\n'.join(p))\n"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, timeout=300,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:  # noqa: BLE001
        return []
    return [line for line in (proc.stdout or "").splitlines() if line.strip()]


def pick_save_path() -> str | None:
    """在独立进程中弹出系统保存框，用于新建压缩文件。"""
    script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "r = tk.Tk()\n"
        "r.withdraw()\n"
        "r.attributes('-topmost', True)\n"
        "p = filedialog.asksaveasfilename(\n"
        "    title='新建压缩文件',\n"
        "    initialfile='新建压缩包.zip',\n"
        "    defaultextension='.zip',\n"
        "    filetypes=[('ZIP 压缩包', '*.zip')]\n"
        ")\n"
        "r.destroy()\n"
        "print(p or '')\n"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, timeout=120,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:  # noqa: BLE001
        return None
    return (proc.stdout or "").strip() or None


# --------------------------------------------------------------------------- #
# 演示压缩包
# --------------------------------------------------------------------------- #

def build_demo_zip() -> bytes:
    import io

    files: dict[str, bytes] = {
        "README.txt": (
            "XiZip 演示压缩包\n"
            "================\n\n"
            "这个压缩包由 XiZip 在本地即时生成，用于体验界面。\n"
            "双击右侧文件可在预览板块中查看内容。\n"
            "把任意文件拖入文件窗格，即可追加进压缩包。\n"
        ).encode("utf-8"),
        "LICENSE.txt": "MIT License\n\nCopyright (c) 2026 XiZip".encode("utf-8"),
        "docs/使用说明.md": (
            "# XiZip 使用说明\n\n"
            "## 快捷键\n\n"
            "- 拖拽压缩包到舞台：打开\n"
            "- 拖拽普通文件到文件窗格：添加到压缩包\n\n"
            "## 三种视图\n\n"
            "| 视图 | 用途 |\n| --- | --- |\n"
            "| MINI | 快速浏览与解压 |\n"
            "| MAX | 文件树 + 列表 + 预览 |\n"
            "| 预览 | 不解压直接查看 |\n"
        ).encode("utf-8"),
        "data/清单.csv": (
            "名称,类型,压缩后,压缩率\n"
            "封面.svg,图像,148 KB,62%\n"
            "banner.svg,图像,96 KB,58%\n"
            "使用说明.md,文档,2 KB,41%\n"
            "main.py,代码,3 KB,49%\n"
        ).encode("utf-8"),
        "src/main.py": (
            "from pathlib import Path\n\n\n"
            "def scan(folder: Path):\n"
            "    for item in sorted(folder.iterdir()):\n"
            "        yield item.name, item.stat().st_size\n\n\n"
            'if __name__ == "__main__":\n'
            '    print(list(scan(Path("."))))\n'
        ).encode("utf-8"),
        "src/utils.py": (
            "def human_size(num: int) -> str:\n"
            "    for unit in ('B', 'KB', 'MB', 'GB'):\n"
            "        if num < 1024:\n"
            "            return f'{num:.1f} {unit}'\n"
            "        num /= 1024\n"
            "    return f'{num:.1f} TB'\n"
        ).encode("utf-8"),
        "assets/封面.svg": svg_cover(),
        "assets/banner.svg": svg_banner(),
        "assets/logo.svg": svg_logo(),
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, data in files.items():
            zf.writestr(path, data)
    return buffer.getvalue()


def svg_cover() -> bytes:
    return """<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17110b"/>
      <stop offset="1" stop-color="#2a1c0c"/>
    </linearGradient>
    <radialGradient id="violet" cx="0.28" cy="0.18" r="0.75">
      <stop offset="0" stop-color="#e8a33a" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#e8a33a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pink" cx="0.82" cy="0.78" r="0.7">
      <stop offset="0" stop-color="#f4704f" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#f4704f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="teal" cx="0.66" cy="0.22" r="0.55">
      <stop offset="0" stop-color="#ffbe6c" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#ffbe6c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="type" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.7" stop-color="#ffe1b4"/>
      <stop offset="1" stop-color="#e6a33c"/>
    </linearGradient>
  </defs>
  <rect width="960" height="600" fill="url(#bg)"/>
  <rect width="960" height="600" fill="url(#violet)"/>
  <rect width="960" height="600" fill="url(#pink)"/>
  <rect width="960" height="600" fill="url(#teal)"/>
  <g opacity="0.16">
    <circle cx="120" cy="510" r="140" fill="none" stroke="#ffffff" stroke-width="1"/>
    <circle cx="120" cy="510" r="220" fill="none" stroke="#ffffff" stroke-width="1"/>
    <circle cx="840" cy="90" r="120" fill="none" stroke="#ffffff" stroke-width="1"/>
  </g>
  <g>
    <rect x="72" y="72" width="44" height="44" rx="12" fill="#d98a1c" opacity="0.9"/>
    <path d="M86 86h24v5H86zM86 96h24v2H86zM86 102h18v2H86zM86 108h24v2H86z" fill="#ffffff" opacity="0.85"/>
    <text x="132" y="104" font-family="Segoe UI, sans-serif" font-size="24" letter-spacing="4" fill="#f3d6a6">XIZIP STUDIO</text>
  </g>
  <text x="72" y="320" font-family="Segoe UI, sans-serif" font-size="132" font-weight="700" letter-spacing="-3" fill="url(#type)">XiZip</text>
  <text x="76" y="382" font-family="Segoe UI, sans-serif" font-size="26" letter-spacing="2" fill="#c2ad8d">COMPRESS · INSPECT · EXTRACT</text>
  <g opacity="0.55">
    <rect x="76" y="440" width="140" height="3" rx="1.5" fill="#d98a1c"/>
    <text x="76" y="490" font-family="Segoe UI, sans-serif" font-size="16" fill="#9a8768">7-Zip kernel · local first · zero cloud</text>
  </g>
</svg>""".encode("utf-8")


def svg_banner() -> bytes:
    return """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420">
  <defs>
    <linearGradient id="b1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b5660e"/>
      <stop offset="0.5" stop-color="#e8a33a"/>
      <stop offset="1" stop-color="#ffbe6c"/>
    </linearGradient>
    <linearGradient id="b2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#17110b"/>
      <stop offset="1" stop-color="#241708"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="420" fill="url(#b2)"/>
  <g transform="translate(0,-40)">
    <ellipse cx="980" cy="230" rx="360" ry="240" fill="url(#b1)" opacity="0.35"/>
    <ellipse cx="260" cy="160" rx="300" ry="200" fill="#f4704f" opacity="0.12"/>
  </g>
  <g font-family="Segoe UI, sans-serif">
    <text x="80" y="200" font-size="64" font-weight="700" fill="#fff6e8">解压，从未如此安静。</text>
    <text x="84" y="256" font-size="22" fill="#c2ad8d" letter-spacing="1">XiZip 以 7-Zip 为内核，界面只有玻璃、光与文件。</text>
    <rect x="84" y="300" width="188" height="52" rx="26" fill="#ffffff" opacity="0.1"/>
    <text x="118" y="333" font-size="18" fill="#ffe6c2">XiZip MAX →</text>
  </g>
</svg>""".encode("utf-8")


def svg_logo() -> bytes:
    return """<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd08a"/>
      <stop offset="0.55" stop-color="#e8a33a"/>
      <stop offset="1" stop-color="#8a4c06"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="144" height="144" rx="36" fill="url(#lg)"/>
  <rect x="8" y="8" width="144" height="144" rx="36" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
  <g fill="#ffffff" fill-opacity="0.92">
    <path d="M50 56h60v8H50z"/>
    <path d="M50 72h60v4H50z"/>
    <path d="M50 84h44v4H50z"/>
    <path d="M50 96h60v4H50z"/>
    <path d="M50 108h32v4H50z"/>
  </g>
  <circle cx="112" cy="110" r="18" fill="#ffffff" fill-opacity="0.16"/>
  <path d="M112 102v16M104 110h16" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
</svg>""".encode("utf-8")


# --------------------------------------------------------------------------- #
# 启动
# --------------------------------------------------------------------------- #

def shutdown():
    shutil.rmtree(TEMP_ROOT, ignore_errors=True)


atexit.register(shutdown)


def pick_port() -> int:
    import socket
    for port in range(8765, 8790):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return 8765


def wait_for_server(url: str, timeout: float = 10.0) -> bool:
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=0.6) as resp:
                if resp.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            time.sleep(0.08)
    return False


def screen_size() -> tuple[int, int]:
    try:
        import ctypes
        return (
            ctypes.windll.user32.GetSystemMetrics(0),
            ctypes.windll.user32.GetSystemMetrics(1),
        )
    except Exception:  # noqa: BLE001
        return (1600, 1000)


def logical_screen_size() -> tuple[int, int]:
    """按系统 DPI 换算的屏幕尺寸，与 pywebview 使用的逻辑像素一致。"""
    try:
        import ctypes
        width, height = screen_size()
        dpi = ctypes.windll.user32.GetDpiForSystem() or 96
        scale = dpi / 96.0
        if scale <= 1:
            return width, height
        return int(width / scale), int(height / scale)
    except Exception:  # noqa: BLE001
        return screen_size()


def max_window_size() -> tuple[int, int]:
    screen_w, screen_h = logical_screen_size()
    width = min(1440, max(1080, int(screen_w * 0.88)), screen_w)
    height = min(960, max(680, int(screen_h * 0.86)), screen_h)
    return width, height


def storage_dir() -> Path:
    """WebView2 的持久化目录，用于保存界面设置。"""
    base = os.environ.get("LOCALAPPDATA")
    return (Path(base) / "XiZip") if base else (BASE_DIR / ".xizip")


def open_desktop_window(url: str) -> None:
    # 让 WebView2 走 GPU 合成：光栅化、零拷贝与画布外置渲染
    os.environ.setdefault(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist "
        "--enable-features=CanvasOopRasterization",
    )

    import webview

    gpu = detect_gpu()
    if gpu["name"]:
        print(f"[XiZip] 渲染设备：{gpu['name']}")

    # 主窗口：普通尺寸窗口，网页界面铺满窗口内容区（不是系统全屏）
    screen_w, screen_h = logical_screen_size()
    win_w, win_h = max_window_size()
    main_window = webview.create_window(
        "XiZip",
        url,
        width=win_w,
        height=win_h,
        x=max(0, (screen_w - win_w) // 2),
        y=max(0, (screen_h - win_h) // 2),
        min_size=(820, 560),
        background_color="#0a0704",
        text_select=True,
    )

    WINDOWS["main"] = main_window

    store = storage_dir()
    try:
        store.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001
        store = Path(tempfile.mkdtemp(prefix="xizip_profile_"))
    webview.start(private_mode=False, storage_path=str(store))


def main() -> None:
    if not SEVEN_ZIP.exists():
        print(f"[XiZip] 缺少 7-Zip 内核：{SEVEN_ZIP}")
        sys.exit(1)

    port = pick_port()
    url = f"http://127.0.0.1:{port}"
    print(f"[XiZip] 7-Zip 内核：{SEVEN_ZIP}")
    print(f"[XiZip] 本地服务：{url}")

    threading.Thread(
        target=lambda: app.run(
            host="127.0.0.1", port=port, debug=False,
            threaded=True, use_reloader=False,
        ),
        daemon=True,
    ).start()

    if not wait_for_server(url):
        print("[XiZip] 本地服务启动失败")
        sys.exit(1)

    try:
        open_desktop_window(url)
    except Exception as exc:  # noqa: BLE001
        print(f"[XiZip] 窗口启动失败：{exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
