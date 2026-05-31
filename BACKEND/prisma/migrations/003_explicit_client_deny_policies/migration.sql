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
