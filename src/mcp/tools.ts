import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { InternalApiCaller, InternalApiResult } from './internalApiClient';

function toToolResult(result: InternalApiResult): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result.body ?? {}, null, 2),
      },
    ],
    isError: result.status >= 400,
  };
}

const businessHoursShape = z
  .object({
    weekOfDays: z.string().describe('Day codes, e.g. "MUWTFSX" (M,U,W,T,F,S,X = Mon..Sun)'),
    startTime: z.string().describe('e.g. "10:00"'),
    endTime: z.string().describe('e.g. "19:00"'),
  })
  .optional();

const featuresShape = z
  .record(z.string(), z.object({ enable: z.boolean() }).passthrough())
  .optional()
  .describe(
    'Map of featureKey -> { enable, ...config }, e.g. { "sampling": { "enable": true, "weekly_sample": 10 } }',
  );

const licenseShape = z.enum(['yes', 'no', 'not_required']).optional();
const deliveryShape = z.object({ available: z.boolean(), radiusMiles: z.number().optional() }).optional();
const samplingShape = z.object({ available: z.boolean(), samplesPerMonth: z.number().optional() }).optional();

/**
 * Registers MCP tools that wrap the business-onboarding REST endpoints
 * (/business/*, /api/businesses/*) via a loopback call to the same Express app.
 * File-upload-only endpoints (avatar/work-photos multipart routes) are intentionally
 * not exposed here — their JSON equivalents (`avatar` / `workPhotos` as base64 or URL
 * strings) are already covered by create_business, update_business_details, and
 * update_business.
 */
export function registerBusinessTools(server: McpServer, callInternalApi: InternalApiCaller): void {
  server.registerTool(
    'create_business_draft',
    {
      title: 'Create business draft (legacy wizard)',
      description: 'Creates a new seller/business profile in draft status for an existing user (POST /business).',
      inputSchema: {
        userId: z.string().describe('Existing User ID that will own this business'),
        name: z.string().min(1),
        serviceType: z.enum(['service', 'product']).optional(),
        description: z.string().min(1),
      },
    },
    async (input) => toToolResult(await callInternalApi('POST', '/business', input)),
  );

  server.registerTool(
    'update_business_section2',
    {
      title: 'Update business wizard section 2 (legacy)',
      description:
        'Adds workPermit, business hours, and feature flags to a draft business, advancing it to review status (PUT /business/{id}/section2).',
      inputSchema: {
        id: z.string().describe('Business (seller) ID'),
        workPermit: z.boolean().optional(),
        business_hours: businessHoursShape,
        features: featuresShape,
      },
    },
    async ({ id, ...body }) => toToolResult(await callInternalApi('PUT', `/business/${id}/section2`, body)),
  );

  server.registerTool(
    'update_business_section3',
    {
      title: 'Submit business wizard section 3 (legacy)',
      description:
        'Final review step for the legacy wizard; advances the business to submitted status (PUT /business/{id}/section3).',
      inputSchema: {
        id: z.string().describe('Business (seller) ID'),
        workPermit: z.boolean().optional(),
        business_hours: businessHoursShape,
        features: featuresShape,
      },
    },
    async ({ id, ...body }) => toToolResult(await callInternalApi('PUT', `/business/${id}/section3`, body)),
  );

  server.registerTool(
    'create_business',
    {
      title: 'Create business (unclaimed)',
      description:
        'Creates a new unclaimed business with no user attached (POST /api/businesses via API key auth). A real user can later claim it in the app.',
      inputSchema: {
        name: z.string().min(1),
        tagline: z.string().optional(),
        location: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipcode: z.string().optional(),
        serviceType: z.enum(['service', 'product']).optional(),
        categories: z.array(z.string()).optional(),
        avatar: z.string().optional().describe('Base64 data URL or https URL for the avatar image'),
        contactEmail: z.string().email().optional().describe('Contact email for outreach on this unclaimed business'),
      },
    },
    async (input) => toToolResult(await callInternalApi('POST', '/api/businesses', input)),
  );

  server.registerTool(
    'get_business',
    {
      title: 'Get business profile',
      description: 'Fetches the full business profile by ID (GET /api/businesses/{id}).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => toToolResult(await callInternalApi('GET', `/api/businesses/${id}`)),
  );

  server.registerTool(
    'update_business_details',
    {
      title: 'Update business trust & details',
      description:
        'Adds bio, work photos, delivery/sampling settings, and license info (PATCH /api/businesses/{id}/details).',
      inputSchema: {
        id: z.string(),
        bio: z.string().optional(),
        workPhotos: z.array(z.string()).optional().describe('Base64 data URLs or https URLs'),
        businessLicense: licenseShape,
        delivery: deliveryShape,
        sampling: samplingShape,
        orderCapDollars: z.number().optional(),
      },
    },
    async ({ id, ...body }) => toToolResult(await callInternalApi('PATCH', `/api/businesses/${id}/details`, body)),
  );

  server.registerTool(
    'publish_business',
    {
      title: 'Publish business',
      description:
        'Transitions a business from draft to active, validating required fields (POST /api/businesses/{id}/publish).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => toToolResult(await callInternalApi('POST', `/api/businesses/${id}/publish`)),
  );

  server.registerTool(
    'update_business',
    {
      title: 'Partially update business (save & continue later)',
      description: 'Accepts any subset of business fields for a partial update (PATCH /api/businesses/{id}).',
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        tagline: z.string().optional(),
        location: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipcode: z.string().optional(),
        serviceType: z.enum(['service', 'product']).optional(),
        categories: z.array(z.string()).optional(),
        avatar: z.string().optional(),
        bio: z.string().optional(),
        workPhotos: z.array(z.string()).optional(),
        businessLicense: licenseShape,
        delivery: deliveryShape,
        sampling: samplingShape,
        orderCapDollars: z.number().optional(),
      },
    },
    async ({ id, ...body }) => toToolResult(await callInternalApi('PATCH', `/api/businesses/${id}`, body)),
  );
}
