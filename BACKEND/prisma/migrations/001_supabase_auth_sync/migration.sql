CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = (SELECT auth.uid())::text
      AND role = 'ADMIN'::public."UserRole"
      AND "isSuspended" = false
  );
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_user_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_phone TEXT;
BEGIN
  user_phone := NULLIF(NEW.raw_user_meta_data->>'phone', '');

  INSERT INTO public.users (
    id,
    email,
    phone,
    password,
    role,
    "kycStatus",
    "updatedAt"
  )
  VALUES (
    NEW.id::text,
    COALESCE(NEW.email, ''),
    COALESCE(user_phone, NEW.phone, CONCAT('supabase:', NEW.id::text)),
    '',
    'USER'::public."UserRole",
    'PENDING'::public."KYCStatus",
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = CASE
          WHEN public.users.phone LIKE 'supabase:%' THEN EXCLUDED.phone
          ELSE public.users.phone
        END,
        "updatedAt" = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own_or_admin ON public.users;
CREATE POLICY users_select_own_or_admin
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid())::text OR private.current_user_is_admin());

DROP POLICY IF EXISTS wallets_select_own_or_admin ON public.wallets;
CREATE POLICY wallets_select_own_or_admin
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING ("userId" = (SELECT auth.uid())::text OR private.current_user_is_admin());

DROP POLICY IF EXISTS transactions_select_own_or_admin ON public.transactions;
CREATE POLICY transactions_select_own_or_admin
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING ("userId" = (SELECT auth.uid())::text OR private.current_user_is_admin());

DROP POLICY IF EXISTS kyc_documents_select_own_or_admin ON public.kyc_documents;
CREATE POLICY kyc_documents_select_own_or_admin
  ON public.kyc_documents
  FOR SELECT
  TO authenticated
  USING ("userId" = (SELECT auth.uid())::text OR private.current_user_is_admin());

DROP POLICY IF EXISTS disputes_select_own_or_admin ON public.disputes;
CREATE POLICY disputes_select_own_or_admin
  ON public.disputes
  FOR SELECT
  TO authenticated
  USING ("userId" = (SELECT auth.uid())::text OR private.current_user_is_admin());

DROP POLICY IF EXISTS rates_public_read ON public.rates;
CREATE POLICY rates_public_read
  ON public.rates
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS services_public_read ON public.services;
CREATE POLICY services_public_read
  ON public.services
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS refresh_tokens_client_deny_all ON public.refresh_tokens;
CREATE POLICY refresh_tokens_client_deny_all
  ON public.refresh_tokens
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS webhook_logs_client_deny_all ON public.webhook_logs;
CREATE POLICY webhook_logs_client_deny_all
  ON public.webhook_logs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
