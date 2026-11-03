CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  first_account boolean;
  provisioned_by_admin boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fe-user-bootstrap', 0));
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_account;
  provisioned_by_admin := coalesce(NEW.raw_app_meta_data->>'fe_account_provisioning' = 'admin', false);

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'full_name', ''),
    first_account OR provisioned_by_admin
  );

  IF first_account THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'salesman');
  END IF;
  RETURN NEW;
END;
$$;
