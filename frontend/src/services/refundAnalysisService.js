import axios from 'axios';
import { getApiV1Base } from './apiConfig';

const API_V1_BASE = getApiV1Base();

export class RefundAnalysisService {
  static async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await axios.post(`${API_V1_BASE}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    return response.data;
  }

  static async cleanupFile(fileId) {
    if (!fileId) {
      return;
    }
    await axios.delete(`${API_V1_BASE}/cleanup/${fileId}`);
  }

  static async analyze(fileIds, options) {
    const response = await axios.post(`${API_V1_BASE}/refunds/analyze`, {
      file_ids: fileIds,
      options,
    });
    return response.data;
  }

  static async exportReport(analysis) {
    const response = await axios.post(
      `${API_V1_BASE}/refunds/export`,
      { analysis },
      { responseType: 'blob' }
    );

    const disposition = response.headers['content-disposition'] || '';
    const fileNameMatch = disposition.match(/filename=\"?([^"]+)\"?/);
    const fileName = fileNameMatch ? fileNameMatch[1] : `refund_report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }
}
