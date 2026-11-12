/**
 * 极简路由
 * ------------------------------------------------------------
 * 只支持本项目需要的形态：/api/admin/users/:id
 * 不引入框架的原因：路由规则简单，依赖越少越好部署。
 */

export interface RouteContext {
  params: Record<string, string>;
}

export type Handler = (ctx: RouteContext, req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: path.split("/").filter(Boolean),
      handler,
    });
  }

  get(path: string, h: Handler) { this.add("GET", path, h); }
  post(path: string, h: Handler) { this.add("POST", path, h); }
  put(path: string, h: Handler) { this.add("PUT", path, h); }
  patch(path: string, h: Handler) { this.add("PATCH", path, h); }
  delete(path: string, h: Handler) { this.add("DELETE", path, h); }

  match(method: string, urlPath: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = urlPath.split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      if (r.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: r.handler, params };
    }
    return null;
  }
}
