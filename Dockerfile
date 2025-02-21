FROM node:22.1.0
LABEL maintainer="Rishi Ghan <rishi.ghan@gmail.com>"

# Working directory
WORKDIR /acquisition-service
# Install dependencies
COPY package.json package-lock.json ./
COPY moleculer.config.ts ./
COPY tsconfig.build.json ./

# Install application dependencies
RUN npm install
RUN npm install -g typescript ts-node

# Copy source
COPY . .

# Build and cleanup
ENV NODE_ENV=production
RUN npm run build \
 && npm prune

EXPOSE 3080
# Start server
CMD ["npm", "start"]