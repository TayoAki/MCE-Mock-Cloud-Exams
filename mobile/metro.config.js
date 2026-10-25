const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

/**
 * Proxy chains such as GitHub Codespaces' port forwarding can send a combined
 * `x-forwarded-proto: https,https`. Expo builds the manifest's bundle URL from
 * that header verbatim, which yields `https,https://…`: Expo Go can't load the
 * app and Metro logs "Unable to resolve manifest assets". Keep only the first
 * (client-facing) value. Expo's manifest handler runs before any middleware a
 * project can add, so this has to happen when the dev server receives the request.
 */
const emitRequest = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === 'request') {
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string' && proto.includes(',')) {
      req.headers['x-forwarded-proto'] = proto.split(',')[0].trim();
    }
  }
  return emitRequest.call(this, event, req, ...rest);
};

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
