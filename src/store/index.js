import { LocalStore } from './local.js';
import { SupabaseStore } from './supabase.js';

export function getStore(config, { storage, seedItems = [], createClient } = {}) {
  if (config?.supabaseUrl && config?.supabaseAnonKey && createClient) {
    return new SupabaseStore(createClient(config.supabaseUrl, config.supabaseAnonKey));
  }
  return new LocalStore({ storage, seedItems });
}
