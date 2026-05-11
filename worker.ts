import { onRequest as proxyHandler } from "./functions/proxy";
import { onRequest as paletteHandler } from "./functions/palette";
import { onRequest as storageHandler } from "./functions/api/storage";
import { onRequestPost as loginHandler } from "./functions/api/login";

type Env = {
  ASSETS: Fetcher;
  DB?: D1Database;
  PASSWORD?: string;
  LANGUAGE?: string;
  language?: string;
};

const PUBLIC_PATH_PATTERNS = [/^\/login(?:\/|$)/, /^\/api\/login(?:\/|$)/];
const PUBLIC_FILE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".png",
  ".svg",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".txt",
  ".map",
  ".json",
  ".woff",
  ".woff2",
]);

function hasPublicExtension(pathname: string): boolean {
  const lastDotIndex = pathname.lastIndexOf(".");
  if (lastDotIndex === -1) return false;
  const extension = pathname.slice(lastDotIndex).toLowerCase();
  return PUBLIC_FILE_EXTENSIONS.has(extension);
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) ||
    hasPublicExtension(pathname)
  );
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) return;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) cookies[key] = value;
  });
  return cookies;
}

async function authMiddleware(request: Request, env: Env): Promise<Response | null> {
  const password = env.PASSWORD;
  if (typeof password !== "string") {
    return null;
  }

  const url = new URL(request.url);
  if (isPublicPath(url.pathname)) {
    return null;
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  if (cookies.auth && cookies.auth === btoa(password)) {
    return null;
  }

  const loginUrl = new URL("/login", url);
  return Response.redirect(loginUrl.toString(), 302);
}

async function i18nMiddleware(response: Response, env: Env): Promise<Response> {
  const language = env.language || env.LANGUAGE;
  if (
    language === "ENG" &&
    response.headers.get("content-type")?.includes("text/html")
  ) {
    return new HTMLRewriter()
      .on("head", {
        element(element) {
          element.prepend('<script>window.SITE_LANGUAGE = "ENG";</script>', {
            html: true,
          });
        },
      })
      .transform(response);
  }
  return response;
}

function mapAssetRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === "/login") {
    url.pathname = "/login.html";
    return new Request(url.toString(), request);
  }
  return request;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authResult = await authMiddleware(request, env);
    if (authResult) {
      return authResult;
    }

    const url = new URL(request.url);
    let response: Response;

    if (url.pathname === "/proxy") {
      response = await proxyHandler({ request });
    } else if (url.pathname === "/palette") {
      response = await paletteHandler({ request });
    } else if (url.pathname === "/api/storage") {
      response = await storageHandler({ request, env });
    } else if (url.pathname === "/api/login") {
      if (request.method.toUpperCase() !== "POST") {
        response = new Response("Method not allowed", { status: 405 });
      } else {
        response = await loginHandler({ request, env });
      }
    } else {
      response = await env.ASSETS.fetch(mapAssetRequest(request));
    }

    return i18nMiddleware(response, env);
  },
};
