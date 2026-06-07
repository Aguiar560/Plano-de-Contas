FROM node:20-alpine

WORKDIR /app

# Install server deps first — this layer is cached until package.json changes
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev --no-fund --no-audit

# Copy the rest of the application
COPY . .

EXPOSE 3001

CMD ["node", "server/server.js"]
