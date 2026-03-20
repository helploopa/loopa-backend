import swaggerJSDoc, { Options } from 'swagger-jsdoc';

const swaggerOptions: Options = {
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
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
    },
    // We point to where the JSDoc comments will be located
    apis: ['./src/routes/*.ts', './src/index.ts', './src/swagger.ts'],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);
