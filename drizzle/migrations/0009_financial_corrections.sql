CREATE TABLE public.dealer_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  retailer_id uuid NOT NULL REFERENCES public.retailers(id),
  salesman_id uuid NOT NULL REFERENCES public.profiles(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  total_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  refund_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  credit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = refund_amount + credit_amount)
);

CREATE TABLE public.dealer_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_return_id uuid NOT NULL REFERENCES public.dealer_returns(id),
  sale_item_id uuid NOT NULL REFERENCES public.sale_items(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  imei_unit_id uuid REFERENCES public.imei_units(id),
  is_damaged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dealer_return_imei_once
  ON public.dealer_return_items(imei_unit_id)
  WHERE imei_unit_id IS NOT NULL;
CREATE INDEX dealer_returns_sale_idx ON public.dealer_returns(sale_id, created_at);
CREATE INDEX dealer_return_items_sale_item_idx ON public.dealer_return_items(sale_item_id);

ALTER TABLE public.dealer_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_return_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.dealer_returns, public.dealer_return_items TO authenticated;
GRANT ALL ON public.dealer_returns, public.dealer_return_items TO service_role;

CREATE POLICY dealer_returns_read_active_staff
  ON public.dealer_returns FOR SELECT TO authenticated
  USING (
    public.is_active_staff(auth.uid())
    AND (salesman_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );
CREATE POLICY dealer_return_items_read_via_return
  ON public.dealer_return_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dealer_returns r
      WHERE r.id = dealer_return_id
        AND (r.salesman_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE FUNCTION public.post_dealer_return(p_request_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_sale public.sales%rowtype;
  v_sale_item public.sale_items%rowtype;
  v_unit public.imei_units%rowtype;
  v_request public.posting_requests%rowtype;
  v_return_id uuid;
  v_item jsonb;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_unit_id uuid;
  v_category text;
  v_quantity integer;
  v_returned integer;
  v_total numeric(12,2) := 0;
  v_refund numeric(12,2);
  v_note text;
BEGIN
  v_actor := public.require_active_account();
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin required';
  END IF;
  IF p_request_id IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Invalid dealer return';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));
  SELECT * INTO v_request
  FROM public.posting_requests
  WHERE actor_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_request.kind <> 'dealer_return' OR v_request.payload <> p_payload THEN
      RAISE EXCEPTION 'Retry payload changed; start a new request';
    END IF;
    RETURN v_request.result_id;
  END IF;

  v_sale_id := (p_payload->>'sale_id')::uuid;
  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original invoice unavailable';
  END IF;
  IF length(coalesce(p_payload->>'note', '')) > 500 THEN
    RAISE EXCEPTION 'Return note is too long';
  END IF;
  v_note := btrim(coalesce(p_payload->>'note', ''));

  INSERT INTO public.dealer_returns(
    sale_id, retailer_id, salesman_id, created_by, note
  )
  VALUES (v_sale.id, v_sale.retailer_id, v_sale.salesman_id, v_actor, v_note)
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    SELECT si.*
    INTO v_sale_item
    FROM public.sale_items si
    WHERE si.id = v_sale_item_id AND si.sale_id = v_sale.id
    FOR UPDATE OF si;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item is not part of the selected invoice';
    END IF;
    SELECT category INTO v_category FROM public.products WHERE id = v_sale_item.product_id;
    IF coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Return quantity must be a positive integer';
    END IF;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be a positive integer';
    END IF;

    SELECT coalesce(sum(quantity), 0)
    INTO v_returned
    FROM public.dealer_return_items
    WHERE sale_item_id = v_sale_item.id;
    IF v_quantity > v_sale_item.quantity - v_returned THEN
      RAISE EXCEPTION 'Return exceeds the unreturned invoice quantity';
    END IF;

    IF v_category = 'smartphone' THEN
      IF v_quantity <> 1 OR v_sale_item.imei_unit_id IS NULL THEN
        RAISE EXCEPTION 'Return one scanned smartphone IMEI at a time';
      END IF;
      v_unit_id := v_sale_item.imei_unit_id;
      SELECT * INTO v_unit FROM public.imei_units WHERE id = v_unit_id FOR UPDATE;
      IF NOT FOUND OR v_unit.status <> 'sold' OR v_unit.product_id <> v_sale_item.product_id THEN
        RAISE EXCEPTION 'Smartphone IMEI is no longer returnable';
      END IF;
    ELSE
      IF v_sale_item.imei_unit_id IS NOT NULL OR v_item->>'imei_unit_id' IS NOT NULL THEN
        RAISE EXCEPTION 'Button-phone returns do not use IMEI';
      END IF;
      v_unit_id := NULL;
    END IF;

    v_total := v_total + v_quantity * v_sale_item.unit_price;
    INSERT INTO public.dealer_return_items(
      dealer_return_id, sale_item_id, product_id, quantity,
      unit_price, imei_unit_id, is_damaged
    )
    VALUES (
      v_return_id, v_sale_item.id, v_sale_item.product_id, v_quantity,
      v_sale_item.unit_price, v_unit_id, coalesce((v_item->>'is_damaged')::boolean, false)
    );

    IF v_unit_id IS NOT NULL THEN
      UPDATE public.imei_units
      SET status = 'in_dealer_stock',
          current_salesman = NULL,
          returned_at = now(),
          is_damaged = coalesce((v_item->>'is_damaged')::boolean, false)
      WHERE id = v_unit_id;
    END IF;
  END LOOP;

  IF coalesce(p_payload->>'refund_amount', '0') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Refund must be a non-negative amount with up to two decimals';
  END IF;
  v_refund := coalesce((p_payload->>'refund_amount')::numeric, 0);
  IF v_refund < 0 OR v_refund > v_total
     OR v_refund > v_sale.paid_amount - coalesce((
       SELECT sum(refund_amount)
       FROM public.dealer_returns
       WHERE sale_id = v_sale.id AND id <> v_return_id
     ), 0) THEN
    RAISE EXCEPTION 'Cash refund exceeds the paid amount available on the original invoice';
  END IF;

  UPDATE public.dealer_returns
  SET total_amount = v_total,
      refund_amount = v_refund,
      credit_amount = v_total - v_refund
  WHERE id = v_return_id;

  INSERT INTO public.posting_requests(actor_id, request_id, kind, payload, result_id)
  VALUES (v_actor, p_request_id, 'dealer_return', p_payload, v_return_id);
  RETURN v_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_dealer_return(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_dealer_return(uuid, jsonb) TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.dealer_returns, public.dealer_return_items FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.guard_button_phone_stock_issue() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_category text;
  v_available integer;
BEGIN
  SELECT category INTO v_category FROM public.products WHERE id = NEW.product_id;
  IF v_category <> 'button_phone' THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.product_id::text, 1));
  SELECT
    COALESCE((SELECT sum(i.quantity) FROM public.inventory_receipt_items i WHERE i.product_id = NEW.product_id), 0)
    - COALESCE((SELECT sum(i.quantity) FROM public.stock_issue_items i WHERE i.product_id = NEW.product_id), 0)
    + COALESCE((
      SELECT sum(r.quantity)
      FROM public.returns r
      WHERE r.product_id = NEW.product_id AND NOT r.is_damaged
    ), 0)
    + COALESCE((
      SELECT sum(i.quantity)
      FROM public.dealer_return_items i
      WHERE i.product_id = NEW.product_id AND NOT i.is_damaged
    ), 0)
  INTO v_available;
  IF NEW.quantity > v_available THEN
    RAISE EXCEPTION 'Insufficient company stock (% available)', v_available;
  END IF;
  RETURN NEW;
END;
$$;

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
    'inventoryReceiptItems', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_receipt_items t), '[]'::jsonb),
    'dealerReturns', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM public.dealer_returns t), '[]'::jsonb),
    'dealerReturnItems', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.dealer_return_items t), '[]'::jsonb)
  );
END;
$$;
