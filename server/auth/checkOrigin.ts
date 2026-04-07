const normalizeOrigin = ({ value, secure }: { value: string; secure: boolean }): string => {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue) { return ''; }

  const withProtocol = trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')
    ? trimmedValue
    : `http${secure ? 's' : ''}://${trimmedValue}`;

  // Keep only scheme + host[:port] so paths, query params, and fragments don't affect allowlist checks.
  const extractedOrigin = withProtocol.match(/^(https?:\/\/[^/?#]+)/)?.[1] || '';
  if (!extractedOrigin) { return ''; }

  return extractedOrigin
    // Treat explicit :80 as equivalent to implicit default http port.
    .replace(/^http:\/\/(.+):80$/i, 'http://$1')
    // Treat explicit :443 as equivalent to implicit default https port.
    .replace(/^https:\/\/(.+):443$/i, 'https://$1');
};

const allowedOrigin = (origin: string) => {
  const secure = process.env.SECURE === 'true';

  const externalOrigins = (process.env.EXTERNAL_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // DNS can now contain multiple comma-separated values, same as EXTERNAL_ORIGINS.
  const dnsOrigins = (process.env.DNS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const location = `http${secure ? 's' : ''}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;
  const normalizedOrigin = normalizeOrigin({ value: origin, secure });
  const allowedOrigins = [
    location,
    'localhost',
    ...externalOrigins,
    ...dnsOrigins,
  ];

  const normalizedAllowedOrigins = new Set(
    allowedOrigins
      .map((value) => normalizeOrigin({ value, secure }))
      .filter(Boolean)
  );

  if (normalizedOrigin && normalizedAllowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  console.log('');
  console.log('origin not allowed');
  console.log('origin:', origin);
  console.log('normalizedOrigin:', normalizedOrigin);
  console.log('allowedOrigins:', [...normalizedAllowedOrigins]);
  return false;
}

export default allowedOrigin;