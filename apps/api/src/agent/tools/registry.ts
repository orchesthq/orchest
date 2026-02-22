import { z } from "zod";

export type ToolContext = {
  taskId: string;
  clientId: string;
  agentId: string;
};

export type ToolResult = {
  ok: boolean;
  message: string;
  metadata?: Record<string, unknown>;
};

export type RegisteredTool<TArgs extends z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: TArgs;
  execute: (ctx: ToolContext, args: z.infer<TArgs>) => Promise<ToolResult>;
};

export type OpenAiToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function zodToJsonSchema(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const isOptional = v instanceof z.ZodOptional || v instanceof z.ZodDefault;
      const inner = v instanceof z.ZodOptional ? v._def.innerType : v;
      properties[k] = zodToJsonSchema(inner as any);
      if (!isOptional) required.push(k);
    }
    return {
      type: "object",
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodNativeEnum) return { type: "string", enum: Object.values(schema.enum) };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap());
    return { anyOf: [inner, { type: "null" }] };
  }

  // Fallback: accept anything (still validated via Zod at runtime).
  return {};
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool<any>>();

  register<TArgs extends z.ZodTypeAny>(tool: RegisteredTool<TArgs>): void {
    if (!tool.name) throw new Error("Tool name is required");
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as RegisteredTool<any>);
  }

  list(): Array<RegisteredTool<any>> {
    return Array.from(this.tools.values());
  }

  toOpenAiTools(): OpenAiToolDef[] {
    return this.list().map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema),
      },
    }));
  }

  async execute(input: {
    ctx: ToolContext;
    name: string;
    args: unknown;
  }): Promise<ToolResult> {
    const tool = this.tools.get(input.name);
    if (!tool) {
      return { ok: false, message: `Unknown tool: ${input.name}` };
    }
    const parsed = tool.inputSchema.safeParse(input.args);
    if (!parsed.success) {
      return {
        ok: false,
        message: `Invalid arguments for ${tool.name}: ${parsed.error.message}`,
      };
    }
    return await tool.execute(input.ctx, parsed.data);
  }
}

