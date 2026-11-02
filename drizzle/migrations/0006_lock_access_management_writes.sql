REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.user_roles FROM authenticated,anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.access_audit FROM authenticated,anon;
GRANT SELECT ON public.user_roles,public.access_audit TO authenticated;
GRANT ALL ON public.user_roles,public.access_audit TO service_role;