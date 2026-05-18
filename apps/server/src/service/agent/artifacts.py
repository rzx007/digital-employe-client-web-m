from pathlib import Path

_ARTIFACT_CODE_EXTENSIONS = {
    "ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "html",
    "java", "go", "rs", "cpp", "c", "h",
}
_ARTIFACT_SHEET_EXTENSIONS = {"csv", "tsv"}
_ARTIFACT_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"}
_ARTIFACT_LANGUAGE_MAP = {
    "css": "css", "html": "html", "js": "javascript", "json": "json",
    "md": "markdown", "py": "python", "sql": "sql", "ts": "typescript",
    "tsx": "tsx", "jsx": "jsx", "java": "java", "go": "go", "rs": "rust",
    "cpp": "cpp", "c": "c",
}


def infer_artifact_type(file_path: str) -> str:
    normalized = file_path.replace("\\", "/")
    if normalized.startswith("/skills-draft/"):
        return "skill-draft"
    ext = Path(file_path).suffix.lstrip(".").lower()
    if ext in _ARTIFACT_CODE_EXTENSIONS:
        return "code"
    if ext in _ARTIFACT_SHEET_EXTENSIONS:
        return "sheet"
    if ext in _ARTIFACT_IMAGE_EXTENSIONS:
        return "image"
    return "text"


def infer_artifact_language(file_path: str) -> str | None:
    ext = Path(file_path).suffix.lstrip(".").lower()
    return _ARTIFACT_LANGUAGE_MAP.get(ext)
