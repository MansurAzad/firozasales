CREATE OR REPLACE FUNCTION public.is_valid_imei(p_imei text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sum integer := 0;
  v_digit integer;
  v_position integer;
BEGIN
  IF p_imei !~ '^[0-9]{15}$' THEN
    RETURN false;
  END IF;

  FOR v_position IN 1..15 LOOP
    v_digit := substr(p_imei, v_position, 1)::integer;
    IF v_position % 2 = 0 THEN
      v_digit := v_digit * 2;
      IF v_digit > 9 THEN
        v_digit := v_digit - 9;
      END IF;
    END IF;
    v_sum := v_sum + v_digit;
  END LOOP;

  RETURN v_sum % 10 = 0;
END;
$$;

ALTER TABLE public.imei_units
  ADD CONSTRAINT imei_units_imei_luhn_check
  CHECK (public.is_valid_imei(imei)) NOT VALID;
ALTER TABLE public.imei_units
  VALIDATE CONSTRAINT imei_units_imei_luhn_check;

CREATE TABLE public.imei_scan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  imei text NOT NULL,
  source text NOT NULL CHECK (source IN ('mobile_camera', 'webcam', 'usb_scanner', 'manual')),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'invalid_format', 'invalid_checksum', 'duplicate', 'error')),
  message text NOT NULL DEFAULT '',
  product_id uuid REFERENCES public.products(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX imei_scan_history_user_created_idx
  ON public.imei_scan_history (user_id, created_at DESC);
CREATE INDEX imei_scan_history_imei_created_idx
  ON public.imei_scan_history (imei, created_at DESC);

ALTER TABLE public.imei_scan_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.imei_scan_history TO authenticated;

CREATE POLICY imei_scan_history_read_own_or_admin
  ON public.imei_scan_history
  FOR SELECT TO authenticated
  USING (
    user_id = public.require_active_account()
    OR public.has_role(public.require_active_account(), 'admin')
  );

CREATE POLICY imei_scan_history_insert_own
  ON public.imei_scan_history
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.require_active_account());
