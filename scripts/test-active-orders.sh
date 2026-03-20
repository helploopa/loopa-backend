#!/bin/bash

# 1. Login as customer
echo "Logging in as customer..."
LOGIN_RESP=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testcustomer@example.com","password":"mock-auth-password"}')

TOKEN=$(echo $LOGIN_RESP | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to get token"
  echo $LOGIN_RESP
  exit 1
fi

echo "Got token."

# 2. Get active orders
echo "Fetching active orders..."
curl -s -X GET http://localhost:4000/api/orders/active \
  -H "Authorization: Bearer $TOKEN" | grep -o '.*'
