FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS production

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/validate-production-config.sh ./scripts/validate-production-config.sh

RUN npx prisma generate
RUN chmod +x ./scripts/validate-production-config.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1))"

# Migrations run via the platform preDeployCommand (see render.yaml), not on every container boot.
ENTRYPOINT ["./scripts/validate-production-config.sh"]
CMD ["dumb-init", "--", "node", "dist/src/main.js"]
