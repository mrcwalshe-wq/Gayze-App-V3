diff --git a/supabase/pending/inspect_discover_right_now.sql b/supabase/pending/inspect_discover_right_now.sql
new file mode 100644
index 0000000..1474822
--- /dev/null
+++ b/supabase/pending/inspect_discover_right_now.sql
@@ -0,0 +1,217 @@
+-- ============================================================================
+-- READ-ONLY INSPECTION of the live public.discover_right_now
+-- Project: qdewyupsqmtonkloqxsh   (run in Supabase Dashboard -> SQL Editor)
+-- ============================================================================
+-- Every statement below is a SELECT. There is no DDL, no DML, no GRANT/REVOKE,
+-- no ALTER, and no function call with side effects. Running this cannot change
+-- the database.
+--
+-- Run the blocks in order. Queries 1 and 2 are the essential ones; 3-7 are
+-- supporting detail. Query 8 is the fallback if the editor truncates the body.
+--
+-- Paste the results back and the minimal 5 km migration will be prepared from
+-- the ACTUAL definition rather than from documentation.
+-- ============================================================================
+
+
+-- ---------------------------------------------------------------------------
+-- 1. LOCATE IT (and catch any overloads or a different schema)
+--    A function can be overloaded; if more than one row comes back, ALL of them
+--    matter, because PostgREST resolves by name plus argument types.
+-- ---------------------------------------------------------------------------
+select n.nspname                                   as schema_name,
+       p.proname                                   as function_name,
+       p.oid                                       as function_oid,
+       pg_get_function_identity_arguments(p.oid)   as identity_arguments,
+       p.prokind                                   as kind,        -- f=function p=procedure
+       p.proretset                                 as returns_setof
+from   pg_proc p
+join   pg_namespace n on n.oid = p.pronamespace
+where  p.proname = 'discover_right_now'
+order  by n.nspname, p.proname, p.oid;
+
+
+-- ---------------------------------------------------------------------------
+-- 2. THE COMPLETE DEFINITION  <-- the important one
+--    Returns signature, argument names/types/defaults, return type, LANGUAGE,
+--    SECURITY DEFINER/INVOKER, the SET search_path clause, and the entire body.
+--
+--    NOTE: pg_get_functiondef does NOT emit GRANT/REVOKE. Privileges live in
+--    pg_proc.proacl and are reported by Query 3.
+-- ---------------------------------------------------------------------------
+select pg_get_functiondef(p.oid) as definition
+from   pg_proc p
+join   pg_namespace n on n.oid = p.pronamespace
+where  n.nspname = 'public'
+and    p.proname = 'discover_right_now'
+order  by p.oid;
+
+
+-- ---------------------------------------------------------------------------
+-- 3. STRUCTURED METADATA (one row per overload, short columns)
+--    Covers security, volatility, parallel safety, strictness, leakproof,
+--    owner, config (search_path lives here) and privileges.
+-- ---------------------------------------------------------------------------
+select n.nspname                                        as schema_name,
+       p.proname                                        as function_name,
+       pg_get_function_identity_arguments(p.oid)        as identity_arguments,
+       pg_get_function_arguments(p.oid)                 as arguments_with_defaults,
+       pg_get_function_result(p.oid)                    as result_type,
+       p.proretset                                      as returns_setof,
+       l.lanname                                        as language,
+       case p.prosecdef
+         when true then 'SECURITY DEFINER'
+         else           'SECURITY INVOKER'
+       end                                              as security,
+       case p.provolatile
+         when 'i' then 'IMMUTABLE'
+         when 's' then 'STABLE'
+         when 'v' then 'VOLATILE'
+       end                                              as volatility,
+       case p.proparallel
+         when 's' then 'SAFE'
+         when 'r' then 'RESTRICTED'
+         when 'u' then 'UNSAFE'
+       end                                              as parallel_safety,
+       p.proisstrict                                    as is_strict,
+       p.proleakproof                                   as leakproof,
+       p.proconfig                                      as function_config,   -- search_path etc.
+       coalesce(r.rolname, '(none)')                    as owner,
+       coalesce(
+         array_to_string(p.proacl, E'\n'),
+         array_to_string(acldefault('f', p.proowner), E'\n')
+       )                                                as effective_privileges,
+       obj_description(p.oid, 'pg_proc')                as comment
+from   pg_proc p
+join   pg_namespace n on n.oid = p.pronamespace
+join   pg_language  l on l.oid = p.prolang
+left   join pg_roles r on r.oid = p.proowner
+where  n.nspname = 'public'
+and    p.proname = 'discover_right_now'
+order  by p.oid;
+
+
+-- ---------------------------------------------------------------------------
+-- 4. ARGUMENTS, ONE ROW EACH (easier to read than a single long string, and it
+--    distinguishes IN / OUT / INOUT / VARIADIC / TABLE columns explicitly)
+-- ---------------------------------------------------------------------------
+select p.oid                                            as function_oid,
+       g.ord                                            as position,
+       coalesce((p.proargnames)[g.ord], '(unnamed)')     as argument_name,
+       case coalesce((p.proargmodes)[g.ord], 'i')
+         when 'i' then 'IN'
+         when 'o' then 'OUT'
+         when 'b' then 'INOUT'
+         when 'v' then 'VARIADIC'
+         when 't' then 'TABLE'
+       end                                              as mode,
+       format_type((coalesce(p.proallargtypes, p.proargtypes))[g.ord], null)
+                                                        as data_type
+from   pg_proc p
+join   pg_namespace n on n.oid = p.pronamespace
+cross  join lateral generate_subscripts(
+         coalesce(p.proallargtypes, p.proargtypes), 1
+       ) as g(ord)
+where  n.nspname = 'public'
+and    p.proname = 'discover_right_now'
+order  by p.oid, g.ord;
+
+
+-- ---------------------------------------------------------------------------
+-- 5. search_path AND ANY OTHER SETTING
+--    Function-level SET clauses live in pg_proc.proconfig (NOT in
+--    pg_db_role_setting, which has no per-function column). Both are shown:
+--    the function's own config first, then any database/role-level settings
+--    that would also apply at call time.
+-- ---------------------------------------------------------------------------
+select 'function'                                     as scope,
+       '(all roles)'                                  as role_name,
+       p.proconfig                                    as settings
+from   pg_proc p
+join   pg_namespace n on n.oid = p.pronamespace
+where  n.nspname = 'public'
+and    p.proname = 'discover_right_now'
+union all
+select coalesce('database', 'cluster'),
+       coalesce(r.rolname, '(all roles)'),
+       s.setconfig
+from   pg_db_role_setting s
+left   join pg_roles r on r.oid = s.setrole
+order  by 1, 2;
+
+
+-- ---------------------------------------------------------------------------
+-- 6. CANDIDATE TABLES / SCHEMAS THE BODY TOUCHES
+--
+--    This is a HEURISTIC scan of the function text for identifiers that follow
+--    FROM / JOIN / INTO / UPDATE. It is NOT a parser:
+--      * CTE names, subquery aliases and temp names will appear too;
+--      * dynamic SQL built with format()/EXECUTE may be missed.
+--    Treat the output as a checklist to confirm against the body from Query 2,
+--    which is the authority.
+--
+--    (pg_depend is deliberately not used: Postgres records no table
+--    dependencies for function bodies, so it returns nothing here even for a
+--    LANGUAGE sql function. Verified.)
+-- ---------------------------------------------------------------------------
+select distinct lower(m[2]) as referenced_candidate
+from (
+  select pg_get_functiondef(p.oid) as def
+  from   pg_proc p
+  join   pg_namespace n on n.oid = p.pronamespace
+  where  n.nspname = 'public'
+  and    p.proname = 'discover_right_now'
+) f
+cross join lateral regexp_matches(
+  f.def,
+  '\y(from|join|into|update)\y\s+([A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)?)',
+  'gi'
+) as m
+order  by 1;
+
+
+-- ---------------------------------------------------------------------------
+-- 7. IS IT REACHABLE / WHO MAY CALL IT (effective execute privilege)
+--    Run this AS the role that actually calls it if you can; otherwise read the
+--    privileges column from Query 3.
+-- ---------------------------------------------------------------------------
+select current_user                                             as running_as,
+       has_function_privilege(current_user,
+                              'public.discover_right_now(double precision, text, text)',
+                              'EXECUTE')                         as can_execute_3arg_form;
+-- If the signature above does not exist, replace it with the exact
+-- identity_arguments string from Query 1, e.g.
+--   has_function_privilege(current_user,
+--     ('public.discover_right_now(' || <identity_arguments> || ')')::regprocedure,
+--     'EXECUTE')
+
+
+-- ---------------------------------------------------------------------------
+-- 8. FALLBACK IF THE EDITOR TRUNCATES THE BODY
+--    The Supabase SQL Editor grid clips long text. This splits the definition
+--    into ordered 4000-character chunks so nothing is lost. Paste the chunks
+--    back in order.
+-- ---------------------------------------------------------------------------
+with d as (
+  select p.oid, pg_get_functiondef(p.oid) as def
+  from   pg_proc p
+  join   pg_namespace n on n.oid = p.pronamespace
+  where  n.nspname = 'public'
+  and    p.proname = 'discover_right_now'
+),
+chunks as (
+  select d.oid,
+         d.def,
+         generate_series(1, greatest(1, ceil(length(d.def) / 4000.0)::int)) as idx
+  from   d
+)
+select oid                                          as function_oid,
+       idx                                          as chunk,
+       (select max(idx2) from (
+          select generate_series(1, greatest(1, ceil(length(c2.def) / 4000.0)::int)) as idx2
+          from d c2 where c2.oid = chunks.oid
+        ) z)                                       as chunks_total,
+       length(def)                                  as total_chars,
+       substr(def, (idx - 1) * 4000 + 1, 4000)      as part
+from   chunks
+order  by oid, idx;