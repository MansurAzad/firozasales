CREATE TABLE public.catalog_requests (actor_id uuid NOT NULL REFERENCES public.profiles(id), request_id uuid NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id));
GRANT SELECT ON public.catalog_requests TO authenticated;
GRANT ALL ON public.catalog_requests TO service_role;
ALTER TABLE public.catalog_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_own_read ON public.catalog_requests FOR SELECT TO authenticated USING(actor_id=auth.uid());
CREATE OR REPLACE FUNCTION public.post_catalog(p_request_id uuid,p_payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); old_payload jsonb; tbl text:=p_payload->>'table'; act text:=p_payload->>'action'; row jsonb; uid uuid;
BEGIN
PERFORM public.require_active_account();
IF NOT public.has_role(actor,'admin') THEN RAISE EXCEPTION 'Admin required'; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
SELECT payload INTO old_payload FROM public.catalog_requests WHERE actor_id=actor AND request_id=p_request_id;
IF FOUND THEN IF old_payload<>p_payload THEN RAISE EXCEPTION 'Request payload mismatch'; END IF; RETURN; END IF;
IF tbl NOT IN ('products','retailers','imeiUnits') OR act NOT IN ('insert','update','delete') OR jsonb_typeof(p_payload->'rows')<>'array' THEN RAISE EXCEPTION 'Invalid catalog action'; END IF;
FOR row IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
uid:=(row->>'id')::uuid;
IF tbl='products' THEN
 IF act='insert' THEN INSERT INTO public.products(id,name,model,price,category) VALUES(uid,row->>'name',coalesce(row->>'model',''),coalesce((row->>'price')::numeric,0),row->>'category');
 ELSIF act='delete' THEN DELETE FROM public.products WHERE id=uid;
 ELSE UPDATE public.products SET name=coalesce(row->>'name',name),model=coalesce(row->>'model',model),price=coalesce((row->>'price')::numeric,price),is_active=coalesce((row->>'is_active')::boolean,is_active) WHERE id=uid; END IF;
ELSIF tbl='retailers' THEN
 IF act='insert' THEN INSERT INTO public.retailers(id,name,phone,address) VALUES(uid,row->>'name',coalesce(row->>'phone',''),coalesce(row->>'address',''));
 ELSIF act='delete' THEN DELETE FROM public.retailers WHERE id=uid;
 ELSE UPDATE public.retailers SET name=coalesce(row->>'name',name),phone=coalesce(row->>'phone',phone),address=coalesce(row->>'address',address),is_active=coalesce((row->>'is_active')::boolean,is_active) WHERE id=uid; END IF;
ELSE
 IF act<>'insert' THEN RAISE EXCEPTION 'IMEI stock transitions require transaction posting'; END IF;
 INSERT INTO public.imei_units(id,product_id,imei) VALUES(uid,(row->>'product_id')::uuid,row->>'imei');
END IF;
END LOOP;
FOR row IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'units','[]'::jsonb)) LOOP
IF tbl<>'products' OR act<>'insert' THEN RAISE EXCEPTION 'Invalid attached IMEI units'; END IF;
INSERT INTO public.imei_units(id,product_id,imei) VALUES((row->>'id')::uuid,(row->>'product_id')::uuid,row->>'imei');
END LOOP;
INSERT INTO public.catalog_requests(actor_id,request_id,payload) VALUES(actor,p_request_id,p_payload);
END;$$;
REVOKE ALL ON FUNCTION public.post_catalog(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_catalog(uuid,jsonb) TO authenticated,service_role;