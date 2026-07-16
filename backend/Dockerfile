FROM node:18-alpine

# Install build tools for sqlite3 native bindings
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including native sqlite3)
RUN npm install --production

# Copy source code
COPY . .

# Create the data directory that SQLite will write to
RUN mkdir -p /data && chmod 777 /data

EXPOSE 3001

CMD ["node", "server.js"]
