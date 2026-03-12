# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build essentials for native modules (like bcrypt)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client and build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy production dependencies and built code
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Set environment variables (Recommended to set these in Coolify UI instead)
ENV NODE_ENV=production
ENV PORT=3009

EXPOSE 3009

# Run the app
CMD ["npm", "start"]
