# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./

# 同域部署：显式给空串，前端才会请求同源的 /api（而不是默认的 127.0.0.1:3100）
ARG VITE_LIHUO_SERVER_URL=""
ENV VITE_LIHUO_SERVER_URL=${VITE_LIHUO_SERVER_URL}
RUN bun run build

# 运行镜像：静态前端 + /api 反代到后端容器（同域，Cookie 才成立）
FROM nginx:1.27-alpine

ENV API_UPSTREAM=http://api:3100

COPY --from=web-build /app/web/dist /usr/share/nginx/html
# 官方镜像启动时会用环境变量渲染 templates/ 下的模板
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh && rm -f /etc/nginx/conf.d/default.conf

EXPOSE 3000
