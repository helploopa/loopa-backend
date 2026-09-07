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
import addressRouter from './routes/address';
import userRouter from './routes/user';
import businessReferralRouter from './routes/businessReferral';

import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

export const app = express();

const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:3000',
  'http://localhost:19000',
  'http://localhost:19006',
  'http://localhost:5173',
  ...(process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? []),
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (native mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // Allow all origins when CORS_ALLOW_ALL is set (Vercel/production deployments)
    if (process.env.CORS_ALLOW_ALL === 'true') return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Reject without throwing: passing an Error here propagates as an
    // unhandled Express error (no error handler is registered), producing
    // a 500 instead of a clean CORS rejection.
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};

// Handle OPTIONS preflight for every route before any auth middleware
app.options('/{*path}', cors(corsOptions));
app.use(cors(corsOptions));
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
app.use('/api/users/me', userRouter);
app.use('/api/businesses', businessApiRouter);
app.use('/api/media', mediaRouter);
app.use('/api/addresses', addressRouter);
app.use('/api/business-referrals', businessReferralRouter);

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.0/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.0/swagger-ui-standalone-preset.js',
    ],
  })
);

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

// Catch-all error handler: must be last, and must take 4 args for Express
// to recognize it as an error handler rather than regular middleware.
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
