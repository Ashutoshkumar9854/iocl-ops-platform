FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# Create the data directory for the persistent volume
RUN mkdir -p /data
EXPOSE 3001
CMD ["node", "server.js"]
