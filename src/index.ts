import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { typeDefs } from './schema/typeDefs';
import { resolvers } from './resolvers';
import { context } from './context';
import pingRouter from './routes/ping';
import sellerRouter from './routes/seller';
import productRouter from './routes/product';
import orderRouter from './routes/order';
import sellerOrdersRouter from './routes/sellerOrders';
import authRouter from './routes/auth';
import businessRouter from './routes/business';
import makerHubRouter from './routes/makerHub';
import chatRouter from './routes/chat';
import businessApiRouter from './routes/businessApi';
import mediaRouter from './routes/media';
import { initSocketIO } from './services/socketService';

import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

const startServer = async () => {
    const app = express();

    // Core middleware
    app.use(cors());
    app.use(express.json());

    // Serve media files from the external volume (local dev) or CDN root (production)
    const mediaRoot = process.env.MEDIA_ROOT ?? '/Users/sarathbabu/Documents/personal/projects/loopa-volume';
    app.use('/media', express.static(mediaRoot));

    // REST Routes
    app.use('/ping', pingRouter);
    app.use('/seller', sellerRouter);
    app.use('/product', productRouter);
    app.use('/api/orders', orderRouter);
    app.use('/api', sellerOrdersRouter);
    app.use('/auth', authRouter);
    app.use('/business', businessRouter);
    app.use('/api/sellers', makerHubRouter);
    app.use('/api/chats', chatRouter);
    app.use('/api/users/me', chatRouter); // push-token endpoint lives on chatRouter
    app.use('/api/businesses', businessApiRouter);
    app.use('/api/media', mediaRouter);

    // Swagger UI
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    const apolloServer = new ApolloServer({
        typeDefs,
        resolvers,
    });

    await apolloServer.start();

    app.use(
        '/graphql',
        expressMiddleware(apolloServer, {
            context: async ({ req }: { req: express.Request }) => context({ req }),
        })
    );

    // Create HTTP server and attach Socket.io
    const httpServer = http.createServer(app);
    initSocketIO(httpServer);

    const port = process.env.PORT || 4000;
    httpServer.listen(port, () => {
        console.log(`🚀 REST Server ready at: http://localhost:${port}/ping`);
        console.log(`🚀 GraphQL Server ready at: http://localhost:${port}/graphql`);
    });
};

startServer();
