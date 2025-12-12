// If running with localhost use localhost stuff

const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  window.location.port === '3000';

export const API_URL: string =
  import.meta.env.CTRON_API_URL || (isLocalDev ? "http://localhost:5001" : "");
