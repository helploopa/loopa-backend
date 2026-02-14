# Loopa Backend API

Authentication and hyper-local discovery API for Loopa. Built with Node.js, TypeScript, Apollo Server, Prisma, and PostgreSQL (PostGIS).

## Prerequisites

- **Node.js**: v18 or higher
- **Docker**: For running the local PostgreSQL database with PostGIS
- **npm**: Package manager

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Ensure you have a `.env` file in the root directory (one was created during setup):
    ```env
    DATABASE_URL="postgresql://postgres:password@localhost:5432/loopa?schema=public"
    ```

3.  **Start Database**:
    Start the PostgreSQL container with PostGIS:
    ```bash
    docker-compose up -d
    ```

4.  **Initialize Database**:
    Run Prisma migrations to set up the schema:
    ```bash
    npx prisma migrate dev
    ```

## Running the Server

Start the development server:
```bash
npm run dev
```
The server will be available at `http://localhost:4000/`.

## How to Test the API

### 1. Apollo Sandbox (Recommended)
Apollo Server comes with a built-in landing page that serves the Apollo Sandbox.
1.  Open your browser and navigate to [http://localhost:4000/](http://localhost:4000/).
2.  Click "Query your server".
3.  You can explore the schema and run queries interactively.

### 2. Example Queries

**Get All Users:**
```graphql
query GetUsers {
  users {
    id
    email
    name
  }
}
```

**Get Nearby Products:**
*Note: Currently returns all products as a placeholder until geospatial logic is fully implemented.*

**Sample 1 (Lat/Long + Radius):**
```graphql
query GetNearbyProducts {
  nearbyProducts(location: {
    latitude: 40.94,
    longitude: -123.63,
    radius_miles: 3.0
  }) {
    id
    title
    price
    seller {
      name
    }
  }
}
```

**Sample 2 (City/State):**
```graphql
query GetNearbyProducts {
  nearbyProducts(location: {
    city: "Willow Creek",
    state: "CA",
    country: "US",
    latitude: 40.9398,
    longitude: -123.6312,
    radius_miles: 5.0,
    formatted: "Willow Creek, CA"
  }) {
    id
    title
    price
    seller {
      name
    }
  }
}
```

### 3. Using cURL
You can also test the API from the command line:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  --data '{ "query": "{ users { id name } }" }' \
  http://localhost:4000/
```
