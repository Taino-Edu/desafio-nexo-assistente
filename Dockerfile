# Uma imagem com os dois processos (serviço de chamados e app), suficiente para
# a demonstração. Os bancos SQLite ficam no volume /app/data.
FROM node:22-alpine
RUN npm install -g pnpm@12.15.0
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/tickets/package.json apps/tickets/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @nexo/web build

ENV NODE_ENV=production \
    WEB_DB_PATH=/app/data/web.db \
    TICKETS_DB_PATH=/app/data/tickets.db \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
VOLUME /app/data
EXPOSE 3000
CMD ["pnpm", "start"]
