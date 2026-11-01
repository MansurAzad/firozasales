CREATE OR REPLACE FUNCTION public.is_active_staff(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.is_active)
     AND (public.has_role(_uid,'admin') OR public.has_role(_uid,'salesman'));
$$;
REVOKE EXECUTE ON FUNCTION public.is_active_staff(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_active_staff(uuid) TO authenticated;
DROP POLICY IF EXISTS "retailers: read" ON public.retailers;
CREATE POLICY "retailers: read active staff" ON public.retailers FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
DROP POLICY IF EXISTS "products: read" ON public.products;
CREATE POLICY "products: read active staff" ON public.products FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));