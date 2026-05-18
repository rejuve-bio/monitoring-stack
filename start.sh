#!/bin/bash
# Generate prometheus.yml from template then start the stack
set -a
source .env
set +a

envsubst < prometheus.yml.template > prometheus.yml
docker compose up -d
