FROM node:20-alpine

# better-sqlite3 requires native build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy all source files
COPY backend/ ./backend/
COPY public/  ./public/
COPY admin/   ./admin/

# Data directory for SQLite DB and uploads
RUN mkdir -p /app/backend/data/uploads

EXPOSE 3000

CMD ["node", "backend/server.js"]
