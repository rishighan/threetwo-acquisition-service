FROM node:22.1.0
LABEL maintainer="Rishi Ghan <rishi.ghan@gmail.com>"

# Set working directory
WORKDIR /acquisition-service

# Copy package files first for efficient caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies)
RUN npm install 

# Copy necessary config files
COPY moleculer.config.ts tsconfig.json tsconfig.build.json ./

# Copy the rest of the source code
COPY . .

# Build the application
RUN npm run build 

# Now remove devDependencies to keep the final image small
RUN npm prune --omit=dev

# Expose the port
EXPOSE 3080

# Start the application
CMD ["npm", "start"]
