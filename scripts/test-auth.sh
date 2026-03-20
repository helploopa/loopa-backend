#!/bin/bash

# Configuration
# Replace with your actual Web API Key from Firebase Console -> Project Settings -> General
API_KEY="AIzaSyBLy0oi1DZeSPuC6HnMKWZ7IhBP5-8KJSY"
USER_ID="test-user-123"

# 1. Generate Custom Token
echo "Generating custom token for user: $USER_ID..."
CUSTOM_TOKEN=$(npx ts-node scripts/get-custom-token.ts "$USER_ID")

if [ $? -ne 0 ]; then
    echo "Failed to generate custom token."
    exit 1
fi

echo "Custom Token generated."

# 2. Exchange Custom Token for ID Token
if [ "$API_KEY" == "[YOUR_FIREBASE_WEB_API_KEY]" ]; then
    echo "Error: Please replace [YOUR_FIREBASE_WEB_API_KEY] in this script with your actual Firebase Web API Key."
    echo "You can find it in the Firebase Console -> Project Settings -> General."
    exit 1
fi

echo "Exchanging custom token for ID token..."
RESPONSE=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=$API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$CUSTOM_TOKEN\",\"returnSecureToken\":true}")

# Extract ID Token (requires jq, or use grep/sed fallback)
if command -v jq &> /dev/null; then
    ID_TOKEN=$(echo $RESPONSE | jq -r '.idToken')
else
    # Fallback to grep/sed if jq is not installed
    ID_TOKEN=$(echo $RESPONSE | grep -o '"idToken": *"[^"]*"' | sed 's/"idToken": *"//;s/"//')
fi

if [ -z "$ID_TOKEN" ] || [ "$ID_TOKEN" == "null" ]; then
    echo "Failed to exchange token. Response:"
    echo "$RESPONSE"
    exit 1
fi

echo "ID Token obtained."

# 3. Test the API
echo "Testing API with ID Token..."
curl -X POST http://localhost:4000/ \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ID_TOKEN" \
    -d '{"query": "query { users { id email name } }"}'

echo -e "\n\nDone."
