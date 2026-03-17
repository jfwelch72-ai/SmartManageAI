#!/bin/bash
set -e
npm install
npm run db:push -- --force 2>&1 || true
