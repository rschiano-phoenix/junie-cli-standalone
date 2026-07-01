FROM node:20-slim

# Install dependencies: curl for Junie, git for repo operations, docker.io for exec, ca-certificates for git, unzip for installation, openssh-client for SSH repositories
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-client \
    docker.io \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Junie CLI
RUN curl -fsSL https://junie.jetbrains.com/install.sh | bash

# Ensure Junie is in PATH
# The install script typically puts it in /root/.local/bin or /usr/local/bin
ENV PATH="/root/.local/bin:/usr/local/bin:${PATH}"

# Prepare SSH directory for known_hosts/config when SSH repositories are used.
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

# Configure git to trust the app directory (useful for mounted volumes)
RUN git config --global --add safe.directory /app

# Set working directory inside container
WORKDIR /app

# Install app dependencies
# Note: This expects the build context to be the project root
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Create workspace and projects directories and ensure they are writable
RUN mkdir -p /app/workspace /app/projects && chmod 777 /app/workspace /app/projects

# Expose the webhook port
EXPOSE 3000

# Default environment variables
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
