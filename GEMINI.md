# GEMINI Instructions

This file provides guidance to Gemini (or any AI assistant) when working with code in this repository.

## Repository Overview
Loopa Backend is a Node.js API server built with Express and Prisma, using a PostgreSQL database for the marketplace backend.

## Constraints
- TypeScript must be used for all development.
- Adhere to the existing ESLint and Prettier configurations.
- Do not bypass Prisma for database access.

## Repository Structure
- `src/` - Contains all source code.
  - `routes/` - Express route handlers.
  - `resolvers/` - GraphQL resolvers.
  - `middleware/` - Express middlewares (e.g. auth).
- `prisma/` - Prisma schema and migrations.

## Testing Actions
- **Clear name and description**: Ensure any tests written or described have a clear name and concise description.
- Use the configured testing framework in the repository.

## Security Considerations
- Never log sensitive information (tokens, passwords, PII).
- Always validate and sanitize user input.
- Use `authenticateToken` middleware for protected routes.

## Key Action Details
- **Forces new deployments**: When modifying GitHub Actions or ECS Tasks, be aware of what triggers new deployments.
- **Common Development Commands**:
  - `npm run dev`: Start the local development server using `ts-node-dev`.
  - `npx prisma generate`: Update Prisma Client after schema changes.
  - `npx prisma db push`: Push schema changes to the local development database.

**IMPORTANT:** Always use official AWS actions for ECS deployments instead of manual `jq` manipulation of task definitions.

## Implementation Notes
- **Idempotency**: Ensure scripts and actions can be safely run multiple times.
- **Outputs**: Properly define action outputs.
- **Informative logging**: Use clear step names and `echo` statements in workflows.
- **Timeouts**: Always include timeouts to prevent hanging workflows.
- **Fail fast**: Validate inputs and fail early with clear messages.
- **Use GitHub Actions expressions**: Leverage expressions instead of complex bash scripting where possible.
- **Environment variables**: Use consistently across all actions.

## Documentation Requirements
- **Quick start guide**: Keep it updated in `README.md`.
- **Versioning strategy**: Follow the project's strategy for API and package versioning.
- **Links to individual action READMEs**: Maintain links to any custom actions.
- **Always update GEMINI.md**: When new rules, infrastructure patterns, or uses are added.
- **Generate code that is readable and easy to use**: Clear, simple documentation; be concise.
- **Infrastructure Code Review**: Always use the infrastructure code review process to check your changes and approach.
