-- Switch on suspension enforcement for every PostgREST request.
-- Reversible: alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
alter role authenticator set pgrst.db_pre_request = 'public.gayze_pre_request';
notify pgrst, 'reload config';
