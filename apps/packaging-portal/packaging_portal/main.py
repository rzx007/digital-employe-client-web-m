from __future__ import annotations

import json
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from . import db
from .gitlab_api import GitLabClient

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

settings: Settings
gitlab: GitLabClient


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global settings, gitlab
    settings = load_settings()
    db.init_db(settings.database_path)
    gitlab = GitLabClient(settings)
    yield


app = FastAPI(title="BobanStaff 打包门户", lifespan=lifespan)


class BuildRequest(BaseModel):
    project_slug: str = Field(min_length=1, max_length=64)
    git_ref: str = Field(default="", max_length=128)
    assets_ref: str = Field(default="main", max_length=128)
    triggered_by: str = Field(default="", max_length=128)


class BrandJsonBody(BaseModel):
    brand_json: str


def _slug_ok(slug: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]*", slug))


@app.get("/api/settings")
async def public_settings():
    return {
        "default_git_ref": settings.default_git_ref,
        "assets_gitlab_url": settings.assets_gitlab_url,
        "ci_gitlab_url": settings.ci_gitlab_url,
    }


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/projects")
async def list_projects(ref: str = "main"):
    try:
        slugs = await gitlab.list_brand_projects(ref=ref)
    except Exception as e:
        raise HTTPException(502, f"读取资源库失败: {e}") from e
    projects = []
    for slug in slugs:
        item: dict = {"slug": slug}
        try:
            raw = await gitlab.get_file(f"projects/{slug}/brand.json", ref=ref)
            item["brand"] = json.loads(raw.decode("utf-8"))
        except Exception:
            item["brand"] = None
        try:
            meta_raw = await gitlab.get_file(f"projects/{slug}/meta.json", ref=ref)
            item["meta"] = json.loads(meta_raw.decode("utf-8"))
        except Exception:
            item["meta"] = None
        projects.append(item)
    return {"ref": ref, "projects": projects}


@app.post("/api/projects/{slug}/upload")
async def upload_project(
    slug: str,
    brand_json: str = Form(...),
    triggered_by: str = Form(""),
    logo: UploadFile | None = File(None),
    icon_ico: UploadFile | None = File(None),
    icon_png: UploadFile | None = File(None),
):
    if not _slug_ok(slug):
        raise HTTPException(400, "slug 仅允许小写字母、数字、-_")

    try:
        parsed = json.loads(brand_json)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"brand.json 不是合法 JSON: {e}") from e

    files: dict[str, bytes] = {
        f"projects/{slug}/brand.json": json.dumps(
            parsed, ensure_ascii=False, indent=2
        ).encode("utf-8"),
    }

    meta = {
        "displayName": parsed.get("productName", slug),
        "description": "",
        "updatedBy": triggered_by or "packaging-portal",
    }
    files[f"projects/{slug}/meta.json"] = json.dumps(
        meta, ensure_ascii=False, indent=2
    ).encode("utf-8")

    if logo:
        files[f"projects/{slug}/logo.png"] = await logo.read()
    if icon_ico:
        files[f"projects/{slug}/icon.ico"] = await icon_ico.read()
    if icon_png:
        files[f"projects/{slug}/icon.png"] = await icon_png.read()

    try:
        commit_id = await gitlab.commit_files(
            branch="main",
            commit_message=f"portal: update brand project {slug}",
            files=files,
            author_name=triggered_by or "packaging-portal",
        )
    except Exception as e:
        raise HTTPException(502, f"提交资源库失败: {e}") from e

    return {"slug": slug, "commit": commit_id}


@app.post("/api/builds")
async def create_build(body: BuildRequest):
    if not _slug_ok(body.project_slug):
        raise HTTPException(400, "无效的 project_slug")

    git_ref = body.git_ref or settings.default_git_ref
    build_id = db.create_build(
        settings.database_path,
        project_slug=body.project_slug,
        git_ref=git_ref,
        triggered_by=body.triggered_by or None,
    )

    try:
        pipeline = await gitlab.trigger_branded_build(
            brand_project=body.project_slug,
            git_ref=git_ref,
            assets_ref=body.assets_ref,
        )
    except Exception as e:
        db.update_build_status(settings.database_path, build_id, status="failed")
        raise HTTPException(502, f"触发 CI 失败: {e}") from e

    pipeline_id = int(pipeline["id"])
    pipeline_url = pipeline.get("web_url") or (
        f"{settings.ci_gitlab_url}/{settings.main_project_id}/-/pipelines/{pipeline_id}"
    )
    db.update_build_pipeline(
        settings.database_path,
        build_id,
        pipeline_id=pipeline_id,
        pipeline_url=pipeline_url,
        status=pipeline.get("status", "pending"),
    )
    return db.get_build(settings.database_path, build_id)


@app.get("/api/builds")
async def list_builds(limit: int = 50):
    return {"builds": db.list_builds(settings.database_path, limit=limit)}


@app.get("/api/builds/{build_id}")
async def get_build(build_id: int, refresh: bool = False):
    row = db.get_build(settings.database_path, build_id)
    if not row:
        raise HTTPException(404, "记录不存在")
    if refresh and row.get("pipeline_id"):
        try:
            p = await gitlab.get_pipeline(int(row["pipeline_id"]))
            status = p.get("status", row["status"])
            db.update_build_status(
                settings.database_path,
                build_id,
                status=status,
            )
            row = db.get_build(settings.database_path, build_id)
        except Exception:
            pass
    return row


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
