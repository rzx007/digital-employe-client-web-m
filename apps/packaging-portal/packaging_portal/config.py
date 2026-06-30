import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # 216：packaging-assets 资源库
    assets_gitlab_url: str
    assets_gitlab_token: str
    assets_project_id: str
    brand_assets_repo: str
    # bobandata.com：digital-employee-client CI
    ci_gitlab_url: str
    ci_gitlab_token: str
    main_project_id: str
    trigger_token: str
    default_git_ref: str
    database_path: str
    port: int


def load_settings() -> Settings:
    assets_url = os.environ.get(
        "ASSETS_GITLAB_URL",
        os.environ.get("GITLAB_URL", "http://10.172.246.216:8929"),
    ).rstrip("/")
    ci_url = os.environ.get(
        "CI_GITLAB_URL",
        os.environ.get("GITLAB_MAIN_URL", "https://gitlab.bobandata.com"),
    ).rstrip("/")
    return Settings(
        assets_gitlab_url=assets_url,
        assets_gitlab_token=os.environ.get(
            "ASSETS_GITLAB_TOKEN", os.environ["GITLAB_TOKEN"]
        ),
        assets_project_id=os.environ.get(
            "GITLAB_ASSETS_PROJECT_ID", os.environ.get("ASSETS_PROJECT_ID", "")
        ),
        brand_assets_repo=os.environ["BRAND_ASSETS_REPO"],
        ci_gitlab_url=ci_url,
        ci_gitlab_token=os.environ.get(
            "CI_GITLAB_TOKEN", os.environ.get("GITLAB_MAIN_TOKEN", "")
        ),
        main_project_id=os.environ.get(
            "GITLAB_MAIN_PROJECT_ID", os.environ.get("CI_MAIN_PROJECT_ID", "")
        ),
        trigger_token=os.environ["GITLAB_TRIGGER_TOKEN"],
        default_git_ref=os.environ.get("DEFAULT_GIT_REF", "dev"),
        database_path=os.environ.get(
            "DATABASE_PATH", "/home/boban/packaging-portal/data/packaging-portal.db"
        ),
        port=int(os.environ.get("PORT", "8090")),
    )
