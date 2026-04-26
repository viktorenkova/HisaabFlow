const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

let cachedApiBase = null;

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getQueryBackendUrl() {
  if (typeof window === 'undefined' || !window.location?.search) {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  return params.get('backendUrl') || params.get('apiBase');
}

function shouldUseSameOrigin() {
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }

  const { protocol, hostname, port } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') {
    return false;
  }

  const isReactDevServer =
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    (port === '3000' || port === '3001');

  return !isReactDevServer;
}

export function getApiBase() {
  if (cachedApiBase) {
    return cachedApiBase;
  }

  const explicitUrl =
    (typeof window !== 'undefined' && window.BACKEND_URL) ||
    getQueryBackendUrl();

  if (explicitUrl) {
    cachedApiBase = normalizeUrl(explicitUrl);
    return cachedApiBase;
  }

  if (shouldUseSameOrigin()) {
    cachedApiBase = normalizeUrl(window.location.origin);
    return cachedApiBase;
  }

  cachedApiBase = DEFAULT_BACKEND_URL;
  return cachedApiBase;
}

export function getApiV1Base() {
  return `${getApiBase()}/api/v1`;
}

