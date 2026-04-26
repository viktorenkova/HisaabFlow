/**
 * Export utilities
 * Handles data export functionality
 */
import axios from 'axios';
import toast from 'react-hot-toast';
import { getApiV1Base } from '../services/apiConfig';

const API_V1_BASE = getApiV1Base();

/**
 * Exports transformed data as CSV file
 */
export const exportData = async (transformedData, setError) => {
  if (!transformedData) return;
  
  try {
    const response = await axios.post(`${API_V1_BASE}/export`, transformedData, {
      responseType: 'blob'
    });
    
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `multi_csv_converted_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    
    toast.success('Export completed successfully!');
    
  } catch (err) {
    setError(`Export failed: ${err.response?.data?.detail || err.message}`);
  }
};
