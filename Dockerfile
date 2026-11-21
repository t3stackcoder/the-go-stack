# The production image: the built server and nothing else.
#
#   docker build -t the-go-stack .
#   docker run -p 3000:3000 -e ORIGIN=https://example.com the-go-stack
#
# ORIGIN must be the address visitors use. Without it the server cannot tell its own address
# behind a proxy, and refuses form posts as coming from another site.

FROM node:24-slim AS build
WORKDIR /app

# pnpm, at the version package.json names.
RUN corepack enable

# Dependencies first, so that this layer is rebuilt only when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build


FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app

# The build bundles everything it imports, so no node_modules are needed here. package.json
# comes along because it is what marks server.js as an ES module.
COPY --from=build /app/build ./build
COPY package.json server.js ./

# Not root.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD node -e "fetch('http://localhost:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server.js"]
