"""签发业务编排（密码学在 activation_core）。"""

from __future__ import annotations

from pathlib import Path

from activation_core import (
    format_device_code,
    generate_keypair,
    parse_expires,
    sign_license,
    verify_license,
)
from license_issuer.config import DEFAULT_ADMIN_DIR
from license_issuer.models import IssueResult, KeypairPaths


class KeyService:
    @staticmethod
    def generate_keypair(out_dir: Path, *, force: bool = False) -> KeypairPaths:
        out_dir = out_dir.expanduser()
        out_dir.mkdir(parents=True, exist_ok=True)
        private_path = out_dir / "private_key.pem"
        public_path = out_dir / "public_key.pem"
        if private_path.exists() and not force:
            raise FileExistsError(f"私钥已存在: {private_path}（使用 force=True 覆盖）")
        private_pem, public_pem = generate_keypair()
        private_path.write_bytes(private_pem)
        public_path.write_bytes(public_pem)
        return KeypairPaths(private_key=private_path, public_key=public_path)

    @staticmethod
    def read_public_key(private_key_path: Path) -> bytes:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        private_pem = private_key_path.expanduser().read_bytes()
        key = serialization.load_pem_private_key(private_pem, password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("私钥不是 Ed25519 类型")
        return key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )


class IssueService:
    def issue(
        self,
        device_code: str,
        expires: str,
        private_key_path: Path,
    ) -> IssueResult:
        path = private_key_path.expanduser()
        if not path.exists():
            raise FileNotFoundError(f"私钥不存在: {path}")
        expires_at = parse_expires(expires)
        license_code = sign_license(path.read_bytes(), device_code, expires_at)
        return IssueResult(
            device_code_display=format_device_code(device_code),
            expires_at=expires_at,
            license_code=license_code,
        )

    def verify(
        self,
        license_code: str,
        device_code: str,
        public_key_path: Path,
    ) -> None:
        path = public_key_path.expanduser()
        if not path.exists():
            raise FileNotFoundError(f"公钥不存在: {path}")
        verify_license(
            license_code.strip(),
            path.read_bytes(),
            device_code=device_code,
        )


def default_admin_dir() -> Path:
    return DEFAULT_ADMIN_DIR
