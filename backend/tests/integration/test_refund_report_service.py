from backend.core.refund_detection.utils import normalize_text
from backend.services.refund_report_service import DEFAULT_REFUND_PHRASES, RefundReportService


def test_lot_payment_default_phrase_matches_any_numeric_lot():
    service = RefundReportService()

    assert service._matches_refund_phrase(
        normalize_text("Оплата услуг по лоту № 12345"),
        DEFAULT_REFUND_PHRASES,
    )
    assert service._matches_refund_phrase(
        normalize_text("Оплата услуг по лоту №987"),
        DEFAULT_REFUND_PHRASES,
    )


def test_lot_payment_default_phrase_requires_numeric_lot():
    service = RefundReportService()

    assert not service._matches_refund_phrase(
        normalize_text("Оплата услуг по лоту №"),
        DEFAULT_REFUND_PHRASES,
    )
