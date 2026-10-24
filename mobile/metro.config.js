const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

/**
 * Dev-only: forward /v1 requests to the local API, so the app (web, simulator,
 * phone or tunnel) only needs to reach Metro. This also makes GitHub Codespaces
 * work without making the API port public.
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => (req, res, next) => {
    if (!req.url || !req.url.startsWith('/v1/')) return metroMiddleware(req, res, next);
    const target = new URL(req.url, API_PROXY_TARGET);
    const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (apiRes) => {
      res.writeHead(apiRes.statusCode ?? 502, apiRes.headers);
      apiRes.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'api_unreachable', message: `The CertPath API is not running at ${API_PROXY_TARGET}` }));
    });
    req.pipe(upstream);
  },
};

// withUniwindConfig must stay the outermost wrapper.
module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
