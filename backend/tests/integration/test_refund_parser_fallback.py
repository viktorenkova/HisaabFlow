from backend.core.refund_detection.parsers import AccountStatementParser, SberBusinessParser


class FakeWorksheet:
    def __init__(self, title, rows):
        self.title = title
        self._rows = rows

    def iter_rows(self, min_row=1, max_row=None, values_only=False):
        end_row = len(self._rows) if max_row is None else max_row
        for row in self._rows[min_row - 1:end_row]:
            yield tuple(row)


class FakeWorkbook:
    def __init__(self, worksheets, read_only):
        self.worksheets = worksheets
        self.read_only = read_only
        self.closed = False

    def close(self):
        self.closed = True


def test_sber_refund_parser_falls_back_from_streaming_mode(monkeypatch):
    parser = SberBusinessParser()
    valid_sheet = FakeWorksheet(
        "40702810438000120274",
        [
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [
                "",
                "Дата проводки",
                "",
                "",
                "Счет",
                "",
                "",
                "",
                "",
                "Сумма по дебету",
                "",
                "",
                "",
                "Сумма по кредиту",
                "№ документа",
                "",
                "",
                "",
                "",
                "",
                "Назначение платежа",
            ],
            ["", "", "", "", "Дебет", "", "", "", "Кредит"],
            [
                "",
                "2026-04-01 10:00:00",
                "",
                "",
                "40702810438000120274 7722776500 ООО МИГАС",
                "",
                "",
                "",
                "40702810101850000497",
                "48379.94",
                "",
                "",
                "",
                "",
                "747",
                "",
                "",
                "",
                "",
                "",
                "Оплата поставщику",
            ],
        ],
    )

    def fake_load_workbook(file_path, read_only, data_only):
        return FakeWorkbook([valid_sheet], read_only=read_only)

    monkeypatch.setattr("backend.core.refund_detection.parsers.load_workbook", fake_load_workbook)
    monkeypatch.setattr(
        parser,
        "_resolve_sheet",
        lambda workbook: (None, None) if workbook.read_only else (valid_sheet, 10),
    )
    monkeypatch.setattr(
        parser,
        "_map_indexes",
        lambda headers: {"date": 1, "debit": 9, "credit": 13, "purpose": 20, "document": 14},
    )

    transactions = parser.parse("irrelevant.xlsx", "statement.xlsx")

    assert len(transactions) == 1
    assert transactions[0].source_bank == "sber_business"
    assert transactions[0].document_number == "747"
    assert transactions[0].amount == 48379.94
    assert transactions[0].payment_purpose == "Оплата поставщику"


def test_account_refund_parser_falls_back_from_streaming_mode(monkeypatch):
    parser = AccountStatementParser()
    valid_sheet = FakeWorksheet(
        "Выписка по счёту",
        [
            ["Выписка по счёту", "40702 810 1 01300 014373"],
            ["За период", "c 01.04.2026 по 23.04.2026"],
            ["Владелец счёта", 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "МИГАС"'],
            ["ИНН владельца", "7722776500"],
            ["БИК", "044525593"],
            [],
            ["Остаток входящий", "38440.43"],
            ["Остаток исходящий", "54896.24"],
            ["Дата предыдущей операции по счёту", "", "18.03.2026"],
            [],
            [
                "Дата",
                "Номер документа",
                "Дебет",
                "Кредит",
                "Контрагент",
                "",
                "",
                "",
                "",
                "",
                "Назначение платежа",
                "Код дебитора",
                "Тип документа",
            ],
            [
                "",
                "",
                "",
                "",
                "Наименование",
                "ИНН",
                "КПП",
                "Счёт",
                "БИК",
                "Наименование банка",
                "",
                "",
                "",
            ],
            [
                "10.04.2026",
                "276348",
                "",
                "20371.64",
                'ПАО СК "РОСГОССТРАХ"',
                "7707067683",
                "997950001",
                "40701810816805000007",
                "044525187",
                "Банк ВТБ (ПАО)",
                "ВЫПЛАТА ВОЗНАГРАЖДЕНИЯ",
                "",
                "Платежное поручение",
            ],
        ],
    )

    def fake_load_workbook(file_path, read_only, data_only):
        return FakeWorkbook([valid_sheet], read_only=read_only)

    monkeypatch.setattr("backend.core.refund_detection.parsers.load_workbook", fake_load_workbook)
    monkeypatch.setattr(
        parser,
        "_resolve_sheet",
        lambda workbook: (None, None) if workbook.read_only else (valid_sheet, 11),
    )
    monkeypatch.setattr(
        parser,
        "_map_indexes",
        lambda headers: {"date": 0, "debit": 2, "credit": 3, "purpose": 10, "document": 1, "counterparty": 4},
    )

    transactions = parser.parse("irrelevant.xlsx", "statement.xlsx")

    assert len(transactions) == 1
    assert transactions[0].source_bank == "account_statement"
    assert transactions[0].document_number == "276348"
    assert transactions[0].amount == 20371.64
    assert transactions[0].payment_purpose == "ВЫПЛАТА ВОЗНАГРАЖДЕНИЯ"
    assert transactions[0].account_number == "40702810101300014373"
