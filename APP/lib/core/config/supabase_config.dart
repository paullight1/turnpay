class SupabaseConfig {
  static const url = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://gkpueopmdlqlfbvrzuqh.supabase.co',
  );

  static const publishableKey = String.fromEnvironment(
    'SUPABASE_PUBLISHABLE_KEY',
    defaultValue: 'sb_publishable_BVfIS18rZbce5ZTwFJvzrg_jMr34w-v',
  );
}
