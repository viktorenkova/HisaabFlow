"""
Refund analysis endpoints.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.api.file_endpoints import get_uploaded_file
from backend.api.models import RefundAnalysisResponse, RefundAnalyzeRequest, RefundExportRequest
from backend.services.refund_report_service import RefundReportService


refund_router = APIRouter()
refund_service = RefundReportService()


@refund_router.post("/refunds/analyze", response_model=RefundAnalysisResponse)
async def analyze_refunds(request: RefundAnalyzeRequest):
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="At least one file is required")

    file_infos = []
    for file_id in request.file_ids:
        file_info = get_uploaded_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail=f"File {file_id} not found")
        file_infos.append(file_info)

    try:
        return refund_service.analyze_files(file_infos, request.options.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@refund_router.post("/refunds/export")
async def export_refund_report(request: RefundExportRequest):
    try:
        report_bytes = refund_service.export_report(request.analysis.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"refund_report_{timestamp}.xlsx"
    return StreamingResponse(
        iter([report_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
