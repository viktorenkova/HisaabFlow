import React, { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import AppHeader from '../components/layout/AppHeader';
import { Badge, Button, Card } from '../components/ui';
import { Download, FileText, Upload, X } from '../components/ui/Icons';
import { useTheme } from '../theme/ThemeProvider';
import { RefundAnalysisService } from '../services/refundAnalysisService';

const DEFAULT_PHRASES = [
  'Возврат оплаты по договору',
  'Возврат оплат по договору',
  'Возврат по договору',
];

const acceptedExtensions = ['.xlsx', '.xls', '.csv'];

function RefundAppLogic() {
  const theme = useTheme();
  const fileInputRef = useRef(null);

  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [options, setOptions] = useState({
    enable_amount_multiple: true,
    amount_multiple: 5000,
    enable_email: true,
    enable_refund_phrase: true,
    refund_phrases_text: DEFAULT_PHRASES.join('\n'),
    match_mode: 'any',
    outgoing_only: true,
  });

  const parsedOptions = useMemo(() => ({
    enable_amount_multiple: options.enable_amount_multiple,
    amount_multiple: Number(options.amount_multiple) || 0,
    enable_email: options.enable_email,
    enable_refund_phrase: options.enable_refund_phrase,
    refund_phrases: options.refund_phrases_text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    match_mode: options.match_mode,
    outgoing_only: options.outgoing_only,
  }), [options]);

  const uploadFiles = async (fileList) => {
    const validFiles = Array.from(fileList).filter((file) => {
      const lowerName = file.name.toLowerCase();
      return acceptedExtensions.some((extension) => lowerName.endsWith(extension));
    });

    if (validFiles.length === 0) {
      toast.error('Поддерживаются только Excel и CSV-файлы.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const uploaded = [];
      for (const file of validFiles) {
        const response = await RefundAnalysisService.uploadFile(file);
        uploaded.push({
          fileId: response.file_id,
          fileName: file.name,
          size: response.size,
        });
      }
      setUploadedFiles((prev) => [...prev, ...uploaded]);
      toast.success(`Загружено файлов: ${uploaded.length}`);
    } catch (requestError) {
      setError(`Ошибка загрузки: ${requestError.response?.data?.detail || requestError.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFile = async (index) => {
    const file = uploadedFiles[index];
    setUploadedFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    if (file?.fileId) {
      try {
        await RefundAnalysisService.cleanupFile(file.fileId);
      } catch {
        // Ignore cleanup failures for local temp files.
      }
    }
  };

  const handleAnalyze = async () => {
    if (uploadedFiles.length === 0) {
      toast.error('Сначала загрузите выписки.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await RefundAnalysisService.analyze(
        uploadedFiles.map((file) => file.fileId),
        parsedOptions
      );
      setAnalysis(result);
      toast.success(`Найдено операций: ${result.summary.matched_transactions}`);
    } catch (requestError) {
      setError(`Ошибка анализа: ${requestError.response?.data?.detail || requestError.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!analysis) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await RefundAnalysisService.exportReport(analysis);
      toast.success('Excel-отчет сформирован.');
    } catch (requestError) {
      setError(`Ошибка выгрузки: ${requestError.response?.data?.detail || requestError.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    const filesToCleanup = [...uploadedFiles];
    setUploadedFiles([]);
    setAnalysis(null);
    setError(null);

    for (const file of filesToCleanup) {
      try {
        await RefundAnalysisService.cleanupFile(file.fileId);
      } catch {
        // Ignore cleanup failures during reset.
      }
    }
  };

  const handleCheckboxChange = (event) => {
    const { name, checked } = event.target;
    setOptions((prev) => ({ ...prev, [name]: checked }));
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setOptions((prev) => ({ ...prev, [name]: value }));
  };

  const metricCards = analysis ? [
    { label: 'Файлы', value: analysis.summary.processed_files, tone: 'primary' },
    { label: 'Совпадения', value: analysis.summary.matched_transactions, tone: 'success' },
    { label: 'Сумма возвратов', value: `${Number(analysis.summary.total_amount || 0).toLocaleString('ru-RU')} ₽`, tone: 'secondary' },
    { label: 'Уникальные e-mail', value: analysis.summary.unique_emails_count, tone: 'warning' },
  ] : [];

  const containerStyle = {
    minHeight: '100vh',
    background: `linear-gradient(180deg, ${theme.colors.background.default} 0%, ${theme.colors.background.elevated} 100%)`,
  };

  const pageStyle = {
    maxWidth: '1320px',
    margin: '0 auto',
    padding: `${theme.spacing.xl} ${theme.spacing.lg} ${theme.spacing.xxl}`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.lg,
  };

  const heroStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)',
    gap: theme.spacing.lg,
  };

  const infoGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: theme.spacing.md,
  };

  const uploadZoneStyle = {
    border: `2px dashed ${dragOver ? theme.colors.primary : theme.colors.border}`,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.xl,
    backgroundColor: dragOver ? `${theme.colors.primary}12` : theme.colors.background.elevated,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'center',
  };

  const inputStyle = {
    width: '100%',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    backgroundColor: theme.colors.background.paper,
    color: theme.colors.text.primary,
    fontSize: '14px',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  };

  const thStyle = {
    textAlign: 'left',
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    borderBottom: `1px solid ${theme.colors.border}`,
    color: theme.colors.text.secondary,
    position: 'sticky',
    top: 0,
    backgroundColor: theme.colors.background.paper,
  };

  const tdStyle = {
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    borderBottom: `1px solid ${theme.colors.border}`,
    verticalAlign: 'top',
    color: theme.colors.text.primary,
  };

  const wrapTextStyle = {
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    minWidth: 0,
  };

  return (
    <div style={containerStyle}>
      <AppHeader />
      <main style={pageStyle}>
        <div style={heroStyle}>
          <Card elevated padding="xl">
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
              <Badge variant="primary" size="large" style={{ width: 'fit-content' }}>
                Локальный режим
              </Badge>
              <div>
                <h1 style={{ ...theme.typography.h2, margin: 0, color: theme.colors.text.primary }}>
                  Автоматический отчет по возвратам из банковских выписок
                </h1>
                <p style={{ ...theme.typography.body1, margin: `${theme.spacing.sm} 0 0`, color: theme.colors.text.secondary }}>
                  Программа работает полностью на этом компьютере: без внешних API, облачных сервисов и банковских интеграций.
                  Вы загружаете Excel/CSV, система находит возвраты по вашим правилам и собирает готовый Excel-отчет.
                </p>
              </div>
            </div>
          </Card>

          <Card elevated padding="xl">
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
              <h2 style={{ ...theme.typography.h4, margin: 0, color: theme.colors.text.primary }}>
                Что уже умеет MVP
              </h2>
              <div style={infoGridStyle}>
                <Badge variant="outline">СберБизнес</Badge>
                <Badge variant="outline">Выписка по счету</Badge>
                <Badge variant="outline">CSV MigTorg</Badge>
                <Badge variant="outline">Excel-отчет</Badge>
              </div>
              <p style={{ ...theme.typography.body2, margin: 0, color: theme.colors.text.secondary }}>
                Новый формат выписки позже добавляется отдельным parser-классом, без переписывания ядра фильтрации.
              </p>
            </div>
          </Card>
        </div>

        {error && (
          <Card padding="lg" style={{ borderColor: theme.colors.error }}>
            <div style={{ color: theme.colors.error, fontWeight: 600 }}>{error}</div>
          </Card>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: theme.spacing.lg }}>
          <Card elevated padding="xl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <div>
                <h2 style={{ ...theme.typography.h4, margin: 0, color: theme.colors.text.primary }}>1. Загрузка выписок</h2>
                <p style={{ ...theme.typography.body2, margin: `${theme.spacing.xs} 0 0`, color: theme.colors.text.secondary }}>
                  Поддерживаются `.xlsx`, `.xls`, `.csv`.
                </p>
              </div>
              <Badge variant="secondary">{uploadedFiles.length} файл(ов)</Badge>
            </div>

            <div
              style={uploadZoneStyle}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                uploadFiles(event.dataTransfer.files);
              }}
            >
              <Upload size={42} color={theme.colors.primary} />
              <div style={{ ...theme.typography.h5, marginTop: theme.spacing.sm, color: theme.colors.text.primary }}>
                Перетащите выписки сюда или нажмите для выбора
              </div>
              <div style={{ ...theme.typography.body2, marginTop: theme.spacing.xs, color: theme.colors.text.secondary }}>
                Можно загружать несколько файлов сразу из разных банков.
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => uploadFiles(event.target.files)}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
              {uploadedFiles.map((file, index) => (
                <div
                  key={`${file.fileId}-${index}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: theme.borderRadius.md,
                    padding: theme.spacing.md,
                    backgroundColor: theme.colors.background.paper,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, minWidth: 0 }}>
                    <FileText size={18} color={theme.colors.primary} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: theme.colors.text.primary, ...wrapTextStyle }}>
                        {file.fileName}
                      </div>
                      <div style={{ fontSize: '12px', color: theme.colors.text.secondary }}>
                        {Math.max(1, Math.round((file.size || 0) / 1024))} KB
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" size="small" onClick={() => handleRemoveFile(index)}>
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card elevated padding="xl">
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
              <div>
                <h2 style={{ ...theme.typography.h4, margin: 0, color: theme.colors.text.primary }}>2. Правила поиска</h2>
                <p style={{ ...theme.typography.body2, margin: `${theme.spacing.xs} 0 0`, color: theme.colors.text.secondary }}>
                  Эти параметры можно будет расширять дальше без подключения внешних ресурсов.
                </p>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, color: theme.colors.text.primary }}>
                <input
                  type="checkbox"
                  name="enable_amount_multiple"
                  checked={options.enable_amount_multiple}
                  onChange={handleCheckboxChange}
                />
                Искать суммы, кратные
              </label>
              <input
                name="amount_multiple"
                type="number"
                min="0"
                style={inputStyle}
                value={options.amount_multiple}
                onChange={handleInputChange}
                disabled={!options.enable_amount_multiple}
              />

              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, color: theme.colors.text.primary }}>
                <input
                  type="checkbox"
                  name="enable_email"
                  checked={options.enable_email}
                  onChange={handleCheckboxChange}
                />
                Искать e-mail в назначении платежа
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, color: theme.colors.text.primary }}>
                <input
                  type="checkbox"
                  name="enable_refund_phrase"
                  checked={options.enable_refund_phrase}
                  onChange={handleCheckboxChange}
                />
                Искать формулировки возврата
              </label>

              <textarea
                name="refund_phrases_text"
                rows={6}
                style={{ ...inputStyle, resize: 'vertical' }}
                value={options.refund_phrases_text}
                onChange={handleInputChange}
                disabled={!options.enable_refund_phrase}
              />

              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, color: theme.colors.text.primary }}>
                <input
                  type="checkbox"
                  name="outgoing_only"
                  checked={options.outgoing_only}
                  onChange={handleCheckboxChange}
                />
                Анализировать только исходящие платежи
              </label>

              <div>
                <div style={{ marginBottom: theme.spacing.sm, fontWeight: 600, color: theme.colors.text.primary }}>
                  Режим совпадения
                </div>
                <div style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, color: theme.colors.text.primary }}>
                    <input
                      type="radio"
                      name="match_mode"
                      value="any"
                      checked={options.match_mode === 'any'}
                      onChange={handleInputChange}
                    />
                    Любое правило
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, color: theme.colors.text.primary }}>
                    <input
                      type="radio"
                      name="match_mode"
                      value="all"
                      checked={options.match_mode === 'all'}
                      onChange={handleInputChange}
                    />
                    Все включенные правила
                  </label>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card elevated padding="lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md, flexWrap: 'wrap' }}>
            <div style={{ color: theme.colors.text.secondary }}>
              Анализ выполняется локально на вашем компьютере. Внешние API не используются.
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              <Button variant="secondary" size="large" onClick={handleReset} disabled={loading || uploadedFiles.length === 0}>
                Очистить
              </Button>
              <Button variant="primary" size="large" onClick={handleAnalyze} loading={loading} disabled={uploadedFiles.length === 0}>
                Проанализировать выписки
              </Button>
            </div>
          </div>
        </Card>

        {analysis && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: theme.spacing.md }}>
              {metricCards.map((card) => (
                <Card key={card.label} elevated padding="lg">
                  <div style={{ color: theme.colors.text.secondary, marginBottom: theme.spacing.xs }}>{card.label}</div>
                  <div style={{ ...theme.typography.h3, color: theme.colors.text.primary }}>{card.value}</div>
                </Card>
              ))}
            </div>

            {analysis.warnings?.length > 0 && (
              <Card padding="lg" style={{ borderColor: theme.colors.warning }}>
                <div style={{ fontWeight: 600, color: theme.colors.text.primary, marginBottom: theme.spacing.sm }}>Предупреждения</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                  {analysis.warnings.map((warning) => (
                    <div key={warning} style={{ color: theme.colors.text.secondary }}>{warning}</div>
                  ))}
                </div>
              </Card>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.7fr)', gap: theme.spacing.lg }}>
              <Card elevated padding="xl">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
                  <div>
                    <h2 style={{ ...theme.typography.h4, margin: 0, color: theme.colors.text.primary }}>3. Найденные операции</h2>
                    <p style={{ ...theme.typography.body2, margin: `${theme.spacing.xs} 0 0`, color: theme.colors.text.secondary }}>
                      Строки, которые прошли выбранные правила фильтрации.
                    </p>
                  </div>
                  <Button variant="primary" size="medium" onClick={handleExport} loading={loading} leftIcon={<Download size={16} />}>
                    Скачать Excel-отчет
                  </Button>
                </div>

                <div style={{ maxHeight: '620px', overflow: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.borderRadius.lg }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Дата</th>
                        <th style={thStyle}>Сумма</th>
                        <th style={thStyle}>Файл</th>
                        <th style={thStyle}>E-mail</th>
                        <th style={thStyle}>Правила</th>
                        <th style={thStyle}>Назначение платежа</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.transactions.map((transaction, index) => (
                        <tr key={`${transaction.source_file}-${transaction.document_number}-${index}`}>
                          <td style={tdStyle}>{transaction.operation_date || '-'}</td>
                          <td style={tdStyle}>{Number(transaction.amount || 0).toLocaleString('ru-RU')} ₽</td>
                          <td style={{ ...tdStyle, ...wrapTextStyle, minWidth: '180px' }}>{transaction.source_file}</td>
                          <td style={{ ...tdStyle, ...wrapTextStyle, minWidth: '150px' }}>{transaction.extracted_email || '-'}</td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
                              {transaction.matched_rules.map((rule) => (
                                <Badge key={rule} variant="outline" size="small">{rule}</Badge>
                              ))}
                            </div>
                          </td>
                          <td style={{ ...tdStyle, ...wrapTextStyle, minWidth: '320px' }}>{transaction.payment_purpose || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
                <Card elevated padding="xl">
                  <h2 style={{ ...theme.typography.h4, margin: 0, color: theme.colors.text.primary }}>Уникальные пользователи</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.lg, minWidth: 0 }}>
                    {analysis.summary.unique_emails.length > 0 ? analysis.summary.unique_emails.map((email) => (
                      <Badge key={email} variant="primary" style={{ maxWidth: '100%', ...wrapTextStyle }}>{email}</Badge>
                    )) : (
                      <div style={{ color: theme.colors.text.secondary }}>E-mail не найден.</div>
                    )}
                  </div>
                </Card>

                <Card elevated padding="xl">
                  <h2 style={{ ...theme.typography.h4, margin: 0, color: theme.colors.text.primary }}>Разбивка по файлам</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
                    {analysis.summary.by_file.map((item) => (
                      <div
                        key={item.source_file}
                        style={{
                          border: `1px solid ${theme.colors.border}`,
                          borderRadius: theme.borderRadius.md,
                          padding: theme.spacing.md,
                          backgroundColor: theme.colors.background.paper,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ fontWeight: 600, color: theme.colors.text.primary, ...wrapTextStyle }}>{item.source_file}</div>
                        <div style={{ fontSize: '13px', color: theme.colors.text.secondary, marginTop: theme.spacing.xs }}>
                          Совпадения: {item.matched_transactions} | Сумма: {Number(item.matched_amount || 0).toLocaleString('ru-RU')} ₽
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default RefundAppLogic;
