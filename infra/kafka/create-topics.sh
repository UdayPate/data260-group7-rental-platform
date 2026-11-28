#!/usr/bin/env bash
# Creates every Kafka topic the project uses, each with 3 partitions (spec 13.11 needs several
# partitions so that three debates can run side by side, and so consumer groups can scale).
#
# It is safe to run again: --if-not-exists skips topics that already exist.
#   automatically: the kafka-init service in docker-compose.yml runs it after Kafka is healthy
#   by hand:       docker compose exec kafka env BOOTSTRAP=localhost:9092 bash /create-topics.sh
#                  (or from the host, if Kafka's CLI is installed: BOOTSTRAP=localhost:9092 KAFKA_BIN=/path/to/bin ./create-topics.sh)
set -euo pipefail

BOOTSTRAP="${BOOTSTRAP:-localhost:9092}"
KAFKA_BIN="${KAFKA_BIN:-/opt/kafka/bin}"
PARTITIONS="${PARTITIONS:-3}"

TOPICS=(
  # Booking: Booking API -> booking worker, Analytics
  booking.requested booking.approved booking.declined booking.cancelled booking.completed
  # Availability: booking worker / Property Service -> Property Service (WebSocket push), Analytics
  availability.blocked availability.released
  # Property activity -> Analytics
  property.viewed property.saved search.performed availability.notified
  # Review Service (Himja) -> Property Service (rating), Analytics
  review.created
  # Messaging Service (Himja) -> Analytics
  message.sent
  # AI service (Himja): the debate
  ai.requests debate.round.0 debate.round.1 debate.round.2 ai.results
  # Every service -> Analytics: journey steps (spec 8) and rejected messages
  trace.steps dead.letter
)

echo "Waiting for Kafka at ${BOOTSTRAP} ..."
for attempt in $(seq 1 30); do
  if "${KAFKA_BIN}/kafka-broker-api-versions.sh" --bootstrap-server "${BOOTSTRAP}" >/dev/null 2>&1; then break; fi
  sleep 2
done

for topic in "${TOPICS[@]}"; do
  "${KAFKA_BIN}/kafka-topics.sh" --bootstrap-server "${BOOTSTRAP}" --create --if-not-exists \
    --topic "${topic}" --partitions "${PARTITIONS}" --replication-factor 1
done

echo "Topics now in Kafka:"
"${KAFKA_BIN}/kafka-topics.sh" --bootstrap-server "${BOOTSTRAP}" --list
