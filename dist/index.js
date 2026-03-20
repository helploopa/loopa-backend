"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const server_1 = require("@apollo/server");
const express5_1 = require("@as-integrations/express5");
const typeDefs_1 = require("./schema/typeDefs");
const resolvers_1 = require("./resolvers");
const context_1 = require("./context");
const ping_1 = __importDefault(require("./routes/ping"));
const seller_1 = __importDefault(require("./routes/seller"));
const product_1 = __importDefault(require("./routes/product"));
const order_1 = __importDefault(require("./routes/order"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./swagger");
const startServer = async () => {
    const app = (0, express_1.default)();
    // Core middleware
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    // REST Routes
    app.use('/ping', ping_1.default);
    app.use('/seller', seller_1.default);
    app.use('/product', product_1.default);
    app.use('/api/orders', order_1.default);
    // Swagger UI
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec));
    const server = new server_1.ApolloServer({
        typeDefs: typeDefs_1.typeDefs,
        resolvers: resolvers_1.resolvers,
    });
    await server.start();
    app.use('/graphql', (0, express5_1.expressMiddleware)(server, {
        context: async ({ req }) => (0, context_1.context)({ req }),
    }));
    const port = process.env.PORT || 4000;
    app.listen(port, () => {
        console.log(`🚀 REST Server ready at: http://localhost:${port}/ping`);
        console.log(`🚀 GraphQL Server ready at: http://localhost:${port}/graphql`);
    });
};
startServer();
