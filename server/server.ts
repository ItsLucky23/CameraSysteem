import dotenv from 'dotenv';
import { initializeSentry } from './functions/sentry';
import path from 'path';

dotenv.config({ path: [".env.local", ".env"] });
initializeSentry();

import http from 'http';
import getParams from './utils/getParams';
import { loginWithCredentials, loginCallback, createOAuthState } from './auth/login';
import { serveFavicon, serveFile } from './prod/serveFile';
import loadSocket from './sockets/socket';
import z from 'zod';
import oauthProviders from "./auth/loginConfig";
import { deleteSession } from './functions/session';
import allowedOrigin from './auth/checkOrigin';
import config, { SessionLayout } from '../config';

import { serveAvatar } from './utils/serveAvatars';
import { extractTokenFromRequest } from './utils/extractTokenFromRequest';
import { handleHttpApiRequest } from './sockets/handleHttpApiRequest';
import handleHttpSyncRequest from './sockets/handleHttpSyncRequest';

const REDACTED_LOG_KEYS = new Set([
  'password',
  'confirmPassword',
  'token',
  'authorization',
  'cookie',
  'clientSecret',
  'access_token',
  'refresh_token',
]);

const sanitizeForLog = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_LOG_KEYS.has(key) ? '[REDACTED]' : sanitizeForLog(val);
    }
    return output;
  }

  return value;
};

const ServerRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {

  const origin = req.headers.origin ?? req.headers.referer ?? req.headers.host ?? '';

  if (!allowedOrigin(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Forbidden');
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader('Referrer-Policy', 'no-referrer'); // prevents the browser from leaking sensative urls
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // only allows iframes to use this pages content if on the same domain
  res.setHeader('X-XSS-Protection', '1; mode=block'); // prevents some xss attacks
  res.setHeader('X-Content-Type-Options', 'nosniff'); // prevents mimetype sniffing, this means that when sending a txt file it will not try to execute it as ddl if the user requested this

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const method = req.method;
  const url = req.url || '/';
  const [routePath, queryString] = url.split('?');

  if (method !== 'GET' && method != 'POST' && method != 'PUT' && method != 'DELETE') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    return res.end(`method: ${method} not supported, use one of the following methods: GET, POST, PUT, DELETE`);
  }

  const cookieHeader = req.headers.cookie || '';
  const token = cookieHeader
    .split('; ')
    .find(row => row.startsWith('token='))
    ?.split('=')[1];


  //? here we load the application icon
  if (z.literal('/favicon.ico').safeParse(routePath).success) {
    return serveFavicon(res);
  }

  //? here we get the params from the request
  let params: object | null;
  params = await getParams({ method, req, res, queryString });

  //? we log the request and if there are any params we log them with the request
  if (params && typeof params == 'object' && Object.keys(params).length !== 0) {
    const safeParams = sanitizeForLog(params);
    console.log(`method: ${method}, url: ${routePath}, params: ${JSON.stringify(safeParams)}`, 'magenta')
  } else {
    console.log(`method: ${method}, url: ${routePath}`, 'magenta');
    params = {};
  }

  //? we dont use zod cause it doesnt allow you to pass in a id in the url
  if (routePath.startsWith('/uploads/')) {
    await serveAvatar({ routePath, res });
    return;
  }

  //? triggers when logging in
  //? when using the credentials provider all the logic happends here else we redirect to the oauth provider and all the logic happends in the auth/callback api
  if (z.string().startsWith('/auth/api').safeParse(routePath).success) {
    const providerName = routePath.split('/')[3]; // Extract the provider (google/github)
    const provider = oauthProviders.find(p => p.name === providerName);
    if (!provider || !provider.name) { return { provider, status: false, reason: 'login.providerNotFound' }; }

    if (provider?.name != 'credentials' && 'scope' in provider) {
      const oauthState = await createOAuthState(provider.name);
      if (!oauthState) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end('OAuth state initialization failed');
      }

      const clientId = encodeURIComponent(provider.clientID);
      const callbackUrl = encodeURIComponent(provider.callbackURL);
      const scope = encodeURIComponent(provider.scope.join(' '));
      const state = encodeURIComponent(oauthState);

      res.writeHead(302, {
        'Location': `${provider.authorizationURL}?client_id=${clientId}&redirect_uri=${callbackUrl}&scope=${scope}&response_type=code&prompt=select_account&state=${state}`,
      });
      return res.end();
    }

    //? here all the logic happends for login or creating an account with credentials
    const { status, reason, newToken, session } = await loginWithCredentials(params) as {
      status: boolean,
      reason: string,
      newToken: string | null,
      session: SessionLayout | undefined
    }

    //? if it failed to either login or creating an account then we return
    if (!status) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ status, reason: reason || 'internal server error' }));
    }

    //? if it was successful then we apply the cookie and return the user id and reason for the login or account creation
    if (newToken) {
      if (token) { await deleteSession(token); }

      if (process.env.NODE_ENV === 'development') {
        console.log('setting cookie with new token', 'green');
      }
      const cookieOptions = `HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; ${process.env.SECURE == 'true' ? "Secure;" : ""}`

      res.setHeader("Set-Cookie", `token=${newToken}; ${cookieOptions}`);
      // return res.end(JSON.stringify({ status, reason, session })) 
      // } else { 
    }
    return res.end(JSON.stringify({ status, reason, session, newToken }))

  } else if (z.string().startsWith('/auth/callback').safeParse(routePath).success) {
    //? this endpoint is triggerd by the oauth provider after the user has logged in
    const newToken = await loginCallback(routePath, req, res);

    //? if it failed to either login or creating an account then we return
    if (!newToken) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end('Login failed');
    }

    //? we successfully logged in or created an acocunt

    //? if the user already had a token then we delete the previous session data
    if (token) { await deleteSession(token); }

    //? we set the cookie with the new token and redirect the user to the frontend
    if (process.env.NODE_ENV === 'development') {
      console.log('setting cookie or redirect with new token', 'green');
    }
    const cookieOptions = `HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; ${process.env.SECURE == 'true' ? "Secure;" : ""}`

    const location = process.env.DNS

    if (config.sessionBasedToken) {
      res.writeHead(302, {
        Location: `${process.env.DNS}?token=${newToken}`,
      });
    } else {
      res.setHeader("Set-Cookie", `token=${newToken}; ${cookieOptions}`);
      res.writeHead(302, { Location: location }); // Redirect without exposing token in URL
    }
    return res.end();

    //? HTTP API route - allows calling APIs via HTTP instead of WebSocket
    //? Supports: GET/POST/PUT/DELETE /api/{name}
  } else if (routePath.startsWith('/api/')) {
    try {
      const httpToken = extractTokenFromRequest(req);

      // Extract API name from path: /api/examples/getUserData → examples/getUserData
      const apiName = routePath.slice(5); // Remove "/api/" prefix (5 chars)

      if (!apiName) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        return res.end(JSON.stringify({
          status: 'error',
          httpStatus: 400,
          message: 'api.invalidName',
          errorCode: 'api.invalidName',
        }));
      }

      // Use getParams to parse request data (handles GET query params, POST/PUT/DELETE body)
      const apiData = params || {};

      const result = await handleHttpApiRequest({
        name: apiName,
        data: apiData,
        token: httpToken,
        requesterIp: req.socket.remoteAddress ?? undefined,
        xLanguageHeader: req.headers['x-language'],
        acceptLanguageHeader: req.headers['accept-language'],
        method: (method as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'POST'
      });

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.httpStatus);
      return res.end(JSON.stringify(result));
    } catch (error) {
      console.log('HTTP API error:', error, 'red');
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({
        status: 'error',
        httpStatus: 500,
        message: 'api.invalidRequestFormat',
        errorCode: 'api.invalidRequestFormat',
      }));
    }

  } else if (routePath.startsWith('/sync/')) {
    try {
      if (method !== 'POST') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(405);
        return res.end(JSON.stringify({
          status: 'error',
          message: 'sync.methodNotAllowed',
          errorCode: 'sync.methodNotAllowed',
        }));
      }

      const httpToken = extractTokenFromRequest(req);
      const syncName = routePath.slice(6);

      if (!syncName) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        return res.end(JSON.stringify({
          status: 'error',
          message: 'sync.invalidName',
          errorCode: 'sync.invalidName',
        }));
      }

      const syncParams = params || {};

      const result = await handleHttpSyncRequest({
        name: `sync/${syncName}`,
        cb: typeof (syncParams as any).cb === 'string' ? (syncParams as any).cb : undefined,
        data: (syncParams as any).data || {},
        receiver: (syncParams as any).receiver,
        ignoreSelf: (syncParams as any).ignoreSelf,
        token: httpToken,
        xLanguageHeader: req.headers['x-language'],
        acceptLanguageHeader: req.headers['accept-language'],
      });

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.status === 'success' ? 200 : 400);
      return res.end(JSON.stringify(result));
    } catch (error) {
      console.log('HTTP SYNC error:', error, 'red');
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({
        status: 'error',
        message: 'sync.invalidRequestFormat',
        errorCode: 'sync.invalidRequestFormat',
      }));
    }

  } else if (routePath.includes("/assets/")) {
    const assetPath = routePath.slice(routePath.indexOf("/assets/"));
    req.url = assetPath;
    return serveFile(req, res);

  } else if (z.string()
    .regex(/^\/(assets\/[a-zA-Z0-9_\-/]+|[a-zA-Z0-9_\-]+)\.(png|jpg|jpeg|gif|svg|html|css|js)$/)
    .safeParse(routePath).success) {
    //? if the request is a file with one of the following extensions then we serve it
    //? png|jpg|jpeg|gif|svg|html|css|js
    return serveFile(req, res);

  } else if (path.extname(routePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");

  } else { // for the index.html
    //? if the request doesnt fit any of the above then we serve the index.html file
    return serveFile({ url: '/' }, res);
  }
}

const ip: string = process.env.SERVER_IP || '127.0.0.1';
const port: string = process.env.SERVER_PORT || '80';

(async () => {
  const isDevMode = process.env.NODE_ENV !== 'production';
  if (isDevMode) {
    const { initConsolelog } = await import('./utils/console.log');
    initConsolelog();
    const { initializeAll } = await import('./dev/loader');
    await initializeAll();
    const { setupWatchers } = await import('./dev/hotReload');
    setupWatchers();
    const { initRepl } = await import('./utils/repl');
    initRepl();
  }

  const httpServer = http.createServer(async (req, res) => { ServerRequest(req, res) });
  loadSocket(httpServer);
  // @ts-ignore // typescript thinks ip needs to be a number
  httpServer.listen(port, ip, () => {
    console.log(`Server is running on http://${ip}:${port}/`, 'green');
  });


})()