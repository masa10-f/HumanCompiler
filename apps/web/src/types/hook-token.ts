export interface HookToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HookTokenCreate {
  name: string;
}

export interface HookTokenCreated extends HookToken {
  token: string;
}
