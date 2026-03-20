import 'dotenv/config';
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

import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

const startServer = async () => {
    const app = express();

    // Core middleware
    app.use(cors());
    app.use(express.json());

    // REST Routes
    app.use('/ping', pingRouter);
    app.use('/seller', sellerRouter);
    app.use('/product', productRouter);
    app.use('/api/orders', orderRouter);
    app.use('/api', sellerOrdersRouter);
    app.use('/auth', authRouter);
    app.use('/business', businessRouter);

    // Swagger UI
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    const server = new ApolloServer({
        typeDefs,
        resolvers,
    });

    await server.start();

    app.use(
        '/graphql',
        expressMiddleware(server, {
            context: async ({ req }: { req: express.Request }) => context({ req }),
        })
    );

    const port = process.env.PORT || 4000;
    app.listen(port, () => {
        console.log(`🚀 REST Server ready at: http://localhost:${port}/ping`);
        console.log(`🚀 GraphQL Server ready at: http://localhost:${port}/graphql`);
    });
};

startServer();
