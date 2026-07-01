"""Typer CLI：de-license"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel

from license_issuer.config import (
    DEFAULT_ADMIN_DIR,
    default_private_key_path,
    private_key_hint,
    resolve_private_key,
    resolve_public_key,
    tool_install_dir,
)
from license_issuer.service import IssueService, KeyService

app = typer.Typer(
    name="de-license",
    help="Digital Employee 离线激活授权签发工具",
    no_args_is_help=True,
)
keys_app = typer.Typer(help="密钥对管理")
app.add_typer(keys_app, name="keys")

console = Console()


@keys_app.command("generate")
def keys_generate(
    out_dir: Path = typer.Option(
        DEFAULT_ADMIN_DIR,
        "--out-dir",
        help="私钥/公钥输出目录",
    ),
    force: bool = typer.Option(False, "--force", help="覆盖已存在的密钥"),
) -> None:
    """生成 Ed25519 密钥对。"""
    try:
        paths = KeyService.generate_keypair(out_dir, force=force)
    except FileExistsError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=1) from exc
    console.print(f"[green]私钥[/green]: {paths.private_key}")
    console.print(f"[green]公钥[/green]: {paths.public_key}")
    console.print(
        "\n[yellow]提醒[/yellow]：私钥勿提交仓库。"
        f"\n分发二进制时，将 private_key.pem 与 de-license.exe 同目录（{tool_install_dir()}）。"
        "\n公钥需拷贝到 apps/server/src/core/activation/public_key.pem 后重打客户端。"
    )


@keys_app.command("export-public")
def keys_export_public(
    private_key: Optional[Path] = typer.Option(
        None,
        "--private-key",
        help="私钥路径（默认同目录 private_key.pem）",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="写入公钥文件；默认打印到 stdout",
    ),
) -> None:
    """从私钥导出公钥 PEM。"""
    priv = resolve_private_key(str(private_key) if private_key else None)
    if not priv.exists():
        console.print(f"[red]私钥不存在: {priv}[/red]")
        console.print(private_key_hint())
        raise typer.Exit(code=1)
    public_pem = KeyService.read_public_key(priv)
    if output:
        output.expanduser().write_bytes(public_pem)
        console.print(f"[green]已写入[/green]: {output}")
    else:
        console.print(public_pem.decode("utf-8"))


@app.command("issue")
def issue(
    device: str = typer.Option(..., "--device", help="用户提供的设备码"),
    expires: str = typer.Option(
        ...,
        "--expires",
        help="到期：YYYY-MM-DD 或 +30d/+12m/+1y",
    ),
    private_key: Optional[Path] = typer.Option(
        None,
        "--private-key",
        help=f"私钥路径（默认 {default_private_key_path()}）",
    ),
) -> None:
    """签发授权码。"""
    priv = resolve_private_key(str(private_key) if private_key else None)
    try:
        result = IssueService().issue(device, expires, priv)
    except FileNotFoundError as exc:
        console.print(f"[red]{exc}[/red]")
        console.print(private_key_hint())
        raise typer.Exit(code=1) from exc
    console.print(f"设备码: [cyan]{result.device_code_display}[/cyan]")
    console.print(f"到期: {result.expires_at.isoformat()}")
    console.print(
        Panel(
            result.license_code,
            title="授权码（发给用户）",
            border_style="green",
        )
    )


@app.command("verify")
def verify(
    license_code: str = typer.Option(..., "--license", help="授权码"),
    device: str = typer.Option(..., "--device", help="设备码"),
    public_key: Optional[Path] = typer.Option(
        None,
        "--public-key",
        help="公钥路径",
    ),
) -> None:
    """验证授权码（管理员自测）。"""
    pub = resolve_public_key(str(public_key) if public_key else None)
    try:
        IssueService().verify(license_code, device, pub)
    except FileNotFoundError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # noqa: BLE001
        console.print(f"[red]验证失败: {exc}[/red]")
        raise typer.Exit(code=1) from exc
    console.print("[green]授权码有效[/green]")
