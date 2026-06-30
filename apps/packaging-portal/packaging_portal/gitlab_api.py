from __future__ import annotations

import base64
from typing import Any

import httpx

from .config import Settings


class GitLabClient:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._assets_headers = {"PRIVATE-TOKEN": settings.assets_gitlab_token}
        self._ci_headers = self._auth_headers(settings.ci_gitlab_token)

    @staticmethod
    def _auth_headers(token: str) -> dict[str, str]:
        if token.startswith("glpat-") or len(token) == 40:
            return {"PRIVATE-TOKEN": token}
        return {"Authorization": f"Bearer {token}"}

    def _assets_url(self, path: str) -> str:
        return f"{self._s.assets_gitlab_url}/api/v4{path}"

    def _ci_url(self, path: str) -> str:
        return f"{self._s.ci_gitlab_url}/api/v4{path}"

    async def list_project_tree(self, path: str, ref: str = "main") -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(
                self._assets_url(
                    f"/projects/{self._s.assets_project_id}/repository/tree"
                ),
                headers=self._assets_headers,
                params={"path": path, "ref": ref, "per_page": 100},
            )
            r.raise_for_status()
            return r.json()

    async def list_brand_projects(self, ref: str = "main") -> list[str]:
        items = await self.list_project_tree("projects", ref=ref)
        return sorted(i["name"] for i in items if i.get("type") == "tree")

    async def get_file(self, file_path: str, ref: str = "main") -> bytes:
        encoded = file_path.replace("/", "%2F")
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(
                self._assets_url(
                    f"/projects/{self._s.assets_project_id}/repository/files/{encoded}/raw"
                ),
                headers=self._assets_headers,
                params={"ref": ref},
            )
            r.raise_for_status()
            return r.content

    async def file_exists(self, file_path: str, ref: str = "main") -> bool:
        encoded = file_path.replace("/", "%2F")
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                self._assets_url(
                    f"/projects/{self._s.assets_project_id}/repository/files/{encoded}"
                ),
                headers=self._assets_headers,
                params={"ref": ref},
            )
            return r.status_code == 200

    async def commit_files(
        self,
        *,
        branch: str,
        commit_message: str,
        files: dict[str, bytes],
        author_name: str = "packaging-portal",
    ) -> str:
        actions = []
        for path, content in files.items():
            action = (
                "update"
                if await self.file_exists(path, ref=branch)
                else "create"
            )
            actions.append(
                {
                    "action": action,
                    "file_path": path,
                    "content": base64.b64encode(content).decode("ascii"),
                    "encoding": "base64",
                }
            )
        payload = {
            "branch": branch,
            "commit_message": commit_message,
            "author_name": author_name,
            "actions": actions,
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                self._assets_url(
                    f"/projects/{self._s.assets_project_id}/repository/commits"
                ),
                headers=self._assets_headers,
                json=payload,
            )
            r.raise_for_status()
            return r.json()["id"]

    async def trigger_branded_build(
        self,
        *,
        brand_project: str,
        git_ref: str,
        assets_ref: str = "main",
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                self._ci_url(
                    f"/projects/{self._s.main_project_id}/trigger/pipeline"
                ),
                data={
                    "token": self._s.trigger_token,
                    "ref": git_ref,
                    "variables[BRAND_PROJECT]": brand_project,
                    "variables[BRAND_ASSETS_REPO]": self._s.brand_assets_repo,
                    "variables[BRAND_ASSETS_REF]": assets_ref,
                },
            )
            r.raise_for_status()
            return r.json()

    async def get_pipeline(self, pipeline_id: int) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                self._ci_url(
                    f"/projects/{self._s.main_project_id}/pipelines/{pipeline_id}"
                ),
                headers=self._ci_headers,
            )
            r.raise_for_status()
            return r.json()
