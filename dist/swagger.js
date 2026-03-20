"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swaggerSpec = void 0;
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Loopa Hyperlocal Marketplace API',
            version: '1.0.0',
            description: 'REST API documentation for the Loopa hyperlocal marketplace backend, featuring Makers/Sellers, Products, and per-seller Carts.',
            contact: {
                name: 'Loopa Developers',
            },
        },
        servers: [
            {
                url: 'http://localhost:4000',
                description: 'Local development server',
            },
        ],
    },
    // We point to where the JSDoc comments will be located
    apis: ['./src/routes/*.ts', './src/index.ts', './src/swagger.ts'],
};
exports.swaggerSpec = (0, swagger_jsdoc_1.default)(swaggerOptions);
