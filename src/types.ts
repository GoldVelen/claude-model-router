export interface BackendConfig {
  url: string;
  apiKey: string;
  path?: string;
  modelPattern?: string;
  sanitizer?: 'deepseek' | 'none';
}

export interface Config {
  port: number;
  logLevel: 'silent' | 'info' | 'debug';
  backends: Record<string, BackendConfig>;
  aliases: Record<string, string>;
}
