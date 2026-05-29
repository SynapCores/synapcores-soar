/**
 * MCP examiner-portal endpoint.
 *
 * Speaks JSON-RPC 2.0 over POST. Three methods we implement:
 *   - initialize    → returns server capabilities
 *   - tools/list    → returns the SOAR MCP tool catalog
 *   - tools/call    → executes a tool, returns the JSON result
 *
 * Auth: Authorization: Bearer mcp_... — looked up against
 * mcp_tokens. Tenant + scope are bound at token mint.
 *
 * Every tools/call writes to soar_audit_log (actor_type='mcp_token').
 */

import { resolveMcpToken } from '@/lib/mcp/auth';
import { findTool, SOAR_MCP_TOOLS, auditMcpCall } from '@/lib/mcp/tools';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, data },
    },
    { status: 200 },
  );
}

function rpcOk(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const resolved = await resolveMcpToken(token);
  if (!resolved) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body.id ?? null, -32600, 'Invalid Request');
  }

  switch (body.method) {
    case 'initialize':
      return rpcOk(body.id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'synapcores-soar',
          version: '0.1.0',
        },
      });

    case 'tools/list':
      return rpcOk(body.id, {
        tools: SOAR_MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = typeof params.name === 'string' ? findTool(params.name) : null;
      if (!tool) {
        return rpcError(body.id, -32602, `Unknown tool: ${params.name}`);
      }
      const args = params.arguments ?? {};
      const start = Date.now();
      try {
        const out = await tool.exec(args, {
          tenantId: resolved.tenantId,
          tokenId: resolved.tokenId,
          auditorLabel: resolved.label,
        });
        await auditMcpCall({
          tenantId: resolved.tenantId,
          tokenId: resolved.tokenId,
          auditorLabel: resolved.label,
          toolName: tool.name,
          args,
          ok: true,
          durationMs: Date.now() - start,
        });
        return rpcOk(body.id, {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        });
      } catch (err) {
        await auditMcpCall({
          tenantId: resolved.tenantId,
          tokenId: resolved.tokenId,
          auditorLabel: resolved.label,
          toolName: tool.name,
          args,
          ok: false,
          durationMs: Date.now() - start,
        });
        return rpcError(body.id, -32603, 'Tool execution failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    case 'ping':
      return rpcOk(body.id, {});

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}
