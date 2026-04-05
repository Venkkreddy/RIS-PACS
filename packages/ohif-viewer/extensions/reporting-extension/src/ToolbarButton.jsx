import React, { useState } from 'react';

function captureViewportAsBlob() {
  const viewportCanvas = document.querySelector('canvas');
  if (!viewportCanvas) {
    throw new Error('No active viewport canvas found');
  }

  return new Promise((resolve, reject) => {
    viewportCanvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('Failed to capture JPEG from viewport'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      0.92
    );
  });
}

function getReportId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('reportId') || 'active-report';
}

function getStudyId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('studyId') || params.get('StudyInstanceUID') || '';
}

function getReportingBaseUrl() {
  if (typeof window !== 'undefined' && window.__REPORTING_API_URL__) {
    return window.__REPORTING_API_URL__;
  }

  if (typeof process !== 'undefined' && process.env && process.env.REPORTING_API_URL) {
    return process.env.REPORTING_API_URL;
  }

  if (window.config?.reporting?.baseUrl) {
    return window.config.reporting.baseUrl;
  }
  return 'http://localhost:8081';
}

function getReportingUiBaseUrl() {
  if (window.config?.reporting?.uiBaseUrl) {
    return window.config.reporting.uiBaseUrl;
  }

  const apiBase = getReportingBaseUrl();
  return apiBase.includes(':8081') ? apiBase.replace(':8081', ':5173') : apiBase;
}

export default function ToolbarButton() {
  const [status, setStatus] = useState('');

  const handleCapture = async () => {
    try {
      setStatus('Capturing...');
      const jpegBlob = await captureViewportAsBlob();
      const reportId = getReportId();
      const reportingBaseUrl = getReportingBaseUrl();

      const formData = new FormData();
      formData.append('file', jpegBlob, 'ohif-capture.jpg');

      await fetch(`${reportingBaseUrl}/reports/${reportId}/attach`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      setStatus('Attached');
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleOpenReport = () => {
    const studyId = getStudyId();
    if (!studyId) {
      setStatus('No studyId in viewer URL');
      return;
    }

    const reportingUi = getReportingUiBaseUrl();
    window.open(`${reportingUi}/reports/study/${encodeURIComponent(studyId)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        onClick={handleCapture}
        className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
        title="Capture viewport and attach to reporting app"
      >
        Attach JPEG
      </button>
      <button
        type="button"
        onClick={handleOpenReport}
        className="rounded bg-violet-600 px-3 py-2 text-sm text-white"
        title="Open reporting app for current study"
      >
        Open Report
      </button>
      {status ? <span style={{ marginLeft: 8 }}>{status}</span> : null}
    </div>
  );
}
