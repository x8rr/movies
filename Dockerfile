# pinned: the scrapers run sites' own JS/wasm, which fingerprints the runtime — Hexa's
# wasm rejects Bun 1.4.5 (E18) but runs on 1.3.13. Re-run the providers before bumping.
FROM oven/bun:1.3.13-alpine
WORKDIR /app
COPY package.json bun.lock* ./
COPY patches/ patches/
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src/ src/
COPY public/ public/
EXPOSE 3000
CMD ["bun", "src/index.js"]
