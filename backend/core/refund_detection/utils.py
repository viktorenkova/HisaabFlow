import csv
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

import pandas as pd


EMAIL_REGEX = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def normalize_text(value: object) -> str:
    text = "" if value is None else str(value)
    return " ".join(
        text.replace("\xa0", " ")
        .replace("\n", " ")
        .replace("\r", " ")
        .strip()
        .lower()
        .replace("ё", "е")
        .split()
    )


def clean_account_number(value: object) -> str:
    text = "" if value is None else str(value)
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits


def parse_date(value: object) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S") if value.time() != datetime.min.time() else value.strftime("%Y-%m-%d")

    text = str(value).strip()
    dayfirst = not ("T" in text and "+" in text)
    parsed = pd.to_datetime(text, errors="coerce", dayfirst=dayfirst)
    if pd.isna(parsed):
        return str(value).strip()
    return parsed.strftime("%Y-%m-%d %H:%M:%S") if parsed.time() != datetime.min.time() else parsed.strftime("%Y-%m-%d")


def parse_amount(value: object) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)

    text = str(value).strip()
    if not text:
        return 0.0

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]

    cleaned = (
        text.replace("\xa0", "")
        .replace(" ", "")
        .replace("=", "")
        .replace("−", "-")
    )

    if re.fullmatch(r"\d+-\d{1,2}", cleaned):
        cleaned = cleaned.replace("-", ".")
    elif cleaned.count(",") > 0 and cleaned.count(".") == 0:
        cleaned = cleaned.replace(",", ".")
    elif cleaned.count(",") > 0 and cleaned.count(".") > 0:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")

    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    if cleaned in {"", "-", ".", "-."}:
        return 0.0

    try:
        amount = float(cleaned)
    except ValueError:
        return 0.0
    return -amount if negative else amount


def extract_email(value: object) -> Optional[str]:
    text = "" if value is None else str(value)
    match = EMAIL_REGEX.search(text)
    return match.group(0) if match else None


def is_multiple_of(amount: float, factor: float) -> bool:
    if factor <= 0:
        return False
    if amount is None or math.isclose(float(amount), 0.0, abs_tol=1e-9):
        return False
    quotient = abs(float(amount)) / float(factor)
    return math.isclose(quotient, round(quotient), abs_tol=1e-9)


def read_csv_rows(file_path: str) -> pd.DataFrame:
    attempts = ["utf-8-sig", "cp1251", "utf-8", "latin1"]
    last_error = None
    for encoding in attempts:
        try:
            with open(file_path, "r", encoding=encoding, newline="") as handle:
                sample = handle.read(4096)
                handle.seek(0)
                dialect = csv.Sniffer().sniff(sample, delimiters=";,|\t,")
                delimiter = dialect.delimiter
            return pd.read_csv(file_path, encoding=encoding, sep=delimiter)
        except Exception as exc:  # pragma: no cover - fallback path
            last_error = exc
    raise ValueError(f"Unable to read CSV file {Path(file_path).name}: {last_error}")


def find_row_by_keywords(rows: Iterable[List[object]], keyword_groups: List[str], max_rows: int = 30) -> Optional[int]:
    normalized_keywords = [normalize_text(keyword) for keyword in keyword_groups]
    for index, row in enumerate(rows, start=1):
        if index > max_rows:
            return None
        cells = [normalize_text(cell) for cell in row]
        if all(any(keyword in cell for cell in cells) for keyword in normalized_keywords):
            return index
    return None


def has_meaningful_values(values: List[object]) -> bool:
    return any(value not in (None, "") for value in values)
