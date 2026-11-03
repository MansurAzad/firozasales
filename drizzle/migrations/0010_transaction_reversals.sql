ALTER TABLE public.imei_units
  ADD COLUMN is_voided boolean NOT NULL DEFAULT false;

CREATE TABLE public.transaction_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_kind text NOT NULL CHECK (
    transaction_kind IN ('issue', 'sale', 'payment', 'settlement', 'inventory_receipt', 'dealer_return')
  ),
  transaction_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  reversed_by uuid NOT NULL REFERENCES public.profiles(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  source_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_kind, transaction_id)
);

ALTER TABLE public.transaction_reversals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.transaction_reversals TO authenticated;
GRANT ALL ON public.transaction_reversals TO service_role;

CREATE POLICY transaction_reversals_read_admin
  ON public.transaction_reversals FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.transaction_reversals FROM authenticated, anon;

CREATE FUNCTION public.guard_transaction_reversal_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Transaction reversal audit is immutable';
END;
$$;

CREATE TRIGGER transaction_reversals_immutable
  BEFORE UPDATE OR DELETE ON public.transaction_reversals
  FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_reversal_immutable();

CREATE FUNCTION public.transaction_is_reversed(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.transaction_reversals r
    WHERE r.transaction_kind = p_kind AND r.transaction_id = p_id
  );
$$;
REVOKE ALL ON FUNCTION public.transaction_is_reversed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transaction_is_reversed(text, uuid) TO authenticated;

CREATE FUNCTION public.company_stock_quantity(p_product_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((
      SELECT sum(i.quantity)
      FROM public.inventory_receipt_items i
      WHERE i.product_id = p_product_id
        AND NOT public.transaction_is_reversed('inventory_receipt', i.receipt_id)
    ), 0)
    - COALESCE((
      SELECT sum(i.quantity)
      FROM public.stock_issue_items i
      JOIN public.stock_issues h ON h.id = i.issue_id
      WHERE i.product_id = p_product_id
        AND NOT public.transaction_is_reversed('issue', h.id)
    ), 0)
    + COALESCE((
      SELECT sum(r.quantity)
      FROM public.returns r
      WHERE r.product_id = p_product_id
        AND NOT public.transaction_is_reversed('settlement', r.settlement_id)
        AND NOT r.is_damaged
    ), 0)
    + COALESCE((
      SELECT sum(i.quantity)
      FROM public.dealer_return_items i
      JOIN public.dealer_returns h ON h.id = i.dealer_return_id
      WHERE i.product_id = p_product_id
        AND NOT public.transaction_is_reversed('dealer_return', h.id)
        AND NOT i.is_damaged
    ), 0);
$$;
REVOKE ALL ON FUNCTION public.company_stock_quantity(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_stock_quantity(uuid) FROM authenticated;

CREATE FUNCTION public.salesman_stock_quantity(p_salesman_id uuid, p_product_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((
      SELECT sum(i.quantity)
      FROM public.stock_issue_items i
      JOIN public.stock_issues h ON h.id = i.issue_id
      WHERE h.salesman_id = p_salesman_id
        AND i.product_id = p_product_id
        AND NOT public.transaction_is_reversed('issue', h.id)
    ), 0)
    - COALESCE((
      SELECT sum(i.quantity)
      FROM public.sale_items i
      JOIN public.sales h ON h.id = i.sale_id
      WHERE h.salesman_id = p_salesman_id
        AND i.product_id = p_product_id
        AND NOT public.transaction_is_reversed('sale', h.id)
    ), 0)
    - COALESCE((
      SELECT sum(r.quantity)
      FROM public.returns r
      WHERE r.salesman_id = p_salesman_id
        AND r.product_id = p_product_id
        AND NOT public.transaction_is_reversed('settlement', r.settlement_id)
    ), 0);
$$;
REVOKE ALL ON FUNCTION public.salesman_stock_quantity(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salesman_stock_quantity(uuid, uuid) FROM authenticated;

CREATE FUNCTION public.has_active_followup(p_salesman_id uuid, p_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.salesman_id = p_salesman_id AND s.sold_at > p_at
        AND NOT public.transaction_is_reversed('sale', s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.retailer_payments p
      WHERE p.salesman_id = p_salesman_id AND p.paid_at > p_at
        AND NOT public.transaction_is_reversed('payment', p.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.stock_issues i
      WHERE i.salesman_id = p_salesman_id AND i.issued_at > p_at
        AND NOT public.transaction_is_reversed('issue', i.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.settlements s
      WHERE s.salesman_id = p_salesman_id AND s.created_at > p_at
        AND NOT public.transaction_is_reversed('settlement', s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.dealer_returns r
      WHERE r.salesman_id = p_salesman_id AND r.created_at > p_at
        AND NOT public.transaction_is_reversed('dealer_return', r.id)
    );
$$;
REVOKE ALL ON FUNCTION public.has_active_followup(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_followup(uuid, timestamptz) FROM authenticated;

CREATE FUNCTION public.reverse_transaction(
  p_kind text,
  p_transaction_id uuid,
  p_reason text,
  p_physical_confirmed boolean,
  p_request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_salesman uuid;
  v_at timestamptz;
  v_amount numeric := 0;
  v_cash_on_hand numeric := 0;
  v_source_snapshot jsonb;
  v_return_id uuid;
  v_receipt_id uuid;
  v_unit record;
  v_row record;
BEGIN
  v_actor := public.require_active_account();
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Admin required';
  END IF;
  IF p_kind IS NULL
     OR p_kind NOT IN ('issue', 'sale', 'payment', 'settlement', 'inventory_receipt', 'dealer_return')
     OR p_transaction_id IS NULL
     OR p_request_id IS NULL
     OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'Select a valid transaction and provide a reason (8-500 characters)';
  END IF;
  IF p_physical_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm that the physical stock and cash movements have been verified';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('reversal:' || p_kind || ':' || p_transaction_id::text, 0));
  SELECT r.id INTO v_return_id
  FROM public.transaction_reversals r
  WHERE r.reversed_by = v_actor AND r.request_id = p_request_id;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.transaction_reversals r
      WHERE r.id = v_return_id AND r.transaction_kind = p_kind
        AND r.transaction_id = p_transaction_id AND r.reason = btrim(p_reason)
    ) THEN
      RAISE EXCEPTION 'Retry payload changed; start a new reversal request';
    END IF;
    RETURN v_return_id;
  END IF;
  IF public.transaction_is_reversed(p_kind, p_transaction_id) THEN
    RAISE EXCEPTION 'Transaction has already been reversed';
  END IF;

  IF p_kind = 'sale' THEN
    SELECT s.salesman_id, s.sold_at, s.paid_amount
    INTO v_salesman, v_at, v_amount
    FROM public.sales s WHERE s.id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
    PERFORM 1 FROM public.profiles WHERE id = v_salesman FOR UPDATE;
    IF public.has_active_followup(v_salesman, v_at) THEN
      RAISE EXCEPTION 'Reverse later active transactions first';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dealer_returns r WHERE r.sale_id = p_transaction_id
      AND NOT public.transaction_is_reversed('dealer_return', r.id)) THEN
      RAISE EXCEPTION 'Reverse linked dealer returns first';
    END IF;
    SELECT COALESCE(sum(s.paid_amount), 0) + COALESCE((
      SELECT sum(p.amount) FROM public.retailer_payments p
      WHERE p.salesman_id = v_salesman
        AND NOT public.transaction_is_reversed('payment', p.id)
    ), 0) - COALESCE((
      SELECT sum(d.amount) FROM public.deposits d
      WHERE d.salesman_id = v_salesman
        AND NOT public.transaction_is_reversed('settlement', d.settlement_id)
    ), 0) - COALESCE((
      SELECT sum(r.refund_amount) FROM public.dealer_returns r
      WHERE r.salesman_id = v_salesman
        AND NOT public.transaction_is_reversed('dealer_return', r.id)
    ), 0)
    INTO v_cash_on_hand
    FROM public.sales s
    WHERE s.salesman_id = v_salesman
      AND NOT public.transaction_is_reversed('sale', s.id);
    IF v_cash_on_hand < v_amount THEN
      RAISE EXCEPTION 'SR cash on hand is insufficient to reverse the cash paid at sale';
    END IF;
    FOR v_unit IN
      SELECT u.id
      FROM public.sale_items i
      JOIN public.imei_units u ON u.id = i.imei_unit_id
      WHERE i.sale_id = p_transaction_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.imei_units u
        WHERE u.id = v_unit.id AND u.status = 'sold' AND NOT u.is_voided
      ) THEN
        RAISE EXCEPTION 'Sold IMEI is no longer at the expected location';
      END IF;
      UPDATE public.imei_units
      SET status = 'with_salesman', current_salesman = v_salesman
      WHERE id = v_unit.id;
    END LOOP;
    SELECT jsonb_build_object(
      'transaction', to_jsonb(s),
      'items', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.sale_items i WHERE i.sale_id = s.id), '[]'::jsonb)
    ) INTO v_source_snapshot
    FROM public.sales s WHERE s.id = p_transaction_id;

  ELSIF p_kind = 'issue' THEN
    SELECT i.salesman_id, i.issued_at
    INTO v_salesman, v_at
    FROM public.stock_issues i WHERE i.id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock issue not found'; END IF;
    PERFORM 1 FROM public.profiles WHERE id = v_salesman FOR UPDATE;
    IF public.has_active_followup(v_salesman, v_at) THEN
      RAISE EXCEPTION 'Reverse later active transactions first';
    END IF;
    FOR v_row IN
      SELECT i.product_id, sum(i.quantity)::integer AS quantity, p.category
      FROM public.stock_issue_items i
      JOIN public.products p ON p.id = i.product_id
      WHERE i.issue_id = p_transaction_id
      GROUP BY i.product_id, p.category
    LOOP
      IF v_row.category = 'button_phone'
         AND public.salesman_stock_quantity(v_salesman, v_row.product_id) < v_row.quantity THEN
        RAISE EXCEPTION 'SR button-phone stock is not physically available for this reversal';
      END IF;
    END LOOP;
    FOR v_unit IN
      SELECT u.id
      FROM public.stock_issue_items i
      JOIN public.imei_units u ON u.id = i.imei_unit_id
      WHERE i.issue_id = p_transaction_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.imei_units u
        WHERE u.id = v_unit.id AND u.status = 'with_salesman'
          AND u.current_salesman = v_salesman AND NOT u.is_voided
      ) THEN
        RAISE EXCEPTION 'Issued IMEI is no longer held by this SR';
      END IF;
      UPDATE public.imei_units
      SET status = 'in_dealer_stock', current_salesman = NULL
      WHERE id = v_unit.id;
    END LOOP;
    SELECT jsonb_build_object(
      'transaction', to_jsonb(h),
      'items', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.stock_issue_items i WHERE i.issue_id = h.id), '[]'::jsonb)
    ) INTO v_source_snapshot
    FROM public.stock_issues h WHERE h.id = p_transaction_id;

  ELSIF p_kind = 'payment' THEN
    SELECT p.salesman_id, p.paid_at, p.amount
    INTO v_salesman, v_at, v_amount
    FROM public.retailer_payments p WHERE p.id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
    PERFORM 1 FROM public.profiles WHERE id = v_salesman FOR UPDATE;
    SELECT COALESCE(sum(s.paid_amount), 0) + COALESCE((
      SELECT sum(p.amount) FROM public.retailer_payments p
      WHERE p.salesman_id = v_salesman
        AND NOT public.transaction_is_reversed('payment', p.id)
    ), 0) - COALESCE((
      SELECT sum(d.amount) FROM public.deposits d
      WHERE d.salesman_id = v_salesman
        AND NOT public.transaction_is_reversed('settlement', d.settlement_id)
    ), 0) - COALESCE((
      SELECT sum(r.refund_amount) FROM public.dealer_returns r
      WHERE r.salesman_id = v_salesman
        AND NOT public.transaction_is_reversed('dealer_return', r.id)
    ), 0)
    INTO v_cash_on_hand
    FROM public.sales s
    WHERE s.salesman_id = v_salesman
      AND NOT public.transaction_is_reversed('sale', s.id);
    IF v_cash_on_hand < v_amount THEN
      RAISE EXCEPTION 'SR cash on hand is insufficient to reverse this payment';
    END IF;
    SELECT to_jsonb(p) INTO v_source_snapshot
    FROM public.retailer_payments p WHERE p.id = p_transaction_id;

  ELSIF p_kind = 'settlement' THEN
    SELECT s.salesman_id, s.created_at
    INTO v_salesman, v_at
    FROM public.settlements s WHERE s.id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
    PERFORM 1 FROM public.profiles WHERE id = v_salesman FOR UPDATE;
    IF public.has_active_followup(v_salesman, v_at) THEN
      RAISE EXCEPTION 'Reverse later active transactions first';
    END IF;
    FOR v_row IN
      SELECT DISTINCT r.product_id
      FROM public.returns r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.settlement_id = p_transaction_id AND p.category = 'button_phone'
      ORDER BY r.product_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(v_row.product_id::text, 1));
    END LOOP;
    FOR v_row IN
      SELECT r.product_id, sum(r.quantity)::integer AS quantity, p.category
      FROM public.returns r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.settlement_id = p_transaction_id AND NOT r.is_damaged
      GROUP BY r.product_id, p.category
    LOOP
      IF v_row.category = 'button_phone'
         AND public.company_stock_quantity(v_row.product_id) < v_row.quantity THEN
        RAISE EXCEPTION 'Company button-phone stock is no longer available for this reversal';
      END IF;
    END LOOP;
    FOR v_unit IN
      SELECT u.id, r.is_damaged
      FROM public.returns r
      JOIN public.imei_units u ON u.id = r.imei_unit_id
      WHERE r.settlement_id = p_transaction_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.imei_units u
        WHERE u.id = v_unit.id AND u.status = 'in_dealer_stock' AND NOT u.is_voided
      ) THEN
        RAISE EXCEPTION 'Returned IMEI is no longer in company stock';
      END IF;
      UPDATE public.imei_units
      SET status = 'with_salesman', current_salesman = v_salesman,
          is_damaged = v_unit.is_damaged
      WHERE id = v_unit.id;
    END LOOP;
    SELECT jsonb_build_object(
      'transaction', to_jsonb(s),
      'returns', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.returns r WHERE r.settlement_id = s.id), '[]'::jsonb),
      'deposits', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.deposits d WHERE d.settlement_id = s.id), '[]'::jsonb)
    ) INTO v_source_snapshot
    FROM public.settlements s WHERE s.id = p_transaction_id;

  ELSIF p_kind = 'inventory_receipt' THEN
    SELECT r.id INTO v_receipt_id
    FROM public.inventory_receipts r WHERE r.id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventory receipt not found'; END IF;
    FOR v_row IN
      SELECT DISTINCT i.product_id
      FROM public.inventory_receipt_items i
      WHERE i.receipt_id = p_transaction_id
      ORDER BY i.product_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(v_row.product_id::text, 1));
    END LOOP;
    FOR v_row IN
      SELECT i.product_id, sum(i.quantity)::integer AS quantity
      FROM public.inventory_receipt_items i
      WHERE i.receipt_id = p_transaction_id
      GROUP BY i.product_id
    LOOP
      IF public.company_stock_quantity(v_row.product_id) < v_row.quantity THEN
        RAISE EXCEPTION 'Received stock has downstream activity; reverse that activity first';
      END IF;
    END LOOP;
    FOR v_unit IN
      SELECT u.id
      FROM public.inventory_receipt_items i
      JOIN public.imei_units u ON u.receipt_item_id = i.id
      WHERE i.receipt_id = p_transaction_id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.imei_units u
        WHERE u.id = v_unit.id AND u.status = 'in_dealer_stock'
          AND NOT u.is_voided
      ) OR EXISTS (
        SELECT 1 FROM public.stock_issue_items i WHERE i.imei_unit_id = v_unit.id
      ) OR EXISTS (
        SELECT 1 FROM public.sale_items i WHERE i.imei_unit_id = v_unit.id
      ) OR EXISTS (
        SELECT 1 FROM public.returns r WHERE r.imei_unit_id = v_unit.id
      ) OR EXISTS (
        SELECT 1 FROM public.dealer_return_items i WHERE i.imei_unit_id = v_unit.id
      ) THEN
        RAISE EXCEPTION 'Received IMEI has downstream activity';
      END IF;
      UPDATE public.imei_units SET is_voided = true WHERE id = v_unit.id;
    END LOOP;
    SELECT jsonb_build_object(
      'transaction', to_jsonb(r),
      'items', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.inventory_receipt_items i WHERE i.receipt_id = r.id), '[]'::jsonb)
    ) INTO v_source_snapshot
    FROM public.inventory_receipts r WHERE r.id = p_transaction_id;

  ELSE
    SELECT r.salesman_id, r.created_at, r.refund_amount
    INTO v_salesman, v_at, v_amount
    FROM public.dealer_returns r WHERE r.id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dealer return not found'; END IF;
    PERFORM 1 FROM public.profiles WHERE id = v_salesman FOR UPDATE;
    PERFORM 1 FROM public.sales
    WHERE id = (SELECT sale_id FROM public.dealer_returns WHERE id = p_transaction_id)
    FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.dealer_returns r
      WHERE r.sale_id = (SELECT sale_id FROM public.dealer_returns WHERE id = p_transaction_id)
        AND r.created_at > v_at
        AND NOT public.transaction_is_reversed('dealer_return', r.id)
    ) THEN
      RAISE EXCEPTION 'Reverse later returns against this invoice first';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.dealer_return_items i
      JOIN public.products p ON p.id = i.product_id
      JOIN public.stock_issue_items ii ON ii.product_id = i.product_id
      JOIN public.stock_issues ih ON ih.id = ii.issue_id
      WHERE i.dealer_return_id = p_transaction_id
        AND p.category = 'button_phone'
        AND ih.issued_at > v_at
        AND NOT public.transaction_is_reversed('issue', ih.id)
    ) THEN
      RAISE EXCEPTION 'Returned stock has been issued again; reverse that issue first';
    END IF;
    FOR v_row IN
      SELECT i.product_id, sum(i.quantity)::integer AS quantity
      FROM public.dealer_return_items i
      JOIN public.products p ON p.id = i.product_id
      WHERE i.dealer_return_id = p_transaction_id
        AND p.category = 'button_phone' AND NOT i.is_damaged
      GROUP BY i.product_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(v_row.product_id::text, 1));
      IF public.company_stock_quantity(v_row.product_id) < v_row.quantity THEN
        RAISE EXCEPTION 'Returned button-phone stock is no longer in company stock';
      END IF;
    END LOOP;
    FOR v_unit IN
      SELECT u.id, i.is_damaged
      FROM public.dealer_return_items i
      JOIN public.imei_units u ON u.id = i.imei_unit_id
      WHERE i.dealer_return_id = p_transaction_id AND i.imei_unit_id IS NOT NULL
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.imei_units u
        WHERE u.id = v_unit.id AND u.status = 'in_dealer_stock' AND NOT u.is_voided
      ) THEN
        RAISE EXCEPTION 'Returned IMEI has downstream activity';
      END IF;
      UPDATE public.imei_units
      SET status = 'sold', current_salesman = NULL, is_damaged = v_unit.is_damaged
      WHERE id = v_unit.id;
    END LOOP;
    SELECT jsonb_build_object(
      'transaction', to_jsonb(r),
      'items', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.dealer_return_items i WHERE i.dealer_return_id = r.id), '[]'::jsonb)
    ) INTO v_source_snapshot
    FROM public.dealer_returns r WHERE r.id = p_transaction_id;
  END IF;

  INSERT INTO public.transaction_reversals(
    transaction_kind, transaction_id, request_id, reversed_by, reason, source_snapshot
  )
  VALUES (p_kind, p_transaction_id, p_request_id, v_actor, btrim(p_reason), v_source_snapshot)
  RETURNING id INTO v_return_id;
  RETURN v_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_transaction(text, uuid, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_transaction(text, uuid, text, boolean, uuid) TO authenticated;

CREATE FUNCTION public.guard_reversed_sale_dealer_return() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.transaction_is_reversed('sale', NEW.sale_id) THEN
    RAISE EXCEPTION 'Cannot return against a reversed invoice';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dealer_return_active_invoice_guard
  BEFORE INSERT ON public.dealer_returns
  FOR EACH ROW EXECUTE FUNCTION public.guard_reversed_sale_dealer_return();

CREATE OR REPLACE FUNCTION public.post_dealer_return(p_request_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF NOT FOUND OR public.transaction_is_reversed('sale', v_sale_id) THEN
    RAISE EXCEPTION 'Original invoice unavailable';
  END IF;
  IF length(coalesce(p_payload->>'note', '')) > 500 THEN
    RAISE EXCEPTION 'Return note is too long';
  END IF;
  v_note := btrim(coalesce(p_payload->>'note', ''));

  INSERT INTO public.dealer_returns(sale_id, retailer_id, salesman_id, created_by, note)
  VALUES (v_sale.id, v_sale.retailer_id, v_sale.salesman_id, v_actor, v_note)
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    SELECT si.* INTO v_sale_item
    FROM public.sale_items si
    WHERE si.id = v_sale_item_id AND si.sale_id = v_sale.id
    FOR UPDATE OF si;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item is not part of the selected invoice'; END IF;
    SELECT category INTO v_category FROM public.products WHERE id = v_sale_item.product_id;
    IF coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Return quantity must be a positive integer';
    END IF;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Return quantity must be a positive integer'; END IF;

    SELECT coalesce(sum(i.quantity), 0)
    INTO v_returned
    FROM public.dealer_return_items i
    JOIN public.dealer_returns r ON r.id = i.dealer_return_id
    WHERE i.sale_item_id = v_sale_item.id
      AND NOT public.transaction_is_reversed('dealer_return', r.id);
    IF v_quantity > v_sale_item.quantity - v_returned THEN
      RAISE EXCEPTION 'Return exceeds the unreturned invoice quantity';
    END IF;

    IF v_category = 'smartphone' THEN
      IF v_quantity <> 1 OR v_sale_item.imei_unit_id IS NULL THEN
        RAISE EXCEPTION 'Return one scanned smartphone IMEI at a time';
      END IF;
      v_unit_id := v_sale_item.imei_unit_id;
      SELECT * INTO v_unit FROM public.imei_units WHERE id = v_unit_id FOR UPDATE;
      IF NOT FOUND OR v_unit.status <> 'sold' OR v_unit.product_id <> v_sale_item.product_id
         OR v_unit.is_voided THEN
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
      SET status = 'in_dealer_stock', current_salesman = NULL,
          returned_at = now(), is_damaged = coalesce((v_item->>'is_damaged')::boolean, false)
      WHERE id = v_unit_id;
    END IF;
  END LOOP;

  IF coalesce(p_payload->>'refund_amount', '0') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Refund must be a non-negative amount with up to two decimals';
  END IF;
  v_refund := coalesce((p_payload->>'refund_amount')::numeric, 0);
  IF v_refund < 0 OR v_refund > v_total
     OR v_refund > v_sale.paid_amount - coalesce((
       SELECT sum(r.refund_amount)
       FROM public.dealer_returns r
       WHERE r.sale_id = v_sale.id AND r.id <> v_return_id
         AND NOT public.transaction_is_reversed('dealer_return', r.id)
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

CREATE OR REPLACE FUNCTION public.guard_button_phone_stock_issue() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_category text;
  v_available integer;
BEGIN
  SELECT category INTO v_category FROM public.products WHERE id = NEW.product_id;
  IF v_category <> 'button_phone' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.product_id::text, 1));
  v_available := public.company_stock_quantity(NEW.product_id);
  IF NEW.quantity > v_available THEN
    RAISE EXCEPTION 'Insufficient company stock (% available)', v_available;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_transaction(
  p_kind text,
  p_payload jsonb,
  p_request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_sr uuid;
  v_admin boolean;
  v_result uuid;
  v_receipt public.posting_requests%rowtype;
  v_item jsonb;
  v_unit_json jsonb;
  v_product public.products%rowtype;
  v_unit public.imei_units%rowtype;
  v_qty integer;
  v_price numeric;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining integer;
  v_available numeric;
  v_deposit_total numeric := 0;
  v_retailer uuid;
  v_damage boolean;
BEGIN
  v_actor := public.require_active_account();
  v_admin := public.has_role(v_actor, 'admin');
  IF p_request_id IS NULL OR p_payload IS NULL
     OR p_kind NOT IN ('issue', 'sale', 'settlement', 'payment') THEN
    RAISE EXCEPTION 'Invalid posting request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));
  SELECT * INTO v_receipt FROM public.posting_requests
  WHERE actor_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.kind <> p_kind OR v_receipt.payload <> p_payload THEN
      RAISE EXCEPTION 'Retry payload changed; start a new request';
    END IF;
    RETURN v_receipt.result_id;
  END IF;

  v_sr := CASE WHEN v_admin
    THEN coalesce(nullif(p_payload->>'salesman_id', '')::uuid, v_actor)
    ELSE v_actor END;
  IF NOT v_admin AND p_payload ? 'salesman_id'
     AND (p_payload->>'salesman_id')::uuid IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Cannot post for another SR';
  END IF;
  IF p_kind = 'issue' AND NOT v_admin THEN
    RAISE EXCEPTION 'Only admin can issue stock';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_sr AND is_active FOR UPDATE;
  IF NOT FOUND OR NOT public.has_role(v_sr, 'salesman') THEN
    RAISE EXCEPTION 'Select an active SR';
  END IF;
  IF p_kind IN ('sale', 'payment') THEN
    v_retailer := (p_payload->>'retailer_id')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.retailers WHERE id = v_retailer AND is_active
    ) THEN
      RAISE EXCEPTION 'Select an active dealer';
    END IF;
  END IF;

  IF p_kind IN ('issue', 'sale') THEN
    IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_payload->'items') = 0 THEN
      RAISE EXCEPTION 'Add stock items';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or inactive product'; END IF;
      IF v_product.category = 'smartphone' THEN
        IF jsonb_typeof(v_item->'unit_ids') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_item->'unit_ids') = 0 THEN
          RAISE EXCEPTION 'Scan at least one IMEI';
        END IF;
        v_qty := jsonb_array_length(v_item->'unit_ids');
      ELSE
        IF coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'Quantity must be a positive integer';
        END IF;
        v_qty := (v_item->>'quantity')::integer;
        IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be a positive integer'; END IF;
      END IF;
      IF p_kind = 'sale' THEN
        v_price := (v_item->>'unit_price')::numeric;
        IF v_price IS NULL OR v_price < 0
           OR v_price::text IN ('NaN', 'Infinity', '-Infinity')
           OR v_price <> round(v_price, 2) THEN
          RAISE EXCEPTION 'Invalid unit price';
        END IF;
        v_total := v_total + v_qty * v_price;
      END IF;
    END LOOP;

    IF p_kind = 'sale' THEN
      v_paid := coalesce((p_payload->>'paid_amount')::numeric, 0);
      IF v_paid < 0 OR v_paid > v_total
         OR v_paid::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_paid <> round(v_paid, 2) THEN
        RAISE EXCEPTION 'Cash must be between zero and sale total';
      END IF;
      INSERT INTO public.sales(salesman_id, retailer_id, total_amount, paid_amount, note)
      VALUES (v_sr, v_retailer, v_total, v_paid, coalesce(p_payload->>'note', ''))
      RETURNING id INTO v_result;
    ELSE
      INSERT INTO public.stock_issues(salesman_id, issued_by, note)
      VALUES (v_sr, v_actor, coalesce(p_payload->>'note', ''))
      RETURNING id INTO v_result;
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
      SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
      v_price := coalesce((v_item->>'unit_price')::numeric, 0);
      IF v_product.category = 'smartphone' THEN
        FOR v_unit_json IN SELECT value FROM jsonb_array_elements(v_item->'unit_ids') LOOP
          SELECT * INTO v_unit FROM public.imei_units
          WHERE id = (v_unit_json#>>'{}')::uuid FOR UPDATE;
          IF NOT FOUND OR v_unit.product_id IS DISTINCT FROM v_product.id
             OR v_unit.is_damaged OR v_unit.is_voided THEN
            RAISE EXCEPTION 'Unknown, mismatched, damaged or reversed IMEI';
          END IF;
          IF p_kind = 'issue' THEN
            IF v_unit.status <> 'in_dealer_stock' THEN
              RAISE EXCEPTION 'IMEI is not in company stock';
            END IF;
            INSERT INTO public.stock_issue_items(issue_id, product_id, quantity, imei_unit_id)
            VALUES (v_result, v_product.id, 1, v_unit.id);
            UPDATE public.imei_units
            SET status = 'with_salesman', current_salesman = v_sr, issued_at = now()
            WHERE id = v_unit.id;
          ELSE
            IF v_unit.status <> 'with_salesman'
               OR v_unit.current_salesman IS DISTINCT FROM v_sr THEN
              RAISE EXCEPTION 'IMEI is not held by this SR';
            END IF;
            INSERT INTO public.sale_items(sale_id, product_id, quantity, unit_price, imei_unit_id)
            VALUES (v_result, v_product.id, 1, v_price, v_unit.id);
            UPDATE public.imei_units
            SET status = 'sold', current_salesman = NULL, sold_at = now()
            WHERE id = v_unit.id;
          END IF;
        END LOOP;
      ELSE
        v_qty := (v_item->>'quantity')::integer;
        IF p_kind = 'issue' THEN
          INSERT INTO public.stock_issue_items(issue_id, product_id, quantity)
          VALUES (v_result, v_product.id, v_qty);
        ELSE
          v_remaining := public.salesman_stock_quantity(v_sr, v_product.id);
          IF v_qty > v_remaining THEN
            RAISE EXCEPTION 'Quantity exceeds SR stock (% remaining)', v_remaining;
          END IF;
          INSERT INTO public.sale_items(sale_id, product_id, quantity, unit_price)
          VALUES (v_result, v_product.id, v_qty, v_price);
        END IF;
      END IF;
    END LOOP;

  ELSIF p_kind = 'payment' THEN
    v_paid := (p_payload->>'amount')::numeric;
    SELECT
      coalesce((SELECT sum(s.total_amount - s.paid_amount) FROM public.sales s
        WHERE s.salesman_id = v_sr AND s.retailer_id = v_retailer
          AND NOT public.transaction_is_reversed('sale', s.id)), 0)
      - coalesce((SELECT sum(p.amount) FROM public.retailer_payments p
        WHERE p.salesman_id = v_sr AND p.retailer_id = v_retailer
          AND NOT public.transaction_is_reversed('payment', p.id)), 0)
    INTO v_available;
    IF v_paid IS NULL OR v_paid <= 0 OR v_paid > v_available
       OR v_paid::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_paid <> round(v_paid, 2) THEN
      RAISE EXCEPTION 'Payment exceeds dealer due or is invalid (% due)', v_available;
    END IF;
    INSERT INTO public.retailer_payments(salesman_id, retailer_id, amount, note)
    VALUES (v_sr, v_retailer, v_paid, coalesce(p_payload->>'note', ''))
    RETURNING id INTO v_result;

  ELSE
    IF jsonb_typeof(p_payload->'returns') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_payload->'deposits') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid settlement';
    END IF;
    IF jsonb_array_length(p_payload->'returns') + jsonb_array_length(p_payload->'deposits') = 0 THEN
      RAISE EXCEPTION 'Add a return or deposit';
    END IF;
    SELECT
      coalesce((SELECT sum(s.paid_amount) FROM public.sales s
        WHERE s.salesman_id = v_sr AND NOT public.transaction_is_reversed('sale', s.id)), 0)
      + coalesce((SELECT sum(p.amount) FROM public.retailer_payments p
        WHERE p.salesman_id = v_sr AND NOT public.transaction_is_reversed('payment', p.id)), 0)
      - coalesce((SELECT sum(d.amount) FROM public.deposits d
        WHERE d.salesman_id = v_sr
          AND NOT public.transaction_is_reversed('settlement', d.settlement_id)), 0)
      - coalesce((SELECT sum(r.refund_amount) FROM public.dealer_returns r
        WHERE r.salesman_id = v_sr
          AND NOT public.transaction_is_reversed('dealer_return', r.id)), 0)
    INTO v_available;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'deposits') LOOP
      v_paid := (v_item->>'amount')::numeric;
      IF v_paid IS NULL OR v_paid <= 0
         OR v_paid::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_paid <> round(v_paid, 2) THEN
        RAISE EXCEPTION 'Invalid deposit';
      END IF;
      v_deposit_total := v_deposit_total + v_paid;
    END LOOP;
    IF v_deposit_total > v_available THEN
      RAISE EXCEPTION 'Deposits exceed cash on hand (% available)', v_available;
    END IF;
    INSERT INTO public.settlements(salesman_id, note)
    VALUES (v_sr, coalesce(p_payload->>'note', ''))
    RETURNING id INTO v_result;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'returns') LOOP
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_item->>'product_id')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unknown return product'; END IF;
      v_damage := coalesce((v_item->>'is_damaged')::boolean, false);
      IF v_product.category = 'smartphone' THEN
        IF jsonb_typeof(v_item->'unit_ids') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_item->'unit_ids') = 0 THEN
          RAISE EXCEPTION 'Scan return IMEIs';
        END IF;
        FOR v_unit_json IN SELECT value FROM jsonb_array_elements(v_item->'unit_ids') LOOP
          SELECT * INTO v_unit FROM public.imei_units
          WHERE id = (v_unit_json#>>'{}')::uuid FOR UPDATE;
          IF NOT FOUND OR v_unit.product_id IS DISTINCT FROM v_product.id
             OR v_unit.status <> 'with_salesman'
             OR v_unit.current_salesman IS DISTINCT FROM v_sr OR v_unit.is_voided THEN
            RAISE EXCEPTION 'Wrong return IMEI';
          END IF;
          INSERT INTO public.returns(settlement_id, salesman_id, product_id, quantity, imei_unit_id, is_damaged)
          VALUES (v_result, v_sr, v_product.id, 1, v_unit.id, v_damage);
          UPDATE public.imei_units
          SET status = 'in_dealer_stock', current_salesman = NULL,
              returned_at = now(), is_damaged = v_damage
          WHERE id = v_unit.id;
        END LOOP;
      ELSE
        IF coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'Return quantity must be a positive integer';
        END IF;
        v_qty := (v_item->>'quantity')::integer;
        v_remaining := public.salesman_stock_quantity(v_sr, v_product.id);
        IF v_qty <= 0 OR v_qty > v_remaining THEN
          RAISE EXCEPTION 'Return exceeds SR stock (% remaining)', v_remaining;
        END IF;
        INSERT INTO public.returns(settlement_id, salesman_id, product_id, quantity, is_damaged)
        VALUES (v_result, v_sr, v_product.id, v_qty, v_damage);
      END IF;
    END LOOP;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'deposits') LOOP
      INSERT INTO public.deposits(settlement_id, salesman_id, amount, note)
      VALUES (v_result, v_sr, (v_item->>'amount')::numeric, coalesce(v_item->>'note', ''));
    END LOOP;
  END IF;

  INSERT INTO public.posting_requests(actor_id, request_id, kind, payload, result_id)
  VALUES (v_actor, p_request_id, p_kind, p_payload, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.post_transaction(text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_transaction(text, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accounting_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.require_active_account();
  RETURN jsonb_build_object(
    'profiles', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.profiles t), '[]'::jsonb),
    'roles', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.user_roles t), '[]'::jsonb),
    'products', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.products t), '[]'::jsonb),
    'imeiUnits', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.imei_units t WHERE NOT t.is_voided
    ), '[]'::jsonb),
    'retailers', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.retailers t), '[]'::jsonb),
    'sales', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sold_at DESC) FROM public.sales t
      WHERE NOT public.transaction_is_reversed('sale', t.id)
    ), '[]'::jsonb),
    'saleItems', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.sale_items t
      JOIN public.sales s ON s.id = t.sale_id
      WHERE NOT public.transaction_is_reversed('sale', s.id)
    ), '[]'::jsonb),
    'payments', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.paid_at DESC) FROM public.retailer_payments t
      WHERE NOT public.transaction_is_reversed('payment', t.id)
    ), '[]'::jsonb),
    'deposits', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.deposited_at DESC) FROM public.deposits t
      WHERE NOT public.transaction_is_reversed('settlement', t.settlement_id)
    ), '[]'::jsonb),
    'returns', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.returns t
      WHERE NOT public.transaction_is_reversed('settlement', t.settlement_id)
    ), '[]'::jsonb),
    'stockIssues', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.issued_at DESC) FROM public.stock_issues t
      WHERE NOT public.transaction_is_reversed('issue', t.id)
    ), '[]'::jsonb),
    'issueItems', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.stock_issue_items t
      JOIN public.stock_issues h ON h.id = t.issue_id
      WHERE NOT public.transaction_is_reversed('issue', h.id)
    ), '[]'::jsonb),
    'settlements', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM public.settlements t
      WHERE NOT public.transaction_is_reversed('settlement', t.id)
    ), '[]'::jsonb),
    'inventoryReceipts', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.received_at DESC) FROM public.inventory_receipts t
      WHERE NOT public.transaction_is_reversed('inventory_receipt', t.id)
    ), '[]'::jsonb),
    'inventoryReceiptItems', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_receipt_items t
      JOIN public.inventory_receipts r ON r.id = t.receipt_id
      WHERE NOT public.transaction_is_reversed('inventory_receipt', r.id)
    ), '[]'::jsonb),
    'dealerReturns', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM public.dealer_returns t
      WHERE NOT public.transaction_is_reversed('dealer_return', t.id)
    ), '[]'::jsonb),
    'dealerReturnItems', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.dealer_return_items t
      JOIN public.dealer_returns r ON r.id = t.dealer_return_id
      WHERE NOT public.transaction_is_reversed('dealer_return', r.id)
    ), '[]'::jsonb),
    'transactionReversals', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC)
      FROM public.transaction_reversals t
    ), '[]'::jsonb)
  );
END;
$$;
