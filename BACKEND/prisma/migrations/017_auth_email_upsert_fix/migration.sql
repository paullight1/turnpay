CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_phone TEXT;
  public_user_id TEXT;
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
  ON CONFLICT (email) DO UPDATE
    SET email = EXCLUDED.email,
        phone = CASE
          WHEN public.users.phone LIKE 'supabase:%' THEN EXCLUDED.phone
          ELSE public.users.phone
        END,
        "updatedAt" = CURRENT_TIMESTAMP
  RETURNING id INTO public_user_id;

  INSERT INTO public.wallets (
    id,
    "userId",
    currency,
    balance,
    "updatedAt"
  )
  VALUES
    (
      gen_random_uuid()::text,
      public_user_id,
      'NGN'::public."WalletCurrency",
      0,
      CURRENT_TIMESTAMP
    ),
    (
      gen_random_uuid()::text,
      public_user_id,
      'GHS'::public."WalletCurrency",
      0,
      CURRENT_TIMESTAMP
    )
  ON CONFLICT ("userId", currency) DO NOTHING;

  RETURN NEW;
END;
$$;
