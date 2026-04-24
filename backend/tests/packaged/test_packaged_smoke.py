"""
Packaged-backend smoke tests.

These tests run against a live backend URL so we can validate a packaged
Windows build, not just the in-process FastAPI app used by normal tests.

PowerShell example:
    $env:HISAABFLOW_SMOKE_BASE_URL = "http://127.0.0.1:8011"
    pytest backend/tests/packaged -m packaged_smoke -q
"""

from __future__ import annotations

import json
import mimetypes
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest


pytestmark = [pytest.mark.packaged_smoke]


@dataclass(frozen=True)
class SmokeSettings:
    base_url: str
    known_bank_file: Path
    unknown_bank_file: Path
    refund_file: Path
    timeout_seconds: float


@dataclass(frozen=True)
class HttpResponse:
    status_code: int
    headers: Mapping[str, str]
    content: bytes
    url: str
    method: str

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Dict[str, Any]:
        return json.loads(self.text)

    def header(self, name: str, default: str = "") -> str:
        target = name.lower()
        for key, value in self.headers.items():
            if key.lower() == target:
                return value
        return default


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_sample_path(env_name: str, default_relative_path: str) -> Path:
    configured_path = os.getenv(env_name)
    sample_path = Path(configured_path) if configured_path else _repo_root() / default_relative_path

    if not sample_path.exists():
        pytest.skip(
            f"Smoke sample file not found for {env_name}: {sample_path}",
            allow_module_level=False,
        )

    return sample_path


def _request(
    method: str,
    url: str,
    timeout_seconds: float,
    *,
    json_body: Optional[Dict[str, Any]] = None,
    form_fields: Optional[Dict[str, str]] = None,
    files: Optional[Dict[str, Path]] = None,
) -> HttpResponse:
    headers: Dict[str, str] = {}
    body: Optional[bytes] = None

    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif files:
        boundary = f"----hisaabflow-smoke-{uuid.uuid4().hex}"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        body = _encode_multipart(boundary, form_fields or {}, files)
    elif form_fields:
        body = urlencode(form_fields).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    request = Request(url=url, data=body, method=method.upper(), headers=headers)

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            return HttpResponse(
                status_code=response.status,
                headers=dict(response.headers.items()),
                content=response.read(),
                url=url,
                method=method.upper(),
            )
    except HTTPError as exc:
        return HttpResponse(
            status_code=exc.code,
            headers=dict(exc.headers.items()),
            content=exc.read(),
            url=url,
            method=method.upper(),
        )
    except URLError as exc:
        pytest.fail(f"Request failed for {method.upper()} {url}: {exc}")


def _encode_multipart(boundary: str, form_fields: Dict[str, str], files: Dict[str, Path]) -> bytes:
    boundary_bytes = boundary.encode("utf-8")
    chunks = []

    for field_name, value in form_fields.items():
        chunks.extend(
            [
                b"--" + boundary_bytes + b"\r\n",
                f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )

    for field_name, file_path in files.items():
        mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        chunks.extend(
            [
                b"--" + boundary_bytes + b"\r\n",
                (
                    f'Content-Disposition: form-data; name="{field_name}"; '
                    f'filename="{file_path.name}"\r\n'
                ).encode("utf-8"),
                f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
                file_path.read_bytes(),
                b"\r\n",
            ]
        )

    chunks.append(b"--" + boundary_bytes + b"--\r\n")
    return b"".join(chunks)


@pytest.fixture(scope="session")
def smoke_settings() -> SmokeSettings:
    base_url = os.getenv("HISAABFLOW_SMOKE_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        pytest.skip(
            "Set HISAABFLOW_SMOKE_BASE_URL to run packaged smoke tests.",
            allow_module_level=True,
        )

    timeout_seconds = float(os.getenv("HISAABFLOW_SMOKE_TIMEOUT", "30"))

    return SmokeSettings(
        base_url=base_url,
        known_bank_file=_resolve_sample_path(
            "HISAABFLOW_SMOKE_KNOWN_FILE",
            "sample_data/statement_23243482_EUR_2025-01-04_2025-06-02.csv",
        ),
        unknown_bank_file=_resolve_sample_path(
            "HISAABFLOW_SMOKE_UNKNOWN_FILE",
            "sample_data/2019-03-02_11-50-46_bunq-statement.csv",
        ),
        refund_file=_resolve_sample_path(
            "HISAABFLOW_SMOKE_REFUND_FILE",
            "sample_data/statement_23243482_EUR_2025-01-04_2025-06-02.csv",
        ),
        timeout_seconds=timeout_seconds,
    )


@pytest.fixture
def uploaded_file_ids(smoke_settings: SmokeSettings) -> list[str]:
    file_ids: list[str] = []
    yield file_ids

    for file_id in file_ids:
        _request(
            "DELETE",
            f"{smoke_settings.base_url}/api/v1/cleanup/{file_id}",
            smoke_settings.timeout_seconds,
        )


def _json_or_fail(response: HttpResponse) -> Dict[str, Any]:
    try:
        return response.json()
    except ValueError as exc:
        body_preview = response.text[:500]
        pytest.fail(
            f"Expected JSON from {response.method} {response.url}, "
            f"got status {response.status_code} and body preview: {body_preview!r} ({exc})"
        )


def _assert_ok_json(response: HttpResponse) -> Dict[str, Any]:
    assert response.status_code == 200, response.text
    return _json_or_fail(response)


def _upload_csv(
    smoke_settings: SmokeSettings,
    uploaded_file_ids: list[str],
    sample_path: Path,
) -> Dict[str, Any]:
    response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/upload",
        smoke_settings.timeout_seconds,
        files={"file": sample_path},
    )

    payload = _assert_ok_json(response)
    assert payload["success"] is True
    assert payload["file_id"]
    uploaded_file_ids.append(payload["file_id"])
    return payload


def _choose_bank_name(configs_payload: Dict[str, Any]) -> str:
    raw_bank_names = configs_payload["raw_bank_names"]
    assert raw_bank_names, "Expected at least one bank configuration"

    if "wise" in raw_bank_names:
        return "wise"

    return raw_bank_names[0]


def test_packaged_health_and_config_endpoints(
    smoke_settings: SmokeSettings,
) -> None:
    health_response = _request(
        "GET",
        f"{smoke_settings.base_url}/health",
        smoke_settings.timeout_seconds,
    )
    health_payload = _assert_ok_json(health_response)
    assert health_payload["status"] == "healthy"
    assert health_payload["routers_available"] is True

    configs_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/configs",
        smoke_settings.timeout_seconds,
    )
    configs_payload = _assert_ok_json(configs_response)
    assert configs_payload["count"] >= 1
    assert len(configs_payload["raw_bank_names"]) == configs_payload["count"]

    bank_name = _choose_bank_name(configs_payload)
    config_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/config/{bank_name}",
        smoke_settings.timeout_seconds,
    )
    config_payload = _assert_ok_json(config_response)
    assert config_payload["success"] is True
    assert config_payload["bank_name"] == bank_name
    assert config_payload["config"]["column_mapping"]


def test_packaged_known_bank_preview_parse_transform_export(
    smoke_settings: SmokeSettings,
    uploaded_file_ids: list[str],
) -> None:
    upload_payload = _upload_csv(
        smoke_settings,
        uploaded_file_ids,
        smoke_settings.known_bank_file,
    )
    file_id = upload_payload["file_id"]

    preview_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/preview/{file_id}",
        smoke_settings.timeout_seconds,
    )
    preview_payload = _assert_ok_json(preview_response)
    assert preview_payload["success"] is True
    assert preview_payload["preview_data"]
    assert preview_payload["bank_detection"]["detected_bank"] != "unknown"

    detected_bank = preview_payload["bank_detection"]["detected_bank"]
    config_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/config/{detected_bank}",
        smoke_settings.timeout_seconds,
    )
    config_payload = _assert_ok_json(config_response)
    assert config_payload["success"] is True

    detect_range_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/detect-range/{file_id}",
        smoke_settings.timeout_seconds,
    )
    detect_range_payload = _assert_ok_json(detect_range_response)
    assert detect_range_payload["success"] is True
    assert detect_range_payload["suggested_header_row"] >= 0

    parse_request = {
        "start_row": detect_range_payload["suggested_header_row"],
        "end_row": None,
        "start_col": 0,
        "end_col": None,
        "encoding": preview_payload["encoding_used"],
        "enable_cleaning": True,
    }
    parse_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/parse-range/{file_id}",
        smoke_settings.timeout_seconds,
        json_body=parse_request,
    )
    parse_payload = _assert_ok_json(parse_response)
    assert parse_payload["success"] is True
    assert parse_payload["row_count"] > 0
    assert parse_payload["data"]

    transform_request = {
        "data": parse_payload["data"],
        "column_mapping": config_payload["config"]["column_mapping"],
        "bank_name": detected_bank,
    }
    transform_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/transform",
        smoke_settings.timeout_seconds,
        json_body=transform_request,
    )
    transform_payload = _assert_ok_json(transform_response)
    assert transform_payload["success"] is True
    assert transform_payload["row_count"] > 0
    assert transform_payload["data"]

    export_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/export",
        smoke_settings.timeout_seconds,
        json_body={"data": transform_payload["data"]},
    )
    assert export_response.status_code == 200, export_response.text
    assert "text/csv" in export_response.header("Content-Type")
    assert "attachment;" in export_response.header("Content-Disposition").lower()
    assert export_response.text.startswith("Date,Amount,Category,Title,Note,Account")


def test_packaged_multi_csv_pipeline(
    smoke_settings: SmokeSettings,
    uploaded_file_ids: list[str],
) -> None:
    upload_payload = _upload_csv(
        smoke_settings,
        uploaded_file_ids,
        smoke_settings.known_bank_file,
    )
    file_id = upload_payload["file_id"]

    preview_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/preview/{file_id}",
        smoke_settings.timeout_seconds,
    )
    preview_payload = _assert_ok_json(preview_response)
    assert preview_payload["success"] is True

    detect_range_response = _request(
        "GET",
        f"{smoke_settings.base_url}/api/v1/detect-range/{file_id}",
        smoke_settings.timeout_seconds,
    )
    detect_range_payload = _assert_ok_json(detect_range_response)
    assert detect_range_payload["success"] is True

    multi_parse_request = {
        "file_ids": [file_id],
        "parse_configs": [
            {
                "start_row": detect_range_payload["suggested_header_row"],
                "end_row": None,
                "start_col": 0,
                "end_col": None,
                "encoding": preview_payload["encoding_used"],
                "enable_cleaning": True,
            }
        ],
        "enable_cleaning": True,
    }
    multi_parse_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/multi-csv/parse",
        smoke_settings.timeout_seconds,
        json_body=multi_parse_request,
    )
    multi_parse_payload = _assert_ok_json(multi_parse_response)
    assert multi_parse_payload["success"] is True
    assert multi_parse_payload["total_files"] == 1
    assert len(multi_parse_payload["parsed_csvs"]) == 1

    parsed_csv = multi_parse_payload["parsed_csvs"][0]
    assert parsed_csv["success"] is True
    assert parsed_csv["parse_result"]["row_count"] > 0

    multi_transform_request = {
        "csv_data_list": [
            {
                "filename": parsed_csv["filename"],
                "data": parsed_csv["parse_result"]["data"],
                "headers": parsed_csv["parse_result"]["headers"],
                "bank_info": parsed_csv["bank_info"],
            }
        ]
    }
    multi_transform_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/multi-csv/transform",
        smoke_settings.timeout_seconds,
        json_body=multi_transform_request,
    )
    multi_transform_payload = _assert_ok_json(multi_transform_response)
    assert multi_transform_payload["success"] is True
    assert multi_transform_payload["transformed_data"]
    assert multi_transform_payload["transformation_summary"]["total_files"] == 1


def test_packaged_refund_analyze_and_export(
    smoke_settings: SmokeSettings,
    uploaded_file_ids: list[str],
) -> None:
    upload_payload = _upload_csv(
        smoke_settings,
        uploaded_file_ids,
        smoke_settings.refund_file,
    )

    analyze_request = {
        "file_ids": [upload_payload["file_id"]],
        "options": {
            "enable_amount_multiple": True,
            "amount_multiple": 5000.0,
            "enable_email": True,
            "enable_refund_phrase": True,
            "match_mode": "any",
            "outgoing_only": True,
        },
    }
    analyze_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/refunds/analyze",
        smoke_settings.timeout_seconds,
        json_body=analyze_request,
    )
    analyze_payload = _assert_ok_json(analyze_response)
    assert analyze_payload["success"] is True
    assert analyze_payload["summary"]["requested_files"] == 1
    assert (
        analyze_payload["summary"]["processed_files"]
        + analyze_payload["summary"]["skipped_files"]
        == analyze_payload["summary"]["requested_files"]
    )
    assert "applied_options" in analyze_payload

    export_response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/refunds/export",
        smoke_settings.timeout_seconds,
        json_body={"analysis": analyze_payload},
    )
    assert export_response.status_code == 200, export_response.text
    assert (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        in export_response.header("Content-Type")
    )
    assert "attachment;" in export_response.header("Content-Disposition").lower()
    assert len(export_response.content) > 0


def test_packaged_unknown_bank_analysis(
    smoke_settings: SmokeSettings,
) -> None:
    response = _request(
        "POST",
        f"{smoke_settings.base_url}/api/v1/unknown-bank/analyze-csv",
        smoke_settings.timeout_seconds,
        files={"file": smoke_settings.unknown_bank_file},
    )

    payload = _assert_ok_json(response)
    assert payload["success"] is True
    assert payload["headers"]
    assert payload["sample_data"]
    assert payload["amount_format_analysis"]["confidence"] >= 0.0
