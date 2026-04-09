import unittest
from unittest.mock import MagicMock, patch

from src.server import create_app


class ServerAppLifespanTest(unittest.TestCase):
    def test_create_app_passes_custom_lifespan_to_fastapi(self) -> None:
        fastapi_instance = MagicMock()
        fastapi_instance.add_middleware = MagicMock()
        fastapi_instance.include_router = MagicMock()

        with patch("src.server.FastAPI", return_value=fastapi_instance) as fastapi_cls:
            create_app()

        _, kwargs = fastapi_cls.call_args
        self.assertIn("lifespan", kwargs)
        self.assertIsNotNone(kwargs["lifespan"])


if __name__ == "__main__":
    unittest.main()
