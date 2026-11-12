/** New-API 传输层类型：只描述我们需要的那部分响应形状 */

export interface NewApiStatusResponse {
  success: boolean;
  data?: {
    version?: string;
    server_address?: string;
    setup?: boolean;
  };
}

export interface NewApiModelListResponse {
  object?: string;
  success?: boolean;
  data?: Array<{
    id: string;
    object?: string;
    owned_by?: string;
    created?: number;
  }>;
}

export interface NewApiChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string };
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** New-API 网关自身错误：{ error: { code, message, type } } */
export interface NewApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  success?: boolean;
  code?: string;
  message?: string;
}

export interface NewApiLogItem {
  id?: number;
  created_at?: number;
  model_name?: string;
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  channel_id?: number;
  request_id?: string;
}

export interface NewApiLogListResponse {
  success?: boolean;
  data?: NewApiLogItem[] | { items?: NewApiLogItem[] };
}

export interface NewApiChannelTestResponse {
  success?: boolean;
  message?: string;
  time?: number;
}
