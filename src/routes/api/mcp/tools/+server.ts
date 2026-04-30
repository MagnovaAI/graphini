import { listMcpTools } from '$lib/server/agents/tool-catalog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  return Response.json({
    tools: listMcpTools()
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const id =
    body && typeof body === 'object' && 'id' in body
      ? (body as { id?: string | number | null }).id
      : null;

  return Response.json({
    id,
    jsonrpc: '2.0',
    result: {
      tools: listMcpTools()
    }
  });
};
