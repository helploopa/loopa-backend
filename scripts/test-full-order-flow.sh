#!/bin/bash
# Tests the full Loopa order workflow
set -e

SERVER_URL="http://localhost:4000"

echo "=== 1. Logging in as Seller ==="
SELLER_LOGIN=$(curl -s -X POST $SERVER_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maker@example.com","password":"mock-auth-password"}')
SELLER_TOKEN=$(echo $SELLER_LOGIN | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$SELLER_TOKEN" ]; then
    echo "Seller login failed!"
    echo $SELLER_LOGIN
    exit 1
fi
echo "Seller authenticated."

echo -e "\n=== 2. Seller getting their own product ID ==="
PRODUCT_ID=$(npx ts-node scripts/temp-get-product.ts | cut -d':' -f1)

if [ -z "$PRODUCT_ID" ]; then
    echo "No product found."
    exit 1
fi
echo "Using product ID: $PRODUCT_ID"

echo -e "\n=== 3. Logging in as Customer ==="
CUST_LOGIN=$(curl -s -X POST $SERVER_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testcustomer@example.com","password":"mock-auth-password"}')
CUST_TOKEN=$(echo $CUST_LOGIN | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Customer authenticated."

echo -e "\n=== 4. Customer Adds Item to Cart ==="
ADD_RESP=$(curl -s -X POST $SERVER_URL/api/orders/add-item \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -d "{\"productId\": \"$PRODUCT_ID\", \"quantity\": 1}")
ORDER_ID=$(echo $ADD_RESP | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$ORDER_ID" ]; then
    echo "Failed to create order cart."
    echo $ADD_RESP
    exit 1
fi
echo "Active Cart pending order created: $ORDER_ID"

echo -e "\n=== 5. Customer Places Order ==="
curl -s -X POST $SERVER_URL/api/orders/$ORDER_ID/place \
  -H "Authorization: Bearer $CUST_TOKEN" | jq .

echo -e "\n=== 6. Seller Proposes Changes ==="
curl -s -X PATCH $SERVER_URL/api/orders/$ORDER_ID/propose-changes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{
    "proposedPickupDate": "2026-10-31",
    "proposedPickupTime": "10:00 AM - 12:00 PM",
    "reason": "Need extra time to bake fresh",
    "sellerComments": "I can only do Halloween morning"
  }' | jq .

echo -e "\n=== 7. Customer Reviews and Approves Changes ==="
curl -s -X PATCH $SERVER_URL/api/orders/$ORDER_ID/review-changes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -d '{"action": "approve"}' | jq .

echo -e "\n=== 8. Seller Marks In Progress ==="
curl -s -X POST $SERVER_URL/api/orders/$ORDER_ID/delivery-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{"status": "IN_PROGRESS"}' | jq .

echo -e "\n=== 9. Seller Marks Ready For Pickup ==="
curl -s -X POST $SERVER_URL/api/orders/$ORDER_ID/delivery-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{
    "status": "READY_FOR_PICKUP",
    "pickupAddress": "Front Porch, 123 Maker St",
    "pickupTimeWindow": "Sat 10-12"
  }' | jq .

echo -e "\n=== 10. Seller Marks Completed ==="
curl -s -X POST $SERVER_URL/api/orders/$ORDER_ID/delivery-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{"status": "COMPLETED"}' | jq .

echo -e "\n=== Finished ==="
