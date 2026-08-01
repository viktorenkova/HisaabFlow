import csv

from backend.core.refund_detection.parsers import MigTorgCsvParser, StatementParserFactory
from backend.services.refund_report_service import RefundReportService


HEADERS = [
    "transaction_id",
    "id / operation_id",
    "acquirer_id / provider_payment_id",
    "external_id / payment_id",
    "merchant_name",
    "project_id",
    "project_url",
    "project_name",
    "customer_id",
    "card_holder",
    "operation_type",
    "operation_status",
    "transaction_type",
    "customer_purse / account_number",
    "card_product",
    "issuer_bank_name",
    "issuer_country",
    "completed_at / operation_completed_at",
    "created_at / operation_created_at",
    "amount / amount",
    "real_amount / channel_amount",
    "",
    "real_currency / channel_currency",
    "currency / currency",
    "arn",
]


def _row(project_name, operation_type, refund_amount, operation_id):
    row = [""] * len(HEADERS)
    row[1] = operation_id
    row[7] = project_name
    row[9] = "CUSTOMER NAME"
    row[10] = operation_type
    row[11] = "success"
    row[17] = "2026-07-30T08:09:12+0300"
    row[19] = "999999"
    row[20] = "888888"
    row[21] = refund_amount
    row[22] = "RUB"
    row[23] = "RUB"
    return row


def _write_statement(path):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(HEADERS)
        writer.writerow(_row("new.migtorg.com/dashboard", "refund", "5125", "refund-1"))
        writer.writerow(_row("new.migtorg.com/dashboard", "refund", "1,01", "refund-2"))
        writer.writerow(_row("new.migtorg.com/dashboard", "sale", "7000", "sale-1"))
        writer.writerow(_row("STAGE_new.migtorg.com", "refund", "9000", "stage-refund"))
        writer.writerow(_row("another.project", "refund", "8000", "refund-other-project"))


def test_migtorg_parser_uses_h_and_k_filters_and_v_amount(tmp_path):
    statement_path = tmp_path / "provider-report.csv"
    _write_statement(statement_path)

    parser = MigTorgCsvParser()
    assert parser.can_handle(str(statement_path), statement_path.name)

    transactions = parser.parse(str(statement_path), statement_path.name)

    assert [transaction.document_number for transaction in transactions] == ["refund-1", "refund-2"]
    assert [transaction.amount for transaction in transactions] == [5125.0, 1.01]
    assert all(transaction.direction == "outgoing" for transaction in transactions)
    assert all(transaction.metadata["amount_source_column"] == "V" for transaction in transactions)


def test_migtorg_refunds_are_added_independently_of_existing_rules(tmp_path):
    statement_path = tmp_path / "provider-report.csv"
    _write_statement(statement_path)
    service = RefundReportService()

    result = service.analyze_files(
        [{"temp_path": str(statement_path), "original_name": statement_path.name}],
        {
            "enable_amount_multiple": False,
            "enable_email": False,
            "enable_refund_phrase": False,
            "outgoing_only": True,
        },
    )

    assert result["warnings"] == []
    assert result["summary"]["matched_transactions"] == 2
    assert result["summary"]["total_amount"] == 5126.01
    assert all(transaction["matched_rules"] == ["migtorg_refund"] for transaction in result["transactions"])


def test_factory_detects_migtorg_by_structure_without_filename_marker(tmp_path):
    statement_path = tmp_path / "generic-provider-report.csv"
    _write_statement(statement_path)

    parser = StatementParserFactory().get_parser(str(statement_path), statement_path.name)

    assert isinstance(parser, MigTorgCsvParser)
