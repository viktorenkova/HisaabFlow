from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class NormalizedTransaction:
    source_bank: str
    source_parser: str
    source_file: str
    account_number: str
    operation_date: str
    document_number: str
    direction: str
    amount: float
    counterparty_name: str
    payment_purpose: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    extracted_email: Optional[str] = None
    matched_rules: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["amount"] = round(float(self.amount or 0), 2)
        return payload
