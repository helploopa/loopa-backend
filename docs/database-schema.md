# Loopa – PostgreSQL Database Schema

> **ORM:** Prisma  
> **Database:** PostgreSQL (Neon serverless) with the `postgis` extension  
> **Schema file:** `prisma/schema.prisma`

---

## Table of Contents

1. [Entity Relationship Overview](#entity-relationship-overview)
2. [Tables](#tables)
   - [User](#user)
   - [Seller](#seller)
   - [Product](#product)
   - [SellerMedia](#sellermedia)
   - [Story](#story)
   - [Category](#category)
   - [SellerAddress](#selleraddress)
   - [SellerBusinessHours](#sellerbusinesshours)
   - [SellerFeature](#sellerfeature)
   - [Order](#order)
   - [OrderItem](#orderitem)
   - [OrderReview](#orderreview)
   - [OrderChange](#orderchange)
   - [OrderDeliveryStatus](#orderdeliverystatus)
   - [Sample](#sample)
   - [Chat](#chat)
   - [Message](#message)
3. [Enum-like String Values](#enum-like-string-values)
4. [Key Indexes & Constraints](#key-indexes--constraints)

---

## Entity Relationship Overview

```
User ──────────── Seller (1:1)
 │                  │
 │           ┌──────┴──────────────────────┐
 │        Product  Story  SellerMedia  SellerAddress
 │        SellerBusinessHours  SellerFeature
 │
 ├── Order ──── OrderItem ──── Product
 │       │          │
 │       │     OrderReview
 │       │     OrderChange
 │       │     OrderDeliveryStatus
 │       │
 │     Chat ──── Message
 │
 └── Sample (claimed)
       │
     Seller / Product
```

---

## Tables

### User

Primary identity for both buyers and sellers.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK, default `uuid()` | |
| `email` | `TEXT` | UNIQUE, NOT NULL | Login email |
| `firstName` | `TEXT` | nullable | |
| `lastName` | `TEXT` | nullable | |
| `name` | `TEXT` | nullable | Display name |
| `password` | `TEXT` | nullable | Hashed; null for Google sign-in users |
| `googleUid` | `TEXT` | UNIQUE, nullable | Firebase/Google OAuth UID |
| `fcmToken` | `TEXT` | nullable | Firebase Cloud Messaging token for push notifications |
| `profileImage` | `TEXT` | nullable | Public URL of the user's profile photo |
| `emailVerified` | `BOOLEAN` | default `false` | |
| `emailVerificationToken` | `TEXT` | UNIQUE, nullable | One-time email verification token |
| `emailVerificationTokenExpiry` | `TIMESTAMP` | nullable | |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Relations:** `Seller` (optional 1:1), `Order[]`, `Sample[]` (claimed), `OrderReview[]`, `Chat[]` (as participant1 or participant2), `Message[]`

---

### Seller

Seller profile linked 1:1 to a `User`. Geo-indexed for radius queries.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `userId` | `TEXT` | UNIQUE FK → `User.id` | |
| `name` | `TEXT` | NOT NULL | Business/display name |
| `description` | `TEXT` | NOT NULL | Long-form description |
| `tagline` | `TEXT` | nullable | Short marketing copy |
| `location` | `TEXT` | nullable | Free-form location string (e.g. "Willow Creek, CA") |
| `categories` | `TEXT[]` | | Array of category labels |
| `bio` | `TEXT` | nullable | |
| `workPhotos` | `TEXT[]` | | Array of photo URLs |
| `businessLicense` | `TEXT` | nullable | `"yes"` \| `"no"` \| `"not_required"` |
| `deliveryRadiusMiles` | `FLOAT` | nullable | |
| `samplesPerMonth` | `INT` | nullable | Max free samples the seller offers per month |
| `orderCapDollars` | `FLOAT` | nullable | Max order value per customer |
| `publishedAt` | `TIMESTAMP` | nullable | When the seller went live |
| `avatarUrl` | `TEXT` | nullable | |
| `coverPhoto` | `TEXT` | nullable | |
| `latitude` | `FLOAT` | NOT NULL | Used for geo-radius search |
| `longitude` | `FLOAT` | NOT NULL | Used for geo-radius search |
| `city` | `TEXT` | nullable | |
| `state` | `TEXT` | nullable | |
| `zipcode` | `TEXT` | nullable | |
| `pickupDays` | `TEXT` | nullable | |
| `pickupStartTime` | `TEXT` | nullable | |
| `pickupEndTime` | `TEXT` | nullable | |
| `serviceType` | `TEXT` | nullable | `"service"` \| `"product"` |
| `status` | `TEXT` | default `"draft"` | `draft` → `review` → `submitted` → `active` |
| `workPermit` | `BOOLEAN` | default `false` | |
| `delivery` | `BOOLEAN` | default `false` | Whether seller offers delivery |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Indexes:** `(latitude, longitude)` — supports bounding-box + distance queries.  
**Relations:** `Product[]`, `Story[]`, `Sample[]`, `Order[]`, `SellerBusinessHours[]`, `SellerFeature[]`, `SellerMedia[]`, `SellerAddress[]`

---

### Product

Items a seller lists for sale or sampling.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `title` | `TEXT` | NOT NULL | |
| `description` | `TEXT` | NOT NULL | |
| `price` | `FLOAT` | NOT NULL | |
| `currency` | `TEXT` | default `"USD"` | |
| `quantityAvailable` | `INT` | default `1` | Total stock |
| `quantityLeft` | `INT` | default `1` | Remaining stock (kept for compatibility) |
| `images` | `TEXT[]` | | All image URLs |
| `primaryImage` | `TEXT` | nullable | Featured image |
| `imageUrl` | `TEXT` | nullable | Deprecated; use `primaryImage` |
| `category` | `TEXT` | nullable | |
| `tags` | `TEXT[]` | | Search/filter tags |
| `badges` | `TEXT[]` | | UI badges (e.g. "organic", "bestseller") |
| `pickupWindows` | `JSONB` | nullable | Array of pickup window objects |
| `pickupLocation` | `JSONB` | nullable | Location details for pickup |
| `content` | `JSONB` | nullable | Optional rich content sections — `highlights`, `howItWorks`, `orderInstructions`, etc. Each section has a `style` string and a `blocks` array of `{ heading, subheading?, text }` objects |
| `isFavorite` | `BOOLEAN` | default `false` | |
| `isActive` | `BOOLEAN` | default `true` | `false` = soft-deleted |
| `sampler` | `BOOLEAN` | default `false` | Whether product is used as a sampler |
| `sampleProduct` | `BOOLEAN` | default `false` | Whether this is a dedicated sample product |
| `deletedAt` | `TIMESTAMP` | nullable | Soft delete timestamp |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Relations:** `OrderItem[]`, `Sample[]`

---

### SellerMedia

Normalised media assets for sellers and their products.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `entityType` | `TEXT` | NOT NULL | `seller_avatar` \| `seller_cover` \| `seller_work_photo` \| `product` |
| `entityId` | `TEXT` | nullable | `productId` when `entityType = "product"` |
| `filename` | `TEXT` | NOT NULL | Original filename |
| `mimeType` | `TEXT` | NOT NULL | e.g. `image/jpeg` |
| `sizeBytes` | `INT` | NOT NULL | |
| `storageProvider` | `TEXT` | default `"local"` | `local` \| `s3` |
| `storageKey` | `TEXT` | NOT NULL | Storage path / S3 key |
| `publicUrl` | `TEXT` | NOT NULL | URL served to clients |
| `isPrimary` | `BOOLEAN` | default `false` | |
| `sortOrder` | `INT` | default `0` | Display ordering |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Indexes:** `(sellerId, entityType)`, `(entityId)`

---

### Story

Short-form content posts by sellers (similar to Instagram stories).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `content` | `TEXT` | NOT NULL | Text body |
| `image` | `TEXT` | nullable | Optional image URL |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

---

### Category

Browse categories shown in the app.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `label` | `TEXT` | NOT NULL | Display name |
| `icon` | `TEXT` | NOT NULL | Icon identifier or URL |
| `isActive` | `BOOLEAN` | default `true` | |
| `count` | `INT` | default `0` | Denormalized count of active sellers/products |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

---

### SellerAddress

Addresses associated with a seller (business location and pickup points).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `type` | `TEXT` | NOT NULL | `"business"` \| `"pickup"` |
| `label` | `TEXT` | nullable | Human label (e.g. "Home Kitchen") |
| `street` | `TEXT` | nullable | |
| `city` | `TEXT` | nullable | |
| `state` | `TEXT` | nullable | |
| `zipcode` | `TEXT` | nullable | |
| `country` | `TEXT` | default `"US"` | |
| `latitude` | `FLOAT` | NOT NULL | |
| `longitude` | `FLOAT` | NOT NULL | |
| `isDefault` | `BOOLEAN` | default `false` | Primary pickup address |
| `isActive` | `BOOLEAN` | default `true` | |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Indexes:** `(sellerId, type)`

---

### SellerBusinessHours

Weekly operating hours for a seller, one row per day.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `dayCode` | `TEXT` | NOT NULL | `M`=Mon, `U`=Tue, `W`=Wed, `T`=Thu, `F`=Fri, `S`=Sat, `X`=Sun |
| `startTime` | `TEXT` | NOT NULL | HH:MM 24h format |
| `endTime` | `TEXT` | NOT NULL | HH:MM 24h format |
| `isOpen` | `BOOLEAN` | default `true` | |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Unique:** `(sellerId, dayCode)` — one record per seller per weekday.

---

### SellerFeature

Feature flags and configuration per seller (e.g. sampling, delivery).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `featureKey` | `TEXT` | NOT NULL | e.g. `"sampling"`, `"delivery"` |
| `enabled` | `BOOLEAN` | default `false` | |
| `config` | `JSONB` | nullable | Feature-specific config (e.g. `{ "weekly_sample": 10 }`) |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Unique:** `(sellerId, featureKey)`

---

### Order

Customer orders placed with a seller.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `orderNumber` | `TEXT` | UNIQUE, default `cuid()` | Human-readable order ID |
| `status` | `TEXT` | default `"pending"` | See order statuses below |
| `totalAmount` | `FLOAT` | NOT NULL | |
| `currency` | `TEXT` | default `"USD"` | |
| `customerId` | `TEXT` | FK → `User.id` | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `pickupDate` | `TEXT` | nullable | e.g. `"03-22-2026"` |
| `pickupTime` | `TEXT` | nullable | e.g. `"10:00 - 12:00"` |
| `reviewStatus` | `TEXT` | default `"pending"` | `pending` \| `partial` \| `completed` |
| `freeSampleEligible` | `BOOLEAN` | default `false` | Whether order unlocks a free sample |
| `freeSampleExpiry` | `TIMESTAMP` | nullable | Expiry of free sample eligibility |
| `freeSampleClaimed` | `BOOLEAN` | default `false` | |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Relations:** `OrderItem[]`, `OrderReview[]`, `OrderChange[]`, `OrderDeliveryStatus[]`, `Chat[]`

---

### OrderItem

Individual line items within an order.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `orderId` | `TEXT` | FK → `Order.id` | |
| `productId` | `TEXT` | FK → `Product.id` | |
| `quantity` | `INT` | NOT NULL | |
| `price` | `FLOAT` | NOT NULL | Price at time of order |
| `pickupDate` | `TEXT` | nullable | Item-level pickup date override |
| `pickupTime` | `TEXT` | nullable | Item-level pickup time override |
| `reviewStatus` | `TEXT` | default `"pending"` | `pending` \| `completed` |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Relations:** `OrderReview[]`, `OrderChange[]`, `OrderDeliveryStatus[]`

---

### OrderReview

Customer review submitted after an order item is fulfilled.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `orderId` | `TEXT` | FK → `Order.id` | |
| `customerId` | `TEXT` | FK → `User.id` | |
| `orderItemId` | `TEXT` | FK → `OrderItem.id` | |
| `comments` | `TEXT` | nullable | |
| `packagingRating` | `FLOAT` | nullable | 1–5 |
| `qualityRating` | `FLOAT` | nullable | 1–5 |
| `quantityRating` | `FLOAT` | nullable | 1–5 |
| `deliveryRating` | `FLOAT` | nullable | 1–5 |
| `itemDescribedRating` | `FLOAT` | nullable | 1–5 |
| `overallRating` | `FLOAT` | NOT NULL | 1–5 |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

---

### OrderChange

Audit log of order status changes and pickup rescheduling proposals.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `orderId` | `TEXT` | FK → `Order.id` | |
| `orderItemId` | `TEXT` | nullable FK → `OrderItem.id` | |
| `changedBy` | `TEXT` | NOT NULL | `"customer"` \| `"seller"` |
| `previousStatus` | `TEXT` | NOT NULL | |
| `newStatus` | `TEXT` | NOT NULL | |
| `proposedPickupDate` | `TEXT` | nullable | |
| `proposedPickupTime` | `TEXT` | nullable | |
| `reason` | `TEXT` | nullable | |
| `comments` | `TEXT` | nullable | |
| `createdAt` | `TIMESTAMP` | default `now()` | |

---

### OrderDeliveryStatus

Delivery / fulfillment status timeline per order (and optionally per item).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `orderId` | `TEXT` | FK → `Order.id` | |
| `orderItemId` | `TEXT` | nullable FK → `OrderItem.id` | |
| `status` | `TEXT` | NOT NULL | `IN_PROGRESS` \| `READY_FOR_PICKUP` \| `COMPLETED` \| `CANCELLED` |
| `updatedBy` | `TEXT` | NOT NULL | `"seller"` \| `"system"` |
| `pickupAddress` | `TEXT` | nullable | |
| `pickupTimeWindow` | `TEXT` | nullable | |
| `comments` | `TEXT` | nullable | |
| `createdAt` | `TIMESTAMP` | default `now()` | |

---

### Sample

Free samples offered by sellers, claimable by users.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `sellerId` | `TEXT` | FK → `Seller.id` | |
| `productId` | `TEXT` | nullable FK → `Product.id` | The product being sampled |
| `status` | `TEXT` | default `"available"` | `available` \| `claimed` \| `expired` |
| `pickupWindows` | `JSONB` | nullable | Array of available pickup windows |
| `expiresAt` | `TIMESTAMP` | nullable | |
| `claimedByUserId` | `TEXT` | nullable FK → `User.id` | |
| `claimedAt` | `TIMESTAMP` | nullable | |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

---

### Chat

Conversation thread between two users, optionally tied to an order.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `orderId` | `TEXT` | nullable FK → `Order.id` | |
| `participant1Id` | `TEXT` | FK → `User.id` | |
| `participant2Id` | `TEXT` | FK → `User.id` | |
| `lastMessageAt` | `TIMESTAMP` | nullable | Denormalized for sorting |
| `unreadCount1` | `INT` | default `0` | Unread count for participant1 |
| `unreadCount2` | `INT` | default `0` | Unread count for participant2 |
| `createdAt` | `TIMESTAMP` | default `now()` | |
| `updatedAt` | `TIMESTAMP` | auto-updated | |

**Unique:** `(participant1Id, participant2Id, orderId)` — prevents duplicate chats for the same pair + order.  
**Relations:** `Message[]`

---

### Message

Individual messages within a chat thread.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` (UUID) | PK | |
| `chatId` | `TEXT` | FK → `Chat.id` | |
| `senderId` | `TEXT` | FK → `User.id` | |
| `content` | `TEXT` | nullable | Text body; null for image-only messages |
| `imageUrl` | `TEXT` | nullable | |
| `type` | `TEXT` | default `"text"` | `text` \| `image` \| `sample_offer` |
| `readBy` | `TEXT[]` | | Array of `userId`s who have read this message |
| `createdAt` | `TIMESTAMP` | default `now()` | |

---

## Enum-like String Values

These columns use plain `TEXT` with application-enforced values (no PostgreSQL `ENUM` type).

| Table | Column | Allowed Values |
|---|---|---|
| `Seller` | `status` | `draft`, `review`, `submitted`, `active` |
| `Seller` | `serviceType` | `service`, `product` |
| `Seller` | `businessLicense` | `yes`, `no`, `not_required` |
| `Order` | `status` | `pending`, `confirmed`, `in_progress`, `ready_for_pickup`, `completed`, `cancelled` |
| `Order` | `reviewStatus` | `pending`, `partial`, `completed` |
| `OrderItem` | `reviewStatus` | `pending`, `completed` |
| `OrderDeliveryStatus` | `status` | `IN_PROGRESS`, `READY_FOR_PICKUP`, `COMPLETED`, `CANCELLED` |
| `OrderDeliveryStatus` | `updatedBy` | `seller`, `system` |
| `OrderChange` | `changedBy` | `customer`, `seller` |
| `Sample` | `status` | `available`, `claimed`, `expired` |
| `SellerAddress` | `type` | `business`, `pickup` |
| `SellerMedia` | `entityType` | `seller_avatar`, `seller_cover`, `seller_work_photo`, `product` |
| `Message` | `type` | `text`, `image`, `sample_offer` |
| `SellerBusinessHours` | `dayCode` | `M`, `U`, `W`, `T`, `F`, `S`, `X` |

---

## Key Indexes & Constraints

| Table | Index / Constraint | Columns | Purpose |
|---|---|---|---|
| `User` | UNIQUE | `email` | Login uniqueness |
| `User` | UNIQUE | `googleUid` | OAuth uniqueness |
| `User` | UNIQUE | `emailVerificationToken` | Token collision prevention |
| `Seller` | INDEX | `(latitude, longitude)` | Geo-radius queries |
| `Seller` | UNIQUE (via `userId`) | `userId` | 1:1 with User |
| `SellerMedia` | INDEX | `(sellerId, entityType)` | Fast media lookup by type |
| `SellerMedia` | INDEX | `entityId` | Fast product media lookup |
| `SellerAddress` | INDEX | `(sellerId, type)` | Fetch business/pickup addresses |
| `SellerBusinessHours` | UNIQUE | `(sellerId, dayCode)` | One row per seller per day |
| `SellerFeature` | UNIQUE | `(sellerId, featureKey)` | One config row per feature |
| `Order` | UNIQUE | `orderNumber` | Human-readable reference |
| `Chat` | UNIQUE | `(participant1Id, participant2Id, orderId)` | No duplicate threads |
