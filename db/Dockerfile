# Tooling image for the db package: seed, import, create-user, relink-rfid, explain, integration tests.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . .
CMD ["node", "--version"]
