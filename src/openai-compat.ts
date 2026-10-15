import http from 'node:http';
import { type BackendConfig, type BackendProtocol } from './types.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue | undefined;
}
type ResponseAdapter = 'passthrough' | 'chat-to-responses' | 'anthropic-to-responses';

interface PreparedProxyRequest {
  path: string;
  body: string;
  responseAdapter: ResponseAdapter;
}

interface StreamMessageState {
  outputIndex: number;
  itemId: string;
  text: string;
  started: boolean;
  completed: boolean;
}

interface StreamFunctionCallState {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  started: boolean;
  completed: boolean;
}

interface StreamState {
  started: boolean;
  completed: boolean;
  responseId: string;
  model: string;
  createdAt: number;
  nextOutputIndex: number;
  message: StreamMessageState | null;
  functionCalls: Map<number, StreamFunctionCallState>;
}

function parseJsonObject(body: string): JsonObject {
  return JSON.parse(body) as JsonObject;
}

function maybeApplyDefaultModel(payload: JsonObject, backend: BackendConfig): JsonObject {
  const rawModel = typeof payload.model === 'string' ? payload.model : '';
  if (!backend.defaultModel) return payload;
  if (!rawModel) {
    payload.model = backend.defaultModel;
    return payload;
  }

  if (!backend.modelPattern) {
    if (rawModel !== backend.defaultModel) {
      payload.model = backend.defaultModel;
    }
    return payload;
  }

  try {
    const matches = new RegExp(backend.modelPattern).test(rawModel);
    if (!matches) {
      payload.model = backend.defaultModel;
    }
  } catch {
    if (rawModel !== backend.defaultModel) {
      payload.model = backend.defaultModel;
    }
  }

  return payload;
}

function isChatCompletionsPath(path: string): boolean {
  return path.includes('/chat/completions');
}

function isAnthropicMessagesPath(path: string): boolean {
  return path.includes('/messages');
}

function getCompatUpstreamProtocol(backend: BackendConfig): BackendProtocol {
  if (backend.upstreamProtocol) return backend.upstreamProtocol;
  if (backend.protocol) return backend.protocol;

  const path = backend.path ?? '';
  if (path.includes('/chat/completions')) return 'openai-chat';
  if (path.includes('/responses')) return 'openai-responses';
  return 'anthropic';
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function extractTextParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];

  const textParts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = record['type'];
    const text = record['text'];
    if (
      (type === 'input_text' || type === 'output_text' || type === 'text')
      && typeof text === 'string'
    ) {
      textParts.push(text);
    }
  }
  return textParts;
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  const textParts = extractTextParts(content);
  if (textParts.length > 0) return textParts.join('\n');
  return stringifyValue(content);
}

function mapToolChoice(toolChoice: unknown): JsonValue | undefined {
  if (typeof toolChoice === 'string') return toolChoice;
  if (!toolChoice || typeof toolChoice !== 'object') return undefined;

  const record = toolChoice as Record<string, unknown>;
  if (record['type'] !== 'function') return undefined;

  if (record['function'] && typeof record['function'] === 'object') {
    return {
      type: 'function',
      function: record['function'] as JsonObject,
    };
  }

  const name = typeof record['name'] === 'string' ? record['name'] : '';
  if (!name) return undefined;

  return {
    type: 'function',
    function: { name },
  };
}

function mapTools(tools: unknown): JsonValue[] | undefined {
  if (!Array.isArray(tools)) return undefined;

  const mapped = tools.flatMap((tool): JsonValue[] => {
    if (!tool || typeof tool !== 'object') return [];
    const record = tool as Record<string, unknown>;
    if (record['type'] !== 'function') return [];

    if (record['function'] && typeof record['function'] === 'object') {
      return [{
        type: 'function',
        function: record['function'] as JsonObject,
      }];
    }

    const name = typeof record['name'] === 'string' ? record['name'] : '';
    if (!name) return [];

    const mappedTool: JsonObject = {
      name,
    };

    if (typeof record['description'] === 'string') {
      mappedTool['description'] = record['description'];
    }
    if (record['parameters'] && typeof record['parameters'] === 'object') {
      mappedTool['parameters'] = record['parameters'] as JsonObject;
    }
    if (typeof record['strict'] === 'boolean') {
      mappedTool['strict'] = record['strict'];
    }

    return [{
      type: 'function',
      function: mappedTool,
    }];
  });

  return mapped.length > 0 ? mapped : undefined;
}

function mapFunctionCallToolMessage(record: Record<string, unknown>): JsonObject | null {
  const name = typeof record['name'] === 'string' ? record['name'] : '';
  if (!name) return null;

  const callId = typeof record['call_id'] === 'string'
    ? record['call_id']
    : (typeof record['id'] === 'string' ? record['id'] : `call_${Date.now()}`);

  return {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: callId,
      type: 'function',
      function: {
        name,
        arguments: stringifyValue(record['arguments'] ?? ''),
      },
    }],
  };
}

function mapFunctionCallOutputToolMessage(record: Record<string, unknown>): JsonObject | null {
  const callId = typeof record['call_id'] === 'string'
    ? record['call_id']
    : (typeof record['id'] === 'string' ? record['id'] : '');
  if (!callId) return null;

  return {
    role: 'tool',
    tool_call_id: callId,
    content: stringifyValue(record['output'] ?? ''),
  };
}

function mapMessageLike(record: Record<string, unknown>): JsonObject | null {
  const role = typeof record['role'] === 'string' ? record['role'] : '';
  if (!role) return null;

  const message: JsonObject = {
    role,
    content: normalizeMessageContent(record['content']),
  };

  if (Array.isArray(record['tool_calls'])) {
    message['tool_calls'] = record['tool_calls'] as JsonValue[];
  }

  return message;
}

function mapInputItem(item: unknown): JsonObject[] {
  if (!item || typeof item !== 'object') return [];
  const record = item as Record<string, unknown>;

  if (typeof record['role'] === 'string') {
    const message = mapMessageLike(record);
    return message ? [message] : [];
  }

  if (record['type'] === 'message') {
    const message = mapMessageLike(record);
    return message ? [message] : [];
  }

  if (record['type'] === 'function_call') {
    const message = mapFunctionCallToolMessage(record);
    return message ? [message] : [];
  }

  if (record['type'] === 'function_call_output') {
    const message = mapFunctionCallOutputToolMessage(record);
    return message ? [message] : [];
  }

  return [];
}

function buildChatMessages(payload: JsonObject): JsonValue[] {
  const messages: JsonValue[] = [];

  if (typeof payload.instructions === 'string' && payload.instructions.trim()) {
    messages.push({
      role: 'system',
      content: payload.instructions,
    });
  }

  const input = payload.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
    return messages;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      messages.push(...mapInputItem(item));
    }
    return messages;
  }

  if (input && typeof input === 'object') {
    messages.push(...mapInputItem(input));
  }

  return messages;
}

function responsesRequestToChatRequest(payload: JsonObject): JsonObject {
  const request: JsonObject = {
    model: payload.model,
    messages: buildChatMessages(payload),
  };

  if (typeof payload.temperature === 'number') request['temperature'] = payload.temperature;
  if (typeof payload.top_p === 'number') request['top_p'] = payload.top_p;
  if (typeof payload.stream === 'boolean') request['stream'] = payload.stream;
  if (typeof payload.parallel_tool_calls === 'boolean') {
    request['parallel_tool_calls'] = payload.parallel_tool_calls;
  }
  if (typeof payload.max_output_tokens === 'number') request['max_tokens'] = payload.max_output_tokens;
  if (Array.isArray(payload.stop)) request['stop'] = payload.stop;

  const mappedTools = mapTools(payload.tools);
  if (mappedTools) request['tools'] = mappedTools;

  const mappedToolChoice = mapToolChoice(payload.tool_choice);
  if (mappedToolChoice !== undefined) request['tool_choice'] = mappedToolChoice;

  if (typeof payload.model === 'string' && payload.model.startsWith('deepseek-')) {
    // Disable DeepSeek thinking mode for Responses clients so completion tokens are
    // spent on visible output instead of returning reasoning-only payloads.
    request['thinking'] = false;
  }

  return request;
}

function parseArguments(value: unknown): JsonValue {
  if (typeof value !== 'string') {
    return value as JsonValue;
  }

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function mapChatMessagesToAnthropic(messages: JsonValue[]): { system: string | undefined; messages: JsonValue[] } {
  const systemParts: string[] = [];
  const anthropicMessages: JsonValue[] = [];

  for (const item of messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as JsonObject;
    const role = typeof record.role === 'string' ? record.role : '';
    const content = record.content;

    if (role === 'system') {
      const text = normalizeMessageContent(content);
      if (text.trim()) systemParts.push(text);
      continue;
    }

    if (role === 'tool') {
      const toolCallId = typeof record.tool_call_id === 'string' ? record.tool_call_id : '';
      if (!toolCallId) continue;
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: normalizeMessageContent(content),
        }],
      });
      continue;
    }

    if (role !== 'user' && role !== 'assistant') continue;

    if (role === 'assistant' && Array.isArray(record.tool_calls)) {
      const blocks: JsonValue[] = [];
      const text = normalizeMessageContent(content);
      if (text) {
        blocks.push({ type: 'text', text });
      }

      for (const toolCall of record.tool_calls) {
        if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) continue;
        const toolRecord = toolCall as JsonObject;
        const fn = toolRecord.function;
        if (!fn || typeof fn !== 'object' || Array.isArray(fn)) continue;
        const fnRecord = fn as JsonObject;
        const id = typeof toolRecord.id === 'string' ? toolRecord.id : `tool_${Date.now()}`;
        const name = typeof fnRecord.name === 'string' ? fnRecord.name : '';
        if (!name) continue;

        blocks.push({
          type: 'tool_use',
          id,
          name,
          input: parseArguments(fnRecord.arguments),
        });
      }

      anthropicMessages.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : '',
      });
      continue;
    }

    anthropicMessages.push({
      role,
      content: normalizeMessageContent(content),
    });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: anthropicMessages,
  };
}

function mapResponsesToolsToAnthropic(tools: unknown): JsonValue[] | undefined {
  if (!Array.isArray(tools)) return undefined;

  const mapped = tools.flatMap((tool): JsonValue[] => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return [];
    const record = tool as JsonObject;
    if (record.type !== 'function') return [];

    const fn = record.function && typeof record.function === 'object' && !Array.isArray(record.function)
      ? record.function as JsonObject
      : record;
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name) return [];

    const anthropicTool: JsonObject = {
      name,
      input_schema: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters as JsonObject : {
        type: 'object',
        properties: {},
      },
    };
    if (typeof fn.description === 'string') {
      anthropicTool.description = fn.description;
    }
    return [anthropicTool];
  });

  return mapped.length > 0 ? mapped : undefined;
}

function mapResponsesToolChoiceToAnthropic(toolChoice: unknown): JsonValue | undefined {
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'required') return { type: 'any' };
    if (toolChoice === 'none') return { type: 'none' };
    return { type: 'auto' };
  }
  if (!toolChoice || typeof toolChoice !== 'object' || Array.isArray(toolChoice)) return undefined;

  const record = toolChoice as JsonObject;
  if (record.type !== 'function') return undefined;

  const fn = record.function && typeof record.function === 'object' && !Array.isArray(record.function)
    ? record.function as JsonObject
    : record;
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (!name) return undefined;

  return { type: 'tool', name };
}

function responsesRequestToAnthropicRequest(payload: JsonObject): JsonObject {
  const chatMessages = buildChatMessages(payload);
  const mapped = mapChatMessagesToAnthropic(chatMessages);
  const request: JsonObject = {
    model: payload.model,
    messages: mapped.messages,
    max_tokens: typeof payload.max_output_tokens === 'number' ? payload.max_output_tokens : 4096,
  };

  if (mapped.system) request.system = mapped.system;
  if (typeof payload.temperature === 'number') request.temperature = payload.temperature;
  if (typeof payload.top_p === 'number') request.top_p = payload.top_p;
  if (typeof payload.stream === 'boolean') request.stream = payload.stream;
  if (Array.isArray(payload.stop)) request.stop_sequences = payload.stop as JsonValue[];

  const tools = mapResponsesToolsToAnthropic(payload.tools);
  if (tools) request.tools = tools;

  const toolChoice = mapResponsesToolChoiceToAnthropic(payload.tool_choice);
  if (toolChoice) request.tool_choice = toolChoice;

  return request;
}

function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  const textParts = extractTextParts(content);
  if (textParts.length > 0) return textParts.join('\n');
  return '';
}

function buildOutputItems(message: Record<string, unknown>): JsonValue[] {
  const output: JsonValue[] = [];
  const text = extractAssistantText(message['content']);

  if (text) {
    output.push({
      id: 'msg_local_0',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text,
      }],
    });
  }

  if (Array.isArray(message['tool_calls'])) {
    for (const toolCall of message['tool_calls']) {
      if (!toolCall || typeof toolCall !== 'object') continue;
      const toolRecord = toolCall as Record<string, unknown>;
      const fn = toolRecord['function'];
      if (!fn || typeof fn !== 'object') continue;

      const fnRecord = fn as Record<string, unknown>;
      const callId = typeof toolRecord['id'] === 'string' ? toolRecord['id'] : '';
      const name = typeof fnRecord['name'] === 'string' ? fnRecord['name'] : '';
      if (!callId || !name) continue;

      output.push({
        id: `fc_${callId}`,
        type: 'function_call',
        status: 'completed',
        call_id: callId,
        name,
        arguments: stringifyValue(fnRecord['arguments'] ?? ''),
      });
    }
  }

  return output;
}

function mapUsage(usage: unknown): JsonObject | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;

  const promptTokens = typeof record['prompt_tokens'] === 'number' ? record['prompt_tokens'] : 0;
  const completionTokens = typeof record['completion_tokens'] === 'number' ? record['completion_tokens'] : 0;
  const totalTokens = typeof record['total_tokens'] === 'number'
    ? record['total_tokens']
    : promptTokens + completionTokens;

  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function mapAnthropicUsage(usage: unknown): JsonObject | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;
  const inputTokens = typeof record['input_tokens'] === 'number' ? record['input_tokens'] : 0;
  const outputTokens = typeof record['output_tokens'] === 'number' ? record['output_tokens'] : 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

function chatResponseToResponsesBody(rawBody: string): string {
  const parsed = parseJsonObject(rawBody);
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0];
  const message = firstChoice && typeof firstChoice === 'object'
    ? ((firstChoice as Record<string, unknown>)['message'] as Record<string, unknown> | undefined)
    : undefined;
  const safeMessage = message && typeof message === 'object' ? message : {};
  const output = buildOutputItems(safeMessage);
  const outputText = extractAssistantText(safeMessage['content']);

  return JSON.stringify({
    id: typeof parsed.id === 'string' ? parsed.id : `resp_${Date.now()}`,
    object: 'response',
    created_at: typeof parsed.created === 'number' ? parsed.created : Math.floor(Date.now() / 1000),
    status: 'completed',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    output,
    output_text: outputText,
    usage: mapUsage(parsed.usage),
  });
}

function anthropicContentToOutput(content: unknown): { output: JsonValue[]; outputText: string } {
  const blocks = Array.isArray(content) ? content : [];
  const output: JsonValue[] = [];
  const textParts: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const record = block as JsonObject;
    if (record.type === 'text' && typeof record.text === 'string') {
      textParts.push(record.text);
      continue;
    }
    if (record.type === 'tool_use') {
      const callId = typeof record.id === 'string' ? record.id : `call_${Date.now()}`;
      const name = typeof record.name === 'string' ? record.name : '';
      if (!name) continue;
      output.push({
        id: `fc_${callId}`,
        type: 'function_call',
        status: 'completed',
        call_id: callId,
        name,
        arguments: stringifyValue(record.input ?? {}),
      });
    }
  }

  const outputText = textParts.join('');
  if (outputText) {
    output.unshift({
      id: 'msg_anthropic_0',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: outputText,
      }],
    });
  }

  return { output, outputText };
}

function anthropicResponseToResponsesBody(rawBody: string): string {
  const parsed = parseJsonObject(rawBody);
  const converted = anthropicContentToOutput(parsed.content);

  return JSON.stringify({
    id: typeof parsed.id === 'string' ? parsed.id : `resp_${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    output: converted.output,
    output_text: converted.outputText,
    usage: mapAnthropicUsage(parsed.usage),
  });
}

async function readProxyBody(proxyRes: http.IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    proxyRes.setEncoding('utf8');
    let body = '';
    proxyRes.on('data', (chunk) => (body += chunk));
    proxyRes.on('end', () => resolve(body));
    proxyRes.on('error', reject);
  });
}

function createStreamState(): StreamState {
  return {
    started: false,
    completed: false,
    responseId: '',
    model: '',
    createdAt: Math.floor(Date.now() / 1000),
    nextOutputIndex: 0,
    message: null,
    functionCalls: new Map(),
  };
}

function writeSseEvent(clientRes: http.ServerResponse, event: JsonObject | string): void {
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  clientRes.write(`data: ${payload}\n\n`);
}

function buildMessageItem(state: StreamMessageState, status: 'in_progress' | 'completed'): JsonObject {
  return {
    id: state.itemId,
    type: 'message',
    status,
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: state.text,
    }],
  };
}

function buildFunctionCallItem(state: StreamFunctionCallState, status: 'in_progress' | 'completed'): JsonObject {
  return {
    id: state.itemId,
    type: 'function_call',
    status,
    call_id: state.callId,
    name: state.name,
    arguments: state.arguments,
  };
}

function buildCompletedResponseFromStream(state: StreamState): JsonObject {
  const output: JsonValue[] = [];

  if (state.message) {
    output.push(buildMessageItem(state.message, 'completed'));
  }

  const functionCalls = [...state.functionCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex);
  for (const functionCall of functionCalls) {
    output.push(buildFunctionCallItem(functionCall, 'completed'));
  }

  const outputText = state.message?.text ?? '';

  return {
    id: state.responseId,
    object: 'response',
    created_at: state.createdAt,
    status: 'completed',
    model: state.model,
    output,
    output_text: outputText,
  };
}

function ensureStreamStarted(clientRes: http.ServerResponse, state: StreamState, chunk: Record<string, unknown>): void {
  if (state.started) return;

  state.started = true;
  state.responseId = typeof chunk['id'] === 'string' ? chunk['id'] : `resp_${Date.now()}`;
  state.model = typeof chunk['model'] === 'string' ? chunk['model'] : '';
  state.createdAt = typeof chunk['created'] === 'number'
    ? chunk['created']
    : Math.floor(Date.now() / 1000);

  writeSseEvent(clientRes, {
    type: 'response.created',
    response: {
      id: state.responseId,
      object: 'response',
      created_at: state.createdAt,
      status: 'in_progress',
      model: state.model,
      output: [],
    },
  });
  writeSseEvent(clientRes, {
    type: 'response.in_progress',
    response: {
      id: state.responseId,
      object: 'response',
      created_at: state.createdAt,
      status: 'in_progress',
      model: state.model,
      output: [],
    },
  });
}

function ensureMessageStarted(clientRes: http.ServerResponse, state: StreamState): StreamMessageState {
  if (state.message) return state.message;

  state.message = {
    outputIndex: state.nextOutputIndex++,
    itemId: `msg_${state.responseId || Date.now()}`,
    text: '',
    started: true,
    completed: false,
  };

  writeSseEvent(clientRes, {
    type: 'response.output_item.added',
    output_index: state.message.outputIndex,
    item: buildMessageItem(state.message, 'in_progress'),
  });
  writeSseEvent(clientRes, {
    type: 'response.content_part.added',
    output_index: state.message.outputIndex,
    content_index: 0,
    part: {
      type: 'output_text',
      text: '',
    },
  });

  return state.message;
}

function ensureFunctionCallStarted(
  clientRes: http.ServerResponse,
  state: StreamState,
  callIndex: number,
  delta: Record<string, unknown>,
): StreamFunctionCallState {
  const existing = state.functionCalls.get(callIndex);
  if (existing) return existing;

  const functionRecord = delta['function'] && typeof delta['function'] === 'object'
    ? delta['function'] as Record<string, unknown>
    : {};

  const functionCall: StreamFunctionCallState = {
    outputIndex: state.nextOutputIndex++,
    itemId: typeof delta['id'] === 'string' ? `fc_${delta['id']}` : `fc_${state.responseId}_${callIndex}`,
    callId: typeof delta['id'] === 'string' ? delta['id'] : `call_${state.responseId}_${callIndex}`,
    name: typeof functionRecord['name'] === 'string' ? functionRecord['name'] : '',
    arguments: '',
    started: true,
    completed: false,
  };

  state.functionCalls.set(callIndex, functionCall);
  writeSseEvent(clientRes, {
    type: 'response.output_item.added',
    output_index: functionCall.outputIndex,
    item: buildFunctionCallItem(functionCall, 'in_progress'),
  });

  return functionCall;
}

function completeMessage(clientRes: http.ServerResponse, state: StreamState): void {
  if (!state.message || state.message.completed) return;

  writeSseEvent(clientRes, {
    type: 'response.output_text.done',
    output_index: state.message.outputIndex,
    content_index: 0,
    text: state.message.text,
  });
  writeSseEvent(clientRes, {
    type: 'response.content_part.done',
    output_index: state.message.outputIndex,
    content_index: 0,
    part: {
      type: 'output_text',
      text: state.message.text,
    },
  });
  writeSseEvent(clientRes, {
    type: 'response.output_item.done',
    output_index: state.message.outputIndex,
    item: buildMessageItem(state.message, 'completed'),
  });

  state.message.completed = true;
}

function completeFunctionCalls(clientRes: http.ServerResponse, state: StreamState): void {
  const functionCalls = [...state.functionCalls.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, functionCall] of functionCalls) {
    if (functionCall.completed) continue;

    writeSseEvent(clientRes, {
      type: 'response.function_call_arguments.done',
      output_index: functionCall.outputIndex,
      item_id: functionCall.itemId,
      arguments: functionCall.arguments,
    });
    writeSseEvent(clientRes, {
      type: 'response.output_item.done',
      output_index: functionCall.outputIndex,
      item: buildFunctionCallItem(functionCall, 'completed'),
    });

    functionCall.completed = true;
  }
}

function completeStream(clientRes: http.ServerResponse, state: StreamState): void {
  if (state.completed) return;
  state.completed = true;

  completeMessage(clientRes, state);
  completeFunctionCalls(clientRes, state);
  writeSseEvent(clientRes, {
    type: 'response.completed',
    response: buildCompletedResponseFromStream(state),
  });
  writeSseEvent(clientRes, '[DONE]');
  clientRes.end();
}

function processChatChunk(clientRes: http.ServerResponse, state: StreamState, chunk: Record<string, unknown>): void {
  ensureStreamStarted(clientRes, state, chunk);

  const choices = Array.isArray(chunk['choices']) ? chunk['choices'] : [];
  const choice = choices[0];
  if (!choice || typeof choice !== 'object') return;

  const choiceRecord = choice as Record<string, unknown>;
  const delta = choiceRecord['delta'] && typeof choiceRecord['delta'] === 'object'
    ? choiceRecord['delta'] as Record<string, unknown>
    : {};

  if (typeof delta['content'] === 'string' && delta['content'].length > 0) {
    const message = ensureMessageStarted(clientRes, state);
    message.text += delta['content'];
    writeSseEvent(clientRes, {
      type: 'response.output_text.delta',
      output_index: message.outputIndex,
      content_index: 0,
      delta: delta['content'],
    });
  }

  if (Array.isArray(delta['tool_calls'])) {
    for (const toolCall of delta['tool_calls']) {
      if (!toolCall || typeof toolCall !== 'object') continue;
      const toolCallRecord = toolCall as Record<string, unknown>;
      const callIndex = typeof toolCallRecord['index'] === 'number' ? toolCallRecord['index'] : 0;
      const functionCall = ensureFunctionCallStarted(clientRes, state, callIndex, toolCallRecord);
      const functionRecord = toolCallRecord['function'] && typeof toolCallRecord['function'] === 'object'
        ? toolCallRecord['function'] as Record<string, unknown>
        : {};

      if (typeof functionRecord['name'] === 'string' && functionRecord['name']) {
        functionCall.name = functionRecord['name'];
      }

      if (typeof functionRecord['arguments'] === 'string' && functionRecord['arguments']) {
        functionCall.arguments += functionRecord['arguments'];
        writeSseEvent(clientRes, {
          type: 'response.function_call_arguments.delta',
          output_index: functionCall.outputIndex,
          item_id: functionCall.itemId,
          delta: functionRecord['arguments'],
        });
      }
    }
  }

  const finishReason = typeof choiceRecord['finish_reason'] === 'string' ? choiceRecord['finish_reason'] : '';
  if (finishReason === 'tool_calls') {
    completeFunctionCalls(clientRes, state);
  }
  if (finishReason === 'stop') {
    completeStream(clientRes, state);
  }
}

async function relayChatStreamAsResponses(
  proxyRes: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  clientRes.writeHead(proxyRes.statusCode ?? 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const state = createStreamState();
  proxyRes.setEncoding('utf8');
  let buffer = '';

  await new Promise<void>((resolve, reject) => {
    proxyRes.on('data', (chunk) => {
      buffer += chunk;

      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const payload = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');

        if (!payload) continue;
        if (payload === '[DONE]') {
          completeStream(clientRes, state);
          continue;
        }

        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          processChatChunk(clientRes, state, parsed);
        } catch {
          /* ignore malformed upstream chunks */
        }
      }
    });

    proxyRes.on('end', () => {
      completeStream(clientRes, state);
      resolve();
    });
    proxyRes.on('error', reject);
  });
}

export function prepareProxyRequest(
  backend: BackendConfig,
  requestProtocol: BackendProtocol,
  body: string,
  fallbackPath: string,
): PreparedProxyRequest {
  const upstreamPath = backend.path || fallbackPath;
  const upstreamProtocol = getCompatUpstreamProtocol(backend);
  const payload = parseJsonObject(body);
  const effectivePayload = requestProtocol === 'openai-responses'
    ? maybeApplyDefaultModel(payload, backend)
    : payload;

  if (
    requestProtocol === 'openai-responses'
    && (upstreamProtocol === 'openai-chat' || isChatCompletionsPath(upstreamPath))
  ) {
    return {
      path: upstreamPath,
      body: JSON.stringify(responsesRequestToChatRequest(effectivePayload)),
      responseAdapter: 'chat-to-responses',
    };
  }

  if (
    requestProtocol === 'openai-responses'
    && (upstreamProtocol === 'anthropic' || isAnthropicMessagesPath(upstreamPath))
  ) {
    const anthropicPayload = responsesRequestToAnthropicRequest(effectivePayload);
    // Anthropic streaming uses a different event schema; request a normal response and adapt it.
    delete anthropicPayload.stream;
    return {
      path: upstreamPath,
      body: JSON.stringify(anthropicPayload),
      responseAdapter: 'anthropic-to-responses',
    };
  }

  return {
    path: upstreamPath,
    body: JSON.stringify(effectivePayload),
    responseAdapter: 'passthrough',
  };
}

export async function relayProxyResponse(
  proxyRes: http.IncomingMessage,
  clientRes: http.ServerResponse,
  responseAdapter: ResponseAdapter,
): Promise<void> {
  if (responseAdapter === 'passthrough') {
    const headers = { ...proxyRes.headers };
    delete headers['content-encoding'];
    clientRes.writeHead(proxyRes.statusCode ?? 502, headers);
    proxyRes.pipe(clientRes);
    return;
  }

  if (responseAdapter === 'anthropic-to-responses') {
    const body = await readProxyBody(proxyRes);
    clientRes.writeHead(proxyRes.statusCode ?? 200, { 'Content-Type': 'application/json' });
    clientRes.end(anthropicResponseToResponsesBody(body));
    return;
  }

  const contentType = String(proxyRes.headers['content-type'] || '');
  if (contentType.includes('text/event-stream')) {
    await relayChatStreamAsResponses(proxyRes, clientRes);
    return;
  }

  const body = await readProxyBody(proxyRes);
  clientRes.writeHead(proxyRes.statusCode ?? 200, { 'Content-Type': 'application/json' });
  clientRes.end(chatResponseToResponsesBody(body));
}
