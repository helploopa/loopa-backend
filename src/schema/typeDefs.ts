import gql from 'graphql-tag';

export const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String
    seller: Seller
  }

  type SellerBusinessHour {
    id: ID!
    dayCode: String!
    startTime: String!
    endTime: String!
    isOpen: Boolean!
  }

  type SellerFeature {
    id: ID!
    featureKey: String!
    enabled: Boolean!
    config: String
  }

  type Seller {
    id: ID!
    name: String!
    description: String!
    latitude: Float!
    longitude: Float!
    distanceMiles: Float
    workPermit: Boolean
    delivery: Boolean
    products: [Product!]!
    stories: [Story!]!
    businessHours: [SellerBusinessHour!]!
    features: [SellerFeature!]!
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

  input MapBoundsInput {
    northEastLat: Float!
    northEastLng: Float!
    southWestLat: Float!
    southWestLng: Float!
  }

  input MapClusterInput {
    lat: Float!
    lng: Float!
    zoom: Int
    bounds: MapBoundsInput
    category: String
    radiusKm: Float
  }

  type ClusterItem {
    makerId: ID!
    name: String!
    product: String
    price: Float
    image: String
  }

  type MapCluster {
    id: ID!
    lat: Float!
    lng: Float!
    count: Int!
    items: [ClusterItem!]!
  }

  type MapItem {
    id: ID!
    type: String!
    lat: Float!
    lng: Float!
    name: String!
    image: String
    category: String
    rating: Float
    distanceKm: Float
    hasFreeSamples: Boolean!
  }

  type MapClustersResult {
    clusters: [MapCluster!]!
    items: [MapItem!]!
  }

  type Query {
    users: [User!]!
    nearbyProducts(location: LocationInput!, category: String): [Product!]!
    categories: [Category!]!
    product(id: ID!): Product
    order(id: ID!): Order
    availableSampleSellers(orderId: ID!): SampleOffer!
    nearbyFreeSampleProducts(location: LocationInput!): FreeSampleResult!
    mapClusters(input: MapClusterInput!): MapClustersResult!
  }

  type FreeSampleSellerInfo {
    id: ID!
    name: String!
    avatarUrl: String
    city: String
    state: String
    zipcode: String
    overallRating: Float
    reviewCount: Int
    distanceMiles: Float!
    tags: [String!]!
    businessHours: [SellerBusinessHour!]!
  }

  type FreeSampleProduct {
    id: ID!
    title: String!
    description: String!
    primaryImage: String
    images: [String!]
    tags: [String!]!
    seller: FreeSampleSellerInfo!
  }

  type FreeSampleResult {
    totalCount: Int!
    products: [FreeSampleProduct!]!
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

  input BusinessHourInput {
    dayCode: String!
    startTime: String!
    endTime: String!
    isOpen: Boolean
  }

  input SellerFeatureInput {
    featureKey: String!
    enabled: Boolean!
    config: String
  }

  input UpdateSellerInput {
    name: String
    description: String
    avatarUrl: String
    coverPhoto: String
    latitude: Float
    longitude: Float
    city: String
    state: String
    pickupDays: String
    pickupStartTime: String
    pickupEndTime: String
    workPermit: Boolean
    delivery: Boolean
    businessHours: [BusinessHourInput!]
    features: [SellerFeatureInput!]
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
    updateSeller(userId: ID!, input: UpdateSellerInput!): Seller!
    createOrder(input: CreateOrderInput!): OrderResponse!
    claimSample(input: ClaimSampleInput!): ClaimSampleResponse!
    login: User!
  }
`;
