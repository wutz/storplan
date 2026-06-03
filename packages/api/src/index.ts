import { planXEOS } from '@storplan/core';
import type { XEOSPlanRequest } from '@storplan/core';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/plan' && request.method === 'POST') {
      try {
        const body = await request.json() as { storage: string } & XEOSPlanRequest;

        if (!body.storage || !body.capacity) {
          return Response.json(
            { error: 'Missing required fields: storage, capacity' },
            { status: 400, headers: corsHeaders }
          );
        }

        if (body.storage !== 'xeos') {
          return Response.json(
            { error: `Unsupported storage type: ${body.storage}. Supported: xeos` },
            { status: 400, headers: corsHeaders }
          );
        }

        const result = planXEOS({
          capacity: body.capacity,
          uploadBandwidth: body.uploadBandwidth,
          downloadBandwidth: body.downloadBandwidth,
          uploadOps: body.uploadOps,
          downloadOps: body.downloadOps,
        });

        return Response.json(result, { headers: corsHeaders });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return Response.json({ error: message }, { status: 500, headers: corsHeaders });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  },
};
