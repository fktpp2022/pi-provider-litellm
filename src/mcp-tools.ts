import type { Static, TSchema } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { normalizeBaseUrl } from "./discover.js";
import type { LiteLLMMcpTool } from "./types.js";

const LIST_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;

function withTimeout(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export async function discoverMcpTools(baseUrl: string, apiKey: string): Promise<LiteLLMMcpTool[]> {
  const { signal, cancel } = withTimeout(LIST_TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/mcp-rest/tools/list`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal,
    });
    if (!response.ok) return [];
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as LiteLLMMcpTool[]) : [];
  } catch {
    return [];
  } finally {
    cancel();
  }
}

export async function executeMcpTool(
  baseUrl: string,
  apiKey: string,
  server: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { signal, cancel } = withTimeout(CALL_TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/mcp-rest/tools/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ server, tool: toolName, args }),
      signal,
    });
    if (!response.ok) return `Error calling ${toolName} on ${server}: HTTP ${response.status}`;
    const body = (await response.json()) as Record<string, unknown>;
    return JSON.stringify("result" in body ? body.result : body, null, 2);
  } catch (error) {
    return `Error calling ${toolName} on ${server}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    cancel();
  }
}

function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "tool";
}

function isMappableSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const schema = value as Record<string, unknown>;
  if ("$ref" in schema || "anyOf" in schema || "oneOf" in schema || "allOf" in schema) return false;
  if (["string", "number", "integer", "boolean"].includes(String(schema.type))) return true;
  if (schema.type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return items?.type === "string";
  }
  return false;
}

function mapPropertySchema(name: string, schema: Record<string, unknown>): TSchema {
  const description = typeof schema.description === "string" ? schema.description : name;
  switch (schema.type) {
    case "string":
      return Type.String({ description });
    case "number":
      return Type.Number({ description });
    case "integer":
      return Type.Integer({ description });
    case "boolean":
      return Type.Boolean({ description });
    case "array":
      return Type.Array(Type.String(), { description });
    default:
      return Type.Unknown({ description });
  }
}

function buildParameters(inputSchema: Record<string, unknown>): TSchema {
  const properties = inputSchema.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== "object") {
    return Type.Object({
      args: Type.Record(Type.String(), Type.Unknown(), { description: "Tool arguments as key-value pairs" }),
    });
  }

  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((key) => typeof key === "string")
    : [];
  const mapped: Record<string, TSchema> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (!isMappableSchema(property)) {
      return Type.Object({
        args: Type.Record(Type.String(), Type.Unknown(), { description: "Tool arguments as key-value pairs" }),
      });
    }
    const field = mapPropertySchema(key, property);
    mapped[key] = required.includes(key) ? field : Type.Optional(field);
  }

  return Type.Object(mapped);
}

export async function createMcpToolDefinitions(
  baseUrl: string,
  getApiKey: () => Promise<string>,
): Promise<ToolDefinition[]> {
  const discoveryApiKey = await getApiKey();
  const tools = await discoverMcpTools(baseUrl, discoveryApiKey);

  return tools.map((mcpTool) => {
    const safeServer = sanitizeName(mcpTool.server_name);
    const safeTool = sanitizeName(mcpTool.name);
    const parameters = buildParameters(mcpTool.input_schema);

    return defineTool({
      name: `mcp_${safeServer}_${safeTool}`,
      label: `${mcpTool.server_name}: ${mcpTool.name}`,
      description: `${mcpTool.description} (via ${mcpTool.server_name} MCP server)`,
      promptSnippet: `${mcpTool.description} via ${mcpTool.server_name} MCP server`,
      parameters,
      async execute(_toolCallId, params: Static<typeof parameters>) {
        const apiKey = await getApiKey();
        const rawParams = params as Record<string, unknown>;
        const args =
          Object.keys(rawParams).length === 1 && rawParams.args && typeof rawParams.args === "object"
            ? (rawParams.args as Record<string, unknown>)
            : rawParams;
        const text = await executeMcpTool(baseUrl, apiKey, mcpTool.server_name, mcpTool.name, args);
        return {
          content: [{ type: "text", text }],
          details: { server: mcpTool.server_name, tool: mcpTool.name },
        };
      },
    });
  });
}
