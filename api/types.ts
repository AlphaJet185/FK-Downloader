export type ApiQueryValue = string | string[] | undefined;

export interface ApiRequest {
  method?: string;
  query: Record<string, ApiQueryValue>;
  body?: any;
  headers?: Record<string, string | string[] | undefined>;
  [key: string]: any;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: any): ApiResponse;
  send(body: any): ApiResponse;
  setHeader(name: string, value: string): void;
  [key: string]: any;
}
