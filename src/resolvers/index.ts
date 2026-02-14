const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 3958.8; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const mapProduct = (product: any, latitude: number, longitude: number) => {
    const distance = calculateDistance(latitude, longitude, product.seller.latitude, product.seller.longitude);
    return {
        ...product,
        isFavorite: false, // Placeholder
        primaryImage: product.primaryImage || product.imageUrl,
        images: product.images || (product.imageUrl ? [product.imageUrl] : []),
        quantityAvailable: product.quantityAvailable, // Already in DB
        quantityLeft: product.quantityLeft, // Keeping for compatibility
        // Map pickupWindows from JSON or fallback to seller defaults
        pickupWindows: product.pickupWindows ? product.pickupWindows : (product.seller.pickupDays ? [{
            days: product.seller.pickupDays,
            startTime: product.seller.pickupStartTime,
            endTime: product.seller.pickupEndTime,
            formatted: `${product.seller.pickupDays} ${product.seller.pickupStartTime} - ${product.seller.pickupEndTime}`
        }] : []),
        // Map pickupLocation from JSON or fallback to seller location
        pickupLocation: product.pickupLocation ? product.pickupLocation : {
            address: "88 Oak Ave, Willow Creek", // Placeholder address if not stored
            latitude: product.seller.latitude,
            longitude: product.seller.longitude,
            distanceMiles: parseFloat(distance.toFixed(1)),
            isExact: false
        },
        makerId: product.seller.id, // Mapping sellerId to makerId as requested
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        seller: {
            ...product.seller,
            distanceMiles: parseFloat(distance.toFixed(1))
        }
    };
};

export const resolvers = {
    Query: {
        users: async (_parent: any, _args: any, context: any) => {
            return context.prisma.user.findMany();
        },
        nearbyProducts: async (_parent: any, args: { location: any; category?: string }, context: any) => {
            const { latitude, longitude, radius_miles } = args.location;
            const { category } = args;

            // Build filter object
            const whereClause: any = {};
            // If category is provided and not "all" (case insensitive), filter by it
            if (category && category.toLowerCase() !== 'all') {
                whereClause.category = {
                    equals: category,
                    mode: 'insensitive', // Case-insensitive matching
                };
            }

            // In a real app, we would filter by distance using PostGIS here.
            // For now, fetch all and calculate distance in memory (suitable for demo dataset).
            const products = await context.prisma.product.findMany({
                where: whereClause,
                include: { seller: true }
            });

            return products.map((product: any) => mapProduct(product, latitude, longitude)).filter((p: any) => {
                // Optional: Filter by radius here if we want to simulate the "nearby" behavior strictly
                return p.seller.distanceMiles <= (radius_miles || 10000);
            });
        },
        categories: async (_parent: any, _args: any, context: any) => {
            return context.prisma.category.findMany();
        },
        product: async (_parent: any, args: { id: string }, context: any) => {
            const product = await context.prisma.product.findUnique({
                where: { id: args.id },
                include: { seller: true }
            });

            if (!product) return null;
            // For single product, we might need user's location to calculate distance. 
            // If not provided, we can pass 0,0 or handle it gracefully. 
            // For now, let's assume 0,0 or null distance if location context is missing.
            // Ideally, we'd pass location context or just use seller location as base.
            return mapProduct(product, product.seller.latitude, product.seller.longitude); // Sets distance to 0
        },
        order: async (_parent: any, args: { id: string }, context: any) => {
            const order = await context.prisma.order.findUnique({
                where: { id: args.id },
                include: {
                    customer: true,
                    items: {
                        include: {
                            product: {
                                include: { seller: true }
                            }
                        }
                    }
                }
            });

            if (!order) return null;

            const firstName = order.customer.name?.split(' ')[0] || 'Customer';

            return {
                id: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                createdAt: order.createdAt.toISOString(),
                totalAmount: order.totalAmount,
                currency: order.currency,
                customer: {
                    firstName,
                    greetingName: firstName
                },
                items: order.items.map((item: any) => ({
                    productId: item.productId,
                    title: item.product.title,
                    seller: {
                        id: item.product.seller.id,
                        name: item.product.seller.name,
                        firstName: item.product.seller.name.split(' ')[0] || 'Seller',
                        personalMessage: `${item.product.seller.name.split(' ')[0]} is already preparing your ${item.product.title}.`
                    },
                    price: item.price,
                    quantity: item.quantity,
                    pickup: item.pickupData || {}
                })),
                pickupSummary: {
                    location: order.items[0]?.pickupData?.location?.address || "124 Maple St, Willow Creek",
                    time: order.items[0]?.pickupData?.window?.formatted || "Sat 2:00 PM - 4:00 PM"
                }
            };
        },
        availableSampleSellers: async (_parent: any, args: { orderId: string }, context: any) => {
            // Fetch the order to get customer location context
            const order = await context.prisma.order.findUnique({
                where: { id: args.orderId },
                include: {
                    customer: true,
                    items: {
                        include: {
                            product: {
                                include: { seller: true }
                            }
                        }
                    }
                }
            });

            if (!order) throw new Error('Order not found');

            // Get the seller IDs from the order to exclude them
            const orderSellerIds = order.items.map((item: any) => item.product.seller.id);

            // Fetch available samples from sellers (excluding order sellers)
            const samples = await context.prisma.sample.findMany({
                where: {
                    status: 'available',
                    sellerId: {
                        notIn: orderSellerIds
                    }
                },
                include: {
                    seller: true,
                    product: true
                }
            });

            // Use first order item's seller location as reference for distance calculation
            const refLat = order.items[0]?.product?.seller?.latitude || 40.94;
            const refLng = order.items[0]?.product?.seller?.longitude || -123.63;

            // Format sample sellers
            const sellers = samples.map((sample: any) => {
                const distance = calculateDistance(refLat, refLng, sample.seller.latitude, sample.seller.longitude);

                // Parse pickup windows from JSON or use defaults
                const pickupWindows = sample.pickupWindows || [
                    {
                        id: "win_1",
                        day: "Tomorrow",
                        startTime: "15:00",
                        endTime: "17:00",
                        formatted: "Tomorrow 3:00–5:00 PM",
                        available: true
                    },
                    {
                        id: "win_2",
                        day: "Sat",
                        startTime: "10:00",
                        endTime: "12:00",
                        formatted: "Sat 10:00 AM–12:00 PM",
                        available: true
                    },
                    {
                        id: "win_3",
                        day: "Sun",
                        startTime: "16:00",
                        endTime: "18:00",
                        formatted: "Sun 4:00–6:00 PM",
                        available: true
                    }
                ];

                return {
                    id: sample.seller.id,
                    name: sample.seller.name,
                    avatarUrl: `https://cdn.loopa.app/avatars/${sample.seller.name.toLowerCase().replace(/\s+/g, '')}.jpg`,
                    rating: 4.9, // Placeholder - would come from reviews
                    reviewCount: 124, // Placeholder
                    distanceMiles: parseFloat(distance.toFixed(1)),
                    disclaimer: "This is a complimentary sample. Loopa does not take responsibility for product quality, ingredients, allergens, or safety. Please review details carefully before claiming.",
                    pickupWindows
                };
            });

            return {
                status: 'available',
                eligibility: {
                    orderId: order.id,
                    claimLimit: 1,
                    expiresIn: '48 hours'
                },
                sellers
            };
        },
    },
    Mutation: {
        createCategory: async (_parent: any, args: { label: string; icon: string; isActive?: boolean; count?: number }, context: any) => {
            return context.prisma.category.create({
                data: {
                    label: args.label,
                    icon: args.icon,
                    isActive: args.isActive ?? true,
                    count: args.count ?? 0,
                },
            });
        },
        updateProduct: async (_parent: any, args: { id: string; input: any }, context: any) => {
            const updatedProduct = await context.prisma.product.update({
                where: { id: args.id },
                data: args.input,
                include: { seller: true }
            });
            return mapProduct(updatedProduct, updatedProduct.seller.latitude, updatedProduct.seller.longitude);
        },
        createOrder: async (_parent: any, args: { input: { customerId: string; items: Array<{ productId: string; quantity: number }> } }, context: any) => {
            const { customerId, items } = args.input;

            // Fetch customer and products
            const customer = await context.prisma.user.findUnique({ where: { id: customerId } });
            if (!customer) throw new Error('Customer not found');

            // Fetch all products with sellers
            const productIds = items.map((item: any) => item.productId);
            const products = await context.prisma.product.findMany({
                where: { id: { in: productIds } },
                include: { seller: true }
            });

            // Calculate total
            const totalAmount = items.reduce((sum: number, item: any) => {
                const product = products.find((p: any) => p.id === item.productId);
                return sum + (product ? product.price * item.quantity : 0);
            }, 0);

            // Generate order number
            const orderNumber = `LPA-${Math.floor(1000 + Math.random() * 9000)}`;

            // Create order
            const order = await context.prisma.order.create({
                data: {
                    orderNumber,
                    totalAmount,
                    customerId,
                    items: {
                        create: items.map((item: any) => {
                            const product = products.find((p: any) => p.id === item.productId);
                            return {
                                productId: item.productId,
                                quantity: item.quantity,
                                price: product?.price || 0,
                                pickupData: product ? {
                                    location: product.pickupLocation || {
                                        address: "124 Maple St, Willow Creek",
                                        city: "Willow Creek",
                                        distanceMiles: 0.7,
                                        coordinates: { lat: product.seller.latitude, lng: product.seller.longitude }
                                    },
                                    window: product.pickupWindows?.[0] || {
                                        day: "Sat",
                                        startTime: "14:00",
                                        endTime: "16:00",
                                        formatted: "Sat 2:00 PM - 4:00 PM"
                                    }
                                } : null
                            };
                        })
                    }
                },
                include: {
                    customer: true,
                    items: {
                        include: {
                            product: {
                                include: { seller: true }
                            }
                        }
                    }
                }
            });

            // Format response
            const firstName = customer.name?.split(' ')[0] || 'Customer';

            return {
                status: 'success',
                message: 'Order placed successfully',
                order: {
                    id: order.id,
                    orderNumber: order.orderNumber,
                    status: order.status,
                    createdAt: order.createdAt.toISOString(),
                    totalAmount: order.totalAmount,
                    currency: order.currency,
                    customer: {
                        firstName,
                        greetingName: firstName
                    },
                    items: order.items.map((item: any) => ({
                        productId: item.productId,
                        title: item.product.title,
                        seller: {
                            id: item.product.seller.id,
                            name: item.product.seller.name,
                            firstName: item.product.seller.name.split(' ')[0] || 'Seller',
                            personalMessage: `${item.product.seller.name.split(' ')[0]} is already preparing your ${item.product.title}.`
                        },
                        price: item.price,
                        quantity: item.quantity,
                        pickup: item.pickupData || {}
                    })),
                    pickupSummary: {
                        location: order.items[0]?.pickupData?.location?.address || "124 Maple St, Willow Creek",
                        time: order.items[0]?.pickupData?.window?.formatted || "Sat 2:00 PM - 4:00 PM"
                    }
                },
                celebration: {
                    title: 'Success!'
                },
                freeSampleOffer: {
                    enabled: true,
                    title: 'A gift for you...',
                    description: 'Because you supported a local maker today, someone else in the neighborhood wants to share a little goodness with you.'
                }
            };
        },
        claimSample: async (_parent: any, args: { input: { orderId: string; sampleId: string; sellerId: string; pickupWindowId: string } }, context: any) => {
            const { orderId, sampleId, sellerId, pickupWindowId } = args.input;

            // Verify order exists
            const order = await context.prisma.order.findUnique({
                where: { id: orderId }
            });

            if (!order) {
                return {
                    success: false,
                    message: 'Order not found',
                    claimedSample: null
                };
            }

            // Fetch the sample
            const sample = await context.prisma.sample.findUnique({
                where: { id: sampleId }
            });

            if (!sample) {
                return {
                    success: false,
                    message: 'Sample not found',
                    claimedSample: null
                };
            }

            if (sample.status !== 'available') {
                return {
                    success: false,
                    message: 'Sample is no longer available',
                    claimedSample: null
                };
            }

            if (sample.sellerId !== sellerId) {
                return {
                    success: false,
                    message: 'Sample does not belong to the specified seller',
                    claimedSample: null
                };
            }

            // Update sample status to claimed
            const claimedSample = await context.prisma.sample.update({
                where: { id: sampleId },
                data: {
                    status: 'claimed',
                    claimedByUserId: order.customerId,
                    claimedAt: new Date()
                }
            });

            return {
                success: true,
                message: 'Sample claimed successfully!',
                claimedSample: {
                    id: claimedSample.id,
                    sellerId: claimedSample.sellerId,
                    productId: claimedSample.productId,
                    status: claimedSample.status,
                    claimedAt: claimedSample.claimedAt?.toISOString()
                }
            };
        }
    },
};
