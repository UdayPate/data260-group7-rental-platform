#!/bin/sh
# Entry point of every Xenia service container. Loads the shared JWT secret, then runs the service.
# The secret is made once by the `jwt-secret` service in docker-compose.yml (a random value in
# .secrets/jwt_secret, git-ignored) and mounted read-only at /run/secrets/xenia/jwt_secret.
# A JWT_SECRET already set in the environment wins.
set -e
if [ -z "$JWT_SECRET" ] && [ -s /run/secrets/xenia/jwt_secret ]; then
  JWT_SECRET="$(cat /run/secrets/xenia/jwt_secret)"
  export JWT_SECRET
fi
exec "$@"
