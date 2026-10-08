FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src/ src/
COPY public/ public/
RUN mkdir -p data
EXPOSE 3000
CMD ["bun", "src/index.js"]
