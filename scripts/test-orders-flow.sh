#!/bin/bash

# 1. Login as customer
echo -e "\n--- Logging in as customer ---"
LOGIN_RESP=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testcustomer@example.com","password":"mock-auth-password"}')

CUSTOMER_TOKEN=$(echo $LOGIN_RESP | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$CUSTOMER_TOKEN" ]; then
  echo "Failed to get token"
  echo $LOGIN_RESP
  exit 1
fi

echo "Got Customer Token: $CUSTOMER_TOKEN"

# 2. Get a product to add to cart
echo -e "\n--- Fetching a product ID directly from REST API ---"
# We know seller ID from the debug-db run: 59139b0b-5407-40e0-a685-887ae0235ea4
SELLER_ID="59139b0b-5407-40e0-a685-887ae0235ea4"
echo "Fetching products for Seller ID: $SELLER_ID"
PRODUCTS_JSON=$(curl -s -X GET "http://localhost:4000/seller/$SELLER_ID/products")

PRODUCT_ID=$(echo $PRODUCTS_JSON | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$PRODUCT_ID" ]; then
    echo "No product found to add to cart. Cannot proceed."
    echo $PRODUCTS_JSON
    exit 1
fi
echo "Using product ID: $PRODUCT_ID"

# 3. Add item to cart for Customer
echo -e "\n--- Adding item to active cart ---"
curl -s -X POST http://localhost:4000/api/orders/add-item \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -d "{\"productId\": \"$PRODUCT_ID\", \"quantity\": 1}" | jq .

# 4. Fetch active orders
echo -e "\n--- Fetching active orders for customer ---"
curl -s -X GET http://localhost:4000/api/orders/active \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq .
