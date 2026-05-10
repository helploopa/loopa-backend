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
import makerHubRouter from './routes/makerHub';
import chatRouter from './routes/chat';
import businessApiRouter from './routes/businessApi';
import mediaRouter from './routes/media';

import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

export const app = express();

app.use(cors());
app.use(express.json());

const mediaRoot = process.env.MEDIA_ROOT ?? '/uploads';
app.use('/media', express.static(mediaRoot));

app.use('/ping', pingRouter);
app.use('/seller', sellerRouter);
app.use('/product', productRouter);
app.use('/api/orders', orderRouter);
app.use('/api', sellerOrdersRouter);
app.use('/auth', authRouter);
app.use('/business', businessRouter);
app.use('/api/sellers', makerHubRouter);
app.use('/api/chats', chatRouter);
app.use('/api/users/me', chatRouter);
app.use('/api/businesses', businessApiRouter);
app.use('/api/media', mediaRouter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Apollo: lazy-start on first request (required for serverless)
const apolloServer = new ApolloServer({ typeDefs, resolvers });
let apolloStarted = false;

app.use('/graphql', async (req, res, next) => {
    if (!apolloStarted) {
        await apolloServer.start();
        apolloStarted = true;
    }
    return expressMiddleware(apolloServer, {
        context: async ({ req: r }) => context({ req: r }),
    })(req, res, next);
});

export default app;
