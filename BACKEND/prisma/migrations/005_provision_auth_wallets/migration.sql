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
      NEW.id::text,
      'NGN'::public."WalletCurrency",
      0,
      CURRENT_TIMESTAMP
    ),
    (
      gen_random_uuid()::text,
      NEW.id::text,
      'GHS'::public."WalletCurrency",
      0,
      CURRENT_TIMESTAMP
    )
  ON CONFLICT ("userId", currency) DO NOTHING;

  RETURN NEW;
END;
$$;

INSERT INTO public.wallets (
  id,
  "userId",
  currency,
  balance,
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  users.id,
  currency.value::public."WalletCurrency",
  0,
  CURRENT_TIMESTAMP
FROM public.users
CROSS JOIN (VALUES ('NGN'), ('GHS')) AS currency(value)
ON CONFLICT ("userId", currency) DO NOTHING;
