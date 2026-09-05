-- 0005: the template catalogue, filled in.
--
-- The table existed from 0001 but held one placeholder row, so the picker in the admin
-- offered a restaurant a design it does not have and hid the one it is using. A template
-- is a row here plus a stylesheet in `app/src/lib/css/`; these two are the ones whose CSS
-- we actually ship (`css/index.json`), and the list must not claim more than that.
--
-- `listed` is what the picker offers. `plain` stays unlisted: it is the fallback a
-- restaurant lands on when a template is retired, not something anyone should choose.

insert into templates (id, name, listed, defaults) values
    ('monday_greens', 'Monday Greens', true, '{}'::jsonb),
    ('elegant_black', 'Elegant Black', true, '{}'::jsonb)
on conflict (id) do update
    set name = excluded.name,
        listed = excluded.listed;

update templates set listed = false where id = 'plain';

-- Every restaurant must name a template it can actually be rendered with. A null here
-- renders the default, which is right, but a template_id naming a row that does not exist
-- is a picker that silently drops the current value.
update tenants
   set template_id = coalesce(settings->>'template_key', 'monday_greens')
 where template_id is null
    or template_id not in (select id from templates);
