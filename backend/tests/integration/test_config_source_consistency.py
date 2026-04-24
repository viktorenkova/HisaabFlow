"""Integration tests for config source consistency across services."""
from pathlib import Path
import shutil

import pytest

from backend.api.dependencies import (
    get_config_manager,
    get_parsing_service,
    get_preview_service,
    get_transformation_service,
)
from backend.infrastructure.config.unified_config_service import (
    get_unified_config_service,
    reset_unified_config_service,
)
from backend.services.unknown_bank_service import UnknownBankService


@pytest.mark.integration
class TestConfigSourceConsistency:
    """Ensure all services use the same effective config directory."""

    @pytest.fixture(autouse=True)
    def reset_singletons(self):
        """Keep singleton and dependency cache state isolated per test."""
        get_preview_service.cache_clear()
        get_parsing_service.cache_clear()
        get_transformation_service.cache_clear()
        get_config_manager.cache_clear()
        reset_unified_config_service()
        yield
        get_preview_service.cache_clear()
        get_parsing_service.cache_clear()
        get_transformation_service.cache_clear()
        get_config_manager.cache_clear()
        reset_unified_config_service()

    def test_all_services_share_user_config_dir_and_reload_from_it(self, monkeypatch):
        """Parsing, cleaning, transformation, preview, and reload should use one config dir."""
        source_configs_dir = Path(__file__).resolve().parents[3] / "configs"
        temp_root = Path(__file__).resolve().parents[3] / "tmp_user_configs_test" / "config_source_consistency"
        shutil.rmtree(temp_root, ignore_errors=True)
        temp_root.mkdir(parents=True, exist_ok=True)
        user_config_dir = temp_root / "user-configs"
        shutil.copytree(source_configs_dir, user_config_dir)

        try:
            app_conf_path = user_config_dir / "app.conf"
            original_app_conf = app_conf_path.read_text(encoding="utf-8")
            app_conf_path.write_text(
                original_app_conf.replace("user_name = Your Name Here", "user_name = Consistency User One"),
                encoding="utf-8",
            )

            monkeypatch.setenv("HISAABFLOW_CONFIG_DIR", str(user_config_dir))
            expected_config_dir = str(user_config_dir.resolve())

            base_config_service = get_unified_config_service()
            preview_service = get_preview_service()
            parsing_service = get_parsing_service()
            transformation_service = get_transformation_service()
            config_manager = get_config_manager()
            unknown_bank_service = UnknownBankService()

            observed_dirs = {
                "base": base_config_service.config_dir,
                "preview": preview_service.config_service.config_dir,
                "parsing": parsing_service.config_service.config_dir,
                "transformation": transformation_service.config_service.config_dir,
                "data_cleaning": transformation_service.data_cleaning_service.config_service.config_dir,
                "transfer_processing": transformation_service.transfer_processing_service.config_service.config_dir,
                "transfer_detector": transformation_service.transfer_processing_service.transfer_detector.config.config_dir,
                "config_manager": config_manager.unified_service.config_dir,
                "unknown_bank": unknown_bank_service.config_service.config_dir,
            }

            assert observed_dirs == {name: expected_config_dir for name in observed_dirs}
            assert base_config_service.get_user_name() == "Consistency User One"

            app_conf_path.write_text(
                original_app_conf.replace("user_name = Your Name Here", "user_name = Consistency User Two"),
                encoding="utf-8",
            )

            reload_success = config_manager.unified_service.reload_all_configs(force=True)

            assert reload_success is True
            assert config_manager.unified_service.config_dir == expected_config_dir
            assert base_config_service.get_user_name() == "Consistency User Two"
            assert transformation_service.config_service.get_user_name() == "Consistency User Two"
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)
