from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List


class RefundPhraseSettingsService:
    def __init__(self, defaults: List[str]):
        self.defaults = self._clean_phrases(defaults)

    def get_settings(self) -> Dict[str, Any]:
        custom_phrases = self._read_custom_phrases()
        return {
            "default_phrases": self.defaults,
            "custom_phrases": custom_phrases,
            "all_phrases": self._merge_phrases(self.defaults, custom_phrases),
            "storage_path": str(self._settings_path()),
        }

    def save_settings(self, custom_phrases: List[str]) -> Dict[str, Any]:
        cleaned_phrases = self._clean_phrases(custom_phrases)
        settings_path = self._settings_path()
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "custom_phrases": cleaned_phrases,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        settings_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return self.get_settings()

    def _read_custom_phrases(self) -> List[str]:
        settings_path = self._settings_path()
        if not settings_path.exists():
            return []

        try:
            payload = json.loads(settings_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []

        phrases = payload.get("custom_phrases", [])
        if not isinstance(phrases, list):
            return []
        return self._clean_phrases(phrases)

    def _settings_path(self) -> Path:
        explicit_path = os.environ.get("HISAABFLOW_REFUND_PHRASES_PATH")
        if explicit_path:
            return Path(explicit_path)

        user_dir = os.environ.get("HISAABFLOW_USER_DIR")
        if user_dir:
            return Path(user_dir) / "refund_phrases.json"

        config_dir = os.environ.get("HISAABFLOW_CONFIG_DIR")
        if config_dir:
            return Path(config_dir).parent / "refund_phrases.json"

        return Path.home() / "HisaabFlow" / "refund_phrases.json"

    def _clean_phrases(self, phrases: List[str]) -> List[str]:
        cleaned = []
        seen = set()
        for phrase in phrases:
            normalized = " ".join(str(phrase).strip().split())
            key = normalized.casefold()
            if normalized and key not in seen:
                cleaned.append(normalized)
                seen.add(key)
        return cleaned

    def _merge_phrases(self, default_phrases: List[str], custom_phrases: List[str]) -> List[str]:
        return self._clean_phrases([*default_phrases, *custom_phrases])
