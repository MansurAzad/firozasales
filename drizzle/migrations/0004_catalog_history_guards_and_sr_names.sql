CREATE OR REPLACE FUNCTION public.guard_catalog_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
IF TG_OP='DELETE' THEN
 IF TG_TABLE_NAME='products' AND (EXISTS(SELECT 1 FROM public.imei_units WHERE product_id=OLD.id) OR EXISTS(SELECT 1 FROM public.stock_issue_items WHERE product_id=OLD.id) OR EXISTS(SELECT 1 FROM public.sale_items WHERE product_id=OLD.id) OR EXISTS(SELECT 1 FROM public.returns WHERE product_id=OLD.id)) THEN RAISE EXCEPTION 'Stock or history exists; deactivate this product instead'; END IF;
 IF TG_TABLE_NAME='retailers' AND (EXISTS(SELECT 1 FROM public.sales WHERE retailer_id=OLD.id) OR EXISTS(SELECT 1 FROM public.retailer_payments WHERE retailer_id=OLD.id)) THEN RAISE EXCEPTION 'Transaction history exists; deactivate this dealer instead'; END IF;
 RETURN OLD;
END IF;
IF length(btrim(NEW.name))=0 THEN RAISE EXCEPTION 'Name is required'; END IF;
IF TG_TABLE_NAME='products' THEN
 IF NEW.price<0 OR NEW.price::text IN ('NaN','Infinity','-Infinity') OR NEW.price<>round(NEW.price,2) THEN RAISE EXCEPTION 'Invalid product price'; END IF;
END IF;
RETURN NEW;
END; $$;
CREATE TRIGGER products_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_history();
CREATE TRIGGER retailers_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.retailers FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_history();
CREATE OR REPLACE FUNCTION public.set_sr_name(p_user_id uuid,p_full_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid;
BEGIN
actor:=public.require_active_account();
IF NOT public.has_role(actor,'admin') THEN RAISE EXCEPTION 'Admin required'; END IF;
IF NOT public.has_role(p_user_id,'salesman') OR public.has_role(p_user_id,'admin') THEN RAISE EXCEPTION 'Select an SR account'; END IF;
IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;
UPDATE public.profiles SET full_name=btrim(p_full_name) WHERE id=p_user_id;
IF NOT FOUND THEN RAISE EXCEPTION 'SR unavailable'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_sr_name(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_sr_name(uuid,text) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.imei_units FROM authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.stock_issues,public.stock_issue_items,public.sales,public.sale_items,public.retailer_payments,public.settlements,public.deposits,public.returns FROM authenticated;