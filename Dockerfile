FROM node:26-alpine AS build

WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY packages ./packages

RUN corepack enable && corepack prepare pnpm@10.8.1 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:26-alpine

WORKDIR /app

RUN addgroup -S sofiadata && adduser -S sofiadata -G sofiadata

COPY --from=build --chown=sofiadata:sofiadata /app/package.json ./package.json
COPY --from=build --chown=sofiadata:sofiadata /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build --chown=sofiadata:sofiadata /app/node_modules ./node_modules
COPY --from=build --chown=sofiadata:sofiadata /app/packages ./packages

ENV HOST=0.0.0.0
ENV PORT=3000
ENV MCP_HTTP_PATH=/mcp
ENV REQUEST_TIMEOUT_MS=30000

# Must match PORT's default value.
EXPOSE 3000

USER sofiadata

CMD ["node", "packages/http-server/dist/index.js"]
