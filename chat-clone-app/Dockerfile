# syntax=docker/dockerfile:1
FROM node:20-bullseye

WORKDIR /app

# Install deps
COPY chat-clone-app/package*.json ./
RUN npm ci

# Copy the app
COPY chat-clone-app/ /app/

# Expose Expi/Metro ports
EXPOSE 19000 19001 19002 8081

CMD ["npm", "run", "start"]
