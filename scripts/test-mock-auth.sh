#!/bin/bash

echo "1. Testing Mock Login..."
RESPONSE=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testcustomer@example.com","password":"mock-auth-password"}')

echo "Login Response:"
echo $RESPONSE | grep -o '.*' # Ensure newline
echo ""

# Extract token
TOKEN=$(echo $RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to extract token!"
  exit 1
fi

echo "2. Successfully extracted token. Testing an authenticated request..."
# Assuming there is a protected GraphQL operation or we just verify that it doesn't fail parsing.
# We will use the simple users query as used in the existing test-auth.sh
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "query { users { id email name } }"}'

echo -e "\n\nDone testing mock auth."
