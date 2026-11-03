CREATE TABLE public.inventory_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_by uuid NOT NULL REFERENCES public.profiles(id),
  source text NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase', 'opening')),
  supplier text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.inventory_receipts(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.imei_units
  ADD COLUMN receipt_item_id uuid REFERENCES public.inventory_receipt_items(id);

ALTER TABLE public.inventory_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipt_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.inventory_receipts, public.inventory_receipt_items TO authenticated;
GRANT ALL ON public.inventory_receipts, public.inventory_receipt_items TO service_role;

CREATE POLICY inventory_receipts_read_active_staff
  ON public.inventory_receipts FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()));
CREATE POLICY inventory_receipt_items_read_active_staff
  ON public.inventory_receipt_items FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()));

CREATE FUNCTION public.guard_imei_receipt_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.allow_imei_receipt', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'IMEI stock must be added through an inventory receipt';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER imei_receipt_insert_guard
  BEFORE INSERT ON public.imei_units
  FOR EACH ROW EXECUTE FUNCTION public.guard_imei_receipt_insert();

CREATE FUNCTION public.guard_button_phone_stock_issue() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_category text;
  v_available integer;
BEGIN
  SELECT category INTO v_category
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_category <> 'button_phone' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.product_id::text, 1));

  SELECT
    COALESCE((SELECT sum(i.quantity) FROM public.inventory_receipt_items i WHERE i.product_id = NEW.product_id), 0)
    - COALESCE((SELECT sum(i.quantity) FROM public.stock_issue_items i WHERE i.product_id = NEW.product_id), 0)
    + COALESCE((
      SELECT sum(r.quantity)
      FROM public.returns r
      WHERE r.product_id = NEW.product_id AND NOT r.is_damaged
    ), 0)
  INTO v_available;

  IF NEW.quantity > v_available THEN
    RAISE EXCEPTION 'Insufficient company stock (% available)', v_available;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER button_phone_stock_issue_guard
  BEFORE INSERT ON public.stock_issue_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_button_phone_stock_issue();

CREATE FUNCTION public.post_inventory_receipt(p_request_id uuid, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_receipt_id uuid;
  v_receipt public.inventory_receipts%rowtype;
  v_request public.posting_requests%rowtype;
  v_item jsonb;
  v_unit jsonb;
  v_product public.products%rowtype;
  v_item_id uuid;
  v_quantity integer;
  v_cost numeric;
  v_units jsonb;
  v_inserted integer;
BEGIN
  v_actor := public.require_active_account();
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin required';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Invalid inventory receipt';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));
  SELECT * INTO v_request
  FROM public.posting_requests
  WHERE actor_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_request.kind <> 'inventory_receipt' OR v_request.payload <> p_payload THEN
      RAISE EXCEPTION 'Retry payload changed; start a new request';
    END IF;
    RETURN v_request.result_id;
  END IF;

  IF coalesce(p_payload->>'source', 'purchase') NOT IN ('purchase', 'opening')
     OR length(coalesce(p_payload->>'supplier', '')) > 160
     OR length(coalesce(p_payload->>'note', '')) > 500 THEN
    RAISE EXCEPTION 'Invalid receipt details';
  END IF;

  INSERT INTO public.inventory_receipts(received_by, source, supplier, note)
  VALUES (
    v_actor,
    coalesce(p_payload->>'source', 'purchase'),
    btrim(coalesce(p_payload->>'supplier', '')),
    btrim(coalesce(p_payload->>'note', ''))
  )
  RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or inactive product';
    END IF;
    IF coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Quantity must be a positive integer';
    END IF;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive integer';
    END IF;
    IF coalesce(v_item->>'unit_cost', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Unit cost must be a non-negative amount with up to two decimals';
    END IF;
    v_cost := (v_item->>'unit_cost')::numeric;
    v_units := coalesce(v_item->'units', '[]'::jsonb);

    IF v_product.category = 'smartphone' THEN
      IF jsonb_typeof(v_units) IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_units) <> v_quantity THEN
        RAISE EXCEPTION 'Scan one IMEI for each smartphone';
      END IF;
    ELSIF jsonb_typeof(v_units) IS DISTINCT FROM 'array'
          OR jsonb_array_length(v_units) <> 0 THEN
      RAISE EXCEPTION 'Button phones do not use IMEI';
    END IF;

    INSERT INTO public.inventory_receipt_items(receipt_id, product_id, quantity, unit_cost)
    VALUES (v_receipt_id, v_product.id, v_quantity, v_cost)
    RETURNING id INTO v_item_id;

    IF v_product.category = 'smartphone' THEN
      PERFORM set_config('app.allow_imei_receipt', 'on', true);
      FOR v_unit IN SELECT value FROM jsonb_array_elements(v_units) LOOP
        IF coalesce(v_unit->>'imei', '') !~ '^[0-9]{14,16}$' THEN
          RAISE EXCEPTION 'Invalid IMEI';
        END IF;
        INSERT INTO public.imei_units(id, product_id, imei, receipt_item_id)
        VALUES (
          (v_unit->>'id')::uuid,
          v_product.id,
          v_unit->>'imei',
          v_item_id
        );
      END LOOP;
      PERFORM set_config('app.allow_imei_receipt', 'off', true);
    END IF;
  END LOOP;

  INSERT INTO public.posting_requests(actor_id, request_id, kind, payload, result_id)
  VALUES (v_actor, p_request_id, 'inventory_receipt', p_payload, v_receipt_id);
  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_inventory_receipt(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_receipt(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.accounting_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.require_active_account();
  RETURN jsonb_build_object(
    'profiles', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.profiles t), '[]'::jsonb),
    'roles', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.user_roles t), '[]'::jsonb),
    'products', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.products t), '[]'::jsonb),
    'imeiUnits', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.imei_units t), '[]'::jsonb),
    'retailers', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.retailers t), '[]'::jsonb),
    'sales', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sold_at DESC) FROM public.sales t), '[]'::jsonb),
    'saleItems', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.sale_items t), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.paid_at DESC) FROM public.retailer_payments t), '[]'::jsonb),
    'deposits', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.deposited_at DESC) FROM public.deposits t), '[]'::jsonb),
    'returns', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.returns t), '[]'::jsonb),
    'stockIssues', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.issued_at DESC) FROM public.stock_issues t), '[]'::jsonb),
    'issueItems', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.stock_issue_items t), '[]'::jsonb),
    'settlements', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM public.settlements t), '[]'::jsonb),
    'inventoryReceipts', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.received_at DESC) FROM public.inventory_receipts t), '[]'::jsonb),
    'inventoryReceiptItems', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_receipt_items t), '[]'::jsonb)
  );
END;
$$;
