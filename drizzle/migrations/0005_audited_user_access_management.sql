CREATE TABLE public.access_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,target_id uuid NOT NULL,old_role public.app_role NOT NULL,new_role public.app_role NOT NULL,old_active boolean NOT NULL,new_active boolean NOT NULL,reason text NOT NULL,changed_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.access_audit TO authenticated;
GRANT ALL ON public.access_audit TO service_role;
ALTER TABLE public.access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY access_audit_admin_read ON public.access_audit FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()) AND public.has_role(auth.uid(),'admin'));
CREATE INDEX access_audit_changed_idx ON public.access_audit(changed_at DESC,id);
CREATE OR REPLACE FUNCTION public.access_control_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid;
BEGIN
actor:=public.require_active_account();
IF NOT public.has_role(actor,'admin') THEN RAISE EXCEPTION 'Admin required'; END IF;
RETURN jsonb_build_object('users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'is_active',p.is_active,'created_at',p.created_at,'role',CASE WHEN public.has_role(p.id,'admin') THEN 'admin' ELSE 'salesman' END) ORDER BY p.full_name,p.id) FROM public.profiles p WHERE public.has_role(p.id,'admin') OR public.has_role(p.id,'salesman')),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.access_control_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.access_control_snapshot() TO authenticated;
CREATE OR REPLACE FUNCTION public.manage_user_access(p_user_id uuid,p_role public.app_role,p_active boolean,p_expected_role public.app_role,p_expected_active boolean,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; old_role public.app_role; old_active boolean;
BEGIN
PERFORM pg_advisory_xact_lock(hashtextextended('fe-access-management',0));
actor:=public.require_active_account();
IF NOT public.has_role(actor,'admin') THEN RAISE EXCEPTION 'Admin required'; END IF;
IF p_role IS NULL OR p_active IS NULL OR p_expected_role IS NULL OR p_expected_active IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'A reason of 3 to 500 characters is required'; END IF;
SELECT is_active INTO old_active FROM public.profiles WHERE id=p_user_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'User unavailable'; END IF;
IF public.has_role(p_user_id,'admin') THEN old_role:='admin'; ELSIF public.has_role(p_user_id,'salesman') THEN old_role:='salesman'; ELSE RAISE EXCEPTION 'User has no managed role'; END IF;
IF old_role IS DISTINCT FROM p_expected_role OR old_active IS DISTINCT FROM p_expected_active THEN RAISE EXCEPTION 'Access changed; refresh and try again'; END IF;
IF old_role=p_role AND old_active=p_active THEN RETURN false; END IF;
IF p_user_id=actor THEN RAISE EXCEPTION 'You cannot change your own access'; END IF;
IF old_role='admin' AND old_active AND (p_role<>'admin' OR NOT p_active) AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id<>p_user_id AND p.is_active AND public.has_role(p.id,'admin')) THEN RAISE EXCEPTION 'At least one active admin must remain'; END IF;
IF old_role='salesman' AND p_role='admin' AND (EXISTS(SELECT 1 FROM public.stock_issues WHERE salesman_id=p_user_id) OR EXISTS(SELECT 1 FROM public.sales WHERE salesman_id=p_user_id) OR EXISTS(SELECT 1 FROM public.retailer_payments WHERE salesman_id=p_user_id) OR EXISTS(SELECT 1 FROM public.deposits WHERE salesman_id=p_user_id) OR EXISTS(SELECT 1 FROM public.returns WHERE salesman_id=p_user_id) OR EXISTS(SELECT 1 FROM public.imei_units WHERE current_salesman=p_user_id)) THEN RAISE EXCEPTION 'SR transaction history exists; keep the SR role to preserve stock and account access'; END IF;
IF old_role<>p_role THEN
 DELETE FROM public.user_roles WHERE user_id=p_user_id;
 INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,p_role);
END IF;
UPDATE public.profiles SET is_active=p_active WHERE id=p_user_id;
INSERT INTO public.access_audit(actor_id,target_id,old_role,new_role,old_active,new_active,reason) VALUES(actor,p_user_id,old_role,p_role,old_active,p_active,btrim(p_reason));
RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.manage_user_access(uuid,public.app_role,boolean,public.app_role,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_user_access(uuid,public.app_role,boolean,public.app_role,boolean,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_sr_active(p_user_id uuid,p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_active boolean;
BEGIN
PERFORM public.require_active_account();
IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin required'; END IF;
IF NOT public.has_role(p_user_id,'salesman') OR public.has_role(p_user_id,'admin') THEN RAISE EXCEPTION 'Select an SR account'; END IF;
SELECT is_active INTO current_active FROM public.profiles WHERE id=p_user_id;
PERFORM public.manage_user_access(p_user_id,'salesman',p_active,'salesman',current_active,'SR account status control');
END; $$;