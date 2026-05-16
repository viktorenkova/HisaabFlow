import json

from backend.services.refund_phrase_settings_service import RefundPhraseSettingsService


def test_refund_phrase_settings_are_saved_to_local_json(monkeypatch, tmp_path):
    settings_path = tmp_path / "refund_phrases.json"
    monkeypatch.setenv("HISAABFLOW_REFUND_PHRASES_PATH", str(settings_path))

    service = RefundPhraseSettingsService(["Возврат по договору"])
    settings = service.save_settings([
        "Оплата услуг по лоту № 100",
        "  Оплата услуг по лоту № 100  ",
        "Своя формулировка",
        "",
    ])

    assert settings["default_phrases"] == ["Возврат по договору"]
    assert settings["custom_phrases"] == [
        "Оплата услуг по лоту № 100",
        "Своя формулировка",
    ]
    assert settings["all_phrases"] == [
        "Возврат по договору",
        "Оплата услуг по лоту № 100",
        "Своя формулировка",
    ]

    payload = json.loads(settings_path.read_text(encoding="utf-8"))
    assert payload["custom_phrases"] == settings["custom_phrases"]


def test_refund_phrase_settings_ignore_invalid_json(monkeypatch, tmp_path):
    settings_path = tmp_path / "refund_phrases.json"
    settings_path.write_text("{broken", encoding="utf-8")
    monkeypatch.setenv("HISAABFLOW_REFUND_PHRASES_PATH", str(settings_path))

    service = RefundPhraseSettingsService(["Возврат по договору"])

    assert service.get_settings()["custom_phrases"] == []
