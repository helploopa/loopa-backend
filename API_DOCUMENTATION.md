# API Documentation

This document lists the available GraphQL APIs for the Loopa Backend, including Queries and Mutations, with sample payloads for client integration.

## Endpoint
**URL:** `http://localhost:4000/` (or your deployed URL)

## Authentication
To authenticate, include the Firebase ID Token in the `Authorization` header.
```
Authorization: Bearer <FIREBASE_ID_TOKEN>
```
The `login` mutation specifically requires this header to return the authenticated user's profile.

---

## Queries

### 1. Get All Users
Fetches a list of all users.
**Query:**
```graphql
query GetUsers {
  users {
    id
    email
    name
  }
}
```

### 2. Get Nearby Products
Fetches products based on location and optional category.
**Query:**
```graphql
query GetNearbyProducts($location: LocationInput!, $category: String) {
  nearbyProducts(location: $location, category: $category) {
    id
    title
    price
    currency
    distanceMiles
    images
    seller {
      id
      name
      latitude
      longitude
    }
  }
}
```
**Variables:**
```json
{
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "radius_miles": 10
  },
  "category": "Food"
}
```

### 3. Get All Categories
Fetches all available product categories.
**Query:**
```graphql
query GetCategories {
  categories {
    id
    label
    icon
    isActive
    count
  }
}
```

### 4. Get Product Details
Fetches details for a specific product.
**Query:**
```graphql
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    description
    price
    quantityAvailable
    primaryImage
    images
    pickupLocation {
      address
      distanceMiles
    }
    seller {
      name
    }
  }
}
```
**Variables:**
```json
{
  "id": "product_id_here"
}
```

### 5. Get Order Details
Fetches details of a specific order.
**Query:**
```graphql
query GetOrder($id: ID!) {
  order(id: $id) {
    id
    orderNumber
    status
    totalAmount
    createdAt
    customer {
      firstName
    }
    items {
      title
      quantity
      price
    }
  }
}
```
**Variables:**
```json
{
  "id": "order_id_here"
}
```

### 6. Get Available Sample Sellers
Fetches available sellers offering free samples for a specific order.
**Query:**
```graphql
query GetAvailableSampleSellers($orderId: ID!) {
  availableSampleSellers(orderId: $orderId) {
    status
    eligibility {
      claimLimit
      expiresIn
    }
    sellers {
      id
      name
      distanceMiles
      rating
      pickupWindows {
        id
        day
        formatted
      }
    }
  }
}
```
**Variables:**
```json
{
  "orderId": "order_id_here"
}
```

---

## Mutations

### 1. Create Category
Creates a new category.
**Mutation:**
```graphql
mutation CreateCategory($label: String!, $icon: String!, $isActive: Boolean) {
  createCategory(label: $label, icon: $icon, isActive: $isActive) {
    id
    label
  }
}
```
**Variables:**
```json
{
  "label": "Bakery",
  "icon": "🥐",
  "isActive": true
}
```

### 2. Update Product
Updates an existing product.
**Mutation:**
```graphql
mutation UpdateProduct($id: ID!, $input: UpdateProductInput!) {
  updateProduct(id: $id, input: $input) {
    id
    title
    price
  }
}
```
**Variables:**
```json
{
  "id": "product_id_here",
  "input": {
    "title": "Fresh Sourdough",
    "price": 12.50
  }
}
```

### 3. Create Order
Creates a new order for a customer.
**Mutation:**
```graphql
mutation CreateOrder($input: CreateOrderInput!) {
  createOrder(input: $input) {
    status
    message
    order {
      id
      orderNumber
      totalAmount
    }
    freeSampleOffer {
      enabled
      title
    }
  }
}
```
**Variables:**
```json
{
  "input": {
    "customerId": "user_id_here",
    "items": [
      {
        "productId": "product_id_1",
        "quantity": 2
      },
      {
        "productId": "product_id_2",
        "quantity": 1
      }
    ]
  }
}
```

### 4. Claim Sample
Claims a free sample from a seller.
**Mutation:**
```graphql
mutation ClaimSample($input: ClaimSampleInput!) {
  claimSample(input: $input) {
    success
    message
    claimedSample {
      id
      status
      claimedAt
    }
  }
}
```
**Variables:**
```json
{
  "input": {
    "orderId": "order_id_here",
    "sampleId": "sample_id_here",
    "sellerId": "seller_id_here",
    "pickupWindowId": "win_1"
  }
}
```

### 5. Login
Authenticates the user using the Firebase token in the header and returns the user profile.
**Mutation:**
```graphql
mutation Login {
  login {
    id
    email
    name
  }
}
```
**Headers:**
```json
{
  "Authorization": "Bearer <FIREBASE_ID_TOKEN>"
}
```
