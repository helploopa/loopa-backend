import gql from 'graphql-tag';

export const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String
    seller: Seller
  }

  type Seller {
    id: ID!
    name: String!
    description: String!
    latitude: Float!
    longitude: Float!
    distanceMiles: Float
    products: [Product!]!
    stories: [Story!]!
  }

  type PickupWindow {
    days: String
    startTime: String
    endTime: String
    formatted: String
  }

  type PickupLocation {
    address: String
    latitude: Float
    longitude: Float
    distanceMiles: Float
    isExact: Boolean
  }

  type Product {
    id: ID!
    title: String!
    description: String!
    price: Float!
    currency: String!
    quantityAvailable: Int!
    quantityLeft: Int!
    images: [String!]
    primaryImage: String
    imageUrl: String # Deprecated
    isFavorite: Boolean
    category: String
    tags: [String!]
    badges: [String!]
    pickupWindows: [PickupWindow!]
    pickupLocation: PickupLocation
    seller: Seller!
    makerId: ID
    createdAt: String
    updatedAt: String
  }

  type Story {
    id: ID!
    content: String!
    image: String
    seller: Seller!
  }

  input LocationInput {
    city: String
    state: String
    country: String
    latitude: Float!
    longitude: Float!
    radius_miles: Float
    formatted: String
  }

  type Category {
    id: ID!
    label: String!
    icon: String!
    isActive: Boolean!
    count: Int!
  }

  type Query {
    users: [User!]!
    nearbyProducts(location: LocationInput!, category: String): [Product!]!
    categories: [Category!]!
    product(id: ID!): Product
    order(id: ID!): Order
    availableSampleSellers(orderId: ID!): SampleOffer!
  }

  input UpdateProductInput {
    title: String
    description: String
    price: Float
    currency: String
    quantityAvailable: Int
    category: String
    primaryImage: String
    images: [String!]
    tags: [String!]
    isActive: Boolean
  }

  input CreateOrderInput {
    customerId: ID!
    items: [OrderItemInput!]!
  }

  input OrderItemInput {
    productId: ID!
    quantity: Int!
  }

  type OrderCustomer {
    firstName: String!
    greetingName: String!
  }

  type OrderSeller {
    id: ID!
    name: String!
    firstName: String!
    personalMessage: String
  }

  type PickupCoordinates {
    lat: Float!
    lng: Float!
  }

  type PickupLocationDetails {
    address: String!
    city: String!
    distanceMiles: Float!
    coordinates: PickupCoordinates!
  }

  type PickupWindowDetails {
    day: String!
    startTime: String!
    endTime: String!
    formatted: String!
  }

  type OrderPickupDetails {
    location: PickupLocationDetails!
    window: PickupWindowDetails!
  }

  type OrderItem {
    productId: ID!
    title: String!
    seller: OrderSeller!
    price: Float!
    quantity: Int!
    pickup: OrderPickupDetails!
  }

  type PickupSummary {
    location: String!
    time: String!
  }

  type Order {
    id: ID!
    orderNumber: String!
    status: String!
    createdAt: String!
    totalAmount: Float!
    currency: String!
    customer: OrderCustomer!
    items: [OrderItem!]!
    pickupSummary: PickupSummary!
  }

  type Celebration {
    title: String!
  }

  type FreeSampleOffer {
    enabled: Boolean!
    title: String!
    description: String!
  }

  type OrderResponse {
    status: String!
    message: String!
    order: Order!
    celebration: Celebration!
    freeSampleOffer: FreeSampleOffer!
  }

  type SamplePickupWindow {
    id: ID!
    day: String!
    startTime: String!
    endTime: String!
    formatted: String!
    available: Boolean!
  }

  type SampleSeller {
    id: ID!
    name: String!
    avatarUrl: String
    rating: Float
    reviewCount: Int
    distanceMiles: Float!
    disclaimer: String!
    pickupWindows: [SamplePickupWindow!]!
  }

  type SampleEligibility {
    orderId: ID!
    claimLimit: Int!
    expiresIn: String!
  }

  type SampleOffer {
    status: String!
    eligibility: SampleEligibility!
    sellers: [SampleSeller!]!
  }

  input ClaimSampleInput {
    orderId: ID!
    sampleId: ID!
    sellerId: ID!
    pickupWindowId: String!
  }

  type ClaimSampleResponse {
    success: Boolean!
    message: String!
    claimedSample: Sample
  }

  type Sample {
    id: ID!
    sellerId: ID!
    productId: ID
    status: String!
    claimedAt: String
  }

  type Mutation {
    createCategory(label: String!, icon: String!, isActive: Boolean, count: Int): Category!
    updateProduct(id: ID!, input: UpdateProductInput!): Product!
    createOrder(input: CreateOrderInput!): OrderResponse!
    claimSample(input: ClaimSampleInput!): ClaimSampleResponse!
  }
`;
