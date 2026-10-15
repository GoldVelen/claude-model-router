export type BackendProtocol = 'anthropic' | 'openai-chat' | 'openai-responses';

export interface BackendConfig {
  url: string;
  apiKey: string;
  path?: string;
  modelPattern?: string;
  defaultModel?: string;
  fallback?: boolean;
  forwardAuthorization?: boolean;
  protocol?: BackendProtocol;
  upstreamProtocol?: BackendProtocol;
  sanitizer?: 'deepseek' | 'none';
}

export interface PipelineStage {
  model: string;
  prompt: string;
}

export interface PipelineConfig {
  [stage: string]: PipelineStage;
}

export interface Config {
  port: number;
  logLevel: 'silent' | 'info' | 'debug';
  backends: Record<string, BackendConfig>;
  aliases: Record<string, string>;
  routingTags?: Record<string, string>;
  pipeline?: PipelineConfig;
}
