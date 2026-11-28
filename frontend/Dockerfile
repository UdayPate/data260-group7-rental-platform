# Frontend image: builds the React app, then serves it with nginx on port 5173.
# Built by the root docker-compose.yml, which passes the real service URLs below.
# Mock mode stays ON so that the one service without a real backend yet (Analytics) is mocked;
# every service with a URL set goes to its real container (see frontend/README.md, "Switch one
# service at a time").

# ---- 1. build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_USE_MOCKS=true
ARG VITE_USER_API_BASE_URL=http://localhost:8001
ARG VITE_PROPERTY_API_BASE_URL=http://localhost:8002
ARG VITE_BOOKING_API_BASE_URL=http://localhost:8003
ARG VITE_MESSAGING_API_BASE_URL=http://localhost:8004
ARG VITE_REVIEW_API_BASE_URL=http://localhost:8005
ARG VITE_AI_API_BASE_URL=http://localhost:8007
ARG VITE_ANALYTICS_API_BASE_URL=
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS \
    VITE_USER_API_BASE_URL=$VITE_USER_API_BASE_URL \
    VITE_PROPERTY_API_BASE_URL=$VITE_PROPERTY_API_BASE_URL \
    VITE_BOOKING_API_BASE_URL=$VITE_BOOKING_API_BASE_URL \
    VITE_MESSAGING_API_BASE_URL=$VITE_MESSAGING_API_BASE_URL \
    VITE_REVIEW_API_BASE_URL=$VITE_REVIEW_API_BASE_URL \
    VITE_AI_API_BASE_URL=$VITE_AI_API_BASE_URL \
    VITE_ANALYTICS_API_BASE_URL=$VITE_ANALYTICS_API_BASE_URL
RUN npm run build

# ---- 2. serve ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5173
