export interface Backend {
  url: string;
  apiKey: string;
}

export interface Config {
  port: number;
  logLevel: 'silent' | 'info' | 'debug';
  backends: {
    deepseek: Backend;
    claude: Backend;
  };
  aliases: Record<string, string>;
}
